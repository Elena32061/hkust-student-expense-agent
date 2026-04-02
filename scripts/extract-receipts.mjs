#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { extractReceiptText } from "./lib/extract-text.mjs";
import { runCommandProvider } from "./lib/provider-command.mjs";

const args = parseArgs(process.argv.slice(2));
const configPath = path.resolve(
  process.cwd(),
  args.config || "config/extraction.local.json",
);

const config = await loadConfig(configPath);
const projectRoot = process.cwd();
const artifactsDir = path.resolve(projectRoot, config.artifactsDir || "artifacts");
await fs.mkdir(artifactsDir, { recursive: true });

if (!Array.isArray(config.receipts) || config.receipts.length === 0) {
  throw new Error("Extraction config must contain a non-empty receipts array.");
}

const outputSchema = JSON.parse(
  await fs.readFile(
    path.resolve(projectRoot, config.schemaPath || "schemas/claim-draft.schema.json"),
    "utf8",
  ),
);

const receipts = [];

for (const receipt of config.receipts) {
  const extracted = await extractReceiptText(receipt, config.textExtraction || {});
  receipts.push({
    id: receipt.id,
    path: path.resolve(receipt.path),
    mime_type: extracted.mimeType,
    extractor: extracted.extractor,
    expenseHints: receipt.expenseHints || {},
    extracted_text: truncate(extracted.text, 25000),
  });
}

const request = {
  version: "0.2-draft",
  created_at: new Date().toISOString(),
  task: "Convert raw receipt text into a structured claim draft for human review before browser automation.",
  instructions: [
    "Return valid JSON only.",
    "Follow the output schema exactly.",
    "Do not fabricate missing amounts, dates, or currencies.",
    "If a field is uncertain, keep the best guess but explain it in review_notes or open_questions.",
    "Keep attachments equal to the original receipt file paths that support each line item.",
    "Output dates in YYYY-MM-DD format."
  ],
  output_schema: outputSchema,
  receipts,
};

const stamp = timestamp();
const requestPath = path.join(artifactsDir, `extract-request-${stamp}.json`);
const latestRequestPath = path.join(artifactsDir, "extract-request.latest.json");
await fs.writeFile(requestPath, JSON.stringify(request, null, 2), "utf8");
await fs.writeFile(latestRequestPath, JSON.stringify(request, null, 2), "utf8");
console.log(`Extraction request written to ${requestPath}`);

const provider = config.provider || { type: "noop" };

if (provider.type === "noop") {
  console.log("");
  console.log("No provider configured.");
  console.log("Next step:");
  console.log("- Point provider.type to \"command\" in config/extraction.local.json");
  console.log("- Or hand the request JSON to your own LLM wrapper");
  process.exit(0);
}

if (provider.type !== "command") {
  throw new Error(`Unsupported provider.type: ${provider.type}`);
}

const draft = await runCommandProvider(provider, request, artifactsDir);
validateClaimDraft(draft);

const responsePath = path.join(artifactsDir, `claim-draft-${stamp}.json`);
const latestResponsePath = path.join(artifactsDir, "claim-draft.latest.json");
await fs.writeFile(responsePath, JSON.stringify(draft, null, 2), "utf8");
await fs.writeFile(latestResponsePath, JSON.stringify(draft, null, 2), "utf8");

console.log(`Claim draft written to ${responsePath}`);

function validateClaimDraft(draft) {
  if (!draft || typeof draft !== "object") {
    throw new Error("Provider output must be an object.");
  }

  if (!Array.isArray(draft.line_items)) {
    throw new Error("Provider output must contain line_items array.");
  }

  if (!Array.isArray(draft.open_questions)) {
    throw new Error("Provider output must contain open_questions array.");
  }

  if (!draft.summary || typeof draft.summary !== "object") {
    throw new Error("Provider output must contain summary object.");
  }
}

async function loadConfig(targetPath) {
  try {
    return JSON.parse(await fs.readFile(targetPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Unable to read extraction config at ${targetPath}. Copy config/extraction.sample.json to config/extraction.local.json first.`,
    );
  }
}

function truncate(value, limit) {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit)}\n\n[truncated]`;
}

function timestamp() {
  const now = new Date();
  const parts = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ];
  return `${parts[0]}${parts[1]}${parts[2]}-${parts[3]}${parts[4]}${parts[5]}`;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function parseArgs(argv) {
  const result = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      result._.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      result[key] = "true";
      continue;
    }

    result[key] = next;
    index += 1;
  }
  return result;
}
