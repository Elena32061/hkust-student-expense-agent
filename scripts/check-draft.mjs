#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const target = process.argv[2] || "artifacts/claim-draft.latest.json";
const draftPath = path.resolve(process.cwd(), target);

if (!fs.existsSync(draftPath)) {
  console.error(`Draft file not found: ${draftPath}`);
  process.exit(1);
}

let draft;

try {
  draft = JSON.parse(fs.readFileSync(draftPath, "utf8"));
} catch (error) {
  console.error(`Invalid JSON in ${draftPath}`);
  console.error(String(error));
  process.exit(1);
}

const errors = [];
const warnings = [];

if (!draft || typeof draft !== "object") {
  errors.push("Draft must be a JSON object.");
}

if (!Array.isArray(draft?.line_items)) {
  errors.push("Draft must contain a line_items array.");
}

if (!Array.isArray(draft?.open_questions)) {
  errors.push("Draft must contain an open_questions array.");
}

if (!draft?.summary || typeof draft.summary !== "object") {
  errors.push("Draft must contain a summary object.");
}

if (Array.isArray(draft?.line_items)) {
  for (const [index, item] of draft.line_items.entries()) {
    const prefix = `line_items[${index}]`;

    requireStringArray(item?.receipt_ids, `${prefix}.receipt_ids`, errors);
    requireString(item?.expense_type, `${prefix}.expense_type`, errors);
    requireIsoDate(item?.date_from, `${prefix}.date_from`, errors);
    requireIsoDate(item?.date_to, `${prefix}.date_to`, errors);
    requireString(item?.currency, `${prefix}.currency`, errors);
    requireNumber(item?.amount, `${prefix}.amount`, errors);
    requireString(item?.business_purpose, `${prefix}.business_purpose`, errors);
    requireString(item?.particular, `${prefix}.particular`, errors);
    requireString(item?.justification, `${prefix}.justification`, errors);
    requireStringArray(item?.attachments, `${prefix}.attachments`, errors);
    requireConfidence(item?.confidence, `${prefix}.confidence`, errors);
    requireStringArray(item?.review_notes, `${prefix}.review_notes`, errors);

    if (Array.isArray(item?.attachments)) {
      for (const attachment of item.attachments) {
        if (isPlaceholderPath(attachment)) {
          warnings.push(`${prefix}.attachments contains a placeholder path: ${attachment}`);
          continue;
        }

        const resolved = path.resolve(attachment);
        if (!fs.existsSync(resolved)) {
          warnings.push(`${prefix}.attachments points to a missing file: ${resolved}`);
        }
      }
    }
  }
}

if (Array.isArray(draft?.open_questions)) {
  for (const [index, value] of draft.open_questions.entries()) {
    requireString(value, `open_questions[${index}]`, errors);
  }
}

if (draft?.summary && typeof draft.summary === "object") {
  if (!Array.isArray(draft.summary.estimated_total_by_currency)) {
    errors.push("summary.estimated_total_by_currency must be an array.");
  } else {
    for (const [index, entry] of draft.summary.estimated_total_by_currency.entries()) {
      requireString(entry?.currency, `summary.estimated_total_by_currency[${index}].currency`, errors);
      requireNumber(entry?.total, `summary.estimated_total_by_currency[${index}].total`, errors);
    }
  }

  requireStringArray(draft.summary.notes, "summary.notes", errors);
}

if (warnings.length) {
  console.log("Warnings:");
  for (const warning of warnings) {
    console.log(`- ${warning}`);
  }
}

if (errors.length) {
  console.error("Draft validation failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Draft looks valid: ${draftPath}`);

function requireString(value, label, list) {
  if (typeof value !== "string" || value.trim() === "") {
    list.push(`${label} must be a non-empty string.`);
  }
}

function requireStringArray(value, label, list) {
  if (!Array.isArray(value)) {
    list.push(`${label} must be an array.`);
    return;
  }

  for (const [index, entry] of value.entries()) {
    if (typeof entry !== "string" || entry.trim() === "") {
      list.push(`${label}[${index}] must be a non-empty string.`);
    }
  }
}

function requireNumber(value, label, list) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    list.push(`${label} must be a number.`);
  }
}

function requireIsoDate(value, label, list) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    list.push(`${label} must be in YYYY-MM-DD format.`);
  }
}

function requireConfidence(value, label, list) {
  if (typeof value !== "number" || value < 0 || value > 1) {
    list.push(`${label} must be a number between 0 and 1.`);
  }
}

function isPlaceholderPath(value) {
  return (
    String(value).startsWith("/absolute/path/to/") ||
    String(value).includes("local-only-receipt")
  );
}
