# Project: ORHIDEEA (FoxPro 2005) Parity Upgrade

## Architecture
The application is a Node.js + Express + SQLite (`better-sqlite3`) + Vanilla JS system running in `G:\asociatie-app`.
- **Database Layer**: SQLite database (`data/asociatie.db`) managed via `db.js`, with strict transactions for all financial mutations, immutable historical monthly snapshots (`apartamente_luna`, `blocuri_luna`), and cumulative receivables ledger (`datorii`, `plati`).
- **Calculation Engine**: Standalone pure calculation modules in `engine/` (`round.js`, `tce.js`, `cre.js`, `calcul.js`) with zero external side effects and exact half-away-from-zero rounding.
- **Business Operations & Financial Lifecycle**: Specialized domain controllers in `services/` or `routes/` for publishing (`TRE`), unpublishing (`GOL`), cashier/receipts (`CHI`, `CHO`), penalty calculations (`pen`/`Lpenal`), cash/bank journals (`CASA`, `BANCA`, `PATRIM`, `ORDINE`), and month-close/reopen (`SLU`).
- **Presentation & UX Layer**: Fast keyboard-navigable modern frontend with `@media print` CSS for A4/A3 portrait/landscape PDF printing, CSV export, command palette (`Ctrl+K`), and GDPR name masking.
- **Security & Integrity**: Session/JWT authentication middleware, bcrypt hashing, audit logging (`audit_logs`) for all sensitive operations, and database integrity checks.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | SQLite Schema Extension | Add `perioade`, `datorii`, `plati`, `apartamente_luna`, `blocuri_luna`, `general`, `casa`, `banca`, `patrimoniu`, `ordine_plata`, `users`, `audit_logs` | M1 | Survey / R1 |
| 2 | Extended Apartment Data Model | 143 fields in `apartamente`: 16 percentages, reductions (`D1/D2/P1/P2/SL1/SL2/SET`), metrology, allocators, manual charges, C/P/R modes | M1 | Survey / R1 |
| 3 | Full DBF & Memo Importer | `import-foxpro.js` importing all tables, `.FPT` memos, and 23,171 rows in `CHITANTE.DBF` with 290,492.47 RON exact reconciliation | M1 | Survey / R1 |
| 4 | TCE Reduction Expiration | Pure module expiring temporary person/surface reductions where `D2 < ULTIMA_ZI` | M2 | Survey / R2 |
| 5 | CRE Heat Cost Allocator Engine | 7 allocators per apartment, `GHP` max consumption for flat-rate, common/individual thermal split, `GCAL_*` output | M2 | Survey / R2 |
| 6 | SUM Parity Calculation Engine | Exact 8-step FoxPro calculation, water/canal/gas/electricity/elevator/admin/trash allocations, zero-person support, half-away-from-zero rounding | M2 | Survey / R2 |
| 7 | Water & Heating Difference Modes | Exact `DIFARAR`, `DIFARAC`, `DIFCANAR`, `DIFCANAC`, `DIFETAC`, `DIFETIN` under `APT`, `CNS`, `PER` and `SL`, `SET` modes | M2 | Survey / R2 |
| 8 | Golden-Month Parity Verification | Automated parity test against `2026\SEPTEMBR`, `2026\IANUARIE`, and `2006\IANUARIE` (diff $\le \pm 0.01$ RON) | M2 | Survey / R2 |
| 9 | Month Publishing (`TRE`) | Write ledger rows `R`, `F`, `A` into `datorii`, freeze snapshot, mark `PUBLICATA` | M3 | Survey / R3 |
| 10 | Month Unpublishing Guard (`GOL`) | Delete ledger rows only if 0 payments exist; revert to `DESCHISA` | M3 | Survey / R3 |
| 11 | On-Demand Penalty Engine | `pen`/`Lpenal` calculation, delay from `15th + ZILE_PENAL + 1`, 0.20%/day, principal cap, idempotent `P` row generation | M3 | Survey / R3 |
| 12 | Cashier Individual (`CHI`) | Fast keyboard cashier, search by name/apartment, row-by-row payment, lump-sum allocation (`P -> A -> F -> R`, oldest first), receipt voiding | M3 | Survey / R3 |
| 13 | Cashier Collective (`CHO`) | Batch cashing / collective receipt issue across multiple apartments in one session | M3 | Survey / R3 |
| 14 | Daily Cash & Bank Journaling | Auto-generate daily collection entries in `CASA` (`ÎNCASĂRILE ZILEI DE ...`), manage `BANCA`, `PATRIM`, `ORDINE` | M3 | Survey / R3 |
| 15 | Month Close & Reopen (`SLU`) | Snapshot state, rotate meter/allocator readings (`old = new`, new = empty), zero charges, reset cash/bank, audited month reopen | M3 | Survey / R3 |
| 16 | Data Entry Screens (Actualizare A-R) | Screens for `ADG`, `ADA`, `ADB`, `APS`, `AIA`, `ADC`, `ARA`, raw views `AVS`/`AVB`/`AVA`, `ACA`, `ABA`, `APA`, `ORD`, `SAL` | M4 | Survey / R4 |
| 17 | Authentication & Security Middleware | Real users, bcrypt password hashing, JWT/session middleware on `/api/*`, audit-logged impersonation | M4 | Survey / R4 |
| 18 | Modern UX Shell & Command Palette | Workflow stepper, global period switcher, clickable calculation explanations, `Ctrl+K` palette searchable by FoxPro codes | M4 | Survey / R4 |
| 19 | Listare Reports (16 reports) | `LIP`, `LIR`, `LAF`, `LAR`, `LP1`, `LP2`, `LPP`, `LRC`, `SCR`, `LFA`, `CCA`, `CBA`, `CP1`, `MAX`, `ORD`, `ADU` | M5 | Survey / R4 |
| 20 | Situații Reports (17 reports) | `SBL`, `SAP`, `PV`, `PVR`, `SRE`, `RE1`, `CED`, `LAR_INST`, `SRU`, `SFR`, `SPE`, `PER`, `GOT`, `AJU`, `LSC`, `LVE`, `COM` | M5 | Survey / R4 |
| 21 | Centralizare Reports | `IN1` (by block/apartment), `IN2` (by receipt number) | M5 | Survey / R4 |
| 22 | GDPR Notice-Board Masking | Toggle to mask owner names by default on public lists (`LAF`, `LAR`, `LP1`, `LP2`, `LPP`, `MAX`) | M5 | Survey / R4 |
| 23 | E2E Acceptance & Adversarial Hardening | Pass 100% of E2E test suite (Tiers 1-4) and Tier 5 adversarial edge cases | M6 | Survey / R1-R4 |
| 24 | Multi-Tenant Workspace Isolation | Scope all data, queries, periods, and users by `asociatie_id` + Control Tower flow to create new blank associations/agencies | M4 | User Request |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Schema, Periods & Full DBF Importer | Database schema extension, snapshots, and full DBF importer (23k ledger rows) | none | DONE |
| M2 | Parity Calculation Engine | Standalone pure `TCE`, `CRE`, `SUM` engines + golden-month parity verification | M1 | DONE |
| M3 | Ledger, Penalties, Cashier & Lifecycle | `TRE`, `GOL`, `CHI`, `CHO`, penalty engine, `CASA`/`BANCA` journals, and `SLU` month close/reopen | M1, M2 | DONE |
| M4 | Data Entry Screens & Operations | 58 menu operations, fast keyboard grids, auth middleware, command palette | M1, M2, M3 | DONE |
| M5 | 33 Reports Catalog & GDPR | Complete Listare (16), Situații (17), Centralizare (2) reports, print/PDF/export, GDPR toggle | M1, M2, M3 | DONE |
| M6 | Final Parity Verification & Hardening | 100% pass on E2E test suite (Tiers 1-4) and Tier 5 adversarial coverage hardening | M1-M5, TEST_READY | DONE |

## Interface Contracts

### M1 ↔ M2 (Database & Importer ↔ Calculation Engine)
- Input: `getPeriodCalculationData(periodId)` returns pure JSON object containing:
  - `period`: `{ id, an, luna, ultima_zi, tarif_ar, tarif_ca, proc_ca }`
  - `asociatie`: `{ id, cota_fr, proc_penal, zile_penal, invoices: { apa_rece, can_met, ... } }`
  - `blocuri`: Array of block objects with allocation modes (`mod_r_dif`, `mod_r_inc`, `modr_difin`, `mod_r_asc`), percentages, thermal parameters, meter readings, invoices.
  - `apartamente`: Array of apartment objects with persons, surfaces, 16 percentages, reductions, meters, allocators (`r1..r7`), manual charges.
- Output of Engine: Pure immutable calculation results:
  - `apartamente`: Array of computed charge values for every apartment.
  - `blocuri`: Array of computed block bases and difference amounts.
  - `asociatie`: Computed association bases.

### M2 ↔ M3 (Calculation Engine ↔ Ledger & Publishing)
- Function: `publishMonth(periodId)`:
  - Preconditions: period is `DESCHISA`, engine calculation runs without errors.
  - Action: Inserts into `datorii` for non-zero charges:
    - Category `'R'` = total maintenance sum from engine.
    - Category `'F'` = working fund (`rulment`).
    - Category `'A'` = repair fund (`fond_repar`).
  - Snapshots live state into `apartamente_luna` and `blocuri_luna`.
  - Sets period status to `'PUBLICATA'`.
- Function: `unpublishMonth(periodId)`:
  - Preconditions: period is `'PUBLICATA'`, and `SELECT COUNT(*) FROM plati p JOIN datorii d ON p.datorie_id = d.id WHERE d.an = ? AND d.luna = ?` is 0.
  - Action: Deletes `datorii` rows for that period, reverts status to `'DESCHISA'`.

### M3 ↔ M4 & M5 (Ledger & Engine ↔ Cashier, Operations & Reports)
- Function: `calculatePenalties(apartmentId, targetDate)`:
  - Computes on-demand penalties for unpaid non-P rows where tenant total balance $\ge 0$.
  - Returns array of `{ datorie_id, zile_intarziere, procent, valoare_penalizare }`.
- Function: `issueReceipt(payload)`:
  - Atomically allocates payment according to priority `P -> A -> F -> R`, oldest month first.
  - Records `chitante` and `plati` rows; writes daily summary to `CASA`.

## Code Layout
- `engine/`: Pure calculation logic
  - `engine/round.js`: Canonical `round2`, `round4`, half-away-from-zero rounding.
  - `engine/tce.js`: Reduction expiration.
  - `engine/cre.js`: Heat cost allocator calculations.
  - `engine/calcul.js`: Full 8-step `SUM.PRG` charge distribution.
- `services/`: Business services
  - `services/ledger.js`: Receivables ledger, debts, payments, arrears queries.
  - `services/penalties.js`: On-demand penalty calculation engine.
  - `services/cashier.js`: Individual (`CHI`) and collective (`CHO`) receipt processing.
  - `services/lifecycle.js`: Month publish (`TRE`), unpublish (`GOL`), close/reopen (`SLU`).
  - `services/reports.js`: Report generation engines for all 33 reports.
  - `services/auth.js`: Authentication, session/JWT, bcrypt, and audit logging.
- `routes/`: Express API endpoints
  - `routes/api.js`: Main API router with sub-route mounts.
  - `routes/operatiuni.js`: Data entry operations (Actualizare).
  - `routes/calcul.js`: Engine endpoints and validation checks.
  - `routes/chitante.js`: Cashier and receipts.
  - `routes/rapoarte.js`: Listare & Situații report endpoints.
- `public/`: Modern Vanilla JS frontend
  - `public/index.html`: Main shell, workflow stepper, period switcher.
  - `public/css/`: Modern UI styles + print CSS (`@media print` A4/A3 portrait/landscape).
  - `public/js/`: Frontend modules (stepper, grids, command palette `Ctrl+K`, report viewers, receipt issuer).
- `tests/`: Automated test suites
  - `tests/golden/`: Golden-month parity tests (`2026\SEPTEMBR`, `2026\IANUARIE`, `2006\IANUARIE`).
  - `tests/e2e/`: Opaque-box acceptance test suite (Tiers 1-4).
  - `tests/adversarial/`: Tier 5 boundary and stress tests.
