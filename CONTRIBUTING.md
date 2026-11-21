# Contributing

Contributions are welcome, but keep the scope tight.

Preferred changes:

- more stable field detection
- safer default behavior
- better docs for local-only usage
- redaction and validation tooling
- example configs with fake data only

Do not contribute:

- real receipts or screenshots
- saved browser profiles
- credentials, tokens, or personal data
- code that turns this into a hosted login proxy or shared submission service

Before opening a PR:

1. Use Node.js 22 and run `npm ci`, then `npm test`.
2. Run `npm run extract:sample` and `npm run check:draft -- --request artifacts/extract-request.latest.json`.
3. Run `npm run check` with a local config. Smoke-test `npm run snapshot` when you have access to the live form.
4. Verify no sensitive files are staged.

Tests use synthetic receipts and stub command providers. They require no API
keys, paid model calls, OCR installation, or HKUST account. Live model accuracy,
SSO, and YZSoft behavior require separate manual verification.
