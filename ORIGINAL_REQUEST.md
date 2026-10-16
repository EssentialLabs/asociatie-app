# Original User Request

## Initial Request — 2026-10-16T08:34:59Z

Upgrade the existing Node.js + Express + SQLite (`better-sqlite3`) + Vanilla JS homeowners association management application in `G:\asociatie-app` to achieve 100% algorithmic and functional parity across all 58 menu functions of the legacy FoxPro 2.6 DOS software **ORHIDEEA (Partaj 3, 2005)**, while keeping the interface fast, keyboard-first, modern, and intuitive.

Working directory: G:\asociatie-app
Integrity mode: development

## Reference Material & Verification Resources
- Detailed Parity Specification & Handover Guide: `G:\asociatie-app\PARITY_IMPLEMENTATION_PLAN.md` (follow every section §1–§8)
- Legacy FoxPro `.PRG` source files (CP852/OEM encoded): `G:\VECHI\incorhi\INCASARI\DIVERSE\PRG\*.PRG`
- Pre-filtered legacy `.PRG` text copies (UI boilerplate stripped): `C:\Users\ciore\.gemini\antigravity\brain\5faf5962-5ba3-49be-8a84-5d3152e69ffc\scratch\*.txt`
- Legacy compiled `.FXP` modules and report layouts `.FRX/.FRT` (including `CHO.FXP`/`CHO.FRX`): `G:\INCASOR\INCASARI\`
- Historical & active DBF datasets (`2003`–`2026`, latest `G:\INCASOR\INCASARI\DATE\ANI_LUNI\2026\SEPTEMBR` with 10 blocks, 78 apartments, and 23,171 ledger rows in `CHITANTE.DBF`): `G:\INCASOR\INCASARI\DATE\ANI_LUNI\`

## Requirements

### R1. Complete Data Model, Period Snapshots & Full DBF Importer
Extend the SQLite schema and `import-foxpro.js` to support monthly periods (`DESCHISA` / `PUBLICATA` / `INCHISA`), immutable per-period snapshots (`apartamente_luna`, `blocuri_luna`), all legacy fields from `GENERAL.DBF`, `ASOC.DBF`, `BLOCURI.DBF`, and `APART.DBF` (including `persoane` defaulting to `0` and allowing `0`, equivalent thermal surface `SUP_EC_TER`, all 16 per-apartment expense percentages, temporary reductions `D1/D2/P1_SCAZ/P2_SCAZ/SL1_SCAZ/SL2_SCAZ/SET_SCAZ`, `C/P/R` meter modes, 6 water meters with serials and metrology dates `D_V_*`, heat meter `ININ/IVIN/CONSTIN`, 7 heat cost allocators `R1..R7` with transmission factors and position coefficients, working/repair fund targets, manual apartment charges `CH_BOX/CH_HAV/REPAR_CRT/ALTELE/I/FOND_REPAR`, and `OBSERVATII` memos), the cumulative receivables ledger (`datorii` and `plati` replacing single-column `restante/penalizari` for categories `R` regie, `F` fond rulment, `A` fond reparații, `P` penalități), and `CASA`, `BANCA`, `PATRIM`, and `ORDINE` journals. Update `import-foxpro.js` to import historical periods and the full 23,171-row `CHITANTE.DBF` ledger from `G:\INCASOR\INCASARI\DATE\ANI_LUNI\2026\SEPTEMBR` (preserving an `--anonymize` option).

### R2. 100% Parity Calculation Engine (`TCE`, `CRE`, `SUM`)
Implement a pure, unit-testable calculation engine matching FoxPro's exact rounding (`ROUND(x, 2)` half-away-from-zero and `ROUND(..., 0)` on intermediate bases where specified in `SUM.PRG`):
- **`TCE.PRG`**: Expire temporary person/surface reductions where `D2 < ULTIMA_ZI`.
- **`CRE.PRG`**: Compute heat cost allocator units (`TOT_UNIT`) across up to 7 allocators per apartment, impose maximum specific consumption (`GHP`) on flat-rate (`P`) apartments in the same block, split block thermal energy into common (`PROCINCCOM%`) and individual shares, and compute `GCAL_UNIT`, `GCAL_MP`, and `GCAL_FINAL`.
- **`SUM.PRG`**: Compute working fund status (`CALC_FR`, `PLAT_FR` from ledger `F` rows), apartment and block water/sewage (`TARIF_AR`, `PROC_CA%`, `TARIF_CA`), hot water thermal energy (`ECART_TEMP`, `RAND_TR`, `TARIF_ET`), all `(CP_AR, CP_AC, CP_IN)` metered vs. flat-rate combinations, all 6 difference fields (`DIFARAR`, `DIFARAC`, `DIFCANAR`, `DIFCANAC`, `DIFETAC`, `DIFETIN`) under `APT`/`CNS`/`PER` and `SL`/`SET`/`CNS` modes, rain water (`CAN_MET`), gas (`GAZ`), elevator (`ASCENSOR` under `PER`/`APT`/surface), trash (`GUNOI`), staircase & elevator electricity (`CURENT_SC`, `CURENT_LI`), association-to-block and block-to-apartment allocations (`CH_ADMIN`, `CH_SEDIU`, `ABONAMENT`, `SAL_TESA`, `SAL_FEME`, `PREST_SERV`, `CHELT_INC`), working fund contribution capped at `MAX_FR`, and manual charges (removing the hardcoded 10 RON repair fund fallback).

### R3. Receivables Ledger, Penalties, Cashier (`TRE`, `GOL`, `CHI`, `CHO`) & Month Close (`SLU`)
- **Publish (`TRE`) & Unpublish (`GOL`)**: Publishing a month writes `R`, `F`, and `A` ledger rows for non-zero apartment amounts and freezes the period snapshot (`PUBLICATA`). Unpublishing deletes those rows and reverts to `DESCHISA` only if zero payments have been recorded against that period.
- **Penalties (`CHI.PRG` `pen` / `Lpenal`)**: Calculate penalties on-demand with a live preview (and an explicit button to book `P` ledger rows idempotently without double-charging days). For each unpaid non-`P` ledger row when the apartment's net balance is `>= 0`, start counting at `15th of following month + ZILE_PENAL + 1 day` at `PROC_PENAL`%/day, capped at the unpaid principal of that row.
- **Cashier (`CHI` Individual & `CHO` Collective)**: Support full payment ("Achită tot"), manual per-row partial or full payment across any period/category, and lump-sum ("Sumă globală") automatic allocation ordered **oldest month first, and within each month `P → A → F → R`**. Support collective receipts (`CHO`) across multiple apartments in one session. Automatically build the FoxPro explanation string (`REGIE`, `FOND REPARAȚII`, `FOND RULMENT`, `PENALITĂȚI`), generate daily cash collection entries in `CASA` (`ÎNCASĂRILE ZILEI DE ...`), and support receipt cancellation with exact rollback of its `plati` allocations and audit logging.
- **Month Close (`SLU`) & Reopen**: Atomically snapshot the closed period (`INCHISA`), advance to the next period copying `GENERAL` tariffs, rotate meter and allocator `index_nou → index_vechi` (setting new readings to `0`/empty), zero monthly computed charges and monthly invoice totals, reset `CASA`/`BANCA` (carrying closing balance to opening balance) and `PATRIM` amounts, while keeping unpaid ledger rows intact as arrears. Provide an audited admin "Redeschide luna" action for the latest closed period if no new receipts exist.

### R4. All 58 Menu Functions, 33 Reports (`LISTARE` & `SITUATII`), Security & Fast Modern UX
- **Data Entry & Operations (`Actualizare A–R`, `Calcul A–C`, `Centralizare A–D`)**: Provide fast, keyboard-navigable screens/tabs for `Date generale`, `Asociație` (identity + association-level invoices), `Blocuri` (modes, percentages, thermal params, block invoices, postal code), `Apartamente` (all 16 percentages, temporary reductions with active badge, manual charges, C/P/R modes), `Indecși & Metrologie` (`AIA`/`ADC` fast grid + expired metrology filter), `Repartitoare` (`ARA` 7-allocator grid), read-only raw DBF-equivalent inspector views (`AVS`/`AVB`/`AVA`), `Acte Casă` (`ACA`), `Acte Bancă` (`ABA`), `Patrimoniu` (`APA`), `Ordine de Plată` (`ORD`), and SQLite backup/restore (`SAL`) + integrity check (`REF_IND` replacement in Control Tower).
- **Complete Report Catalog (`Listare A–P` & `Situații A–Q`)**: Implement all 16 `Listare` reports (`LIP`, `LIR`, `LAF`, `LAR`, `LP1`, `LP2`, `LPP`, `LRC`, `SCR`, `LFA`, `CCA`, `CBA`, `CP1`, `MAX`, `ORD`, `ADU`) and all 17 `Situații` reports (`SBL`, `SAP`, `PV`, `PVR`, `SRE`, `RE1`, `CED`, `LAR_INST`, `SRU`, `SFR`, `SPE`, `PER`, `GOT`, `AJU`, `LSC`, `LVE`, `COM`), plus `Centralizare C/D` (`IN1`, `IN2`). Every report must support period/block/apartment filters, on-screen rendering, print/PDF layout (`@media print` A4/A3 portrait/landscape), and CSV/Excel export. On public notice-board lists (`LAF`, `LAR`, `LP1`, `LP2`, `LPP`, `MAX`), **hide owner names by default (GDPR) with a toggle to show names** on internal/printed copies.
- **UX & Auth**: Provide a workflow stepper for the active month, a global period switcher (with read-only banner on closed periods), clickable charge cells showing formula/base/unit-value explanations, a `Ctrl+K` command palette searchable by both modern and legacy FoxPro terms/codes, and server-side session/JWT authentication middleware protecting `/api/*` routes with audit-logged Superadmin impersonation.

## Acceptance Criteria

### Golden-Month Mathematical Parity
- [ ] Automated test script imports historical DBF data from `G:\INCASOR\INCASARI\DATE\ANI_LUNI\`, runs the calculation engine (`TCE` + `CRE` + `SUM`), and verifies that every computed column in `APART.DBF`, `BLOCURI.DBF`, and `ASOC.DBF` for `2026\SEPTEMBR` (and at least one winter/heating month) matches the legacy FoxPro DBF values within `±0.01` RON.

### Ledger & Arrears Reconciliation
- [ ] Running `import-foxpro.js` on `2026\SEPTEMBR` imports all 23,171 `CHITANTE.DBF` rows such that the total unpaid balance per apartment, per block, and per category (`R`, `F`, `A`, `P`) in SQLite matches the FoxPro DBF unpaid sum (`VALOARE - PLATA1 - PLATA2`) with `0.00` RON difference.

### End-to-End Lifecycle & Guardrails
- [ ] Automated integration test suite passes for the full monthly lifecycle:
  1. `TCE` expires reductions where `D2 < ULTIMA_ZI`.
  2. `SUM` / `CRE` computes all charges (and apartments with `0` persons receive `0.00` RON on per-person expenses).
  3. `TRE` publishes the period into ledger rows (`R`, `F`, `A`) and blocks duplicate publishing.
  4. `GOL` succeeds when no payments exist, and fails with an error once any payment is recorded on that period.
  5. `CHI` / `CHO` accurately processes manual per-row partial payments, lump-sum payments (allocating oldest month first, `P → A → F → R`), on-demand penalty calculation (`15th of next month + ZILE_PENAL + 1`, capped at unpaid principal), automatic `CASA` daily summary generation, and receipt cancellation (restoring exact ledger balances).
  6. `SLU` closes the month atomically, snapshots state, rotates meter/allocator indexes, zeroes monthly charges, and preserves unpaid ledger items as arrears in the new month.

### Complete Feature & Report Verification
- [ ] Automated API verification test confirms all 16 `Listare` endpoints, 17 `Situații` endpoints, `Centralizare` (`CHI`, `CHO`, `IN1`, `IN2`), `Actualizare` (`ADG`, `ADA`, `ADB`, `APS`, `AIA`, `ARA`, `ACA`, `ABA`, `APA`, `ORD`, `SAL`), and GDPR name-toggle on notice-board lists return HTTP 200 with valid structured payloads and zero runtime errors.
