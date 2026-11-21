// Browser operations are separate from the CLI so synthetic forms can exercise them.
export async function runSteps(page, steps, onStep = () => {}) {
  for (const [index, step] of steps.entries()) {
    onStep(index, step);
    try {
      await runStep(page, step);
    } catch (error) {
      throw new Error(`Step ${index + 1}/${steps.length} (${step.action}) failed: ${error.message}`, {
        cause: error,
      });
    }
  }
}

export async function runStep(pageRef, step) {
  if (step.action === "wait") {
    await pageRef.waitForTimeout(Number(step.waitMs ?? step.value ?? 500));
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

export async function resolveLocator(pageRef, step) {
  const frame = selectFrame(pageRef, step.frame);
  const locator = step.locator;
  if (!locator?.kind || !locator.value) {
    throw new Error(`Step is missing locator.kind or locator.value.`);
  }

  let target;
  switch (locator.kind) {
    case "selector":
      target = frame.locator(locator.value);
      break;
    case "label":
      target = frame.getByLabel(locator.value, { exact: false });
      break;
    case "placeholder":
      target = frame.getByPlaceholder(locator.value, { exact: false });
      break;
    case "text":
      target = frame.getByText(locator.value, { exact: false });
      break;
    case "dataBind": {
      const fieldSelector = locator.fieldSelector || ".yz-xform-field-cnt";
      const container = `:is(${fieldSelector})[xdatabind="${escapeCssForSelector(locator.value)}"]`;
      // Chain locators so every comma-separated tag remains inside the binding.
      return frame.locator(container)
        .locator(locator.tag || "input, textarea, select")
        .nth(locator.nth ?? 0);
    }
    case "role":
      if (!locator.role) {
        throw new Error("Role locator requires locator.role.");
      }
      target = frame.getByRole(locator.role, {
        name: locator.value,
        exact: false,
      });
      break;
    default:
      throw new Error(`Unsupported locator kind: ${locator.kind}`);
  }
  if (locator.nth !== undefined) return target.nth(locator.nth);
  return locator.kind === "role" ? target : target.first();
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

function escapeCssForSelector(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
