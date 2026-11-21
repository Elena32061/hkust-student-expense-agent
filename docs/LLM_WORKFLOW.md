# Receipt to reviewed form config

Use Node.js 22. Install JavaScript dependencies with `npm ci`. The workflow is
`extract` → review the draft → `draft:prepare` → `check` → `fill`.

## Extract and review

Choose a provider config, replace its receipt paths and hints, and run:

```bash
npm run extract
npm run check:draft -- --request artifacts/extract-request.latest.json
```

The OpenAI-compatible wrapper sends extracted text to your configured endpoint.
The Ollama wrapper can use a model running locally. Neither receives your browser
session. The built-in `npm run extract:sample` provider emits synthetic fixed
values and is only an integration example, not an OCR or model accuracy test.

Inspect `artifacts/claim-draft.latest.json` against the original receipts:

- Verify each amount, currency, date, category, and business purpose.
- Resolve `null` fields using the receipt or your own knowledge. Unknown values
  are retained for review instead of requiring the model to invent them.
- Read `open_questions` and each item's `review_notes`. Confidence is a model
  estimate, not a measured guarantee of accuracy.
- Keep `receipt_ids`, `attachments`, and `source_request_id` tied to the original
  extraction request. An item must attach exactly the files for its cited IDs.
- If you change amounts, update `summary.estimated_total_by_currency` too.
  Totals must match the known line items. A known currency with an unresolved
  amount uses a null total; items with unknown currency do not get a guessed
  currency total.

Malformed output, impossible dates, inconsistent totals, and unrelated
attachments stop extraction before the latest draft is replaced. Valid drafts
with explicit unknowns are saved with review warnings.

## Generate and fill

After review and correction:

```bash
npm run check:draft -- --request artifacts/extract-request.latest.json --ready
npm run draft:prepare -- --reviewed
npm run check
npm run fill
```

`--reviewed` acknowledges the draft, including outstanding review messages. It
does not override missing fields, invalid totals, source mismatches, or missing
attachment files. Generation never opens the browser and always writes
`submit: false`; it adds no submit or add-row clicks.

The default output is `config/claim.local.json`. Existing output is preserved.
Choose another ignored local config with `--out config/another.local.json`, or
explicitly pass `--force` to replace an existing output. The tool refuses to
overwrite its draft, source request, or source receipts.

For several expenses, add enough rows in the live form before confirming the
fill prompt. The generated config checks every target field in every row before
the first edit. Dates become `DD/MM/YYYY`; amounts are not rounded or converted
between currencies. Field bindings and frame selection follow the repository's
HKUST sample form. New form variants still need manual mapping verification.

## OCR setup and limits

Text files are read directly. PDFs first use `pdftotext`. If a PDF returns no
text, enable scanned PDF fallback in your extraction config:

```json
{
  "textExtraction": {
    "enablePdfText": true,
    "enableOcrForImages": true,
    "enableOcrForPdfs": true,
    "ocrLanguages": "eng",
    "maxPdfPages": 10,
    "timeoutMs": 120000,
    "maxOutputBytes": 2097152
  }
}
```

Install Poppler (`pdftotext`, `pdftoppm`) and Tesseract:

```bash
# macOS
brew install poppler tesseract
# Ubuntu / Debian
sudo apt-get install poppler-utils tesseract-ocr
```

Chinese receipts require the relevant Tesseract language data; after installing
it, use `eng+chi_tra` or `eng+chi_sim` as appropriate. PDF fallback rasterizes
pages locally and deletes temporary images after success or failure. The default
OCR page limit is 10; exceeding it fails instead of dropping later pages.

Fallback is triggered when the PDF's text extraction is empty. For mixed PDFs
whose text layer covers only some pages, explicitly set `enablePdfText: false`
with `enableOcrForPdfs: true` to OCR every page. Always inspect recognition of
decimal points, currency symbols, and dates against the originals.

Each external command has a default 120-second timeout and a combined 2 MiB
stdout/stderr limit. Override `timeoutMs` and `maxOutputBytes` under
`textExtraction` for OCR tools or under `provider` for the model wrapper. Limits
must be positive integers, up to 600000 ms and 16777216 bytes. A receipt exceeding
25000 extracted characters fails; split it into smaller inputs. Empty text also
fails before a provider call.

## Artifact identity and retries

Each request has a unique `request_id`; the runner copies it to the draft's
`source_request_id`. The converter requires both to match. After a provider or
validation failure, the previous successful latest draft remains available; a
failure is never reported as a new draft. Timestamped request artifacts can
still be used to diagnose the failed run locally.

Latest files are replaced individually. Concurrent runs can leave a mismatched
latest pair, which the converter rejects. Use the matching timestamped pair:

```bash
npm run draft:prepare -- --draft artifacts/claim-draft-RUN.json --request artifacts/extract-request-RUN.json --out config/reviewed.local.json --reviewed
```

Older drafts without request identity must be regenerated through `extract`
before conversion. All request/draft artifacts contain local receipt information
and remain under the ignored `artifacts/` directory.

## Development verification

`npm test` exercises the validator, local command execution, OCR fallback using
stub tools, and draft conversion. Tests use synthetic data without paid APIs or
school login. Real model extraction quality and HKUST/YZSoft integration require
separate validation on representative receipts and the live form.
