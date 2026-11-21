#!/usr/bin/env node
import path from "node:path";
import { prepareClaimConfig } from "./lib/draft-to-config.mjs";

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: npm run draft:prepare -- --reviewed [--draft <draft.json>] [--request <request.json>] [--out <claim.local.json>] [--force]");
    console.log("Review receipts and resolve unknown fields before acknowledging with --reviewed. Existing outputs are preserved unless --force is supplied.");
    console.log("Defaults: artifacts/claim-draft.latest.json, artifacts/extract-request.latest.json, config/claim.local.json (relative to the current working directory).");
  } else {
    const result = await prepareClaimConfig({
      draftPath: path.resolve(args.draft || "artifacts/claim-draft.latest.json"),
      requestPath: path.resolve(args.request || "artifacts/extract-request.latest.json"),
      outPath: path.resolve(args.out || "config/claim.local.json"),
      reviewed: args.reviewed === true,
      force: args.force === true,
    });
    for (const warning of result.warnings) console.warn(`Review warning: ${warning}`);
    console.log(`Fill config written to ${result.outputPath}`);
    console.log(`Before filling, manually create at least ${result.rowCount} expense row(s) in the form. All required row fields are checked before any edits.`);
    console.log("Submission is disabled. Run npm run check, then npm run fill for the default output; review the populated form before submitting manually.");
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (["--help", "-h"].includes(token)) args.help = true;
    else if (["--reviewed", "--force"].includes(token)) args[token.slice(2)] = true;
    else if (["--draft", "--request", "--out"].includes(token)) {
      const value = argv[++index];
      if (!value || value.startsWith("-")) throw new Error(`${token} requires a path.`);
      args[token.slice(2)] = value;
    } else throw new Error(`Unknown argument: ${token}. Run with --help for usage.`);
  }
  return args;
}
