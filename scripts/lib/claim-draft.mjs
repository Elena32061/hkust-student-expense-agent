const extractedFields = ["expense_type", "date_from", "date_to", "currency", "amount", "business_purpose", "particular", "justification"];
const itemFields = ["receipt_ids", ...extractedFields, "attachments", "confidence", "review_notes"];
const validCurrency = (value) => typeof value === "string" && /^[A-Z]{3}$/.test(value);
const validAmount = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const nonempty = (value) => typeof value === "string" && value.trim() !== "";

/** Pure structural, accounting, and optional receipt-provenance validation.
 * Unknown extracted values must be explicit nulls. A known currency with any
 * null amount must have a null summary total; complete totals must be numeric.
 * Unknown-currency items are unresolved and excluded from per-currency sums.
 * No file access is performed here; readiness still requires human review.
 */
export function validateClaimDraft(draft, { receipts, requireReady = false } = {}) {
  const errors = [];
  const warnings = [];
  const error = (at, message) => errors.push(`${at} ${message}.`);
  const unresolved = (at, message) => (requireReady ? errors : warnings).push(`${at} ${message}.`);
  const checkObject = (value, at, allowed) => {
    if (!object(value)) {
      error(at, "must be an object");
      return false;
    }
    if (Object.keys(value).some((key) => !allowed.includes(key))) error(at, "contains unsupported properties");
    return true;
  };
  const checkStrings = (value, at, { nonEmpty = false, unique = false } = {}) => {
    if (!Array.isArray(value)) {
      error(at, "must be an array of strings");
      return false;
    }
    let valid = true;
    if (nonEmpty && !value.length) {
      error(at, "must not be empty");
      valid = false;
    }
    value.forEach((entry, index) => {
      if (!nonempty(entry)) {
        error(`${at}[${index}]`, "must be a non-empty string");
        valid = false;
      }
    });
    if (unique && new Set(value).size !== value.length) {
      error(at, "must not contain duplicates");
      valid = false;
    }
    return valid;
  };

  const receiptById = new Map();
  const receiptUseCounts = new Map();
  if (receipts !== undefined) {
    if (!Array.isArray(receipts)) {
      error("receipts", "must be an array");
    } else {
      receipts.forEach((receipt, index) => {
        const at = `receipts[${index}]`;
        if (!object(receipt)) {
          error(at, "must be an object");
          return;
        }
        if (!nonempty(receipt.id)) error(`${at}.id`, "must be a non-empty string");
        if (!nonempty(receipt.path)) error(`${at}.path`, "must be a non-empty string");
        if (nonempty(receipt.id)) {
          if (receiptById.has(receipt.id)) error(`${at}.id`, "duplicates another request receipt ID");
          else receiptById.set(receipt.id, receipt.path);
        }
      });
    }
  }

  if (!checkObject(draft, "draft", ["source_request_id", "line_items", "open_questions", "summary"])) return { errors, warnings };
  if (draft.source_request_id !== undefined && !nonempty(draft.source_request_id)) error("source_request_id", "must be a non-empty string");
  const totals = new Map();
  if (!Array.isArray(draft.line_items)) {
    error("line_items", "must be an array");
  } else {
    if (!draft.line_items.length) unresolved("line_items", "contains no claim items");
    draft.line_items.forEach((item, index) => {
      const at = `line_items[${index}]`;
      if (!checkObject(item, at, itemFields)) return;
      const validIds = checkStrings(item.receipt_ids, `${at}.receipt_ids`, { nonEmpty: true, unique: true });
      const validAttachments = checkStrings(item.attachments, `${at}.attachments`, { nonEmpty: true, unique: true });
      if (validIds) {
        for (const id of item.receipt_ids) {
          receiptUseCounts.set(id, (receiptUseCounts.get(id) || 0) + 1);
        }
      }
      checkStrings(item.review_notes, `${at}.review_notes`);
      if (Array.isArray(item.review_notes) && item.review_notes.length) warnings.push(`${at}.review_notes requires human review.`);
      if (typeof item.confidence !== "number" || !Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1) {
        error(`${at}.confidence`, "must be a finite number between 0 and 1");
      } else if (item.confidence < 0.8) {
        warnings.push(`${at}.confidence is below 0.8; verify this item against its receipts.`);
      }
      for (const key of extractedFields) {
        const value = item[key];
        const fieldAt = `${at}.${key}`;
        if (value === null) {
          unresolved(fieldAt, "is unresolved (null)");
        } else if (key === "amount") {
          if (!validAmount(value)) error(fieldAt, "must be a finite non-negative number or null");
        } else if (key === "date_from" || key === "date_to") {
          if (!isRealDate(value)) error(fieldAt, "must be a real YYYY-MM-DD date or null");
        } else if (key === "currency") {
          if (!validCurrency(value)) error(fieldAt, "must be an uppercase three-letter currency code or null");
        } else if (!nonempty(value)) {
          error(fieldAt, "must be a non-empty string or null");
        }
      }
      if (isRealDate(item.date_from) && isRealDate(item.date_to) && item.date_from > item.date_to) error(`${at}.date_to`, "must not precede date_from");
      if (validCurrency(item.currency)) {
        const current = totals.get(item.currency) || { sum: { units: 0n, scale: 0 }, incomplete: false };
        if (validAmount(item.amount)) current.sum = addDecimal(current.sum, decimal(item.amount));
        else current.incomplete = true;
        totals.set(item.currency, current);
      }
      if (receipts !== undefined && validIds && validAttachments) {
        const paths = new Set();
        item.receipt_ids.forEach((id, receiptIndex) => {
          if (!receiptById.has(id)) error(`${at}.receipt_ids[${receiptIndex}]`, "does not reference a known request receipt");
          else paths.add(receiptById.get(id));
        });
        const attachments = new Set(item.attachments);
        if (paths.size !== attachments.size || [...paths].some((value) => !attachments.has(value))) {
          error(`${at}.attachments`, "must exactly match the original paths of its supporting receipt_ids");
        }
      }
    });
  }
  if (Array.isArray(receipts)) {
    receipts.forEach((receipt, index) => {
      if (!object(receipt) || !nonempty(receipt.id)) return;
      const count = receiptUseCounts.get(receipt.id) || 0;
      if (count === 0) warnings.push(`receipts[${index}] is not referenced by any line item; verify that no expense was omitted.`);
      else if (count > 1) warnings.push(`receipts[${index}] is referenced by multiple line items; verify split amounts to avoid double counting.`);
    });
  }
  checkStrings(draft.open_questions, "open_questions");
  if (Array.isArray(draft.open_questions) && draft.open_questions.length) warnings.push("open_questions requires human review.");
  if (checkObject(draft.summary, "summary", ["estimated_total_by_currency", "notes"])) {
    checkStrings(draft.summary.notes, "summary.notes");
    const entries = draft.summary.estimated_total_by_currency;
    if (!Array.isArray(entries)) {
      error("summary.estimated_total_by_currency", "must be an array");
    } else {
      const seen = new Set();
      entries.forEach((entry, index) => {
        const at = `summary.estimated_total_by_currency[${index}]`;
        if (!checkObject(entry, at, ["currency", "total"])) return;
        if (!validCurrency(entry.currency)) {
          error(`${at}.currency`, "must be an uppercase three-letter currency code");
          return;
        }
        if (seen.has(entry.currency)) error(`${at}.currency`, "duplicates another currency total");
        seen.add(entry.currency);
        const expected = totals.get(entry.currency);
        if (!expected) error(at, "has no corresponding line-item currency");
        if (entry.total === null) {
          if (!expected?.incomplete) error(`${at}.total`, "may be null only when a corresponding line-item amount is unresolved");
          else unresolved(`${at}.total`, "is incomplete because a line-item amount is unresolved");
        } else if (!validAmount(entry.total)) {
          error(`${at}.total`, "must be a finite non-negative number, or null for an incomplete currency total");
        } else if (expected?.incomplete) {
          error(`${at}.total`, "must be null while a corresponding line-item amount is unresolved");
        } else if (expected && !equalDecimal(expected.sum, decimal(entry.total))) {
          error(`${at}.total`, "does not match the sum of its line-item amounts");
        }
      });
      for (const currency of totals.keys()) {
        if (!seen.has(currency)) error("summary.estimated_total_by_currency", "is missing a line-item currency total");
      }
    }
  }
  return { errors, warnings };
}

function isRealDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

// Sum decimal values without currency-specific rounding or float overflow.
function decimal(value) {
  const [coefficient, exponent = "0"] = String(value).toLowerCase().split("e");
  const [integer, fraction = ""] = coefficient.split(".");
  let units = BigInt(integer + fraction);
  let scale = fraction.length - Number(exponent);
  if (scale < 0) { units *= 10n ** BigInt(-scale); scale = 0; }
  return { units, scale };
}

function addDecimal(left, right) {
  const scale = Math.max(left.scale, right.scale);
  return { units: left.units * 10n ** BigInt(scale - left.scale) + right.units * 10n ** BigInt(scale - right.scale), scale };
}

function equalDecimal(left, right) {
  // Permit ordinary JSON floating-point artifacts, without rounding amounts.
  const scale = Math.max(9, left.scale, right.scale);
  const difference = left.units * 10n ** BigInt(scale - left.scale) - right.units * 10n ** BigInt(scale - right.scale);
  return (difference < 0n ? -difference : difference) <= 10n ** BigInt(scale - 9);
}
