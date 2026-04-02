#!/usr/bin/env node

import fs from "node:fs";

const requestPath = process.env.CLAIM_REQUEST_PATH;
const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(
  /\/+$/,
  "",
);
const model = process.env.OPENAI_MODEL;
const apiKey = process.env.OPENAI_API_KEY;

if (!requestPath) {
  fatal("CLAIM_REQUEST_PATH is required.");
}

if (!model) {
  fatal("OPENAI_MODEL is required.");
}

if (!apiKey) {
  fatal("OPENAI_API_KEY is required.");
}

const request = JSON.parse(fs.readFileSync(requestPath, "utf8"));

const response = await fetch(`${baseUrl}/chat/completions`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model,
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "You convert receipt text into structured JSON claim drafts. Return valid JSON only. Do not wrap the answer in markdown.",
      },
      {
        role: "user",
        content: buildPrompt(request),
      },
    ],
  }),
});

if (!response.ok) {
  const errorText = await response.text();
  fatal(`OpenAI-compatible request failed: ${response.status} ${errorText}`.trim());
}

const payload = await response.json();
const content = readMessageContent(payload);

if (!content) {
  fatal("OpenAI-compatible response did not contain message content.");
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

function readMessageContent(payload) {
  const content = payload?.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (item && typeof item.text === "string") {
          return item.text;
        }
        return "";
      })
      .join("");
  }

  return "";
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
