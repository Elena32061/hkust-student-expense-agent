#!/usr/bin/env node

import fs from "node:fs";

const requestPath = process.env.CLAIM_REQUEST_PATH;

if (!requestPath) {
  console.error("CLAIM_REQUEST_PATH is required.");
  process.exit(1);
}

const request = JSON.parse(fs.readFileSync(requestPath, "utf8"));
const firstReceipt = request.receipts[0];

const draft = {
  line_items: [
    {
      receipt_ids: [firstReceipt.id],
      expense_type:
        firstReceipt.expenseHints?.expense_type ||
        "Registration/Conference/Visa Fee",
      date_from: "2026-01-01",
      date_to: "2026-01-01",
      currency: "USD",
      amount: 123.45,
      business_purpose:
        firstReceipt.expenseHints?.business_purpose || "Conference attendance",
      particular: "Mock extracted line item",
      justification: "Mock provider output for local testing.",
      attachments: [firstReceipt.path],
      confidence: 0.42,
      review_notes: [
        "This is synthetic output from examples/mock-command-provider.mjs."
      ]
    }
  ],
  open_questions: [
    "Replace the mock provider with your own model wrapper before using this on real receipts."
  ],
  summary: {
    estimated_total_by_currency: [
      {
        currency: "USD",
        total: 123.45
      }
    ],
    notes: [
      "Mock provider mode is for integration testing only."
    ]
  }
};

process.stdout.write(JSON.stringify(draft, null, 2));
