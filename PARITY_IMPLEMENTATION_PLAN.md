# ORHIDEEA (FoxPro 2005) → asociatie-app: Full Parity Implementation Plan

> **Audience**: the AI agent / developer who will implement the changes.
> **Rule**: this document contains *instructions*, not code. Implement every item. Where it says "read PRG X", open the legacy source before coding: `Get-Content -Encoding Oem G:\VECHI\incorhi\INCASARI\DIVERSE\PRG\X.PRG`. The `view_file` tool rejects `.PRG` files, so read them through PowerShell. Filtered copies (UI lines removed) are in `C:\Users\ciore\.gemini\antigravity\brain\5faf5962-5ba3-49be-8a84-5d3152e69ffc\scratch\*.txt`.
> **Product goal**: the new app must do everything ORHIDEEA does. It must also be fast, simple and modern. Do NOT copy the DOS look. Keep the existing extras (Control Tower, impersonation, GDPR avizier).

---

## 0. Read this first: corrections to the previous handover guide

The earlier guide claimed "✅ 100% parity" on 12 items. That is false.

| Claim in old guide | Reality |
|---|---|
| The legacy menu has ~12 functions | It has **58 functions** across 5 menus (Actualizare 20, Calcul 3, Listare 16, Centralizare 4, Situații 17). See §3. |
| `COM.PRG` = water-difference calculation | `COM.PRG` = **Situații Q "Compar valori de plată"**. It compares this month's charges with a reference month. Water differences are computed inside `SUM.PRG`. |
| `ADR.PRG` = penalty calculation | `ADR.PRG` = **Adrese blocuri** (street/number). Penalties are computed in `CHI.PRG` (procedures `pen` and `Lpenal`). |
| `APA.PRG` = meters | `APA.PRG` = **Patrimoniu** entry. Meters are `AIA.PRG`. Metrology data is `ADC.PRG`. |
| `server.js` has a penalty engine (0.2%/day after 45 days) | **No penalty engine exists.** `penalizari` is just a manually editable number. |
| Month close rolls unpaid balances into arrears | **It does not.** `/api/luna/inchide` only rotates indexes and advances the month. Current-month charges are lost. |
| Water/expense allocation matches FoxPro | It does not. See §2. It ignores per-apartment percentages, temporary reductions, meter-vs-flat-rate (C/P/R) modes, canal, rain water, hot-water energy, etc. |
| Legacy DBFs are `PERSOANE.DBF`, `CONTOARE.DBF`, `FACTURI.DBF` | They don't exist. The real tables are listed in §1.2. |

---

## 1. How the legacy system actually works (the essentials)

### 1.1 Data location
- Monthly snapshot folders: `G:\INCASOR\INCASARI\DATE\ANI_LUNI\<YEAR>\<MONTH8>\` (for example `2026\SEPTEMBR`). Each month is a **complete copy** of all tables. The month-end step creates the next folder.
- The latest month is `2026\SEPTEMBR`: 10 blocks, 78 apartments, **23,171 ledger rows in CHITANTE.DBF**.
- Report layouts: `G:\INCASOR\INCASARI\*.FRX/*.FRT`. These are binary, but their field expressions and labels can be read as strings (CP852). Use them to get exact report columns.
- `CHO` ("Taie chitanțe colective") exists only in compiled form (`CHO.FXP`, `CHO.FRX`), so extract its strings.

### 1.2 Real table structures (from the DBF headers)
- **GENERAL** (one per month): `ULTIMA_ZI` (last day of the month), `TARIF_AR` (water tariff lei/m³, the same for cold-water and hot-water volume), `TARIF_CA` (canal tariff), `PROC_CA` (% of water volume billed as sewage).
- **ASOC**: identity fields (`ASOC` code, `N_R_COM` trade-register no., `COD_FISCAL`, `ADMINISTR`, `PRESEDINTE`, `ADRESA`, `COD` postal code, `JUDET`, `CONT`, `BANCA`, `TELINST`), `PROC_PENAL`, `ZILE_PENAL`, `SERIE_CHIT`, `ULT_CH` (last receipt no.). It also holds **association-level invoice amounts**: `APA_RECE, CAN_MET, APA_CALDA, ETAC, INCALZIRE, GUNOI, CH_ADMIN, SAL_TESA, SAL_FEME, ABONAMENT, CH_SEDIU, RULMENT`, plus the computed allocation bases (`PERSOANE1/2, PERS_AR, PERS_AC, PERSGU, SUPRAFATA1/2, SL_*`, and so on).
- **BLOCURI**: `BLOC, STRADA, NUMAR, COD`. Allocation modes: `MOD_R_DIF` (water diff: `APT`/`CNS`/`PER`), `MOD_R_INC` (heating: `SL`/`SET`), `MODR_DIFIN` (heating diff: `SL`/`SET`/`CNS`), `MOD_R_ASC` (elevator: `PER`/`APT`/surface). Percentages: `PROCINCCOM` (% of heating treated as common areas), `PROC_CHSED, PROC_AV_AC, PROC_AV_IN, PROC_SAL_F, PROC_SAL_T, PROC_ABONA, PROC_CHADM, PROCGUNOI`. Block meters: `INAR/IVAR` (cold), `INAC/IVAC` (hot), `ININ/IVIN, CONSTIN` (heat). Meter modes: `CP_AR, CP_AC, CP_IN` (`C` = block has its own meter, `P` = flat-rate share of the association meter). Thermal parameters: `ECART_TEMP, RAND_TR, TARIF_ET` (lei/Gcal). **Block-level invoice amounts**: `GAZ, GUNOI, CURENT_SC, CURENT_LI, ASCENSOR, SAL_TESA, SAL_FEME, CH_ADMIN, CH_SEDIU, COTA_FR` (monthly working-fund quota), `PREST_SERV, CHELT_INC, ABONAMENT, CAN_MET`. The rest are computed bases and differences (`DIFARAR, DIFARAC, DIFCANAR, DIFCANAC, DIFETAC, DIFETIN`, ...). `OBSERVATII` memo.
- **APART** (one row per apartment, about 170 fields):
  - Identity: `BLOC, APART, NUME`
  - `PERSOANE, SUPRAFATA, SUP_EC_TER` (equivalent thermal surface)
  - **Temporary reductions**: `D1, D2` (validity period), `P1_SCAZ, P2_SCAZ` (persons removed), `SL1_SCAZ, SL2_SCAZ, SET_SCAZ` (surface removed)
  - **Per-apartment percentages (0–100)** applied to each expense: `PROC_AV_AC, PROC_AV_IN, PROCG, PROCGUNOI, PROCASCENS, PROC_CU_SC, PROC_CU_LI, PROC_SAL_F, PROC_SAL_T, PROC_ABONA, P_SALTESA, P_PRESSERV, PROC_CHADM, PROC_DIFER, PROC_DIFIN, PROC_CHSED`
  - Water meters: cold (kitchen `BU`, bath 1 `BA1`, bath 2 `BA2`) and hot (BU/BA1/BA2). Each meter has a new index, old index, metrology date `D_V_*` and serial `SER_*`. Heat meter: `ININ, IVIN, CONSTIN, D_V_IN, SER_IN`. Modes `CP_AR, CP_AC, CP_IN` (`C` = metered, `P` = flat rate, `R` = heat cost allocators)
  - **Up to 7 heat cost allocators**: `SERIE_Rn, IV_Rn, IN_Rn, FACTTR_Rn` (transmission factor), `COEFSP_Rn` (position coefficient), plus results `TOT_UNIT, GCAL_UNIT, GCAL_MP, GCAL_CALC, GCAL_RED, GCAL_FINAL`
  - Computed charge fields: `APA_RECE, ARRA, ARCA, CAN_MNJ, CAN_MNJAR, CAN_MNJAC, CAN_MET, APA_CALDA, INCALZIRE, GAZ, GUNOI, CURENT, CURENT_SC, CURENT_LI, ASCENSOR, SAL_FEME, SAL_TESA, CH_ADMIN, CH_SEDIU, RULMENT, PREST_SERV, ABONAMENT, CHELT_INC, DIFARAR, DIFARAC, DIFCANAR, DIFCANAC, DIFETAC, DIFETIN`
  - **Manual per-apartment charges**: `CH_BOX, CH_HAV, REPAR_CRT, ALTELE, I, FOND_REPAR`
  - Working fund: `MAX_FR` (target), `CALC_FR` (billed so far), `PLAT_FR` (unpaid)
  - `SUPR_REDUS`, `OBSERVATII` memo
- **CHITANTE = the receivables LEDGER** (the core of the money logic; this is *not* a receipt table):
  - One row per apartment × month × category.
  - Fields: `ASOC, BLOC, APART, NUME, LUNA` (name), `LUNAC` (month no.), `AN, VALOARE` (amount owed), `PLATA1, CHITANTA1, DATA1, SURSA1, PLATA2, CHITANTA2, DATA2, SURSA2` (up to 2 partial payments, each with receipt no., date and source), `CEE`.
  - `CEE` = category: **`R`** = maintenance ("regie"), **`F`** = working fund (fond rulment), **`A`** = repair fund (fond reparații), **`P`** = penalties.
  - **Unpaid for a row** = `VALOARE − (CHITANTA1≠0 ? PLATA1 : 0) − (CHITANTA2≠0 ? PLATA2 : 0)`.
  - **Arrears are never stored as a single number.** They are always the sum of unpaid rows from earlier months.
- **CASA** (cash register journal) and **BANCA** (bank journal): `DOCUMENT, DATA, SUMA, INC_PLA`/`DEP_VIR` (receipt/payment or deposit/transfer), `ACT_PAS`, `EXPLICATIE`. They are emptied at month end.
- **PATRIM** (assets and liabilities): `DOCUMENT, DATA, SUMA, ACT_PAS, EXPLICATIE, PERIOADA, DATA_PRES`. The `SUMA` values are reset to 0 each month, but the rows are kept.
- **ORDINE** (bank payment orders): number, date, type, amount, payer and beneficiary (name, address, CUI, IBAN, bank, branch, BIC), up to 3 representative lines.
- **IMPRI** (printer list): no longer needed. Replace it with browser printing to PDF.

### 1.3 Monthly workflow in the legacy system (the new app must support the same cycle)
1. **Actualizare A**: enter GENERAL (tariffs, last day of month).
2. **Actualizare B/C**: enter association-level and block-level invoice amounts, plus block thermal parameters.
3. **Actualizare D/E/F/R**: apartment changes, meter indexes, heat cost allocator readings, metrology data.
4. **Calcul A** `TCE`: expire temporary reductions whose `D2 < ULTIMA_ZI` (clear `D1, D2, P1_SCAZ, P2_SCAZ, SL1_SCAZ, SL2_SCAZ, SET_SCAZ, OBSERVATII`).
5. **Calcul B** `CRE`: convert heat cost allocator readings into Gcal per apartment.
6. **Calcul C** `SUM`: compute every charge for every apartment.
7. **Listare**: print the payment lists (avizier), slips and invoice report. Fix data and recompute as needed.
8. **Actualizare J** `TRE`: "publish" the month by writing ledger rows R/F/A into CHITANTE.
9. **Centralizare A/B**: cut receipts (they pay ledger rows, and penalties are computed on the fly).
10. **Actualizare N/O/P**: cash, bank and patrimony documents. Print the cash register.
11. **Actualizare L** `SLU`: close the month (snapshot, rotate indexes, zero the charges).

---

## 2. Bugs and gaps in the current web app (fix all of these)

| # | Where | Problem | Required fix |
|---|---|---|---|
| G1 | `db.js` schema | No ledger. `apartamente.restante/penalizari` are single numbers. | Introduce the ledger (§4.1). Derive arrears from it. Drop or deprecate the two columns, or keep them only as cached values. |
| G2 | `POST /api/luna/inchide` | Unpaid current-month charges are never carried over. Charges are not stored. There is no snapshot, no lock and no guard against a double close. | Rewrite per §4.6. |
| G3 | `POST /api/chitante` | Payment only reduces penalties and arrears and never touches current-month charges. The receipt is not linked to what it paid. There is no CASA entry. The allocation order is hardcoded. | Rewrite per §4.5. |
| G4 | `POST /api/chitante/:id/anuleaza` | Adds the whole amount to `restante`, even if part of it paid penalties. | Void by reversing the exact ledger payment rows it created (§4.5). |
| G5 | Penalties | No engine. | Implement §4.4. |
| G6 | `POST /api/facturi/:id/repartizeaza` and the water-difference endpoint | `a.persoane \|\| 1` charges **apartments with 0 persons as if they had 1 person**. Per-apartment %, reductions, block %, C/P/R modes and canal are all ignored. | Replace with the calculation engine (§4.2). |
| G7 | Water tariffs | Stored per block (`tarif_apa_rece/calda/canal`). The legacy system has one tariff per month (GENERAL). Hot water is billed by volume × `tarif_apa_calda`. | Legacy model: hot water = volume × `TARIF_AR` (added to cold water) **plus** heating energy (Gcal × `TARIF_ET`). Implement §4.2.1. Per-block overrides may stay as an optional extra. |
| G8 | `lista-plata` | Invents a **flat 10 lei repair fund** when no invoice exists (`cota_fond_reparatii`). | Remove this. The repair fund comes from the apartment's `FOND_REPAR` (manual per apartment), billed as ledger category `A`. |
| G9 | `lista-plata` | Columns don't match the legacy charge set (canal, rain water, gas, separate staircase/elevator electricity, admin, office, subscription, services, heating costs, box, HAV, current repairs, working fund, the 6 difference types, and so on). | Rebuild from the engine output (§5, Listare C/D). |
| G10 | `/api/luna/inchide` | `totalIncasat` filters by month only and ignores the year. | Filter by period (month and year). This becomes moot once the ledger exists. |
| G11 | Auth | Hardcoded passwords. `role: 'superadmin'` logs in without a password. API endpoints have no server-side checks. | Real users table, bcrypt hashes, sessions/JWT, middleware on every `/api/*` route, roles (superadmin, administrator, cashier read/write). Keep impersonation, but audit-log it. |
| G12 | `import-foxpro.js` | Imports only ASOC/BLOCURI/APART, and only part of APART. | Import all tables and all months (§4.9). The 23,171 ledger rows are the real arrears history and **must** be imported. |
| G13 | Month model | Facturi with `luna IS NULL` appear in every month. | Every financial record must belong to a period. Closed periods are read-only. |
| G14 | Persons default | `persoane INTEGER DEFAULT 1`, and the API inserts `persoane \|\| 1` | Default 0. Allow 0. |
| G15 | Number precision | Floats with `Math.round(x*100)/100` everywhere | Store money as integer bani (or use a decimal library). Use one shared `round2` that reproduces FoxPro `ROUND(x,2)` (half away from zero). |

---

## 3. Complete function matrix (58 items)

Status meanings: ❌ missing, 🟡 partial/incorrect, ✅ OK. "Section" points to the instructions below.

### ACTUALIZARE
| Key | Legacy function | PRG | Status | Section |
|---|---|---|---|---|
| A | Date generale (tariffs, last day of month) | ADG | ❌ | 4.3.1 |
| B | Association data and association-level invoices | ADA | 🟡 identity only | 4.3.2 |
| C | Block data, block invoices, modes, %, thermal parameters | ADB | 🟡 | 4.3.3 |
| D | Persons, surfaces, percentages, reductions, add apartment | APS | 🟡 | 4.3.4 |
| E | Meter indexes (cold/hot ×3, heat) | AIA | 🟡 no modes, no heat meter | 4.3.5 |
| F | Heat cost allocator data (7 per apartment) | ARA | ❌ (columns exist, no UI/logic) | 4.3.6 |
| G/H/I | Read-only view of ASOC/BLOCURI/APART | AVS/AVB/AVA | ❌ | 4.3.7 |
| J | Trecere valori de plată (publish month to ledger) | TRE | ❌ | 4.3.8 |
| K | Golire valori de plată (unpublish) | GOL | ❌ | 4.3.8 |
| L | Sfârșit de lună | SLU | 🟡 wrong | 4.6 |
| M | Salvare (backup) | SAL | ❌ | 4.7 |
| N | Acte casă | ACA | ❌ | 4.3.9 |
| O | Acte bancă | ABA | ❌ | 4.3.9 |
| P | Patrimoniu | APA | ❌ | 4.3.9 |
| Q | Adrese blocuri | ADR | ✅ (strada/numar exist; add `cod` postal) | 4.3.3 |
| R | Metrology data and meter serials | ADC | ❌ | 4.3.5 |
| S | Imprimante | AIM | N/A, replaced by browser print/PDF | — |
| T | Refacere indexuri chitanțe | REF_IND | N/A (SQLite). Add a "verifică integritate" (DB integrity check) tool in the Control Tower instead | 4.8 |

### CALCUL
| Key | Function | PRG | Status | Section |
|---|---|---|---|---|
| A | Trecere cereri expirate (expire reductions) | TCE | ❌ | 4.2.0 |
| B | Calcul repartitoare | CRE | ❌ | 4.2.4 |
| C | Însumare și calcul | SUM | 🟡 very partial | 4.2 |

### LISTARE (all of these must render on screen and print or export to PDF; add Excel/CSV export as a modern extra)
| Key | Function | PRG / FRX | Status |
|---|---|---|---|
| A | Fluturași fără restanțe (per-apartment slips, current month) | LIP | ❌ |
| B | Fluturași cu restanțe | LIR (LIR*.FRX) | ❌ |
| C | Liste de afișat fără restanțe | LAF (LAF*.FRX) | ❌ |
| D | Liste de afișat cu restanțe | LAR (LAR*.FRX) | 🟡 |
| E | Liste primărie fără restanțe (city-hall format) | LP1 | ❌ |
| F | Liste primărie cu restanțe | LP2 | ❌ |
| G | Cele mai simple liste de plată (apartment, persons, month total) | LPP | ❌ |
| H | Repartizare cheltuieli fără restanțe | LRC | ❌ |
| I | Situație calcul repartitoare | SCR (SCR1–7.FRX) | ❌ |
| J | Valori facturi (all invoices entered and totals) | LFA | ❌ |
| K | Registrul de casă (for a period) | CCA | ❌ |
| L | Bancă (monthly report) | CBA | ❌ |
| M | Patrimoniu (monthly) | CP1 | ❌ |
| N | Valori în ordine (apartments sorted by amount, ascending) | MAX | ❌ |
| O | Ordine de plată (edit and print bank payment orders) | ORD | ❌ |
| P | Convocator adunare generală | ADU (ADU/ADU2.FRX) | ❌ |

### CENTRALIZARE
| Key | Function | PRG | Status |
|---|---|---|---|
| A | Taie chitanțe individuale | CHI | 🟡 wrong model |
| B | Taie chitanțe colective (one receipt for several apartments / batch cashing) | CHO (compiled only) | ❌ |
| C | Încasări perioadă, by block/apartment order (optionally one apartment) | IN1 | ❌ |
| D | Încasări perioadă, by receipt-number order | IN2 | ❌ |

### SITUAȚII
| Key | Function | PRG | Status |
|---|---|---|---|
| A | Situație blocuri | SBL | ❌ |
| B | Consumuri apartamente (persons and meter consumption) | SAP | ❌ |
| C | Citiri contoare apartamente (reading sheet for meters) | PV (PV1xx/2xx.FRX) | ❌ |
| D | Citiri repartitoare (reading sheet for allocators) | PVR (PVR1–7.FRX) | ❌ |
| E | Restanțe (totals) | SRE | ❌ |
| F | Restanțe + penalități (detailed per month and category) | RE1 | ❌ |
| G | Valori în detaliu (one apartment, every charge item) | CED | ❌ |
| H | Liste de plată pentru instanță (court filing format) | LAR_INST | ❌ |
| I | Situație fond rulment | SRU | ❌ |
| J | Situație fond reparații | SFR | ❌ |
| K | Situație penalități | SPE | ❌ |
| L | Persoane, suprafețe, volume per block | PER | ❌ |
| M | Restanțe și debranșări (heating disconnection and arrears) | GOT | ❌ |
| N | Ajutoare încălzire (heating-aid statement) | AJU | ❌ |
| O | Scrisori restanțieri (letters to debtors) | LSC | ❌ |
| P | Verificări metrologice expirate | LVE | ❌ |
| Q | Compar valori de plată (current month vs a reference month) | COM | ❌ |

---

## 4. Detailed implementation instructions

### 4.0 Architecture rules
- Add a **`perioade` table** (association, year, month, status: `DESCHISA` / `PUBLICATA` / `INCHISA`, ultima_zi, tarif_ar, tarif_ca, proc_ca, closed_at, closed_by). Every monthly datum references a period.
- **Monthly snapshots**: the legacy system can open any past month. On month close, store immutable per-period copies of the block and apartment state (indexes, persons, surface, all computed charges, invoice amounts). Use tables `apartamente_luna` and `blocuri_luna`, keyed by (period, apartment/block). Every report must accept a period selector and work for closed months.
- Put the calculation engine in its own module (for example `engine/calcul.js`). It must be a pure function `(period inputs) → per-apartment charges + block/association bases`, so it can be unit-tested against legacy data.
- Every money mutation (receipts, voids, publish, close) runs inside one `db.transaction` and writes an audit-log row (user, impersonator, action, payload).

### 4.1 Ledger (replaces `restante/penalizari`)
Create table `datorii` (the 1:1 equivalent of CHITANTE.DBF):
- Columns: `id, apartament_id, bloc_id, an, luna, categorie` (`R` intretinere, `F` fond rulment, `A` fond reparații, `P` penalități), `valoare, creat_la, sursa` (publish / manual / penalty / import).
- Create table `plati` (replaces the PLATA1/PLATA2 slots, with no 2-payment limit): `id, datorie_id, chitanta_id, suma, data, sursa` (`CASA` / `BANCA`).
- `rest_de_plata(datorie) = valoare − SUM(plati.suma of non-voided receipts)`.
- **Arrears for an apartment in period P** = sum of unpaid rows with (an, luna) < P. **Current month** = rows for P.
- Add indexes on (apartament_id, an, luna) and (chitanta_id).
- Manual ledger adjustment: legacy `CHI` let the operator add or edit rows (procedure `ADAUG`, categories R/F/A/P). Provide an admin-only "Adaugă/corectează datorie" form with mandatory justification text, written to the audit log.

### 4.2 Calculation engine (`SUM.PRG`, the most important part; read it fully)
Notation: for apartment `c`, block `b`, association `a`, GENERAL `m`.
- `pers(c) = PERSOANE − P1_SCAZ`
- `sl1(c) = SUPRAFATA − SL1_SCAZ`
- `sl2(c) = SUPRAFATA − SL2_SCAZ`
- `set(c) = SUP_EC_TER − SET_SCAZ`

All percentages are 0–100. Use `round2` wherever the legacy code uses `ROUND(...,2)`, and round bases with `ROUND(...,0)` where noted (this reproduces the legacy penny behaviour exactly; do not replace it with "remainder to last apartment").

**4.2.0 Pre-step: TCE (expire reductions).** For each apartment with `D2` set and `D2 < ultima_zi`, clear `D1, D2, P1_SCAZ, P2_SCAZ, SL1_SCAZ, SL2_SCAZ, SET_SCAZ, OBSERVATII`. Offer it as a button and also run it automatically (with a confirmation list) before calculation.

**4.2.1 Step 1: working fund status.** For each apartment, `CALC_FR` = sum of ledger `F` values across all periods, and `PLAT_FR` = unpaid `F`.

**Step 2: apartment meter values** (for apartments with `CP_AR='C'` or `CP_AC='C'`):
- `cnsar = Σ(new−old)` over cold meters BU, BA1, BA2. `cnsac` = the same over the hot meters.
- `ARRA = cnsar × TARIF_AR` and `ARCA = cnsac × TARIF_AR`. Hot-water volume is billed at the cold-water tariff.
- `APA_RECE = (cnsar + cnsac) × TARIF_AR`
- `CAN_MNJ = round2((cnsar+cnsac) × PROC_CA/100 × TARIF_CA)`. `CAN_MNJAR` and `CAN_MNJAC` use cnsar and cnsac separately.
- `APA_CALDA` (energy to heat the water) = `round2(cnsac × b.ECART_TEMP × b.RAND_TR/100 / 1000 × b.TARIF_ET)`
- Heat meter, all apartments: `INCALZIRE = round2(round((ININ−IVIN)×CONSTIN, 4) × TARIF_ET)`. For `CP_IN='R'`, `ININ` is produced by CRE (§4.2.4) with `IVIN=0` and `CONSTIN=1`.

**Step 3: block bases.** For each block, sum over its apartments. Each base below has its matching field:
- `TOT_APART`; counts of apartments with `CP_AR='C'` (`APCAR`), `CP_AC='C'` (`APCAC`), `CP_IN='C'` (`APCIN`); `APASCEN`, `APDIFAR`, `APDIFAC`
- `PERS_AR` = Σpers where CP_AR='P'
- `PERS_AC = round(Σ pers×PROC_AV_AC/100 where CP_AC='P', 0)`; `PERS_ACD = round(PERS_AC × b.PROC_AV_AC/100, 0)`
- `PERS_ACX`; `PERDIFAC = round(Σ pers×PROC_AV_AC/100×PROC_DIFER/100 × b.PROC_AV_AC/100, 0)`
- `PERSOANEG = Σ pers×PROCG/100`; `PERSGU = round(Σ pers×PROCGUNOI/100 × b.PROCGUNOI/100, 0)`; `PASCENS`, `PCURENT_SC`, `PCURENT_LI` = Σ pers × the matching apartment %; `PER_SAL_FE`; `PERDIFAR = Σ pers×PROC_DIFER/100`
- `SUPRAFATA1 = Σ sl1`, `SUPRAFATA2 = Σ sl2`, `SL_DIFIN = Σ sl1×PROC_DIFIN/100`, `SET_COMUN = Σ set`, `SET_DIFIN`
- `SL_INC = round(Σ sl1×PROC_AV_IN/100 where CP_IN='P', 2)`; `SL_INCD = round(SL_INC × b.PROC_AV_IN/100, 2)`; `SUP_EC_TER` = the same with set
- `SL_ABON, SL_SALTE, SL_SALFE, SL_CHSED, SL_CHADM` = `round(Σ SUPRAFATA×apt% × block%/100, 0)`; `SL_PRESSE`, `SL_ASCEN` = Σ SUPRAFATA × apt%
- `ARAC` = Σ ARRA (CP_AR='C'); `ACAC` = Σ ARCA (CP_AC='C'); `ARDIFER` = Σ ARRA×PROC_DIFER/100; `ACDIFER` likewise
- `ETACAC` = Σ apartment APA_CALDA (CP_AC='C'); `INCCAP` = Σ INCALZIRE of metered apartments; `INCRAP` = the rest; `ETINAC = INCCAP + INCRAP`

**Step 4: block meter values** (blocks with CP_AR or CP_AC = 'C'):
- `APA_RECE = (INAR−IVAR) × TARIF_AR` and `APA_CALDA = (INAC−IVAC) × TARIF_AR`
- `ETAC = round2((INAC−IVAC) × TARIF_ET × ECART_TEMP × RAND_TR/100/1000)`
- Blocks with CP_IN='C': `INCALZIRE = round2(round((ININ−IVIN)×CONSTIN,4) × TARIF_ET)`

**Step 5: association bases.** Sum the block bases into ASOC (`TOT_APART, PERSOANE1/2, PERS_AR, PERS_AC, PERSGU, SL_INC, SUPRAFATA1/2, SL_ABON, SL_SALTE, SL_SALFE, SL_CHSED, SL_CHADM, SUP_EC_TER`). Also compute `ARBC/ARACBC/ARACBN, ACBC/ACACBC/ACACBN, ETACBC/ETACACBC/ETACACBN, ETINBC/ETINACBC/ETINACBN`: sums of block-meter values and apartment-meter values, split by whether the block is metered (`C`) or not (`P`).

**Step 6: block-level water, hot water, heating and differences.** Implement exactly the `DO CASE` on `(b.CP_AR, b.CP_AC)` from `SUM.PRG` lines ~220–300:
- **Block cold metered (C), hot not (P):**
  - If every apartment has meters (`TOT_APART = APCAR`): `DIFARAR = APA_RECE − ARAC`, `DIFCANAR = round2(DIFARAR / TARIF_AR × PROC_CA/100 × TARIF_CA)`, block `APA_RECE = 0`.
  - Otherwise: `APA_RECE = APA_RECE − ARAC` (the remainder is shared by persons among unmetered apartments) and the differences are 0.
  - Block hot water and energy come from the association: `APA_CALDA = round2((a.APA_CALDA − a.ACBC − a.ACACBN)/a.PERS_AC × b.PERS_ACD)`. `ETAC` uses the same formula with the ET fields.
  - Recompute `CAN_MNJAR`, `CAN_MNJAC`, `CAN_MNJ` from the remaining volumes.
- **Both metered (C/C):** apply the same logic for hot water (`DIFARAC`, `DIFCANAC`, `DIFETAC = ETAC − ETACAC`) when `TOT_APART = APCAC`. Otherwise use the remainder.
- **Other combinations:** take them verbatim from the PRG (the second half of the CASE block is in `SUM.txt`).
- **Heating:**
  - `CP_IN='C'`, all apartments metered: `DIFETIN = INCALZIRE − ETINAC` and `INCALZIRE = 0`.
  - `CP_IN='C'`, not all metered: `INCALZIRE −= ETINAC`.
  - `CP_IN='P'`: `INCALZIRE = round2((a.INCALZIRE − a.ETINBC − a.ETINACBN)/a.SL_INC × b.SL_INCD)`.
  - Then `INCCOMUN = round2(INCALZIRE × PROCINCCOM/100)` and `INCSUPR = INCALZIRE − INCCOMUN`.
- **Association → block split** (for invoices entered at association level):
  - `GUNOI = round2(a.GUNOI/a.PERSGU × b.PERSGU)`
  - `CH_ADMIN`, `CH_SEDIU`, `ABONAMENT`, `SAL_TESA`, `SAL_FEME`: the same pattern with the matching `SL_*` surface bases.
  - These are *added to* (or replace) the block amounts as in the PRG. Check whether it uses replace or add.

**Step 7: apartment charges** (verbatim from the end of `SUM.PRG`; every term is 0 when its divisor is 0):
- **Water for flat-rate apartments**, by `(c.CP_AR, c.CP_AC)`:
  - C/P: `APA_CALDA = round2(b.ETAC/b.PERS_AC × pers × PROC_AV_AC%)`; `APA_RECE = ARRA + round2(b.APA_CALDA/b.PERS_AC × pers × PROC_AV_AC%)`
  - P/P: the same, but the cold part is `round2(b.APA_RECE/b.PERS_AR × pers)`
  - P/C: `APA_RECE = ARCA + round2(b.APA_RECE/b.PERS_AR × pers)`
  - In all cases `CAN_MNJ = round2(APA_RECE/TARIF_AR × PROC_CA% × TARIF_CA)`
  - C/C: keep the meter values from step 2
- **Heating difference `DIFETIN`** by `MODR_DIFIN`:
  - `SL`: `b.DIFETIN/b.SL_DIFIN × sl1 × PROC_DIFIN%`
  - `SET`: `/b.SET_DIFIN × set × PROC_DIFIN%`
  - `CNS`: `/b.ETINAC × c.INCALZIRE × c.PROC_AV_IN% × b.PROC_AV_IN%`
- **Heating, flat rate (only when `b.INCRAP = 0`)** by `MOD_R_INC`:
  - `SL`: `INCALZIRE += b.INCCOMUN/b.SUPRAFATA1 × sl1 + round2(b.INCSUPR/b.SL_INC × sl1 × PROC_AV_IN%)`
  - `SET`: use `SET_COMUN`/`SUP_EC_TER` and set instead
- **Water differences** by `MOD_R_DIF`:
  - `APT` (per apartment): `DIFARAR = b.DIFARAR/b.APDIFAR × PROC_DIFER%`. `DIFCANAR` likewise. `DIFARAC`, `DIFCANAC`, `DIFETAC` also multiply by `c.PROC_AV_AC% × b.PROC_AV_AC%`.
  - `CNS` (by consumption): `DIFARAR = b.DIFARAR/b.ARDIFER × c.ARRA × PROC_DIFER%`. The hot-water ones use `/b.ACDIFER × c.ARCA`.
  - `PER` (by persons): `DIFARAR = b.DIFARAR/b.PERDIFAR × pers × PROC_DIFER%`. The hot-water ones use `/b.PERDIFAC × pers × PROC_AV_AC% × b.PROC_AV_AC% × PROC_DIFER%`.
  - *Note:* the current app allocates differences "by indivisible share", which the legacy system does not do. Keep it only as an optional extra mode.
- `CAN_MET` (rain water) = `b.CAN_MET/b.SUPRAFATA2 × sl2`
- `GAZ` = `b.GAZ/b.PERSOANEG × pers × PROCG%`
- `ASCENSOR`, by `MOD_R_ASC`:
  - `PER`: `/b.PASCENS × pers × PROCASCENS%`
  - `APT`: `/b.APASCEN × PROCASCENS%`
  - otherwise: `/b.SL_ASCEN × SUPRAFATA × PROCASCENS%`
- `GUNOI` = `b.GUNOI/b.PERSGU × pers × PROCGUNOI% × b.PROCGUNOI%`
- `CURENT_SC` = `b.CURENT_SC/b.PCURENT_SC × pers × PROC_CU_SC%`. `CURENT_LI` likewise with LI. `CURENT = CURENT_SC + CURENT_LI`.
- Surface-based items:
  - `CH_ADMIN = b.CH_ADMIN/(b.SL_CHADM/(b.PROC_CHADM%)) × SUPRAFATA × PROC_CHADM%`
  - `CH_SEDIU`, `ABONAMENT`, `SAL_TESA`, `SAL_FEME`: the same pattern with their own fields and %
  - `PREST_SERV = b.PREST_SERV/b.SL_PRESSE × SUPRAFATA × P_PRESSERV%`
- `RULMENT` = `CALC_FR >= MAX_FR ? 0 : b.COTA_FR`. A working-fund instalment is charged until the apartment's target is reached.
- `CHELT_INC` = `b.CHELT_INC/b.SL_INC × sl1 × PROC_AV_IN%`
- Manual items, copied as entered: `CH_BOX, CH_HAV, REPAR_CRT, ALTELE, I, FOND_REPAR`

**Step 8: month total (category R)** = `APA_RECE + CAN_MNJ + CAN_MET + APA_CALDA + INCALZIRE + GAZ + GUNOI + CURENT + ASCENSOR + CH_ADMIN + CH_SEDIU + PREST_SERV + ALTELE + I + REPAR_CRT + DIFARAR + DIFARAC + DIFCANAR + DIFCANAC + DIFETAC + DIFETIN + CH_BOX + CH_HAV + ABONAMENT + CHELT_INC + SAL_FEME + SAL_TESA` (taken from TRE.PRG).
- Category **F** = `RULMENT`.
- Category **A** = `FOND_REPAR`.

**Engine UX (keep it simple):** add one big "Calculează luna" button. It runs TCE, then CRE, then SUM and shows a validation panel before results:
- blocks where new index < old index
- apartments missing readings
- divisors equal to 0
- metrology expired
- sum of apartment shares ≠ invoice (shown per category, block and association)

Results recompute instantly whenever an input changes, as long as the period is not published.

**4.2.4 CRE: heat cost allocators** (`CP_IN='R'`):
- Per apartment: `TOT_UNIT = round4(Σ_{n=1..7} (IN_Rn − IV_Rn) × FACTTR_Rn × COEFSP_Rn)`.
- `GHP = max over 'R' apartments of TOT_UNIT / (sl1 × PROC_AV_IN%)`. Flat-rate (`'P'`) apartments in the same block get `TOT_UNIT = GHP × sl1 × PROC_AV_IN%` (the maximum specific consumption is imposed).
- Block: `DD = (ININ−IVIN) × CONSTIN` (Gcal), `EE = DD × PROCINCCOM%` (common part), `FF = DD − EE`.
- Over apartments with `CP_IN ≠ 'C'`: `GPU = FF/ΣTOT_UNIT` and `GPS = EE/Σsl1`.
- Per apartment: `GCAL_UNIT = round4(GPU × TOT_UNIT)`, `GCAL_MP = round4(GPS × sl1)`, `GCAL_FINAL = GCAL_UNIT + GCAL_MP + GCAL_RED` (manual correction), then set `IVIN=0`, `ININ=GCAL_FINAL`, `CONSTIN=1`.
- Use the internal precision of 8 decimals, as the legacy code does.
- UI: an allocator grid per apartment (7 rows: serial, old, new, factor, coefficient). Show the computed Gcal and lei live.

### 4.3 Data-entry screens
**4.3.1 Date generale (per period).** Fields: `ultima_zi` (last day of month; used by TCE and penalties), `tarif_ar`, `tarif_ca`, `proc_ca`. Place them on a "Luna curentă" settings card.

**4.3.2 Asociație.**
- Identity: add `n_r_com, cod_postal, judet, telefon` (telinst) and `program` (the "PROGRAM" text printed on lists, e.g. office hours).
- Penalties: `proc_penal`, `zile_penal`.
- Receipts: series and next number.
- **Association-level invoice amounts per period**: cold water (`APA_RECE`), rain water (`CAN_MET`), hot water (`APA_CALDA` + `ETAC`), heating (`INCALZIRE`), garbage, admin expenses, administrator salary (`SAL_TESA`), cleaner salary (`SAL_FEME`), subscription, office expenses, working fund.
- Keep the modern "Facturi" UX (invoice number, supplier, date, document), but every invoice must map to one of these legacy categories, at either association or block level. The engine reads category totals.

**4.3.3 Bloc.** Add every field from §1.2 BLOCURI: the 4 allocation modes, all percentages, meter modes C/P, the 3 block meters (`index_vechi_in`/`index_nou_in` and `const_incalzire` already exist), `ECART_TEMP, RAND_TR, TARIF_ET`, block invoice amounts per period (gas, garbage, staircase electricity, elevator electricity, elevator maintenance, salaries, admin, office, working-fund quota `COTA_FR`, services, heating expenses, subscription, rain water), postal code and observations. Group them into collapsible cards: *Identificare*, *Moduri repartizare*, *Contoare bloc*, *Facturi luna*, *Procente*.

**4.3.4 Apartament.**
- All fields from §1.2 APART: persons, surface, equivalent thermal surface, the 16 percentages (default 100), C/P/R modes, `MAX_FR`, `FOND_REPAR`, the manual charges (`CH_BOX`, `CH_HAV`, `REPAR_CRT`, `ALTELE`, `I`), observations.
- **Temporary reductions** (D1, D2, P1/P2 persons, SL1/SL2/SET surfaces) with a reason. Show a badge on the apartment while a reduction is active.
- Add/remove apartment. Prevent deletion when ledger rows exist; offer "inactiv" instead.
- Inline-edit table with keyboard navigation (Enter moves down, Tab moves right). Speed is critical; the legacy operators type fast.

**4.3.5 Indexes and metrology (AIA, ADC, LVE).**
- Per apartment: 3 cold + 3 hot water meters + 1 heat meter. Each has old/new index, serial and metrology-check date.
- Fast grid: one row per apartment, a column for each new index. Old indexes are read-only (with an admin override), and consumption is shown live. Highlight in red a negative consumption, or a consumption more than 3× the apartment's average.
- Block meters at the top.
- "Verificări metrologice expirate" list (meters whose check date is older than N years; make N configurable, legacy LVE logic). Read LVE.PRG for the exact rule.

**4.3.6 Repartitoare (ARA).** See §4.2.4 for the grid. Read ARA.PRG for validation and field order.

**4.3.7 Read-only views (G/H/I).** Add a "Date brute" tab per period showing association, block and apartment rows with all computed fields (for experts and audits). Make it sortable, filterable and exportable to CSV.

**4.3.8 Publish / Unpublish (TRE/GOL).**
- "Publică luna" (TRE):
  - Preconditions: the period is DESCHISA and the calculation has no blocking errors.
  - In one transaction, insert ledger rows R/F/A for every apartment where the value ≠ 0, then freeze a snapshot of the computed charges and set the status to PUBLICATA.
  - Refuse if ledger rows already exist for the period (legacy rule).
- "Anulează publicarea" (GOL): allowed **only if no payment exists against any row of that period** (legacy: `SUM(CHITANTA1+CHITANTA2)=0`). It deletes the period's R/F/A rows and sets the status back to DESCHISA.
- Receipts can only be cut for published periods.

**4.3.9 Casa / Bancă / Patrimoniu (ACA, ABA, APA).**
- **Cash journal** per period: document no., date, amount, type (Încasare / Plată), explanation.
  - Daily collections are generated automatically: one line per day, "ÎNCASĂRILE ZILEI DE dd.mm.yyyy", equal to the sum of receipts paid in cash that day (ACA logic). Read ACA.PRG.
  - The opening balance comes from the previous period's closing balance.
- **Bank journal**: document, date, amount, type (Depunere / Virament), explanation. Bank-source receipts (sursa = BANCA) feed it.
- **Patrimoniu**: rows of assets and liabilities (`ACT_PAS` = A/P), with document, date, amount, explanation, period text and presentation date. Amounts are re-entered each month (they reset at close), but the rows persist.
- **Ordine de plată (ORD)**: CRUD of payment orders with payer data pre-filled from the association, plus an official print layout.

### 4.4 Penalty engine (`CHI.PRG`, procedures `pen` and `Lpenal`)
- Apply this to each unpaid ledger row with category ≠ `P`, and **only when the apartment's total balance is ≥ 0**. If the apartment has a net credit, no penalties are charged.
  - `unpaid` = the rest-to-pay of the row
  - `start = date(15th of the month following the row's month) + ZILE_PENAL + 1 day`
  - `days = max(0, calculation_date − start)`
  - `pen = round2(days × PROC_PENAL/100 × unpaid)`, **capped at `unpaid`** (penalties can't exceed the debt)
- Legacy: when the operator presses the penalty key while cutting receipts, the penalties are written as new ledger rows (category `P`) in the current period. Implement:
  - (a) a live preview, computed on the fly for the selected date, shown in the cashier screen and the arrears reports;
  - (b) a "Calculează și înregistrează penalități" action per apartment and per block (and automatically at month publish, if the association enables that setting). It creates the `P` rows, is idempotent per period, and never duplicates penalties for the same days. Store `penalizat_pana_la` per source row, so the next run only charges new days.
- **Ask the user**: should penalties be booked automatically each month, or only on demand as in the legacy system? Default to on-demand plus preview.

### 4.5 Cashier (CHI individual, CHO collective, receipts)
- **Individual receipt screen**:
  - Search the apartment by block+number or by name prefix (legacy `cautn`/`cautnl`).
  - Show every unpaid ledger row grouped by period and category (R/F/A/P), each with its amount, paid so far and remaining.
  - Show the penalty preview.
  - Show totals: current month, arrears, penalties, working fund, repair fund.
- **Payment entry**:
  - "Achită tot" (pay everything; legacy `PUNNR` fills every row's remaining amount).
  - A per-row amount.
  - "Sumă globală": distribute a single amount automatically. **Default order: oldest period first; within a period, P → A → F → R.** Make the order configurable in association settings and confirm it with the user (the legacy system let the operator choose rows manually).
  - Partial payments are allowed.
- **On issue**, in one transaction:
  - create the receipt (series and number = `urmatorul_numar_chitanta`, then increment), the date (today, editable only by admin), source (CASA/BANCA), payer name and amount in words;
  - insert the `plati` rows;
  - auto-build the explanation from the paid categories as in legacy (`REGIE`, `FOND REPARAȚII`, `FOND RULMENT`, `PENALITĂȚI`, combined, e.g. "REGIE, FOND REPARAȚII ȘI PENALITĂȚI", plus the periods paid).
- **Warning**: if today's month/year ≠ the working period, show a non-blocking warning (legacy check).
- **Void**: mark the receipt `anulata`, soft-delete its `plati` rows (ledger balances restore automatically), keep the number (no reuse), require a reason and write an audit entry.
- **Collective receipts (CHO)**: one session in which the cashier selects several apartments (e.g. one owner with several apartments, or a batch), enters payments, and prints one combined receipt or one receipt per apartment. Extract the exact behaviour from `CHO.FXP`/`CHO.FRX` strings.
- **Print**: A5/A4 receipt (CHI*.FRX layouts for content). Optional 2-per-page.
- **Speed**: the whole flow must work with the keyboard alone (search → Enter → amount → Enter = issue and print).

### 4.6 Month close (`SLU.PRG`)
Preconditions:
- The period is PUBLICATA.
- The next period does not exist yet.
- Warn if the previous period has no ledger rows (legacy check).
- Show a summary and require typed confirmation.

In one transaction:
1. Snapshot the closed period: copy apartment and block state, invoice amounts, the cash/bank/patrimony journals and the GENERAL values into the period tables, and set the status to INCHISA (read-only).
2. Create the next period with the GENERAL values copied (tariffs carry over) and the receipt counter carried.
3. In the live tables, apply the following resets:
   - Apartment indexes: `old = new` for all 6 water meters, the heat meter and the 7 allocators. Set `new` to NULL. (Legacy sets 0. Modern: NULL means "not read yet", and a missing reading must be flagged before calculation.)
   - Block indexes: `IVAR=INAR`, `IVAC=INAC`, `IVIN=ININ`. Set the new values to NULL.
   - Zero all computed charge fields for apartments and blocks.
   - Zero the block and association monthly invoice amounts and `ECART_TEMP`.
   - Zero `CALC_FR`.
   - Keep persons, surfaces, percentages, reductions, `MAX_FR`, `FOND_REPAR` and the manual charges `CH_BOX`/`CH_HAV` (check SLU: `ALTELE` and `REPAR_CRT` are zeroed, `CH_BOX`/`CH_HAV`/`I`/`FOND_REPAR` are kept).
   - Start the cash/bank journals empty, with opening balance = previous closing balance.
   - Copy the patrimony rows with `suma = 0`.
4. The ledger is **never** rotated or summarised. Unpaid rows automatically become arrears because they belong to an older period.

Also add an admin-only "Redeschide luna" (reopen month) action. It is allowed only for the latest closed period, if the new period has no receipts or published data, and it is audited. The legacy system allowed this only by manually going back to the previous folder.

### 4.7 Backup (SAL)
- "Salvare" button: produce a consistent SQLite backup (`db.backup()` API) as a downloadable timestamped file, and keep the last N files on the server.
- Run an automatic daily backup and a backup before every month close or publish.
- Admin-only restore, with confirmation.

### 4.8 Utilities replacing legacy-only items
- Printers (AIM): replace with print CSS + "Descarcă PDF". Support A4 portrait, A4 landscape and A3 landscape for the wide lists. The 80/132-column modes map to portrait/landscape.
- Rebuild indexes (REF_IND): Control Tower "Verifică integritate" runs `PRAGMA integrity_check` plus ledger consistency checks: payments ≤ amount, receipt sums = payment sums, no orphan rows.

### 4.9 Importer (`import-foxpro.js`)
- Import every month folder under `DATE\ANI_LUNI` (chronologically) into periods. Fill per-period snapshots from each month's APART/BLOCURI/ASOC/GENERAL.
- Import the latest month as the live state, with **all** APART fields (percentages, reductions, all 6 meters + serials + metrology dates, the heat meter, 7 allocators with factors and coefficients, MAX_FR, FOND_REPAR, manual charges, memo `OBSERVATII` from the `.FPT` file).
- Import **CHITANTE.DBF** from the latest month only, because it is cumulative: one `datorii` row per DBF row (categories R/F/A/P). PLATA1/CHITANTA1/DATA1/SURSA1 and PLATA2/... become `plati` rows. Create `chitante` (receipt) rows grouped by receipt number (amount = sum of its payments; date; apartment, or several apartments for collective receipts).
- Import CASA, BANCA, PATRIM, ORDINE and GENERAL per month.
- Text is CP852. Dates are DBF `D` fields. Memo fields come from `.FPT`.
- Make the importer idempotent (`--force`). Print a reconciliation at the end: the total unpaid per block according to the DBF must equal the total in SQLite.
- GDPR: the production data uses real names; the current test DB is anonymised. Keep an `--anonymize` flag.

---

## 5. Reports: required content (Listare and Situații)
General rules:
- Every report has filters (period, block, apartment where relevant, with/without arrears) and three outputs: on-screen table, print/PDF and CSV/Excel export.
- Header: association name, CUI, address, block/staircase, month/year. Footer: signatures for Președinte, Administrator, Cenzor and a "Întocmit" line. Include the posting date and payment deadline text.
- **Before building each report, extract its exact columns from the FRX** (string-dump `G:\INCASOR\INCASARI\<NAME>.FRX`). The PRG (`G:\VECHI\...\PRG\<NAME>.PRG`) shows the filters and the SQL that builds the data.
- GDPR: notice-board lists (C, D, E, F, G, N) must hide names by default (show the apartment number only), with a per-association option. Slips (A, B), letters (O), court lists (H) and detail views (G) may show names, since they are not posted publicly.

| Report | Content / logic |
|---|---|
| A/B Fluturași | One slip per apartment (several per A4 page): every charge item with a non-zero value, month total, and with B also arrears per period, penalties and total due. |
| C/D Liste de afișat | Notice-board table per block: apartment, persons, surface, then **one column per non-empty charge category** (drop columns that are entirely zero so it fits the page), month total, then for D: arrears, penalties, total due. Column totals. Landscape. Footer: the persons/surface bases and tariffs used, `PROGRAM` text and payment deadline. |
| E/F Liste primărie | The same data in the city-hall format (read LP1/LP2 + LP2.FRX for the column order). |
| G Liste simple | Apartment, (name), persons, month total. |
| H Repartizare cheltuieli | Per expense category: invoice total, allocation base, value per unit, and per apartment amounts (LRC). |
| I Situație repartitoare | Per apartment: each allocator's readings, factor, coefficient, units, Gcal unit/surface/final and lei (SCR). |
| J Valori facturi | All association and block invoice amounts entered for the period, with totals, and a check that allocated total = invoiced total (LFA, the biggest report; read it). |
| K Registrul de casă | Cash journal for a date range: opening balance, daily lines, receipts, payments, closing balance per day (CCA). |
| L Bancă | Bank journal for the month with balances (CBA). |
| M Patrimoniu | Assets/liabilities statement (CP1). |
| N Valori în ordine | Apartments sorted ascending by month total (MAX). |
| O Ordine de plată | Print the official payment-order form (ORD). |
| P Convocator | Printable general-assembly notice: date, time, place, agenda (free text), one per apartment or one per block (ADU/ADU2). |
| Centralizare C (IN1) | Collections over a date range, by block/apartment, optionally one apartment: receipt no., date, period paid, category, amount; totals per apartment, block and association. |
| Centralizare D (IN2) | The same, ordered by receipt number, with voided receipts marked. |
| Situații A (SBL) | Per block: apartments, persons, surfaces, meters, modes, invoice totals. |
| B (SAP) | Per apartment: persons and consumption per meter (m³) and Gcal. |
| C (PV) | Blank or pre-filled meter reading sheet per block (old index printed, empty column for the new one). Variants by meter count (PV111…PV232 layouts). |
| D (PVR) | The same for allocators (PVR1–7 by allocator count). |
| E (SRE) | Arrears totals per apartment and block. |
| F (RE1) | Arrears + penalties, detailed per period and category, for a selectable date range (uses the penalty engine at the chosen date). |
| G (CED) | One apartment: every charge item for the period, with allocation base and unit value (explains the bill to the owner). |
| H (LAR_INST) | Arrears list formatted for court filing: owner, apartment, unpaid amount per month, penalties per month with days and rate, totals, signatures. |
| I (SRU) | Working fund per apartment: target `MAX_FR`, billed `CALC_FR`, paid, unpaid. |
| J (SFR) | Repair fund per apartment: billed, paid, unpaid. |
| K (SPE) | Penalties per apartment: computed, booked, paid, unpaid. |
| L (PER) | Persons, surfaces and volumes per block and association (the allocation bases). |
| M (GOT) | Apartments disconnected from heating (CP_IN / percentage 0) together with their arrears. Read GOT.PRG for the exact filter. |
| N (AJU) | Heating-aid statement: per apartment heating energy/value for the social-aid application (read AJU + AJU.FRX). |
| O (LSC) | Printable letters to debtors: owner, apartment, arrears per period, penalties, total, a deadline, the legal text (LSC*.FRX contain the text) and signatures. Threshold filter (minimum amount / minimum months). |
| P (LVE) | Meters with expired metrology. |
| Q (COM) | Per apartment: current period total vs a chosen reference period total, difference and % (and per category if available). |

---

## 6. UX guidelines (modern, fast, simple)
- Main navigation follows the monthly workflow, not the DOS menus: **Luna curentă** (stepper: Date generale → Facturi → Indecși → Calculează → Verifică liste → Publică → Încasări → Închide luna), **Încasări**, **Rapoarte** (searchable catalog of all reports above, grouped Liste / Situații / Financiar), **Blocuri & Apartamente**, **Casă & Bancă**, **Setări**, **Turn de control**.
- Add a global period switcher. Closed periods open read-only with a clear banner.
- Add a command palette (Ctrl+K) with every function name, including the legacy names (e.g. typing "fluturasi" or "TRE" finds the right screen). This helps operators migrating from ORHIDEEA.
- Grids: keyboard-first, sticky headers, instant save, undo on the last change.
- Every computed amount is clickable to show its explanation (formula, base, unit value). This replaces the need for the "Vizualizare valori" expert screens.
- Remove the current "Echivalent FoxPro" labels from section headers once the command palette carries the legacy names (they clutter the UI).

---

## 7. Acceptance and parity tests (mandatory)
1. **Golden-month test.** Import `2026\AUGUST` (or any closed month) inputs (tariffs, invoices, indexes, apartment settings) and run the new engine. Every APART computed field must match the DBF values of that same month folder within ±0.01 lei, and every BLOCURI/ASOC base must match exactly. Run it on at least 3 different months, including a winter month with heating. Produce a diff report per field.
2. **Ledger test.** After importing CHITANTE, the unpaid totals per apartment must equal the FoxPro unpaid totals. Run the penalty engine for a fixed date and compare with legacy RE1/SPE output generated for the same date (ask the user to print RE1 from ORHIDEEA for one block and supply it).
3. **Cycle test.** On a copy of the DB, run publish → 5 receipts (full, partial, global amount, collective, void one) → close → next month. Check: arrears = the previous unpaid amount, receipts restored after the void, cash journal = the sum of cash receipts, indexes rotated, snapshot unchanged after edits.
4. **GOL guard.** Unpublishing a period with a payment must fail.
5. **Performance.** Calculate a 1,000-apartment association in under 1 s. The cashier screen must load in under 150 ms. Report rendering must stay under 1 s.
6. **Security.** Every `/api` route must reject unauthenticated requests. Impersonation must be audit-logged.

---

## 8. Suggested implementation order
1. Schema: periods, ledger, payments, snapshots, audit, users (§4.0, 4.1, G11, G15).
2. Importer for all tables (§4.9). This produces the real data to test against.
3. Calculation engine + golden test (§4.2, §7.1).
4. Data-entry screens for every input the engine needs (§4.3.1–4.3.6).
5. Publish/unpublish, cashier, penalties, void, collective receipts (§4.3.8, 4.4, 4.5).
6. Month close/reopen, backup (§4.6, 4.7).
7. Cash, bank, patrimony, payment orders (§4.3.9).
8. Reports: D, C, A/B, J, K, Centralizare C/D, Situații E/F/G/H/O first (used most), then the rest.
9. UX shell: workflow stepper, command palette, period switcher (§6).
10. Remove obsolete code paths (flat repair fund, `restante`/`penalizari` columns, per-block-only tariffs, the old `repartizeaza` endpoints), or keep them behind the new engine.

## 9. Open questions for the user (ask before implementing the affected parts)
1. Payment allocation order for a single global amount: oldest-first with penalties first within a month (proposed), or another rule?
2. Penalties: booked automatically at publish time, or on demand as in ORHIDEEA?
3. Are all legacy allocation modes really used (allocators `R`, SET surface, `CNS` differences), or can some be hidden behind "advanced"? Recommendation: implement all of them, and hide the unused ones per association.
4. Multi-association support: ASOC has an association code on every table, so the legacy system supports several associations in one install. Should the new app (with the superadmin) be multi-tenant from the start?
5. Should notice-board lists show names (some associations get owner consent) or always hide them?
