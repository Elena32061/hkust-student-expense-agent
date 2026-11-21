import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { validateClaimDraft } from "./claim-draft.mjs";

const FORM_URL = "https://admms66.ust.hk/YZSoft/forms/Post.aspx?pn=Expense+Claim+for+Student+Form";
const FRAME = { urlIncludes: "Expense%20Claim%20for%20Student%20Form.aspx" };
const BINDING = "UST_FO_ExpenseStudentForm_LNEDetail.";
const fields = [
  ["expense_type", "ExpenseType", "select", "select", 500],
  ["date_from", "PeriodFrom", "input[type='text']", "fill", 200],
  ["date_to", "PeriodTo", "input[type='text']", "fill", 200],
  ["business_purpose", "BusinessPurpose", "textarea", "fill", 200],
  ["currency", "Currency", "select", "select", 200],
  ["amount", "UnitPrice", "input[type='text']", "fill", 800],
  ["particular", "Particular", "textarea", "fill", 200],
  ["justification", "Justification", "textarea", "fill", 200],
  ["attachments", "AttachFileID", "input[type='file']", "upload", 1200],
];

/** Convert reviewed values only; model output never controls selectors or actions. */
export async function buildClaimConfig(draft, request) {
  if (!request || typeof request !== "object" || Array.isArray(request)
      || typeof request.request_id !== "string" || !request.request_id.trim()
      || typeof draft?.source_request_id !== "string" || !draft.source_request_id.trim()
      || request.request_id !== draft.source_request_id) {
    throw new Error("Draft source_request_id must match the extraction request request_id. Use the matching request and draft files.");
  }
  if (!Array.isArray(request.receipts) || request.receipts.length === 0) {
    throw new Error("Extraction request must contain a non-empty receipts array.");
  }
  for (const [index, receipt] of request.receipts.entries()) {
    if (typeof receipt?.path !== "string" || !path.isAbsolute(receipt.path)) {
      throw new Error(`Request receipts[${index}].path must be an absolute local path.`);
    }
  }
  const { errors, warnings } = validateClaimDraft(draft, { receipts: request.receipts, requireReady: true });
  if (errors.length) throw new Error(`Draft is not ready to prepare:\n${errors.map(error => `- ${error}`).join("\n")}`);

  const checked = new Set();
  for (const [row, item] of draft.line_items.entries()) {
    for (const attachment of item.attachments) {
      if (checked.has(attachment)) continue;
      try {
        const info = await fs.stat(attachment);
        if (!info.isFile()) throw new Error("not a file");
        await fs.access(attachment, constants.R_OK);
      } catch {
        throw new Error(`line_items[${row}].attachments must refer to existing readable regular files.`);
      }
      checked.add(attachment);
    }
  }

  const preflight = [];
  const edits = [];
  for (const [nth, item] of draft.line_items.entries()) {
    for (const [key, field, tag, action, waitMs] of fields) {
      const locator = { kind: "dataBind", value: BINDING + field, tag, nth };
      // Check every row before changing the first one. File inputs may be hidden.
      preflight.push({ action: "waitFor", frame: { ...FRAME }, locator: { ...locator }, state: "attached" });
      const step = { action, frame: { ...FRAME }, locator, waitMs };
      if (key === "attachments") step.files = [...item.attachments];
      else if (key === "date_from" || key === "date_to") {
        const [year, month, day] = item[key].split("-");
        step.value = `${day}/${month}/${year}`;
      } else step.value = String(item[key]);
      edits.push(step);
    }
  }
  return { config: { formUrl: FORM_URL, submit: false, steps: [...preflight, ...edits] }, warnings, rowCount: draft.line_items.length };
}

/** Only explicit human acknowledgement permits writing a fill config. */
export async function prepareClaimConfig({ draftPath, requestPath, outPath, reviewed = false, force = false }) {
  if (reviewed !== true) throw new Error("Review the draft against its receipts, resolve unknown fields, then pass --reviewed to prepare a fill config.");
  const sources = [path.resolve(draftPath), path.resolve(requestPath)];
  const output = path.resolve(outPath);
  await rejectSourceOverwrite(output, sources);
  const [draft, request] = await Promise.all(sources.map(readJson));
  const result = await buildClaimConfig(draft, request);
  await rejectSourceOverwrite(output, request.receipts.map(receipt => receipt.path));
  await fs.mkdir(path.dirname(output), { recursive: true });
  const temporary = path.join(path.dirname(output), `.${path.basename(output)}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, `${JSON.stringify(result.config, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    if (force) await fs.rename(temporary, output);
    else {
      try {
        // An exclusive hard link publishes the complete file without a partial write.
        await fs.link(temporary, output);
      } catch (error) {
        if (error.code === "EEXIST") throw new Error("Output already exists. Choose another --out path or use --force to replace it.");
        throw error;
      }
    }
  } finally {
    await fs.rm(temporary, { force: true });
  }
  return { ...result, outputPath: output };
}

async function readJson(target) {
  let raw;
  try { raw = await fs.readFile(target, "utf8"); }
  catch { throw new Error("Cannot read the draft or extraction request. Check --draft and --request paths."); }
  try { return JSON.parse(raw); }
  catch { throw new Error("Invalid JSON in the draft or extraction request."); }
}

async function rejectSourceOverwrite(output, sources) {
  let outputReal = output;
  let outputStat;
  try {
    outputReal = await fs.realpath(output);
    outputStat = await fs.stat(output);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  for (const source of sources) {
    if (output === source || outputReal === source) throw new Error("Output must not overwrite a source draft, extraction request, or receipt, even with --force.");
    try {
      const real = await fs.realpath(source);
      const stat = await fs.stat(source);
      if (real === outputReal || (outputStat && stat.dev === outputStat.dev && stat.ino === outputStat.ino)) {
        throw new Error("Output must not overwrite a source draft, extraction request, or receipt, even with --force.");
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}
