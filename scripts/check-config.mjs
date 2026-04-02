#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const target = process.argv[2] || "config/claim.local.json";
const configPath = path.resolve(process.cwd(), target);

if (!fs.existsSync(configPath)) {
  console.error(`Config file not found: ${configPath}`);
  console.error("Copy config/claim.sample.json to config/claim.local.json first.");
  process.exit(1);
}

const raw = fs.readFileSync(configPath, "utf8");
let config;

try {
  config = JSON.parse(raw);
} catch (error) {
  console.error(`Invalid JSON in ${configPath}`);
  console.error(String(error));
  process.exit(1);
}

if (!Array.isArray(config.steps)) {
  console.error("Config must contain a steps array.");
  process.exit(1);
}

const missingFiles = [];
const warnings = [];

for (const [index, step] of config.steps.entries()) {
  if (!step.action) {
    warnings.push(`Step ${index + 1} is missing action.`);
  }

  if (step.action !== "wait" && !step.locator) {
    warnings.push(`Step ${index + 1} is missing locator.`);
  }

  if (Array.isArray(step.files)) {
    for (const file of step.files) {
      if (isPlaceholderPath(file)) {
        warnings.push(`Step ${index + 1} still uses a placeholder file path: ${file}`);
        continue;
      }

      const resolved = path.resolve(file);
      if (!fs.existsSync(resolved)) {
        missingFiles.push({ step: index + 1, file: resolved });
      }
    }
  }
}

if (warnings.length) {
  console.log("Warnings:");
  for (const warning of warnings) {
    console.log(`- ${warning}`);
  }
}

if (missingFiles.length) {
  console.error("Missing files:");
  for (const entry of missingFiles) {
    console.error(`- step ${entry.step}: ${entry.file}`);
  }
  process.exit(1);
}

console.log(`Config looks valid: ${configPath}`);

function isPlaceholderPath(value) {
  return (
    String(value).startsWith("/absolute/path/to/") ||
    String(value).includes("local-only-receipt")
  );
}
