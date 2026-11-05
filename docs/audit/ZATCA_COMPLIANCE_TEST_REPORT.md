# ZATCA Compliance Test Report

Date: 2026-11-05. **Verdict: NOT IMPLEMENTED. No ZATCA test has been run, because there is no ZATCA code yet.** This is the agreed plan: ZATCA is Phase 5. Receipts printed by this build say "TEST BUILD — NOT A ZATCA TAX INVOICE", and the build must not be used for real sales.

## What the audit prompt confirms about scope

- Simplified (B2C) invoices only; EGS functionality map **`0100`** (to confirm at onboarding). Standard-invoice clearance is out of scope.
- So onboarding compliance checks need three documents: simplified invoice, simplified credit note, simplified debit note. **Debit notes must be built too.**

## Requirement status

| Requirement | Status | Notes |
|---|---|---|
| UBL 2.1 XML for invoice, credit note, debit note | NOT BUILT | — |
| UUID per document | Ready in data | `sales.uuid` exists (random v4) |
| ICV (counter per EGS, never reset) | NOT BUILT | Must survive restores and reinstalls. Restore today restores the whole DB, which would carry the counter; see risk Z-3 |
| PIH (previous invoice hash) chain | NOT BUILT | — |
| SHA-256 invoice hash, ECDSA stamp, certificate | NOT BUILT | **Curve still unresolved:** the official Security Features standard table says "P-256"; ZATCA's developer forum CSR examples use secp256k1. Will be settled against the official SDK and sandbox; it is configuration, not hard-coded |
| 9-tag TLV QR | NOT BUILT | Receipt layout leaves room for it |
| Reporting within 24 h, durable queue, retries, timeouts with unknown outcome | NOT BUILT | Design: one worker sends in ICV order; XML, hash and signature are frozen at sale time and never regenerated; a timeout is re-queried, never re-issued |
| Warnings / rejections handling and dashboard | NOT BUILT | — |
| CSID onboarding (OTP, CSR, compliance, production CSID), renewal | NOT BUILT | Keys to be stored with DPAPI, as the backup key is today |
| Credit notes for refunds | NOT BUILT | Refunds themselves are missing (Phase 2) |
| Invoice numbering | PARTIAL | Gapless local counter, unique, in the sale transaction (tested) |
| Immutable issued record | PARTIAL | Sales are immutable; the signed XML will need the same protection |

## Risks to resolve before building ZATCA

| ID | Risk | Mitigation planned |
|---|---|---|
| Z-1 | Switching from the old EGS: revoking it is irreversible | Onboard and test the new EGS first; keep the old one until the cut-over day; written cut-over checklist |
| Z-2 | PIH carry-over from the old system is unclear | Ask ZATCA or a consultant; record the answer before coding |
| Z-3 | Restoring an **older** backup would roll the ICV back and break the chain | Restore must refuse, or require a ZATCA-aware reconciliation, if the backup is older than the last reported invoice. Needs design |
| Z-4 | The private key is in the DB backup or not at all | Keep keys outside the DB (DPAPI). A replacement PC re-onboards rather than copying keys, unless ZATCA permits otherwise |
| Z-5 | A clock running backwards breaks issue-time order | Guard added (BUG-009) |
| Z-6 | The rounding rule may differ from the ZATCA business rules | Validate with the official SDK in CI |

## Tests that will be required (none run yet)

- Official SDK XML and schema validation for every document type.
- Hash and signature verification.
- QR decoding.
- Sandbox and simulation onboarding.
- The three compliance documents.
- Reporting success, warnings, rejection, timeout and duplicate.
- Crash at each step of issuing.
- 200 offline sales then reconnect (Scenario E).
- Restore and reinstall preserving ICV and PIH.

Fabricated "success" responses will not be used as evidence.
