# ORHIDEEA (FoxPro 2.6 DOS, Partaj 3, 2005) -> Modern Web App
## Complete AI Agent Handover, Architecture & Maintenance Guide

> **Purpose of this Document**: Give any incoming AI agent or software engineer **100% context** on how this application is architected, how FoxPro 2005 algorithmic parity is achieved, where every feature lives, how to read the persistent error telemetry logs (`logs/telemetry-errors.jsonl`), and how to safely update, fix, or extend the system without breaking historical financial reconciliation.

---

## 1. System Overview & Core Invariants

- **Repository / Root Directory**: `G:\asociatie-app\` (GitHub: `https://github.com/EssentialLabs/asociatie-app`)
- **Live Hosted Web App (GitHub Pages)**: `https://essentiallabs.github.io/asociatie-app/`
- **Tech Stack**:
  - **Backend**: Node.js + Express (`server.js` + `routes/*.js`)
  - **Database**: SQLite via `better-sqlite3` (`db.js`, `asociatie.db`, compressed backup `asociatie.db.gz`)
  - **Pure Calculation Engine**: `engine/round.js`, `engine/tce.js`, `engine/cre.js`, `engine/calcul.js`
  - **Business Services**: `services/ledger.js`, `services/penalties.js`, `services/cashier.js`, `services/lifecycle.js`, `services/reports.js`, `services/auth.js`, `services/telemetry.js`
  - **Frontend SPA**: Vanilla HTML5/CSS3/ES6 (`public/index.html`, `public/app.js`, `public/style.css`, `public/browser-runtime.js`, `public/demo-seed.json`)

### Critical Golden Rule for AI Agents
> **NEVER mutate `G:\asociatie-app\asociatie.db` during automated tests!**
> `tests/e2e/importer_ledger.test.js` and `tests/adversarial/raw_binary_reconciliation.test.js` verify that `asociatie.db` matches the exact FoxPro `CHITANTE.DBF` baseline:
> - **Total rows in `datorii`**: `23,171`
> - **Total unpaid balance**: **`290,492.47 RON`** (`R = 275,501.47 RON`, `A = 14,631.00 RON`, `F = 360.00 RON`)
> - All mutating tests MUST create an isolated `:memory:` database (`new Database(':memory:')` + `initializeSchema(db)`).
> - If `asociatie.db` is ever modified during manual local testing, restore it to the exact baseline with:
>   ```powershell
>   node import-foxpro.js --force --anonymize
>   ```

---

## 2. Error Telemetry & Bug-Fixing Workflow (`logs/telemetry-errors.jsonl`)

Every error across both backend and frontend is automatically captured and written to disk and SQLite:

1. **`logs/telemetry-errors.jsonl` (Machine-Readable JSON Lines — Primary File for AI Agents)**
   - Every line is a self-contained JSON object:
     ```json
     {"timestamp":"2026-10-16T19:25:00.000Z","platforma":"backend-500","severity":"CRITICAL","method":"POST","url":"/api/chitante/individual","status":500,"asociatie_id":1,"user":"orhideea","mesaj":"...","stack":"...","context":{...}}
     ```
2. **`logs/telemetry-errors.log` (Human-Readable Stack Trace Log)**
3. **SQLite `system_error_logs` Table** (visible in `#sec-control-tower` -> Turn de Control)
4. **Browser `localStorage` (`orhideea_telemetry_errors_v1`)** (captures `window.onerror`, `unhandledrejection`, and failed `fetch('/api/*')` calls even when running on static GitHub Pages)

### How to Download or Inspect Errors
- **From the Live Website**: Click **`📥 Descarcă Erori (.jsonl pt. AI)`** in the top-right bar (or in Turn de Control), or visit `GET /api/telemetry/errors/download?format=jsonl`.
- **From Terminal**: Read `G:\asociatie-app\logs\telemetry-errors.jsonl`.

---

## 3. Ready-to-Use Test Accounts & Multi-Tenant Workspaces

The application supports **Multi-Tenant Isolation (`asociatie_id`)** via the `X-Asociatie-Id` HTTP header and JWT token scoping:

| Account Role | Username | Password | `asociatie_id` | Description |
|---|---|---|---|---|
| **1. Agenția ORHIDEEA (Date Vechi)** | `orhideea` | `orhideea123` | `1` | Contains all imported FoxPro data (`TEST ADMINISTRATORI`, 10 blocks `A1..J1`, 78 apartments, 284 periods `2003–2026`, `23,171` ledger rows). |
| **2. Agenție Nouă (Workspace Curat)** | `agentie_noua` | `agentie123` | `2` | Completely clean/blank association workspace (`ASOCIAȚIA DEMO CURATĂ`) with `0` blocks and `0` apartments so new administrators can add their own data from scratch. |
| **3. Superadmin (Turn de Control)** | `superadmin` | `admin123` | `1` (All) | Full access to Turn de Control, multi-agency creation (`POST /api/operatiuni/asociatii`), impersonation, and telemetry logs. |
| **4. Casier** | `casier` | `admin123` | `1` | Cashier role for `CHI` / `CHO` receipt issuance. |

> **1-Click Switching on Website**: The top bar (`🔑 Conturi Rapide de Test`) allows switching between Account 1 (ORHIDEEA), Account 2 (Clean Workspace), and Account 3 (Superadmin) with a single click.

---

## 4. Directory & Module Architecture

```text
G:\asociatie-app\
├── db.js                         # 19-table SQLite schema, migrations, auto-decompression of asociatie.db.gz
├── import-foxpro.js              # Full CP852 DBF + FPT memo importer (284 periods, 23,171 CHITANTE.DBF rows)
├── server.js                     # Express app entry point, auth + telemetry middleware, legacy & Control Tower routes
├── numar-in-litere.js            # Romanian currency-to-words converter for receipts (CHI/CHO)
├── engine/                       # Pure, zero-side-effect FoxPro 2.6 parity calculation modules
│   ├── round.js                  # Sign-preserving half-away-from-zero rounding (roundFox, round0, round2, round4, round8)
│   ├── tce.js                    # TCE.PRG: Temporary reduction expiration (strictly D2 < ULTIMA_ZI)
│   ├── cre.js                    # CRE.PRG: 2-loop heat cost allocator engine (R1..R7, GHP flat-rate imposition, GCAL_*)
│   └── calcul.js                 # SUM.PRG: Complete 8-step monthly maintenance calculation engine
├── services/                     # Transactional domain services
│   ├── ledger.js                 # Period data loader/saver, cumulative apartment & association ledger queries
│   ├── penalties.js              # pen/Lpenal on-demand penalty engine (HJKG<0 net guard, 15th+ZILE_PENAL+1, 100% cap)
│   ├── cashier.js                # CHI.PRG & CHO.FXP: Lump-sum (P->A->F->R oldest first), 15-branch CEX, negative CHO
│   ├── lifecycle.js              # TRE.PRG (publish), GOL.PRG (unpublish guard), SLU.PRG (close & rotate), reopen
│   ├── reports.js                # All 35 FoxPro reports (16 Listare, 17 Situatii, 2 Centralizare) + GDPR & CSV
│   ├── auth.js                   # JWT auth, password hashing, impersonation, createAssociationWorkspace (Multi-Tenant)
│   └── telemetry.js              # Persistent JSONL/LOG/SQLite error telemetry service
├── routes/                       # Modular Express routers mounted under /api
│   ├── api.js                    # Main router mounting /auth, /operatiuni, /calcul, /chitante, /rapoarte & aliases
│   ├── operatiuni.js             # Actualizare A-R (ADG, ADA, ADB, ADR, APS, AIA, ARA, ADC, ACA, ABA, APA, ORD, AV*, REF)
│   ├── calcul.js                 # /tce, /cre, /sum, /publica, /anuleaza-publicarea, /inchide, /redeschide
│   ├── chitante.js               # /ledger/*, /penalitati/*, /individual (CHI), /colectiv (CHO), /:id/anuleaza
│   └── rapoarte.js               # /catalog, /:code (supports ?showNames=true|false & ?format=csv)
├── public/                       # Vanilla ES6 Single Page Application (works on Express AND static GitHub Pages)
│   ├── index.html                # Full 58-operation SPA shell, 6-stage stepper, modals, and Ctrl+K command palette
│   ├── app.js                    # Frontend controllers for all views, grids, cashier, 35 reports, and journals
│   ├── browser-runtime.js        # Client telemetry hook, 1-click test account bar, and GitHub Pages serverless fallback
│   ├── demo-seed.json            # Pre-built snapshot of ORHIDEEA + Clean Agency + 35 reports for GitHub Pages
│   └── style.css                 # High-density UI styles + @media print A4 portrait/landscape rules
└── tests/                        # Automated Verification Harness (run via `node tests/run_all_tests.js`)
    ├── golden/parity.test.js     # Golden-month parity tests (2026\IULIE, 2026\IUNIE, 2026\IANUARIE, 2006\IANUARIE)
    ├── e2e/                      # Schema, importer ledger, lifecycle/cashier/penalties, 35 reports & multi-tenant auth
    └── adversarial/              # 7 stress suites (raw binary DBF reconciliation, negative CHO, idempotency, GDPR, etc.)
```

---

## 5. Key FoxPro 2.6 Algorithmic Details Solved in Code

1. **IEEE-754 Midpoint Rounding (`engine/round.js`)**:
   - FoxPro `ROUND(x, n)` rounds half-away-from-zero (`2.5 -> 3`, `-2.5 -> -3`).
   - In IEEE-754 binary float, `1 * 0.75 * 0.58` evaluates to `0.43499999999999994` instead of exact `0.435`.
   - `roundFox(val, decimals)` normalizes with `Number(abs.toPrecision(14))` before scaling by $10^n$, eliminating all 1-ban midpoint discrepancies across all 284 months.
2. **Pre-2010 vs. Post-2010 Cleaner Salary (`SAL_FEME`) in `engine/calcul.js`**:
   - In `2006\IANUARIE`, `SL_SALFE` did not exist in `ASOC.DBF`/`BLOCURI.DBF`; `SAL_FEME` was distributed by persons (`PER_SAL_FE`).
   - From 2010 onward, `SL_SALFE` exists and `SAL_FEME` is distributed by surface (`SL_SALFE`).
   - `engine/calcul.js` inspects `hasSlSalFeField` to automatically apply the exact historical or modern formula.
3. **Penalty Calculation (`services/penalties.js`)**:
   - Guard: If an apartment's net unpaid balance across `R, F, A` is $\le 0$ (`HJKG < 0` in FoxPro), **zero penalties** are charged.
   - Due Date (`DATA_SCAD`): Always the **15th of the month following `(AN, LUNA)`**.
   - Grace Window: Penalties begin on `DATA_SCAD + ZILE_PENAL + 1` (46th day after the 15th when `ZILE_PENAL = 45`).
   - Cap: Penalty on any row is capped at 100% of `restanta` (`VAL_PENAL <= RESTANTA`).
4. **Cashier Lump-Sum Priority & 15-Branch `CEX` (`services/cashier.js`)**:
   - Lump-sum payments allocate **oldest month `(an, luna)` first**, and within each month strictly in order **`P -> A -> F -> R`** (Penalties -> Repair Fund -> Working Fund -> Maintenance).
   - `buildExplanationCex` reproduces all 15 combinations of `{R, F, A, P}` in Romanian (`"REGIE"`, `"REGIE SI FOND REPARATII"`, etc.).
   - `issueCollectiveReceipt` (`CHO.FXP`) supports both positive collective collections and negative repair-fund disbursements (`suma < 0`).

---

## 6. How to Run Verification & Rebuild Web Assets

```powershell
# 1. Run all 12 test suites (E2E + Golden-Month Parity + Adversarial Stress)
node tests/run_all_tests.js

# 2. Rebuild compressed DB (asociatie.db.gz) and GitHub Pages seed (public/demo-seed.json)
node scripts/build-web-seed.js

# 3. Start the local Express + SQLite server on http://localhost:3000
node server.js
```
