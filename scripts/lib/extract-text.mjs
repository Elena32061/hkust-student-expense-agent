import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runCommand, DEFAULT_MAX_OUTPUT_BYTES } from "./run-command.mjs";

const TEXT_EXTENSIONS = new Set([".txt", ".md", ".json"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg"]);
const MAX_TEXT_CHARS = 25_000;

export async function extractReceiptText(receipt, options = {}) {
  const targetPath = path.resolve(receipt.path);
  const extension = path.extname(targetPath).toLowerCase();
  const commandOptions = { timeoutMs: options.timeoutMs, maxOutputBytes: options.maxOutputBytes };
  let text;
  let extractor;
  if (TEXT_EXTENSIONS.has(extension)) {
    if ((await fs.stat(targetPath)).size > (options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES)) {
      throw new Error("Receipt text exceeds maxOutputBytes. Split or reduce the source before extracting.");
    }
    text = await fs.readFile(targetPath, "utf8");
    extractor = "direct-read";
  } else if (extension === ".pdf") {
    text = "";
    if (options.enablePdfText !== false) {
      text = await runCommand(options.pdftotextCommand || "pdftotext", ["-layout", targetPath, "-"], {
        ...commandOptions, label: "PDF text extraction",
      });
      extractor = "pdftotext";
    }
    if (!text.trim() && options.enableOcrForPdfs) {
      text = await ocrPdf(targetPath, options, commandOptions);
      extractor = "pdftoppm+tesseract";
    }
    if (!text.trim()) {
      throw new Error("PDF has no extractable text. For scanned PDFs, enable textExtraction.enableOcrForPdfs and install pdftoppm and tesseract.");
    }
  } else if (IMAGE_EXTENSIONS.has(extension) && options.enableOcrForImages) {
    text = await ocrImage(targetPath, options, commandOptions);
    extractor = "tesseract";
  } else {
    throw new Error("Unsupported receipt format. Use text/PDF input or enable textExtraction.enableOcrForImages for PNG/JPEG receipts.");
  }
  if (!text.trim()) throw new Error("Receipt produced no readable text. Check the source file or OCR language settings.");
  if (text.length > MAX_TEXT_CHARS) {
    throw new Error(`Receipt text exceeds ${MAX_TEXT_CHARS} characters. Split the source into smaller receipts; no text was silently truncated.`);
  }
  return { mimeType: inferMimeType(extension), extractor, text };
}

async function ocrPdf(targetPath, options, commandOptions) {
  const maxPages = options.maxPdfPages ?? 10;
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100) {
    throw new Error("textExtraction.maxPdfPages must be an integer from 1 to 100.");
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "claim-pdf-ocr-"));
  try {
    // Render one extra page to detect overflow instead of silently truncating a PDF.
    await runCommand(options.pdftoppmCommand || "pdftoppm", [
      "-png", "-r", "150", "-f", "1", "-l", String(maxPages + 1), targetPath, path.join(dir, "page"),
    ], { ...commandOptions, label: "PDF page rendering" });
    const pages = (await fs.readdir(dir)).filter(name => /^page-\d+\.png$/.test(name))
      .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
    if (pages.length > maxPages) throw new Error(`PDF exceeds maxPdfPages (${maxPages}). Split the PDF or explicitly increase the limit.`);
    if (!pages.length) throw new Error("PDF rendering produced no pages. Check the PDF and pdftoppm installation.");
    const texts = [];
    for (const page of pages) {
      texts.push(await ocrImage(path.join(dir, page), options, commandOptions));
      if (texts.join("\n\n").length > MAX_TEXT_CHARS) throw new Error(`PDF OCR text exceeds ${MAX_TEXT_CHARS} characters. Split the PDF before extracting.`);
    }
    return texts.join("\n\n");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function ocrImage(targetPath, options, commandOptions) {
  return runCommand(options.tesseractCommand || "tesseract", [targetPath, "stdout", "-l", options.ocrLanguages || "eng"], {
    ...commandOptions, label: "Receipt OCR",
  });
}

function inferMimeType(extension) {
  return ({ ".pdf": "application/pdf", ".txt": "text/plain", ".md": "text/markdown", ".json": "application/json",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" })[extension] || "application/octet-stream";
}
