import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

export const DEFAULT_FORM_URL =
  "https://admms66.ust.hk/YZSoft/forms/Post.aspx?pn=Expense+Claim+for+Student+Form";

const actions = new Set(["fill", "select", "click", "check", "upload", "wait", "waitFor"]);
const locatorKinds = new Set(["selector", "label", "placeholder", "text", "dataBind", "role"]);
const waitStates = new Set(["attached", "detached", "visible", "hidden"]);

/** Validate before opening a browser or changing any form fields. */
export async function loadConfig(targetPath, { requireSubmitStep = false } = {}) {
  let raw;
  try {
    raw = await fs.readFile(targetPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error("Config file not found. Copy config/claim.sample.json to config/claim.local.json first, or provide an existing config path.");
    }
    throw new Error("Unable to read config file. Check that it is a readable file.");
  }

  let config;
  try {
    config = JSON.parse(raw);
  } catch {
    // JSON parser messages can include claim values; never echo the source.
    throw new Error("Invalid JSON in config file. Check JSON syntax.");
  }

  requireObject(config, "config");
  if (!Array.isArray(config.steps) || config.steps.length === 0) {
    invalid("steps", "must be a non-empty array");
  }
  if (config.formUrl !== undefined) {
    requireString(config.formUrl, "formUrl");
    let url;
    try {
      url = new URL(config.formUrl);
    } catch {
      invalid("formUrl", "must be an absolute HTTP or HTTPS URL");
    }
    if (!["http:", "https:"].includes(url.protocol)) {
      invalid("formUrl", "must use HTTP or HTTPS");
    }
  }
  if (config.submit !== undefined && typeof config.submit !== "boolean") {
    invalid("submit", "must be a boolean");
  }
  for (const [index, step] of config.steps.entries()) {
    await validateStep(step, `steps[${index}]`);
  }
  if (config.submitStep !== undefined) {
    await validateStep(config.submitStep, "submitStep");
    if (config.submitStep.action !== "click") {
      invalid("submitStep.action", "must be click");
    }
  } else if (config.submit || requireSubmitStep) {
    invalid("submitStep", "is required when submission is requested");
  }
  return config;
}

async function validateStep(step, at) {
  requireObject(step, at);
  if (!actions.has(step.action)) {
    invalid(`${at}.action`, "must be fill, select, click, check, upload, wait, or waitFor");
  }
  if (step.waitMs !== undefined) {
    requireDuration(step.waitMs, `${at}.waitMs`);
  }
  if (step.frame !== undefined) {
    requireObject(step.frame, `${at}.frame`);
    for (const key of Object.keys(step.frame)) {
      if (!["name", "urlIncludes"].includes(key)) {
        invalid(`${at}.frame`, "supports only name and urlIncludes");
      }
      requireString(step.frame[key], `${at}.frame.${key}`);
    }
  }

  if (step.action === "wait") {
    requireDuration(step.waitMs ?? step.value ?? 500, `${at}.waitMs or value`);
    return;
  }
  requireObject(step.locator, `${at}.locator`);
  const locator = step.locator;
  if (!locatorKinds.has(locator.kind)) {
    invalid(`${at}.locator.kind`, "must be selector, label, placeholder, text, dataBind, or role");
  }
  requireString(locator.value, `${at}.locator.value`);
  if (locator.kind === "role") {
    requireString(locator.role, `${at}.locator.role`);
  }
  if (locator.nth !== undefined && (!Number.isInteger(locator.nth) || locator.nth < 0)) {
    invalid(`${at}.locator.nth`, "must be a non-negative integer");
  }
  for (const key of ["tag", "fieldSelector"]) {
    if (locator[key] !== undefined) {
      requireString(locator[key], `${at}.locator.${key}`);
    }
  }
  if (["fill", "select"].includes(step.action)) {
    if (typeof step.value !== "string" && !(typeof step.value === "number" && Number.isFinite(step.value))) {
      invalid(`${at}.value`, "must be a string or finite number");
    }
  }
  if (step.action === "waitFor" && step.state !== undefined && !waitStates.has(step.state)) {
    invalid(`${at}.state`, "must be attached, detached, visible, or hidden");
  }
  if (step.action === "upload") {
    if (!Array.isArray(step.files) || step.files.length === 0) {
      invalid(`${at}.files`, "must be a non-empty array");
    }
    for (const [index, file] of step.files.entries()) {
      const fileAt = `${at}.files[${index}]`;
      requireString(file, fileAt);
      if (file.startsWith("/absolute/path/to/") || file.includes("local-only-receipt")) {
        invalid(fileAt, "still contains a sample placeholder; replace it with a real local attachment path");
      }
      // Preserve existing CLI semantics: relative attachment paths use cwd,
      // not the directory containing the claim config.
      const resolved = path.resolve(file);
      let stat;
      try {
        stat = await fs.stat(resolved);
        await fs.access(resolved, constants.R_OK);
      } catch {
        invalid(fileAt, "must refer to an existing readable file");
      }
      if (!stat.isFile()) {
        invalid(fileAt, "must refer to a regular file, not a directory");
      }
      step.files[index] = resolved;
    }
  }
}

function requireObject(value, at) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalid(at, "must be an object");
  }
}

function requireString(value, at) {
  if (typeof value !== "string" || value.trim() === "") {
    invalid(at, "must be a non-empty string");
  }
}

function requireDuration(value, at) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    invalid(at, "must be a finite non-negative number of milliseconds");
  }
}

function invalid(at, message) {
  throw new Error(`Invalid config: ${at} ${message}.`);
}
