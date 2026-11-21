import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { runStep, runSteps, resolveLocator } from "../scripts/lib/automation.mjs";

let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function form(t, html) {
  const page = await browser.newPage();
  t.after(() => page.close());
  page.setDefaultTimeout(1000);
  await page.setContent(html);
  return page;
}

const bound = (value, extra = {}) => ({ kind: "dataBind", value, ...extra });

test("default dataBind tags stay scoped to the requested field", async (t) => {
  const page = await form(t, `
    <textarea id="unrelated">untouched</textarea><select id="other"><option>other</option></select>
    <div class="yz-xform-field-cnt" xdatabind="claim.purpose"><textarea id="purpose"></textarea></div>
    <div class="yz-xform-field-cnt" xdatabind="claim.price"><input id="price"></div>
  `);
  await runStep(page, { action: "fill", locator: bound("claim.purpose"), value: "Conference" });
  await runStep(page, { action: "fill", locator: bound("claim.price"), value: "12.50" });
  assert.equal(await page.locator("#purpose").inputValue(), "Conference");
  assert.equal(await page.locator("#price").inputValue(), "12.50");
  assert.equal(await page.locator("#unrelated").inputValue(), "untouched");
  assert.equal(await page.locator("#other").inputValue(), "other");
});

test("dataBind nth selects a repeated row within the binding", async (t) => {
  const page = await form(t, `
    <div class="yz-xform-field-cnt" xdatabind="claim.amount"><input></div>
    <div class="yz-xform-field-cnt" xdatabind="claim.amount"><input></div>
  `);
  await runStep(page, { action: "fill", locator: bound("claim.amount", { nth: 1 }), value: "2" });
  assert.deepEqual(await page.locator("input").evaluateAll(nodes => nodes.map(n => n.value)), ["", "2"]);
});

test("explicit nth works across selector, label, placeholder, text and role locators", async (t) => {
  const page = await form(t, `
    <label>Amount<input placeholder="Price"></label>
    <label>Amount<input placeholder="Price"></label>
    <button>Apply</button><button>Apply</button>
  `);
  for (const locator of [
    { kind: "selector", value: "input", nth: 1 },
    { kind: "label", value: "Amount", nth: 1 },
    { kind: "placeholder", value: "Price", nth: 1 },
  ]) {
    await runStep(page, { action: "fill", locator, value: locator.kind });
    assert.equal(await page.locator("input").nth(1).inputValue(), locator.kind);
    assert.equal(await page.locator("input").nth(0).inputValue(), "");
  }
  for (const locator of [
    { kind: "text", value: "Apply", nth: 1 },
    { kind: "role", role: "button", value: "Apply", nth: 1 },
  ]) {
    const target = await resolveLocator(page, { locator });
    assert.equal(await target.evaluate(node => node === document.querySelectorAll("button")[1]), true);
  }
  const strict = await resolveLocator(page, { locator: { kind: "role", role: "button", value: "Apply" } });
  await assert.rejects(() => strict.click(), /strict mode violation/);
});

test("fill events, select, check, click and waitFor work on a synthetic form", async (t) => {
  const page = await form(t, `
    <input id="amount"><select id="currency"><option value="USD">US Dollar</option><option value="HKD">HK Dollar</option></select>
    <input type="checkbox" id="confirm"><button id="add">Add</button>
    <div id="result" hidden>Ready</div>
    <script>
      window.changes = [];
      document.querySelector('#amount').addEventListener('change', e => window.changes.push(e.target.value));
      document.querySelector('#add').onclick = () => document.querySelector('#result').hidden = false;
    </script>
  `);
  await runSteps(page, [
    { action: "fill", locator: { kind: "selector", value: "#amount" }, value: "100" },
    { action: "select", locator: { kind: "selector", value: "#currency" }, value: "HKD" },
    { action: "check", locator: { kind: "selector", value: "#confirm" } },
    { action: "click", locator: { kind: "selector", value: "#add" } },
    { action: "waitFor", locator: { kind: "selector", value: "#result" }, state: "visible" },
  ]);
  assert.equal(await page.locator("#amount").inputValue(), "100");
  assert.ok((await page.evaluate(() => window.changes)).includes("100"));
  assert.equal(await page.locator("#currency").inputValue(), "HKD");
  assert.equal(await page.locator("#confirm").isChecked(), true);
  assert.equal(await page.locator("#result").isVisible(), true);
});

test("upload attaches a local synthetic receipt", async (t) => {
  const page = await form(t, '<input id="receipt" type="file">');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eform-upload-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const receipt = path.join(dir, "synthetic-receipt.txt");
  await fs.writeFile(receipt, "Synthetic receipt only");
  await runStep(page, { action: "upload", locator: { kind: "selector", value: "#receipt" }, files: [receipt] });
  assert.equal(await page.locator("#receipt").evaluate(node => node.files[0].name), "synthetic-receipt.txt");
});

test("frame hints scope filling to the matching iframe", async (t) => {
  const page = await form(t, `<input id="amount"><iframe name="claim" srcdoc="<input id='amount'>"></iframe>`);
  await runStep(page, { action: "fill", frame: { name: "claim" }, locator: { kind: "selector", value: "#amount" }, value: "20" });
  assert.equal(await page.frame({ name: "claim" }).locator("#amount").inputValue(), "20");
  assert.equal(await page.locator("#amount").inputValue(), "");
});

test("zero wait does not fall back to a default delay", async () => {
  const delays = [];
  const page = { waitForTimeout: async delay => { delays.push(delay); } };
  await runStep(page, { action: "wait", waitMs: 0, value: 999 });
  await runStep(page, { action: "wait", value: 0 });
  await runStep(page, { action: "wait" });
  assert.deepEqual(delays, [0, 0, 500]);
});

test("a failed step identifies its index and stops subsequent actions", async (t) => {
  const page = await form(t, '<input id="amount">');
  await assert.rejects(() => runSteps(page, [
    { action: "wait", waitMs: 0 },
    { action: "fill", locator: { kind: "selector", value: "#missing" }, value: "100" },
    { action: "fill", locator: { kind: "selector", value: "#amount" }, value: "200" },
  ]), /Step 2\/3 \(fill\) failed:/);
  assert.equal(await page.locator("#amount").inputValue(), "");
});


test("custom fieldSelector lists keep the binding constraint on every container", async (t) => {
  const page = await form(t, `
    <div class="custom-a" xdatabind="other"><input value="untouched"></div>
    <div class="custom-b" xdatabind="claim.amount"><input></div>
  `);
  await runStep(page, {
    action: "fill", locator: bound("claim.amount", { fieldSelector: ".custom-a, .custom-b" }), value: "10",
  });
  assert.deepEqual(await page.locator("input").evaluateAll(nodes => nodes.map(n => n.value)), ["untouched", "10"]);
});

test("CLI rejects invalid configuration before creating browser state", async (t) => {
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "eform-preflight-"));
  t.after(() => fs.rm(fixture, { recursive: true, force: true }));
  await fs.cp(path.join(projectRoot, "scripts"), path.join(fixture, "scripts"), { recursive: true });
  await fs.symlink(path.join(projectRoot, "node_modules"), path.join(fixture, "node_modules"), "junction");
  const config = path.join(fixture, "invalid.json");
  await fs.writeFile(config, JSON.stringify({ steps: [{ action: "unknown" }] }));
  const result = spawnSync(process.execPath, [path.join(fixture, "scripts/eform-agent.mjs"), "fill", "--config", config], {
    encoding: "utf8", timeout: 10000,
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /action/i);
  assert.doesNotMatch(result.stdout, /Browser opened/);
  await assert.rejects(fs.stat(path.join(fixture, ".auth")), { code: "ENOENT" });
  await assert.rejects(fs.stat(path.join(fixture, "artifacts")), { code: "ENOENT" });
});

test("CLI help and argument errors finish without starting the browser", () => {
  const script = fileURLToPath(new URL("../scripts/eform-agent.mjs", import.meta.url));
  const help = spawnSync(process.execPath, [script, "--help"], { encoding: "utf8", timeout: 10000 });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Usage:/);
  for (const args of [["fill", "--config"], ["fill", "--unknown"], ["snapshot", "--url", "file:///tmp/form.html"]]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8", timeout: 10000 });
    assert.equal(result.status, 1, result.stderr);
    assert.doesNotMatch(result.stdout, /Browser opened/);
  }
});

test("navigation failure closes the browser and releases its profile", async (t) => {
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "eform-cleanup-"));
  t.after(() => fs.rm(fixture, { recursive: true, force: true }));
  await fs.cp(path.join(projectRoot, "scripts"), path.join(fixture, "scripts"), { recursive: true });
  await fs.symlink(path.join(projectRoot, "node_modules"), path.join(fixture, "node_modules"), "junction");
  // Chromium blocks port 1 immediately: no server, school endpoint or login is involved.
  const result = spawnSync(process.execPath, [
    path.join(fixture, "scripts/eform-agent.mjs"), "snapshot", "--headless", "--url", "http://127.0.0.1:1",
  ], { encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /net::ERR_/);
  const reopened = await chromium.launchPersistentContext(path.join(fixture, ".auth/hkust-eform"), { headless: true });
  await reopened.close();
});
