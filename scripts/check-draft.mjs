#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { validateClaimDraft } from "./lib/claim-draft.mjs";

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: node scripts/check-draft.mjs [draft-path] [--request request-path] [--ready]");
    console.log("Defaults to artifacts/claim-draft.latest.json. --ready rejects unresolved fields; human review is still required.");
  } else {
    const draft = await readJson(options.target, "Draft");
    const request = options.request ? await readJson(options.request, "Request") : undefined;
    if (request !== undefined && (!request || typeof request !== "object" || !Array.isArray(request.receipts))) {
      throw new Error("Request must contain a receipts array.");
    }
    const { errors, warnings } = validateClaimDraft(draft, { receipts: request?.receipts, requireReady: options.ready });
    if (request && draft?.source_request_id !== undefined && draft.source_request_id !== request.request_id) errors.push("source_request_id does not match the supplied request.");
    for (const warning of warnings) console.log(`Warning: ${warning}`);
    if (errors.length) {
      console.error("Draft validation failed:");
      for (const error of errors) console.error(`- ${error}`);
      process.exitCode = 1;
    } else {
      console.log(warnings.length ? "Draft structure is valid; unresolved fields or review warnings remain." : "Draft validation passed; review the claim before browser filling.");
      if (!request) console.log("Receipt provenance was not checked. Use --request with the matching extraction request.");
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

async function readJson(target, label) {
  let raw;
  try { raw = await fs.readFile(path.resolve(target), "utf8"); }
  catch { throw new Error(`${label} file could not be read. Check its path and permissions.`); }
  try { return JSON.parse(raw); }
  catch { throw new Error(`${label} file contains invalid JSON.`); }
}

function parseArgs(argv) {
  const result = { target: "artifacts/claim-draft.latest.json", ready: false };
  let positional = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") result.help = true;
    else if (arg === "--ready") result.ready = true;
    else if (arg === "--request") {
      if (result.request || !argv[index + 1] || argv[index + 1].startsWith("-")) throw new Error("--request requires one request file path.");
      result.request = argv[++index];
    } else if (arg.startsWith("-") || positional) throw new Error("Unexpected argument. Use --help for usage.");
    else { result.target = arg; positional = true; }
  }
  return result;
}
