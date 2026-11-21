import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildClaimConfig, prepareClaimConfig } from "../scripts/lib/draft-to-config.mjs";

const script = fileURLToPath(new URL("../scripts/draft-to-config.mjs", import.meta.url));
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "claim-bridge-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const receipt = path.join(dir, "receipt.txt");
  await fs.writeFile(receipt, "Synthetic receipt");
  const request = { request_id: "request-one", receipts: [{ id: "r1", path: receipt }] };
  const item = {
    receipt_ids: ["r1"], expense_type: "Registration/Conference/Visa Fee", date_from: "2026-02-03", date_to: "2026-02-04",
    currency: "USD", amount: 123.45, business_purpose: "Conference attendance", particular: "Registration", justification: "Approved research travel",
    attachments: [receipt], confidence: 0.98, review_notes: [],
  };
  const draft = { source_request_id: "request-one", line_items: [item], open_questions: [], summary: { estimated_total_by_currency: [{ currency: "USD", total: 123.45 }], notes: [] } };
  const options = { draftPath: path.join(dir, "draft.json"), requestPath: path.join(dir, "request.json"), outPath: path.join(dir, "claim.local.json"), reviewed: true };
  async function save() {
    await fs.writeFile(options.draftPath, JSON.stringify(draft));
    await fs.writeFile(options.requestPath, JSON.stringify(request));
  }
  await save();
  return { dir, receipt, draft, request, item, options, save };
}

test("maps reviewed rows to fixed fields, dates and amounts with all preflight checks first", async t => {
  const f = await fixture(t);
  f.draft.line_items.push({ ...f.item, amount: 0.1, date_from: "2026-12-31", date_to: "2027-01-01" });
  f.draft.summary.estimated_total_by_currency[0].total = 123.55;
  const { config, rowCount } = await buildClaimConfig(f.draft, f.request);
  assert.equal(rowCount, 2);
  assert.equal(config.submit, false);
  assert.equal(config.submitStep, undefined);
  assert.equal(config.steps.length, 36);
  assert.ok(config.steps.slice(0, 18).every(step => step.action === "waitFor" && step.state === "attached"));
  assert.ok(config.steps.slice(18).every(step => ["fill", "select", "upload"].includes(step.action)));
  assert.deepEqual(config.steps.slice(18).map(step => step.locator.nth), [...Array(9).fill(0), ...Array(9).fill(1)]);
  const edits = config.steps.slice(18);
  assert.equal(edits[1].value, "03/02/2026");
  assert.equal(edits[10].value, "31/12/2026");
  assert.equal(edits[11].value, "01/01/2027");
  assert.equal(edits[5].value, "123.45");
  assert.equal(edits[14].value, "0.1");
  assert.deepEqual(edits[8].files, [f.receipt]);
  const sample = JSON.parse(await fs.readFile(new URL("../config/claim.sample.json", import.meta.url), "utf8"));
  assert.deepEqual(edits.slice(0, 9).map(step => step.locator), sample.steps.map(step => step.locator));
});

test("requires review acknowledgement and never writes an unreviewed output", async t => {
  const f = await fixture(t);
  await assert.rejects(prepareClaimConfig({ ...f.options, reviewed: false }), /--reviewed/);
  await assert.rejects(fs.stat(f.options.outPath), { code: "ENOENT" });
  await prepareClaimConfig(f.options);
  assert.equal(JSON.parse(await fs.readFile(f.options.outPath, "utf8")).submit, false);
});

test("rejects missing or mismatched request identity", async t => {
  const f = await fixture(t);
  for (const source_request_id of [undefined, "", "another-request"]) {
    await assert.rejects(buildClaimConfig({ ...f.draft, source_request_id }, f.request), /source_request_id/);
  }
  await assert.rejects(buildClaimConfig(f.draft, { ...f.request, request_id: undefined }), /request_id/);
});

test("review acknowledgement cannot override unknown required values or foreign attachments", async t => {
  const f = await fixture(t);
  f.item.amount = null;
  await f.save();
  await assert.rejects(prepareClaimConfig(f.options), /not ready/);
  f.item.amount = 123.45;
  f.item.attachments.push(path.join(f.dir, "unrelated.txt"));
  await fs.writeFile(f.item.attachments[1], "Not a source receipt");
  await f.save();
  await assert.rejects(prepareClaimConfig(f.options), /not ready/);
  await assert.rejects(fs.stat(f.options.outPath), { code: "ENOENT" });
});

test("source receipt IDs and attachment file availability are required", async t => {
  const f = await fixture(t);
  f.item.receipt_ids = ["unknown-id"];
  await assert.rejects(buildClaimConfig(f.draft, f.request), /not ready/);
  f.item.receipt_ids = ["r1"];
  await fs.unlink(f.receipt);
  await assert.rejects(buildClaimConfig(f.draft, f.request), /readable regular files/);
  await fs.mkdir(f.receipt);
  await assert.rejects(buildClaimConfig(f.draft, f.request), /readable regular files/);
});

test("preserves existing output unless explicitly forced, replacing atomically", async t => {
  const f = await fixture(t);
  await fs.writeFile(f.options.outPath, "existing-output");
  await assert.rejects(prepareClaimConfig(f.options), /already exists/);
  assert.equal(await fs.readFile(f.options.outPath, "utf8"), "existing-output");
  await prepareClaimConfig({ ...f.options, force: true });
  assert.equal(JSON.parse(await fs.readFile(f.options.outPath, "utf8")).submit, false);
  assert.ok(!(await fs.readdir(f.dir)).some(name => name.endsWith(".tmp")));
});

test("refuses to overwrite source draft or request, including file aliases", async t => {
  const f = await fixture(t);
  for (const outPath of [f.options.draftPath, f.options.requestPath, f.receipt]) {
    await assert.rejects(prepareClaimConfig({ ...f.options, outPath, force: true }), /must not overwrite/);
  }
  const alias = path.join(f.dir, "alias.json");
  await fs.link(f.options.draftPath, alias);
  await assert.rejects(prepareClaimConfig({ ...f.options, outPath: alias, force: true }), /must not overwrite/);
});

test("keeps model-supplied field text in values and reports review warnings", async t => {
  const f = await fixture(t);
  f.item.confidence = 0.2;
  f.item.review_notes = ["Check conference purpose"];
  f.draft.open_questions = ["Confirm funding source"];
  f.item.particular = 'textarea, [type="submit"]';
  const result = await buildClaimConfig(f.draft, f.request);
  assert.ok(result.warnings.length >= 3);
  assert.equal(result.config.steps.find(step => step.action === "fill" && step.locator.value.endsWith(".Particular")).value, f.item.particular);
  assert.ok(result.config.steps.every(step => step.locator.value.startsWith("UST_FO_ExpenseStudentForm_LNEDetail.")));
});

test("CLI provides help, enforces acknowledgement, and displays row preparation and warnings", async t => {
  const f = await fixture(t);
  const run = args => spawnSync(process.execPath, [script, ...args], { cwd: f.dir, encoding: "utf8", timeout: 10000 });
  const help = run(["--help"]);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /draft:prepare/);
  for (const args of [[], ["--draft"], ["--unknown"]]) assert.equal(run(args).status, 1);
  f.item.confidence = 0.1;
  await f.save();
  const result = run(["--reviewed", "--draft", f.options.draftPath, "--request", f.options.requestPath, "--out", f.options.outPath]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /at least 1 expense row/);
  assert.match(result.stderr, /Review warning:/);
  assert.ok(JSON.parse(await fs.readFile(f.options.outPath, "utf8")).steps.length > 0);
});


test("protects every source receipt from forced overwrite even when omitted from the draft", async t => {
  const f = await fixture(t);
  const omitted = path.join(f.dir, "omitted-receipt.txt");
  await fs.writeFile(omitted, "Original omitted receipt");
  f.request.receipts.push({ id: "r2", path: omitted });
  await f.save();
  const alias = path.join(f.dir, "omitted-alias.txt");
  await fs.link(omitted, alias);
  for (const outPath of [omitted, alias]) {
    await assert.rejects(prepareClaimConfig({ ...f.options, outPath, force: true }), /must not overwrite/);
  }
  assert.equal(await fs.readFile(omitted, "utf8"), "Original omitted receipt");
});
