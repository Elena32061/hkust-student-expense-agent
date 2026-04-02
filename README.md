# HKUST Student Expense Agent

Chinese version: [README.zh-CN.md](README.zh-CN.md)

Unofficial local-first browser automation for the HKUST `Expense Claim for Student Form`.

This project is designed for one workflow only:

1. You log in manually with your own HKUST account.
2. The script reuses your local browser session.
3. The script snapshots or fills the form on your machine.
4. You review the result before any submission.

## Boundaries

- This is not an HKUST official tool.
- This project does not collect credentials.
- This project does not bypass SSO, MFA, captcha, or access control.
- This project should not be used as a hosted service for other people's accounts.
- Auto-submit is disabled by default and should stay opt-in.

## Why This Exists

HKUST student reimbursement eForms are repetitive and structurally stable, but the DOM is dynamic enough that plain form-filling tools are brittle. This repo uses Playwright plus form snapshots to make the workflow inspectable and reproducible.

## Install

```bash
npm install
npx playwright install chromium
cp config/claim.sample.json config/claim.local.json
```

## Quickstart

Capture a real logged-in snapshot first:

```bash
npm run snapshot
```

Then edit your local config and run fill mode:

```bash
npm run check
npm run fill
```

The script will:

- open a real Chromium window
- wait for you to finish manual login if needed
- fill configured fields and attachments
- stop for human review instead of submitting automatically

## Files You Should Never Commit

- `.auth/`
- `artifacts/`
- `config/claim.local.json`
- any real receipts, invoices, bank details, or screenshots
- any real DOM snapshots from a logged-in session

## Project Layout

- `scripts/eform-agent.mjs`: snapshot and fill runner
- `scripts/check-config.mjs`: local config sanity checks
- `config/claim.sample.json`: safe example config with fake data
- `examples/receipts/`: placeholder area for local-only sample paths
- `docs/PUBLISHING.md`: checklist before publishing a fork
- `docs/CLI_ANYTHING.md`: notes for wrapping this into a larger agent workflow

## HKUST-Specific Notes

- Keep the tool local-first.
- Require users to log in themselves.
- Treat saved browser state and snapshots as sensitive data.
- Avoid claims of official affiliation or endorsement.

## License

MIT
