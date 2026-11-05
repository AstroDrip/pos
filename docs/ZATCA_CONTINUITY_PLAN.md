# ZATCA Phase 2: Continuity and Test Plan

Status 2026-11-06: **planning document. No ZATCA code exists in the new POS yet** (plan Phase 5). The new POS is **not** production-ready and must not issue real invoices.

Sources:
- The ZATCA research in `PLAN_AND_APPROVAL_REQUEST.md` §H, checked against official ZATCA pages when the plan was written.
- The official specification pages listed in the owner's prompt:
  - E-Invoice specifications;
  - Simplified technical guide;
  - Technical requirements.
- Anything marked **[verify]** must be confirmed against the current official XML Implementation Standard, Data Dictionary, Security Features standard and the ZATCA SDK before coding. Nothing here replaces those documents.

## 1. What is known about the current system

| Question | What the evidence shows | Confidence |
|---|---|---|
| Does the store issue Phase 2 invoices today? | The owner says yes. The archived ZAT Pro (newest build in the archive, logs up to 2025-10-06) contains only a `KSATLV` QR routine (Phase 1-style Base64 TLV QR). There are **no** strings for Fatoora/ZATCA endpoints, CSID, invoice hash, previous-invoice hash or XML signing | The archive does **not** show Phase 2 |
| Invoice types | Templates for a simplified tax invoice and for returns. A4 "tax invoice" templates exist, but most carry other businesses' details | Simplified: likely. Standard (B2B): unknown (owner question Q-1) |
| Credit / debit notes | Return templates (credit note) exist; no debit note template | — |
| UUID, ICV, PIH, signing, CSID | Not found in the archive | Unknown |
| Submission queue, retries, rejections | Not found (the only e-invoice queue table is India's GST `tbleinvoicetransactions`) | Unknown |

**Conclusion:** the mechanism behind today's Phase 2 compliance is **unknown**. Before any cut-over plan, the owner must show (owner question Q-Z1):
1. which software or device issues today's invoices;
2. the Fatoora portal device (EGS) list, **names and status only, no OTPs, keys or certificates**;
3. a recent receipt with its QR code.

## 2. Decisions already made

- **Scope:** simplified (B2C) invoices only, EGS functionality map `0100`, to confirm at onboarding.
  - Standard invoices (B2B) need **clearance before** they reach the buyer. Simplified invoices are **reported within 24 hours**. The two flows are never mixed.
  - If owner question Q-1 shows B2B invoices are issued, the scope changes.
- **No data migration** (client decision 2026-11-05). The new POS starts its **own** invoice series and its own hash chain on a **newly onboarded EGS**:
  - no counters, UUIDs or hash state are carried from the old system;
  - no private key is copied from it;
  - the old system and its records stay untouched.
- **Signing curve:** official standard text vs. ZATCA forum examples differ (P-256 vs secp256k1). This will be settled with the SDK and sandbox. **[verify]**

## 3. Target design (to build in Phase 5)

| Element | Design |
|---|---|
| **Issuing** | In the sale transaction: invoice number, UUID, ICV (+1 per document, never reset) and PIH (the previous document's hash; the first value as the standard defines it **[verify]**). The UBL XML, its hash, the signature and the QR are created and **frozen**; they are never regenerated |
| **Storage** | Immutable tables for the signed XML, hash and QR, plus a status history (`pending → reported / reported_with_warnings / rejected / unknown_outcome`) |
| **Submission** | One background worker sends in ICV order through a durable outbox, the same pattern as the dashboard outbox (`services/dashboard-sync.ts`). Retries back off. A timeout becomes `unknown_outcome` and is **re-queried, never re-issued** |
| **Offline** | Selling never waits for the internet. Invoices queue locally, the 24-hour reporting window is shown on screen, and an alert appears well before it ends |
| **Rejection** | Rejected invoices stay as issued. The fix is a credit note plus a new invoice, as ZATCA requires **[verify]**. The owner sees a rejection list with ZATCA's messages |
| **Keys and certificates** | The private key is generated on the POS PC and protected with Windows DPAPI (as the backup key is). It is never in the database, backups, logs or the renderer |
| **Certificates** | CSID expiry date shown, renewal warning |
| **Restore** | A restore that would roll ICV or PIH back behind the last reported invoice is refused (risk Z-3) |
| **Credit notes** | Refunds already store the original invoice and their own UUID. Credit notes join the same chain |
| **Debit notes** | To be added; needed for compliance samples |

## 4. Cut-over procedure (old EGS → new EGS)

1. **Owner confirms Q-Z1.** The current issuing system and EGS are known.
2. **Build and validate the new POS against the ZATCA SDK** (XML, hash, signature, QR) and the **sandbox / simulation** environment, with the compliance samples: simplified invoice, simplified credit note, simplified debit note.
3. **Onboard the new EGS on the Fatoora portal.**
   - The owner obtains the OTP from the portal and types it into the POS. The OTP is never sent to the developer.
   - Steps: CSR → compliance CSID → compliance checks → production CSID.
4. **Keep the old EGS active** until the new one has a production CSID and a supervised trial has passed.
5. **Cut-over day:**
   - close the old system's day;
   - make sure all its invoices are reported;
   - take and archive its database backup;
   - start selling on the new POS.
6. **Only after** the new POS has run correctly for an agreed period, the owner decides whether to revoke the old EGS on the portal. **Revoking cannot be undone.**
7. **Keep the old database backup** for the legal retention period. Without migration, it is the only record of past invoices.

**Never:**
- copy the old signing key;
- reset or reuse an invoice counter;
- re-send an invoice whose outcome is unknown as a new invoice;
- issue a standard invoice through the simplified path.

## 5. Test plan (none run yet: no ZATCA code)

| # | Test | Expected | Tool |
|---|---|---|---|
| Z-01 | Simplified invoice XML | Passes SDK schema and business-rule validation | SDK |
| Z-02 | Simplified credit note (linked to its invoice) | Passes; references the original invoice | SDK |
| Z-03 | Simplified debit note | Passes | SDK |
| Z-04 | Standard invoice | Only if Q-1 = yes; clearance flow, not reporting | SDK + sandbox |
| Z-05 | Hash and signature | SDK verifies the hash and signature; changing one byte fails | SDK |
| Z-06 | QR | Decodes to the required tags; matches the XML | SDK / QR decoder |
| Z-07 | Invalid XML (a field removed) | Rejected locally before sending; invoice not issued | unit test |
| Z-08 | Invalid signature | Sandbox rejects; recorded as rejected; owner alerted | sandbox |
| Z-09 | Duplicate submission (same UUID twice) | No second invoice; status unchanged | sandbox |
| Z-10 | Network down for 200 sales | All 200 issued and queued; reported in ICV order after reconnecting; none lost or duplicated | simulation |
| Z-11 | Timeout with unknown outcome | Marked unknown; re-queried; never re-issued | fake server + sandbox |
| Z-12 | ZATCA rejection | Kept; shown with the message; corrected by a credit note and a new invoice | sandbox |
| Z-13 | Retry after failure | Backs off; succeeds; no gap in ICV | fake server |
| Z-14 | ICV continuity across restart and crash at each issuing step | No gaps, no repeats | unit + kill tests |
| Z-15 | PIH continuity (each document chains to the previous) | Chain verifies end to end | unit + SDK |
| Z-16 | Restore an older backup | Refused, or reconciliation demanded | unit |
| Z-17 | Onboarding failure (wrong OTP, expired CSID) | Clear error; selling with a valid CSID unaffected; no key leaked | sandbox |
| Z-18 | Certificate renewal | New CSID used for new invoices; old ones keep their stamp | sandbox |
| Z-19 | Restart with pending submissions | Queue resumes; nothing lost | unit |
| Z-20 | 24-hour window | Alert before the deadline for any unreported invoice | unit |

Fabricated "success" responses are never accepted as evidence. Results go into `docs/TEST_RESULTS.md`.
