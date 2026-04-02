# Publishing Checklist

Publish this subdirectory only. Do not publish the surrounding reimbursement workspace.

Before creating a public repository:

1. Confirm the repo does not include `.auth/`.
2. Confirm the repo does not include `artifacts/`.
3. Confirm the repo does not include `config/claim.local.json`.
4. Confirm the repo does not include any real receipts, screenshots, or PDFs.
5. Confirm all sample data is synthetic.
6. Confirm the README states the tool is unofficial and local-first.
7. Confirm branding does not imply HKUST endorsement.
8. Confirm auto-submit is still disabled by default.

Recommended first release:

- `0.1.0`
- one safe sample config
- snapshot and fill workflows
- a short safety section in the README
