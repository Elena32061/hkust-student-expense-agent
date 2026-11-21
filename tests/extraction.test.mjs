import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runCommand } from "../scripts/lib/run-command.mjs";
import { runCommandProvider } from "../scripts/lib/provider-command.mjs";
import { extractReceiptText } from "../scripts/lib/extract-text.mjs";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const runner = path.join(root, "scripts/extract-receipts.mjs");

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "claim-extraction-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const receipt = path.join(dir, "receipt.txt");
  await fs.writeFile(receipt, "Synthetic registration receipt USD 123.45 2026-01-01");
  const config = {
    artifactsDir: path.join(dir, "artifacts"), schemaPath: path.join(root, "schemas/claim-draft.schema.json"),
    receipts: [{ id: "sample", path: receipt }],
    provider: { type: "command", command: process.execPath, args: [path.join(root, "examples/mock-command-provider.mjs")] },
  };
  return { dir, receipt, config };
}

async function cli(dir, config, name = "config.json") {
  const target = path.join(dir, name);
  await fs.writeFile(target, JSON.stringify(config));
  try {
    return { code: 0, ...await exec(process.execPath, [runner, "--config", target], { cwd: root, timeout: 10000 }) };
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

async function executable(dir, name, source) {
  const target = path.join(dir, `${name}.mjs`);
  await fs.writeFile(target, `#!${process.execPath}\n${source}`, { mode: 0o755 });
  return target;
}

const nodeProvider = source => ({ type: "command", command: process.execPath, args: ["-e", source] });

test("successful extraction saves validated draft tied to its exact request", async t => {
  const { dir, config } = await fixture(t);
  const result = await cli(dir, config);
  assert.equal(result.code, 0, result.stderr);
  const request = JSON.parse(await fs.readFile(path.join(config.artifactsDir, "extract-request.latest.json")));
  const draft = JSON.parse(await fs.readFile(path.join(config.artifactsDir, "claim-draft.latest.json")));
  assert.match(request.request_id, /^[0-9a-f-]{36}$/);
  assert.equal(draft.source_request_id, request.request_id);
  assert.deepEqual(draft.line_items[0].receipt_ids, ["sample"]);
  assert.match(request.instructions.join(" "), /untrusted/);
  assert.match(request.instructions.join(" "), /null/);
});

test("provider timeout, invalid JSON, and invalid draft leave latest successful pair untouched", async t => {
  const { dir, config } = await fixture(t);
  assert.equal((await cli(dir, config)).code, 0);
  const latest = ["extract-request.latest.json", "claim-draft.latest.json"];
  const before = await Promise.all(latest.map(name => fs.readFile(path.join(config.artifactsDir, name), "utf8")));
  const cases = [
    [{ ...nodeProvider("setInterval(()=>{},1000)"), timeoutMs: 80 }, /timed out/],
    [nodeProvider("process.stdout.write('PRIVATE RECEIPT not json')"), /valid JSON/],
    [nodeProvider("process.stdout.write('{}')"), /failed validation/],
  ];
  for (const [provider, message] of cases) {
    const result = await cli(dir, { ...config, provider });
    assert.equal(result.code, 1, result.stderr);
    assert.match(result.stderr, message);
    assert.doesNotMatch(result.stderr, /PRIVATE RECEIPT/);
    assert.deepEqual(await Promise.all(latest.map(name => fs.readFile(path.join(config.artifactsDir, name), "utf8"))), before);
  }
});

test("concurrent CLI extractions use isolated provider request paths", async t => {
  const { dir, config } = await fixture(t);
  const mock = await fs.readFile(path.join(root, "examples/mock-command-provider.mjs"), "utf8");
  const delayed = await executable(dir, "delayed-provider", "await new Promise(resolve => setTimeout(resolve, 100));\n" + mock.replace(/^#!.*\n/, ""));
  const a = { ...config, receipts: [{ ...config.receipts[0], id: "run-a" }], provider: { type: "command", command: process.execPath, args: [delayed] } };
  const b = { ...a, receipts: [{ ...config.receipts[0], id: "run-b" }] };
  const results = await Promise.all([cli(dir, a, "a.json"), cli(dir, b, "b.json")]);
  for (const result of results) assert.equal(result.code, 0, result.stderr);
  const names = await fs.readdir(config.artifactsDir);
  const drafts = await Promise.all(names.filter(name => /^claim-draft-/.test(name)).map(async name => JSON.parse(await fs.readFile(path.join(config.artifactsDir, name)))));
  assert.deepEqual(drafts.map(draft => draft.line_items[0].receipt_ids[0]).sort(), ["run-a", "run-b"]);
  assert.equal(new Set(drafts.map(draft => draft.source_request_id)).size, 2);
  assert.equal(names.filter(name => /^llm-request-/.test(name)).length, 2);
});

test("invalid config and empty or oversized text fail before creating artifacts", async t => {
  const { dir, config, receipt } = await fixture(t);
  for (const change of [
    { receipts: [config.receipts[0], config.receipts[0]] },
    { receipts: [{ id: "", path: receipt }] },
    { receipts: [{ id: "x", path: dir }] },
    { receipts: [{ id: "x", path: path.join(dir, "missing") }] },
    { textExtraction: null }, { provider: null }, { provider: { type: "command", command: "node", args: "bad" } },
    { textExtraction: { timeoutMs: 0 } },
  ]) {
    const result = await cli(dir, { ...config, ...change });
    assert.equal(result.code, 1);
    await assert.rejects(fs.stat(config.artifactsDir), { code: "ENOENT" });
  }
  for (const text of [" \n", "X".repeat(25001)]) {
    await fs.writeFile(receipt, text);
    const result = await cli(dir, config);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /no readable text|25000/);
    await assert.rejects(fs.stat(config.artifactsDir), { code: "ENOENT" });
  }
});

test("command output is bounded and errors do not disclose command output", async () => {
  await assert.rejects(runCommand(process.execPath, ["-e", "process.stdout.write('X'.repeat(4096))"], { maxOutputBytes: 1024 }), /exceeded maxOutputBytes/);
  await assert.rejects(runCommand(process.execPath, ["-e", "process.stderr.write('SECRET RECEIPT');process.exit(2)"], {}), error => {
    assert.match(error.message, /exit 2/);
    assert.doesNotMatch(error.message, /SECRET RECEIPT/);
    return true;
  });
  await assert.rejects(runCommand("/missing/receipt-executable", []), /executable not found/);
});

test("timed out command is terminated even when it ignores SIGTERM", async t => {
  const { dir } = await fixture(t);
  const marker = path.join(dir, "should-not-exist");
  const script = `process.on('SIGTERM',()=>{});setTimeout(()=>require('fs').writeFileSync(${JSON.stringify(marker)},'alive'),600);setInterval(()=>{},1000)`;
  await assert.rejects(runCommand(process.execPath, ["-e", script], { timeoutMs: 100 }), /timed out/);
  await new Promise(resolve => setTimeout(resolve, 450));
  await assert.rejects(fs.stat(marker), { code: "ENOENT" });
});

test("provider receives an immutable unique request file", async t => {
  const { dir } = await fixture(t);
  const source = "const fs=require('fs');setTimeout(()=>{const p=process.env.CLAIM_REQUEST_PATH;process.stdout.write(JSON.stringify({path:p,request:JSON.parse(fs.readFileSync(p,'utf8'))}))},40)";
  const provider = nodeProvider(source);
  const results = await Promise.all([runCommandProvider(provider, { id: "A" }, dir), runCommandProvider(provider, { id: "B" }, dir)]);
  assert.deepEqual(results.map(result => result.request.id), ["A", "B"]);
  assert.notEqual(results[0].path, results[1].path);
});

async function ocrStubs(dir, pageCount = 2) {
  const log = path.join(dir, "render-prefix.txt");
  return {
    enableOcrForPdfs: true,
    pdftotextCommand: await executable(dir, "pdftotext", "process.stdout.write('');"),
    pdftoppmCommand: await executable(dir, "pdftoppm", `import fs from 'node:fs';const p=process.argv.at(-1);fs.writeFileSync(${JSON.stringify(log)},p);for(let i=1;i<=${pageCount};i++)fs.writeFileSync(p+'-'+i+'.png','synthetic');`),
    tesseractCommand: await executable(dir, "tesseract", "import path from 'node:path';process.stdout.write('Recognized '+path.basename(process.argv[2]));"),
    log,
  };
}

test("scanned PDF fallback OCRs all pages and cleans temporary images", async t => {
  const { dir } = await fixture(t);
  const pdf = path.join(dir, "scan.pdf");
  await fs.writeFile(pdf, "synthetic PDF stub");
  const options = await ocrStubs(dir);
  const result = await extractReceiptText({ path: pdf }, options);
  assert.equal(result.extractor, "pdftoppm+tesseract");
  assert.equal(result.text, "Recognized page-1.png\n\nRecognized page-2.png");
  const prefix = await fs.readFile(options.log, "utf8");
  await assert.rejects(fs.stat(path.dirname(prefix)), { code: "ENOENT" });
});

test("PDF overflow fails instead of dropping pages and cleans temporary images", async t => {
  const { dir } = await fixture(t);
  const pdf = path.join(dir, "scan.pdf");
  await fs.writeFile(pdf, "synthetic PDF stub");
  const options = { ...await ocrStubs(dir, 3), maxPdfPages: 2 };
  await assert.rejects(extractReceiptText({ path: pdf }, options), /exceeds maxPdfPages/);
  const prefix = await fs.readFile(options.log, "utf8");
  await assert.rejects(fs.stat(path.dirname(prefix)), { code: "ENOENT" });
});

test("empty PDF requires explicit fallback and direct image OCR remains supported", async t => {
  const { dir } = await fixture(t);
  const options = await ocrStubs(dir);
  const pdf = path.join(dir, "scan.pdf");
  const image = path.join(dir, "receipt.png");
  await fs.writeFile(pdf, "synthetic PDF stub");
  await fs.writeFile(image, "synthetic image stub");
  await assert.rejects(extractReceiptText({ path: pdf }, { ...options, enableOcrForPdfs: false }), /enableOcrForPdfs/);
  const result = await extractReceiptText({ path: image }, { ...options, enableOcrForImages: true });
  assert.equal(result.text, "Recognized receipt.png");
});

test("extraction CLI help succeeds and missing arguments fail cleanly", async () => {
  assert.match((await exec(process.execPath, [runner, "--help"])).stdout, /Usage:/);
  await assert.rejects(exec(process.execPath, [runner, "--config"]), error => /requires a path/.test(error.stderr));
});
