#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

export async function runCommandProvider(provider, request, artifactsDir) {
  if (!provider.command) {
    throw new Error("Command provider requires provider.command.");
  }

  const requestPath = path.join(artifactsDir, "llm-request.latest.json");
  await fs.writeFile(requestPath, JSON.stringify(request, null, 2), "utf8");

  const env = {
    ...process.env,
    ...(provider.env || {}),
    CLAIM_REQUEST_PATH: requestPath,
  };

  const args = Array.isArray(provider.args) ? provider.args : [];
  const raw = await runCommand(provider.command, args, env);

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Command provider did not return valid JSON. ${String(error)}`,
    );
  }
}

async function runCommand(command, args, env) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `${command} exited with code ${code}. ${stderr.trim()}`.trim(),
          ),
        );
        return;
      }

      resolve(stdout);
    });
  });
}
