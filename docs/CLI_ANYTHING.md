# CLI-Anything Notes

This repository already has the right shape for agent-style wrapping:

- a deterministic CLI entrypoint
- explicit config files
- extract, snapshot, check, and fill phases
- human approval before submission

If you later package it for a broader agent framework such as CLI-Anything, keep the interface narrow:

- `extract`: build a claim draft from local receipts through a user-supplied model wrapper
- `snapshot`: inspect the logged-in form and save a local artifact
- `check`: validate a local claim config before browser automation
- `check:draft`: validate model output before it is mapped into browser steps
- `fill`: apply local config to the live form and stop before submission

Keep the same safety model:

- manual login by the user
- local or self-chosen model provider
- no remote credential handling
- no hosted browser state
- no default auto-submit
