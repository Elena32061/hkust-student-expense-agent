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

1. Run `npm run check` with a local config.
2. Smoke-test `npm run snapshot`.
3. Verify no sensitive files are staged.
