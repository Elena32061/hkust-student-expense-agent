#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const DEFAULT_FORM_URL =
  "https://admms66.ust.hk/YZSoft/forms/Post.aspx?pn=Expense+Claim+for+Student+Form";

const args = parseArgs(process.argv.slice(2));
const mode = args._[0];

if (!mode || !["snapshot", "fill"].includes(mode)) {
  printUsage();
  process.exit(1);
}

const configPath = path.resolve(
  projectRoot,
  args.config || "config/claim.local.json",
);

const profileDir = path.resolve(projectRoot, ".auth/hkust-eform");
const artifactsDir = path.resolve(projectRoot, "artifacts");

await fs.mkdir(profileDir, { recursive: true });
await fs.mkdir(artifactsDir, { recursive: true });

const config = mode === "fill" ? await loadConfig(configPath) : null;
const formUrl = args.url || config?.formUrl || DEFAULT_FORM_URL;

let context;

try {
  context = await chromium.launchPersistentContext(profileDir, {
    headless: args.headless === "true",
    viewport: null,
  });
} catch (error) {
  const message = String(error);
  if (message.includes("Executable doesn't exist")) {
    console.error("Playwright browser is not installed.");
    console.error("Run: npx playwright install chromium");
  }
  throw error;
}

const page = context.pages()[0] || (await context.newPage());
await page.goto(formUrl, { waitUntil: "domcontentloaded" });
await page.bringToFront();

if (mode === "snapshot") {
  console.log("Browser opened.");
  console.log("1. Log in to HKUST in the browser window.");
  console.log("2. Navigate until the target eForm is fully visible.");
  await waitForEnter(
    "Press Enter here after the form is visible and ready to inspect.",
  );

  await settle(page);
  const output = await captureSnapshot(page);
  const stamp = timestamp();
  const jsonPath = path.join(artifactsDir, `form-snapshot-${stamp}.json`);
  const pngPath = path.join(artifactsDir, `form-snapshot-${stamp}.png`);

  await fs.writeFile(jsonPath, JSON.stringify(output, null, 2), "utf8");
  await page.screenshot({ path: pngPath, fullPage: true });

  console.log(`Snapshot written to ${jsonPath}`);
  console.log(`Screenshot written to ${pngPath}`);
  await context.close();
  process.exit(0);
}

console.log("Browser opened.");
console.log("If login is required, complete it in the browser first.");
await waitForEnter(
  "Press Enter here after you are on the target form and ready to run fill mode.",
);
await settle(page);

for (const [index, step] of config.steps.entries()) {
  console.log(`Running step ${index + 1}/${config.steps.length}: ${step.action}`);
  await runStep(page, step);
}

console.log("Fill steps completed.");

if (config.submit || args.submit === "true") {
  const answer = await ask(
    "Type SUBMIT to continue with the configured submit click, or press Enter to skip: ",
  );
  if (answer === "SUBMIT") {
    const submitStep = config.submitStep;
    if (!submitStep) {
      throw new Error(
        "Config requested submission, but submitStep is missing from config.",
      );
    }
    await runStep(page, submitStep);
    console.log("Submit step executed.");
  } else {
    console.log("Submission skipped.");
  }
}

await waitForEnter("Inspect the form in the browser, then press Enter to close.");
await context.close();

async function loadConfig(targetPath) {
  try {
    const raw = await fs.readFile(targetPath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Unable to read config at ${targetPath}. Copy config/claim.sample.json to config/claim.local.json first.`,
    );
  }
}

async function runStep(pageRef, step) {
  if (step.action === "wait") {
    await pageRef.waitForTimeout(Number(step.waitMs || step.value || 500));
    return;
  }

  const target = await resolveLocator(pageRef, step);

  switch (step.action) {
    case "fill":
      await setFieldValue(target, String(step.value ?? ""));
      await maybeWait(pageRef, step);
      return;
    case "select":
      await setSelectValue(target, String(step.value ?? ""));
      await maybeWait(pageRef, step);
      return;
    case "click":
      await target.click();
      await maybeWait(pageRef, step);
      return;
    case "check":
      await target.check();
      await maybeWait(pageRef, step);
      return;
    case "upload":
      if (!Array.isArray(step.files) || step.files.length === 0) {
        throw new Error("Upload step requires a non-empty files array.");
      }
      await target.setInputFiles(step.files);
      await maybeWait(pageRef, step);
      return;
    case "waitFor":
      await target.waitFor({ state: step.state || "visible" });
      await maybeWait(pageRef, step);
      return;
    default:
      throw new Error(`Unsupported action: ${step.action}`);
  }
}

async function resolveLocator(pageRef, step) {
  const frame = selectFrame(pageRef, step.frame);
  const locator = step.locator;
  if (!locator?.kind || !locator.value) {
    throw new Error(`Step is missing locator.kind or locator.value.`);
  }

  switch (locator.kind) {
    case "selector":
      return frame.locator(locator.value).first();
    case "label":
      return frame.getByLabel(locator.value, { exact: false }).first();
    case "placeholder":
      return frame.getByPlaceholder(locator.value, { exact: false }).first();
    case "text":
      return frame.getByText(locator.value, { exact: false }).first();
    case "dataBind":
      return resolveDataBindLocator(frame, locator);
    case "role":
      if (!locator.role) {
        throw new Error("Role locator requires locator.role.");
      }
      return frame.getByRole(locator.role, {
        name: locator.value,
        exact: false,
      });
    default:
      throw new Error(`Unsupported locator kind: ${locator.kind}`);
  }
}

function resolveDataBindLocator(frame, locator) {
  const target = locator.value;
  const elementTag = locator.tag || "input, textarea, select";
  const fieldSelector = locator.fieldSelector || ".yz-xform-field-cnt";
  const elementSelector = `${fieldSelector}[xdatabind="${escapeCssForSelector(
    target,
  )}"] ${elementTag}`;
  const nth = Number(locator.nth || 0);
  return frame.locator(elementSelector).nth(nth);
}

function selectFrame(pageRef, frameHint = {}) {
  if (!frameHint || Object.keys(frameHint).length === 0) {
    return pageRef;
  }

  for (const frame of pageRef.frames()) {
    if (frameHint.name && frame.name() !== frameHint.name) {
      continue;
    }
    if (
      frameHint.urlIncludes &&
      !String(frame.url()).includes(frameHint.urlIncludes)
    ) {
      continue;
    }
    return frame;
  }

  throw new Error(`Unable to find frame for hint ${JSON.stringify(frameHint)}`);
}

async function captureSnapshot(pageRef) {
  const frames = [];

  for (const frame of pageRef.frames()) {
    const data = await frame
      .evaluate(() => {
        const headings = Array.from(
          document.querySelectorAll("h1, h2, h3, legend, [role='heading']"),
        )
          .map((node) => node.textContent?.trim())
          .filter(Boolean)
          .slice(0, 50);

        const controls = Array.from(
          document.querySelectorAll("input, select, textarea"),
        ).map((node) => {
          const element = node;
          const tag = element.tagName.toLowerCase();
          const type = tag === "input" ? element.getAttribute("type") || "text" : tag;
          const rect = safeRect(element);
          const visible = isVisible(element, rect);
          const contextText = extractContextText(element);
          const nearbyText = extractNearbyText(element);
          const label =
            (element.labels
              ? Array.from(element.labels)
                  .map((labelNode) => labelNode.textContent?.trim() || "")
                  .filter(Boolean)
                  .join(" | ")
              : "") ||
            element.getAttribute("aria-label") ||
            closestLabelText(element) ||
            nearbyText.left ||
            nearbyText.above ||
            "";

          return {
            tag,
            type,
            selector: buildSelector(element),
            id: element.id || null,
            name: element.getAttribute("name"),
            placeholder: element.getAttribute("placeholder"),
            ariaLabel: element.getAttribute("aria-label"),
            label,
            visible,
            rect,
            rowText: contextText.rowText,
            containerText: contextText.containerText,
            nearbyText,
            value: previewValue(element),
            required: element.required || false,
            disabled: element.disabled || false,
            options:
              tag === "select"
                ? Array.from(element.querySelectorAll("option"))
                    .slice(0, 20)
                    .map((option) => ({
                      value: option.getAttribute("value"),
                      text: option.textContent?.trim() || "",
                    }))
                : undefined,
          };
        });

        const buttons = Array.from(
          document.querySelectorAll("button, input[type='button'], input[type='submit'], [role='button']"),
        ).map((node) => {
          const element = node;
          return {
            tag: element.tagName.toLowerCase(),
            text: element.textContent?.trim() || element.getAttribute("value") || "",
            selector: buildSelector(element),
            id: element.id || null,
            name: element.getAttribute("name"),
          };
        });

        return {
          url: window.location.href,
          title: document.title,
          headings,
          controlCount: controls.length,
          buttonCount: buttons.length,
          controls,
          buttons,
        };

        function closestLabelText(element) {
          const parentLabel = element.closest("label");
          if (parentLabel) {
            return parentLabel.textContent?.trim() || "";
          }

          const labelCell = element
            .closest("td")
            ?.previousElementSibling;
          if (labelCell) {
            const text = normalizeText(labelCell.textContent);
            if (text) {
              return text;
            }
          }

          const row = element.closest("tr");
          if (row) {
            const labelLike = row.querySelector(
              ".x-form-item-label, .yz-xform-field-label, .yz-xform-table-row-label",
            );
            const text = normalizeText(labelLike?.textContent);
            if (text) {
              return text;
            }
          }

          return "";
        }

        function extractContextText(element) {
          const row =
            element.closest("tr") ||
            element.closest(".x-form-item") ||
            element.parentElement;
          const rowText = normalizeText(row?.textContent);

          let container = element.parentElement;
          let hops = 0;
          while (container && hops < 4) {
            const text = normalizeText(container.textContent);
            if (text && text.length <= 300) {
              return {
                rowText,
                containerText: text,
              };
            }
            container = container.parentElement;
            hops += 1;
          }

          return {
            rowText,
            containerText: rowText,
          };
        }

        function extractNearbyText(element) {
          const left = findNearbyText(element, "left");
          const above = findNearbyText(element, "above");
          return { left, above };
        }

        function findNearbyText(element, direction) {
          const targetRect = safeRect(element);
          if (!targetRect.width && !targetRect.height) {
            return "";
          }

          const candidates = Array.from(
            document.querySelectorAll("td, th, span, div, label"),
          )
            .map((node) => ({
              node,
              text: normalizeText(node.textContent),
              rect: safeRect(node),
            }))
            .filter(
              (item) =>
                item.text &&
                item.text.length <= 120 &&
                item.rect.width > 0 &&
                item.rect.height > 0,
            );

          let best = null;
          for (const item of candidates) {
            if (item.node.contains(element) || element.contains(item.node)) {
              continue;
            }

            const dx = targetRect.left - item.rect.right;
            const dy = targetRect.top - item.rect.bottom;
            const verticalOverlap =
              Math.min(targetRect.bottom, item.rect.bottom) -
              Math.max(targetRect.top, item.rect.top);
            const horizontalOverlap =
              Math.min(targetRect.right, item.rect.right) -
              Math.max(targetRect.left, item.rect.left);

            if (direction === "left") {
              if (dx < -5 || dx > 260 || verticalOverlap < -8) {
                continue;
              }
              const score = Math.abs(dx) + Math.abs(verticalOverlap);
              if (!best || score < best.score) {
                best = { score, text: item.text };
              }
            } else if (direction === "above") {
              if (dy < -5 || dy > 120 || horizontalOverlap < -20) {
                continue;
              }
              const score = Math.abs(dy) + Math.abs(horizontalOverlap);
              if (!best || score < best.score) {
                best = { score, text: item.text };
              }
            }
          }

          return best?.text || "";
        }

        function previewValue(element) {
          if (element.tagName.toLowerCase() === "input") {
            const type = element.getAttribute("type") || "text";
            if (type === "password" || type === "file") {
              return null;
            }
          }
          return element.value || null;
        }

        function buildSelector(element) {
          if (element.id) {
            return `#${escapeCss(element.id)}`;
          }

          const name = element.getAttribute("name");
          if (name) {
            return `${element.tagName.toLowerCase()}[name="${escapeAttribute(name)}"]`;
          }

          const parts = [];
          let current = element;
          let depth = 0;

          while (current && current.nodeType === 1 && depth < 4) {
            let part = current.tagName.toLowerCase();
            const parent = current.parentElement;

            if (parent) {
              const siblings = Array.from(parent.children).filter(
                (node) => node.tagName === current.tagName,
              );
              if (siblings.length > 1) {
                part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
              }
            }

            parts.unshift(part);
            current = parent;
            depth += 1;
          }

          return parts.join(" > ");
        }

        function escapeCss(value) {
          return value.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, "\\$1");
        }

        function escapeAttribute(value) {
          return value.replace(/"/g, '\\"');
        }

        function normalizeText(value) {
          return (value || "").replace(/\s+/g, " ").trim();
        }

        function safeRect(element) {
          const rect = element.getBoundingClientRect();
          return {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            top: Math.round(rect.top),
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            bottom: Math.round(rect.bottom),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          };
        }

        function isVisible(element, rect) {
          const style = window.getComputedStyle(element);
          return !(
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.opacity === "0" ||
            rect.width === 0 ||
            rect.height === 0
          );
        }
      })
      .catch((error) => ({
        url: frame.url(),
        title: null,
        error: String(error),
      }));

    frames.push({
      name: frame.name(),
      url: frame.url(),
      ...data,
    });
  }

  return {
    capturedAt: new Date().toISOString(),
    pageUrl: pageRef.url(),
    pageTitle: await pageRef.title(),
    frameCount: frames.length,
    frames,
  };
}

async function settle(pageRef) {
  await pageRef.waitForLoadState("domcontentloaded");
  await pageRef.waitForTimeout(1500);
}

async function triggerFieldEvents(target) {
  await target.evaluate((element) => {
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new Event("blur", { bubbles: true }));
  });
}

async function setFieldValue(target, value) {
  try {
    await target.fill(value);
    await triggerFieldEvents(target);
    return;
  } catch (error) {
    const message = String(error);
    if (!message.includes("not editable")) {
      throw error;
    }
  }

  await target.evaluate((element, nextValue) => {
    if (element.hasAttribute("readonly")) {
      element.removeAttribute("readonly");
    }
    if (element.hasAttribute("disabled")) {
      element.removeAttribute("disabled");
    }
    element.focus();
    element.value = nextValue;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new Event("blur", { bubbles: true }));
  }, value);
}

async function setSelectValue(target, value) {
  try {
    await target.selectOption(value);
    return;
  } catch (error) {
    const message = String(error);
    if (!message.includes("not enabled")) {
      throw error;
    }
  }

  await target.evaluate((element, nextValue) => {
    if (element.hasAttribute("disabled")) {
      element.removeAttribute("disabled");
    }
    element.value = nextValue;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new Event("blur", { bubbles: true }));
  }, value);
}

async function maybeWait(pageRef, step) {
  if (step.waitMs) {
    await pageRef.waitForTimeout(Number(step.waitMs));
  }
}

async function waitForEnter(promptText) {
  await ask(`${promptText}\n`);
}

async function ask(promptText) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await rl.question(promptText);
    return answer.trim();
  } finally {
    rl.close();
  }
}

function timestamp() {
  const now = new Date();
  const parts = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ];
  return `${parts[0]}${parts[1]}${parts[2]}-${parts[3]}${parts[4]}${parts[5]}`;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function parseArgs(argv) {
  const result = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      result._.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      result[key] = "true";
      continue;
    }

    result[key] = next;
    index += 1;
  }
  return result;
}

function printUsage() {
  console.log("Usage:");
  console.log("  npm run snapshot");
  console.log("  npm run fill");
  console.log("");
  console.log("Direct:");
  console.log(
    "  node scripts/eform-agent.mjs snapshot [--url <form-url>] [--headless]",
  );
  console.log(
    "  node scripts/eform-agent.mjs fill --config config/claim.local.json [--submit]",
  );
}

function escapeCssForSelector(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
