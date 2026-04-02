#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

export async function extractReceiptText(receipt, options = {}) {
  const targetPath = path.resolve(receipt.path);
  const extension = path.extname(targetPath).toLowerCase();

  if (TEXT_EXTENSIONS.has(extension)) {
    const text = await fs.readFile(targetPath, "utf8");
    return {
      mimeType: inferMimeType(extension),
      extractor: "direct-read",
      text,
    };
  }

  if (extension === ".pdf" && options.enablePdfText !== false) {
    const command = options.pdftotextCommand || "pdftotext";
    const text = await runCommand(command, ["-layout", targetPath, "-"]);
    return {
      mimeType: "application/pdf",
      extractor: command,
      text,
    };
  }

  if (IMAGE_EXTENSIONS.has(extension) && options.enableOcrForImages) {
    const command = options.tesseractCommand || "tesseract";
    const languages = options.ocrLanguages || "eng";
    const text = await runCommand(command, [targetPath, "stdout", "-l", languages]);
    return {
      mimeType: inferMimeType(extension),
      extractor: command,
      text,
    };
  }

  throw new Error(
    `Unsupported file type for extraction: ${targetPath}. Add your own extractor or convert this file first.`,
  );
}

function inferMimeType(extension) {
  switch (extension) {
    case ".pdf":
      return "application/pdf";
    case ".txt":
      return "text/plain";
    case ".md":
      return "text/markdown";
    case ".json":
      return "application/json";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    default:
      return "application/octet-stream";
  }
}

async function runCommand(command, args) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
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

const TEXT_EXTENSIONS = new Set([".txt", ".md", ".json"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg"]);
