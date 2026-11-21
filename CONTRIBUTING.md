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

1. Run `npm ci`, `npx playwright install chromium`, and `npm test` on Node.js 22.
2. Run `npm run check` with a local config and real local attachment paths.
3. Smoke-test `npm run snapshot` when you have access to the live form. Offline
   tests do not verify HKUST login or YZSoft integration.
4. Verify no sensitive files are staged.
