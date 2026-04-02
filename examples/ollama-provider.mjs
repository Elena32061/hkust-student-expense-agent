#!/usr/bin/env node

import fs from "node:fs";

const requestPath = process.env.CLAIM_REQUEST_PATH;
const host = (process.env.OLLAMA_HOST || "http://127.0.0.1:11434").replace(
  /\/+$/,
  "",
);
const model = process.env.OLLAMA_MODEL;

if (!requestPath) {
  fatal("CLAIM_REQUEST_PATH is required.");
}

if (!model) {
  fatal("OLLAMA_MODEL is required.");
}

const request = JSON.parse(fs.readFileSync(requestPath, "utf8"));

const response = await fetch(`${host}/api/generate`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model,
    stream: false,
    prompt: buildPrompt(request),
    options: {
      temperature: 0,
    },
  }),
});

if (!response.ok) {
  const errorText = await response.text();
  fatal(`Ollama request failed: ${response.status} ${errorText}`.trim());
}

const payload = await response.json();
const content = payload?.response;

if (typeof content !== "string" || content.trim() === "") {
  fatal("Ollama response did not contain model output.");
}

const parsed = JSON.parse(stripCodeFence(content));
process.stdout.write(JSON.stringify(parsed, null, 2));

function buildPrompt(requestObject) {
  return [
    "Convert the following extraction request into a JSON object that matches output_schema exactly.",
    "Return JSON only.",
    JSON.stringify(requestObject, null, 2),
  ].join("\n\n");
}

function stripCodeFence(value) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  return trimmed.replace(/^```[a-zA-Z0-9_-]*\s*/, "").replace(/\s*```$/, "");
}

function fatal(message) {
  console.error(message);
  process.exit(1);
}
