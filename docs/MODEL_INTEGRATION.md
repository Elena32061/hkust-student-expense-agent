# Model Integration

## Contract Overview

The recommended integration path is a local command wrapper.

Your wrapper receives one environment variable:

- `CLAIM_REQUEST_PATH`: absolute path to the extraction request JSON

Your wrapper must:

1. read the request file
2. call any model or API you want
3. print valid JSON to stdout

The stdout JSON must match [`schemas/claim-draft.schema.json`](../schemas/claim-draft.schema.json).

## Why This Contract

This keeps the repository vendor-neutral.

The main project stays responsible for:

- local receipt handling
- schema packaging
- deterministic browser automation

Your wrapper stays responsible for:

- prompt engineering
- model choice
- API keys or local model runtime
- output cleanup before returning JSON

## Request Shape

The request written by `npm run extract` contains:

- `task`: what the model should do
- `instructions`: strict output rules
- `output_schema`: the expected JSON shape
- `receipts[]`: extracted text plus file paths and hints

The exact envelope is documented in [`schemas/extraction-request.schema.json`](../schemas/extraction-request.schema.json).

## Output Shape

The model output must contain:

- `line_items`
- `open_questions`
- `summary`

Each line item should keep:

- the original `receipt_ids`
- the original attachment file paths
- a confidence score
- review notes when the model is unsure

## Local Smoke Test

The repository includes a fake provider so contributors can test the contract without paying for an API.

```bash
npm run extract:sample
npm run check:draft
```

This uses [`examples/mock-command-provider.mjs`](../examples/mock-command-provider.mjs) and the synthetic receipt in [`examples/receipts/sample-registration.txt`](../examples/receipts/sample-registration.txt).

## OpenAI-Compatible Wrapper

Sample wrapper:

- [`examples/openai-compatible-provider.mjs`](../examples/openai-compatible-provider.mjs)

Sample config:

- [`config/extraction.openai-compatible.sample.json`](../config/extraction.openai-compatible.sample.json)

Usage:

```bash
cp config/extraction.openai-compatible.sample.json config/extraction.local.json
export OPENAI_API_KEY=your-key
npm run extract
npm run check:draft
```

This pattern works for any endpoint that exposes an OpenAI-style chat completions API.

## Ollama Wrapper

Sample wrapper:

- [`examples/ollama-provider.mjs`](../examples/ollama-provider.mjs)

Sample config:

- [`config/extraction.ollama.sample.json`](../config/extraction.ollama.sample.json)

Usage:

```bash
cp config/extraction.ollama.sample.json config/extraction.local.json
npm run extract
npm run check:draft
```

## Minimal Wrapper Requirements

No matter which model stack you use, keep these rules:

- return JSON only
- do not invent amounts or dates when the source is missing
- keep file paths in `attachments`
- surface uncertainty in `review_notes` and `open_questions`
- never attempt browser automation from the wrapper

## Recommended Follow-Up

After a draft is produced:

1. inspect `artifacts/claim-draft.latest.json`
2. run `npm run check:draft`
3. review the draft manually
4. map approved values into `config/claim.local.json`
5. run `npm run fill`

This preserves a clean separation between model interpretation and form execution.
