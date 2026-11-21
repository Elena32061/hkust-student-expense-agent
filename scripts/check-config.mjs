#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./lib/config.mjs";

const args = process.argv.slice(2);
const projectRoot = fileURLToPath(new URL("../", import.meta.url));

if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
  console.log("Usage: node scripts/check-config.mjs [config-path]");
  console.log("Config paths are relative to the project root; attachment paths are relative to the current working directory.");
} else if (args.length > 1 || args.some((arg) => arg.startsWith("-"))) {
  console.error("Usage: node scripts/check-config.mjs [config-path]");
  process.exitCode = 1;
} else {
  const configPath = path.resolve(projectRoot, args[0] || "config/claim.local.json");
  try {
    await loadConfig(configPath);
    console.log(`Config looks valid: ${configPath}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
