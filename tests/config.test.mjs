import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../scripts/lib/config.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const field = { kind: "selector", value: "#purpose" };
const fill = () => ({ action: "fill", locator: field, value: "Synthetic claim" });

async function fixture(t, config) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eform-config-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const target = path.join(dir, "claim.json");
  await fs.writeFile(target, JSON.stringify(config));
  return { dir, target };
}

test("validates all supported actions and preserves zero waits and numeric values", async (t) => {
  const config = { submit: false, steps: [
    fill(), { ...fill(), value: "" },
    { action: "select", locator: field, value: 0 },
    { action: "select", locator: field, value: "" },
    { action: "click", locator: { kind: "role", role: "button", value: "Add", nth: 1 } },
    { action: "check", locator: field, frame: { name: "claim", urlIncludes: "form" } },
    { action: "wait", waitMs: 0 }, { action: "wait", value: 0 }, { action: "wait" },
    { action: "waitFor", locator: field, state: "hidden" },
  ] };
  const { target } = await fixture(t, config);
  assert.deepEqual(await loadConfig(target), config);
});

const malformed = [
  [null, /config must be an object/],
  [[], /config must be an object/],
  [{}, /steps must be a non-empty array/],
  [{ steps: [] }, /steps must be a non-empty array/],
  [{ steps: [null] }, /steps\[0\] must be an object/],
  [{ steps: [{}] }, /steps\[0\].action/],
  [{ steps: [{ ...fill(), action: "unknown" }] }, /steps\[0\].action/],
  [{ steps: [{ action: "fill", value: "a" }] }, /steps\[0\].locator/],
  [{ steps: [{ ...fill(), locator: { kind: "unknown", value: "x" } }] }, /locator.kind/],
  [{ steps: [{ ...fill(), locator: { kind: "label", value: " " } }] }, /locator.value/],
  [{ steps: [{ ...fill(), locator: { kind: "role", value: "x" } }] }, /locator.role/],
  [{ steps: [{ ...fill(), locator: { ...field, nth: -1 } }] }, /locator.nth/],
  [{ steps: [{ ...fill(), locator: { ...field, nth: 0.5 } }] }, /locator.nth/],
  [{ steps: [{ ...fill(), locator: { ...field, tag: "" } }] }, /locator.tag/],
  [{ steps: [{ ...fill(), locator: { ...field, fieldSelector: [] } }] }, /locator.fieldSelector/],
  [{ steps: [{ ...fill(), frame: null }] }, /frame must be an object/],
  [{ steps: [{ ...fill(), frame: { name: "" } }] }, /frame.name/],
  [{ steps: [{ ...fill(), frame: { url: "unexpected" } }] }, /frame supports only/],
  [{ steps: [{ action: "fill", locator: field }] }, /value/],
  [{ steps: [{ ...fill(), value: {} }] }, /value/],
  [{ steps: [{ action: "wait", waitMs: -1 }] }, /waitMs/],
  [{ steps: [{ action: "wait", waitMs: "100" }] }, /waitMs/],
  [{ steps: [{ action: "wait", value: -1 }] }, /waitMs or value/],
  [{ steps: [{ ...fill(), waitMs: -1 }] }, /waitMs/],
  [{ steps: [{ action: "waitFor", locator: field, state: "ready" }] }, /state/],
  [{ steps: [fill()], formUrl: "file:///tmp/page" }, /formUrl/],
  [{ steps: [fill()], formUrl: "not a url" }, /formUrl/],
  [{ steps: [fill()], submit: "false" }, /submit must be a boolean/],
  [{ steps: [fill()], submit: true }, /submitStep is required/],
  [{ steps: [fill()], submitStep: fill() }, /submitStep.action must be click/],
  [{ steps: [fill()], submitStep: null }, /submitStep must be an object/],
  [{ steps: [{ action: "upload", locator: field, files: [] }] }, /files must be a non-empty array/],
  [{ steps: [{ action: "upload", locator: field, files: [null] }] }, /files\[0\]/],
  [{ steps: [{ action: "upload", locator: field, files: ["/absolute/path/to/receipt.pdf"] }] }, /sample placeholder/],
];

for (const [index, [config, expected]] of malformed.entries()) {
  test(`rejects malformed config ${index + 1}: ${expected}`, async (t) => {
    const { target } = await fixture(t, config);
    await assert.rejects(loadConfig(target), expected);
  });
}

test("normalizes relative attachment paths from cwd and accepts regular files", async (t) => {
  const { dir, target } = await fixture(t, {});
  const receipt = path.join(dir, "receipt.txt");
  await fs.writeFile(receipt, "synthetic receipt");
  await fs.writeFile(target, JSON.stringify({ steps: [{ action: "upload", locator: field, files: [path.relative(process.cwd(), receipt)] }] }));
  const config = await loadConfig(target);
  assert.deepEqual(config.steps[0].files, [receipt]);
});

test("rejects missing files and directories before any form filling", async (t) => {
  const { dir, target } = await fixture(t, {});
  for (const file of [dir, path.join(dir, "missing.pdf")]) {
    await fs.writeFile(target, JSON.stringify({ steps: [{ action: "upload", locator: field, files: [file] }] }));
    await assert.rejects(loadConfig(target), /steps\[0\].files\[0\].*(regular file|existing readable file)/);
  }
});

test("requires a configured click for CLI-requested submission", async (t) => {
  const { target } = await fixture(t, { steps: [fill()] });
  await assert.rejects(loadConfig(target, { requireSubmitStep: true }), /submitStep is required/);
  await fs.writeFile(target, JSON.stringify({ steps: [fill()], submitStep: { action: "click", locator: field } }));
  assert.equal((await loadConfig(target, { requireSubmitStep: true })).submitStep.action, "click");
});

test("invalid JSON errors do not disclose claim contents", async (t) => {
  const { target } = await fixture(t, {});
  await fs.writeFile(target, '{"bank": "private-bank-details" invalid');
  await assert.rejects(loadConfig(target), (error) => {
    assert.match(error.message, /Invalid JSON/);
    assert.doesNotMatch(error.message, /private-bank-details/);
    return true;
  });
});

test("missing configs provide an actionable error", async (t) => {
  const { dir } = await fixture(t, {});
  await assert.rejects(loadConfig(path.join(dir, "missing.json")), /Copy config\/claim.sample.json/);
});

test("check CLI rejects the sample placeholder and malformed args, and supports help", () => {
  const run = (...args) => spawnSync(process.execPath, [path.join(root, "scripts/check-config.mjs"), ...args], { encoding: "utf8", cwd: os.tmpdir() });
  const sample = run("config/claim.sample.json");
  assert.equal(sample.status, 1);
  assert.match(sample.stderr, /sample placeholder/);
  const badArgs = run("--unknown");
  assert.equal(badArgs.status, 1);
  const help = run("--help");
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage:/);
});
