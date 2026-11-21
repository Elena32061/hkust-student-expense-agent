import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { runCommand } from "./run-command.mjs";

export async function runCommandProvider(provider, request, artifactsDir) {
  if (typeof provider.command !== "string" || !provider.command.trim()) {
    throw new Error("Command provider requires provider.command.");
  }
  // Each process receives its own immutable request, including simultaneous runs.
  const requestPath = path.join(artifactsDir, `llm-request-${randomUUID()}.json`);
  await fs.writeFile(requestPath, JSON.stringify(request, null, 2), { encoding: "utf8", flag: "wx", mode: 0o600 });
  const raw = await runCommand(provider.command, provider.args || [], {
    env: { ...process.env, ...(provider.env || {}), CLAIM_REQUEST_PATH: requestPath },
    timeoutMs: provider.timeoutMs,
    maxOutputBytes: provider.maxOutputBytes,
    label: "Model provider",
  });
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Model provider did not return valid JSON. Configure it to write only the JSON draft to stdout.");
  }
}
