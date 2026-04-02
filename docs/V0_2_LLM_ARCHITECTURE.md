# V0.2 LLM Architecture

## Goal

V0.2 adds an optional LLM stage for turning messy receipt text into a structured claim draft while keeping browser execution deterministic and local.

The design target is:

- LLMs handle understanding and normalization
- Playwright handles browser interaction
- humans keep final review before submission

## Core Principle

This repository does not use an LLM to click around the live HKUST eForm.

That boundary is intentional:

- receipt understanding is fuzzy and model-friendly
- DOM interaction is brittle and should stay deterministic
- submission remains a human-approved action

In short: use the model for extraction, not for browser control.

## Pipeline

1. Local text extraction
   `scripts/extract-receipts.mjs` reads receipts from local disk and extracts text with direct file reads, `pdftotext`, `tesseract`, or a custom replacement.

2. Request packaging
   The script writes `artifacts/extract-request-*.json` and `artifacts/extract-request.latest.json`. The request includes:
   - raw extracted receipt text
   - optional expense hints
   - explicit instructions
   - the target output schema

3. Provider execution
   A provider command receives the request path through `CLAIM_REQUEST_PATH`, runs any model the user wants, and prints JSON to stdout.

4. Draft validation and review
   The repository validates the returned shape, writes `artifacts/claim-draft-*.json`, and keeps `artifacts/claim-draft.latest.json` for follow-up checks.

5. Deterministic form filling
   After review, the structured values can be mapped into the existing `fill` config and executed through Playwright against the live form.

## Trust Boundary

The trust boundary in V0.2 is narrow on purpose.

- The repo never proxies HKUST credentials.
- The repo never asks the model to log in or submit.
- The provider sees receipt text, not a live browser session.
- The browser fill path still uses explicit locators and explicit values.

This makes the system easier to audit, fork, and self-host.

## Why Command Providers

The provider contract is command-based instead of vendor-based.

That means this repository does not hardcode:

- OpenAI
- Anthropic
- Ollama
- LM Studio
- vLLM
- custom lab gateways

If a user can write a local script that:

1. reads `CLAIM_REQUEST_PATH`
2. calls their preferred model
3. prints JSON matching `schemas/claim-draft.schema.json`

then it works with this project.

## Review-First Behavior

The model output is a draft, not ground truth.

Contributors should preserve uncertainty explicitly:

- leave missing values unresolved
- put ambiguities into `review_notes`
- ask for clarification in `open_questions`
- keep attachments tied to original files

The intended workflow is review, then fill, then manual submit.

## Current Scope

V0.2 is a foundation release, not a full autonomous reimbursement bot.

Included now:

- receipt text extraction
- provider-agnostic model contract
- schema-driven draft output
- local validation and sample wrappers

Not included by default:

- autonomous login
- direct model-driven browser control
- silent submission
- hosted multi-user credential handling

## Extension Points

Forks can extend V0.2 in a few clean ways:

- add richer OCR or table extraction upstream of the LLM
- add institution-specific draft-to-form transforms
- add domain prompts for common claim categories
- add stricter JSON Schema validation or policy checks

The important constraint is to keep the browser execution layer explicit and reviewable.
