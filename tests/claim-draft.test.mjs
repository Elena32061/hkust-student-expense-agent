import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateClaimDraft } from "../scripts/lib/claim-draft.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const receipts = [{ id: "receipt-1", path: "/synthetic/receipt.txt" }];
function draft() {
  return {
    line_items: [{ receipt_ids: ["receipt-1"], expense_type: "Registration/Conference/Visa Fee", date_from: "2024-02-29", date_to: "2024-03-01", currency: "USD", amount: 123.45, business_purpose: "Conference attendance", particular: "Registration", justification: "Research presentation", attachments: ["/synthetic/receipt.txt"], confidence: 0.95, review_notes: [] }],
    open_questions: [], summary: { estimated_total_by_currency: [{ currency: "USD", total: 123.45 }], notes: [] },
  };
}
const errorsFor = (value, options = { receipts }) => validateClaimDraft(value, options).errors;

test("valid complete draft passes provenance and readiness validation", () => {
  assert.deepEqual(validateClaimDraft(draft(), { receipts, requireReady: true }), { errors: [], warnings: [] });
});

test("malformed root and nested shapes return errors without throwing", () => {
  for (const value of [undefined, null, [], 4, "draft", {}, { line_items: [null, [], 3], open_questions: null, summary: [] }]) {
    assert.doesNotThrow(() => validateClaimDraft(value));
    assert.ok(errorsFor(value).length);
  }
  const value = draft();
  value.summary.estimated_total_by_currency = [null, [], 4];
  assert.equal(errorsFor(value).filter((entry) => entry.includes("must be an object")).length, 3);
});

test("unknown extracted fields are explicit nulls, not fabricated values", () => {
  const value = draft();
  const item = value.line_items[0];
  for (const key of ["expense_type", "date_from", "date_to", "currency", "amount", "business_purpose", "particular", "justification"]) item[key] = null;
  value.summary.estimated_total_by_currency = [];
  const result = validateClaimDraft(value, { receipts });
  assert.deepEqual(result.errors, []);
  assert.equal(result.warnings.length, 8);
  assert.equal(validateClaimDraft(value, { receipts, requireReady: true }).errors.length, 8);
  delete item.amount;
  assert.match(errorsFor(value).join("\n"), /amount must be/);
});

test("empty drafts are unresolved and are rejected by ready validation", () => {
  const value = { line_items: [], open_questions: [], summary: { estimated_total_by_currency: [], notes: [] } };
  assert.deepEqual(errorsFor(value), []);
  assert.match(validateClaimDraft(value).warnings.join("\n"), /no claim items/);
  assert.match(errorsFor(value, { requireReady: true }).join("\n"), /no claim items/);
});

for (const date of ["2025-02-29", "1900-02-29", "2024-02-30", "2024-04-31", "2024-13-01", "0000-01-01", "2024-2-01", "2024-00-01"]) {
  test(`rejects invalid calendar date ${date}`, () => {
    const value = draft(); value.line_items[0].date_from = date;
    assert.match(errorsFor(value).join("\n"), /date_from must be a real/);
  });
}

test("accepts leap centuries and rejects reversed date intervals", () => {
  const value = draft(); value.line_items[0].date_from = "2000-02-29";
  assert.deepEqual(errorsFor(value), []);
  value.line_items[0].date_from = "2024-03-02";
  assert.match(errorsFor(value).join("\n"), /must not precede/);
});

test("requires finite non-negative amounts and finite confidence in range", () => {
  for (const amount of [NaN, Infinity, -1, "123.45"]) {
    const value = draft(); value.line_items[0].amount = amount;
    assert.match(errorsFor(value).join("\n"), /amount must be a finite/);
  }
  for (const confidence of [NaN, Infinity, -0.1, 1.1, null]) {
    const value = draft(); value.line_items[0].confidence = confidence;
    assert.match(errorsFor(value).join("\n"), /confidence must be a finite/);
  }
  const value = draft(); value.line_items[0].currency = "usd";
  assert.match(errorsFor(value).join("\n"), /uppercase three-letter/);
});

test("empty required strings, arrays, malformed notes and unsupported keys are rejected", () => {
  const value = draft();
  Object.assign(value.line_items[0], { business_purpose: " ", receipt_ids: [], attachments: [], review_notes: [null], unsupported: "private value" });
  value.open_questions = [2]; value.summary.notes = null;
  const errors = errorsFor(value).join("\n");
  assert.match(errors, /receipt_ids must not be empty/);
  assert.match(errors, /attachments must not be empty/);
  assert.match(errors, /business_purpose/);
  assert.match(errors, /unsupported properties/);
  assert.doesNotMatch(errors, /private value/);
});

test("receipt provenance rejects unknown IDs, extra paths and duplicate IDs", () => {
  const value = draft();
  value.line_items[0].receipt_ids = ["invented-private-id"];
  let errors = errorsFor(value).join("\n");
  assert.match(errors, /does not reference a known request receipt/);
  assert.doesNotMatch(errors, /invented-private-id/);
  value.line_items[0].receipt_ids = ["receipt-1", "receipt-1"];
  assert.match(errorsFor(value).join("\n"), /must not contain duplicates/);
  value.line_items[0].receipt_ids = ["receipt-1"];
  value.line_items[0].attachments = ["/invented/private.txt"];
  errors = errorsFor(value).join("\n");
  assert.match(errors, /exactly match/); assert.doesNotMatch(errors, /private.txt/);
  assert.match(errorsFor(draft(), { receipts: [...receipts, ...receipts] }).join("\n"), /duplicates another request receipt ID/);
  assert.match(errorsFor(draft(), { receipts: [null, {}] }).join("\n"), /receipts/);
  assert.match(errorsFor(draft(), { receipts: null }).join("\n"), /receipts must be an array/);
});

test("multiple supporting receipts require exactly their source-path set", () => {
  const sources = [...receipts, { id: "receipt-2", path: "/synthetic/receipt2.txt" }];
  const value = draft();
  value.line_items[0].receipt_ids.push("receipt-2");
  assert.match(errorsFor(value, { receipts: sources }).join("\n"), /exactly match/);
  value.line_items[0].attachments.unshift(sources[1].path);
  assert.deepEqual(errorsFor(value, { receipts: sources }), []);
});

test("unreferenced request receipts produce review warnings without exposing source data", () => {
  const sources = [...receipts, { id: "private-unclaimed-id", path: "/private/unclaimed-receipt.txt" }];
  const result = validateClaimDraft(draft(), { receipts: sources, requireReady: true });
  assert.deepEqual(result.errors, []);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /receipts\[1\] is not referenced by any line item/);
  assert.doesNotMatch(result.warnings.join("\n"), /private|unclaimed/);
});

test("receipt reuse across line items warns for review but allows split invoices", () => {
  const value = draft();
  value.line_items[0].amount = 100;
  value.line_items.push({ ...value.line_items[0], amount: 23.45 });
  const result = validateClaimDraft(value, { receipts, requireReady: true });
  assert.deepEqual(result.errors, []);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /receipts\[0\] is referenced by multiple line items/);
});

test("fully covered request receipts produce no provenance warnings", () => {
  const sources = [...receipts, { id: "receipt-2", path: "/synthetic/receipt2.txt" }];
  const value = draft();
  value.line_items[0].receipt_ids.push("receipt-2");
  value.line_items[0].attachments.push(sources[1].path);
  assert.deepEqual(validateClaimDraft(value, { receipts: sources, requireReady: true }), { errors: [], warnings: [] });
});

test("currency totals reject duplicates, missing currencies, extras and mismatches", () => {
  for (const totals of [[], [{ currency: "EUR", total: 123.45 }], [{ currency: "USD", total: 123.46 }], [{ currency: "USD", total: 123.45 }, { currency: "USD", total: 123.45 }]]) {
    const value = draft(); value.summary.estimated_total_by_currency = totals;
    assert.ok(errorsFor(value).length);
  }
});

test("sum decimal amounts without rounding and tolerate floating-point JSON artifacts", () => {
  const value = draft();
  value.line_items[0].amount = 0.1;
  value.line_items.push({ ...value.line_items[0], amount: 0.2 });
  value.summary.estimated_total_by_currency[0].total = 0.3;
  assert.deepEqual(errorsFor(value), []);
  value.summary.estimated_total_by_currency[0].total = 0.1 + 0.2;
  assert.deepEqual(errorsFor(value), []);
  value.line_items[0].amount = 1e-7; value.line_items[1].amount = 0.1234567;
  value.summary.estimated_total_by_currency[0].total = 0.1234568;
  assert.deepEqual(errorsFor(value), []);
  value.summary.estimated_total_by_currency[0].total = 0.12;
  assert.match(errorsFor(value).join("\n"), /does not match/);
  value.line_items.forEach((item) => { item.amount = 1e308; });
  value.summary.estimated_total_by_currency[0].total = 1e308;
  assert.match(errorsFor(value).join("\n"), /does not match/);
});

test("null currency totals are required only for incomplete amounts", () => {
  const value = draft();
  value.summary.estimated_total_by_currency[0].total = null;
  assert.match(errorsFor(value).join("\n"), /may be null only/);
  value.line_items[0].amount = null;
  assert.deepEqual(errorsFor(value), []);
  assert.match(validateClaimDraft(value).warnings.join("\n"), /total is incomplete/);
  value.summary.estimated_total_by_currency[0].total = 0;
  assert.match(errorsFor(value).join("\n"), /must be null/);
});

test("questions, notes and low confidence remain review warnings in ready mode", () => {
  const value = draft(); value.open_questions = ["Confirm expense category"];
  value.line_items[0].review_notes = ["Verify source"];
  value.line_items[0].confidence = 0.42;
  const result = validateClaimDraft(value, { receipts, requireReady: true });
  assert.deepEqual(result.errors, []); assert.equal(result.warnings.length, 3);
});

test("check-draft CLI reports unresolved draft without claiming readiness and checks provenance", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "claim-draft-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const target = path.join(dir, "draft.json"); const request = path.join(dir, "request.json");
  const value = draft(); value.source_request_id = "request-1"; value.line_items[0].business_purpose = null;
  await fs.writeFile(target, JSON.stringify(value)); await fs.writeFile(request, JSON.stringify({ request_id: "request-1", receipts }));
  const run = (...args) => spawnSync(process.execPath, [path.join(root, "scripts/check-draft.mjs"), target, ...args], { encoding: "utf8" });
  const normal = run("--request", request);
  assert.equal(normal.status, 0); assert.match(normal.stdout, /unresolved fields or review warnings remain/);
  assert.equal(run("--ready").status, 1);
  await fs.writeFile(request, JSON.stringify({ request_id: "different", receipts }));
  assert.match(run("--request", request).stderr, /source_request_id does not match/);
  await fs.writeFile(target, '{"secret":"private" invalid');
  const invalid = run(); assert.equal(invalid.status, 1); assert.doesNotMatch(invalid.stderr, /private/);
});

test("existing mock provider output passes the shared validator", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "claim-mock-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const request = path.join(dir, "request.json");
  await fs.writeFile(request, JSON.stringify({ receipts }));
  const output = spawnSync(process.execPath, [path.join(root, "examples/mock-command-provider.mjs")], { env: { ...process.env, CLAIM_REQUEST_PATH: request }, encoding: "utf8" });
  assert.equal(output.status, 0, output.stderr);
  assert.deepEqual(errorsFor(JSON.parse(output.stdout)), []);
});
