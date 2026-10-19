/**
 * tests/e2e/sections_abc_edge_cases.test.js
 *
 * Comprehensive E2E and Edge-Case Test Suite for Sections A, B, and C:
 * - Section A (routes/operatiuni.js):
 *   ACA/ABA inline edit (PUT /casa/:id, PUT /banca/:id), PRINZ (POST /casa/preia-incasari-zi),
 *   INLO (POST /apartamente/batch-inlocuire), CMFR (POST /apartamente/batch-max-fr),
 *   INITL & SCHD (POST /patrimoniu/init-luna, POST /patrimoniu/batch-data),
 *   ACEL (POST /blocuri/batch-termic), EGAL (POST /apartamente/:id/egalizare-indexuri & batch),
 *   and gcal_red_lei -> gcal_red auto-calculation (PUT /apartamente/:id/extins).
 * - Section B (services/reports.js & routes/rapoarte.js):
 *   IN1 & IN2 filters, CED & LAR_INST period range & multi-block filters,
 *   CCA date range, COM proc_tolerat threshold, LSC & LSA zilim/pana_la/borderou_semnaturi,
 *   LFA ordonare/cu_energie_termica/defalcare_lfa, LIP/LIR/LAF/LAR format/cu_energie_termica/termen_plata,
 *   and LVE includeValid toggle.
 * - Section C (services/cashier.js & routes/chitante.js):
 *   PUT & DELETE /datorii/:id, POST /datorii/:id/punnr (F1=PUNNR 2-slot rule),
 *   GET /fonduri-sumar/:apartamentId (FNDRU, FNDRE, FNDPE),
 *   and POST /colectiv (CHO.FXP mod_valoare TOTAL_BLOC + negative storno, mod_numar UNIC vs INCREMENTAL).
 *
 * Uses strictly isolated `:memory:` SQLite databases (`new Database(':memory:')` + `initializeSchema(db)`).
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const express = require('express');
const { initializeSchema } = require('../../db');
const operatiuniRouter = require('../../routes/operatiuni');
const rapoarteRouter = require('../../routes/rapoarte');
const chitanteRouter = require('../../routes/chitante');
const { generateReport } = require('../../services/reports');
const { issueReceipt } = require('../../services/cashier');

async function createIsolatedTestServer() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeSchema(db);

  // Seed baseline association & active period 2026/09
  db.prepare(`
    INSERT OR REPLACE INTO asociatie (
      id, nume, cod_fiscal, administrator, presedinte, adresa,
      banca, cont_bancar, proc_penalizare, zile_penalizare,
      serie_chitante, urmatorul_numar_chitanta, luna_lucru, an_lucru
    ) VALUES (
      1, 'ASOCIATIA ORHIDEEA TEST', 'RO12345678', 'Admin Test', 'Presedinte Test', 'Str. Orhideelor Nr. 1',
      'BCR', 'RO00AAAA1111222233334444', 0.2, 45,
      'ORH', 100, 9, 2026
    )
  `).run();

  db.prepare(`
    INSERT OR REPLACE INTO perioade (
      id, asociatie_id, an, luna, status, ultima_zi, tarif_ar, tarif_ca, proc_ca, tarif_et
    ) VALUES (
      1, 1, 2026, 9, 'DESCHISA', '2026-09-30', 9.48, 9.67, 100, 350.00
    )
  `).run();

  db.prepare(`
    INSERT OR REPLACE INTO general (
      id, perioada_id, an, luna, ultima_zi, tarif_ar, tarif_ca, proc_ca
    ) VALUES (
      1, 1, 2026, 9, '2026-09-30', 9.48, 9.67, 100
    )
  `).run();

  // Seed 2 blocks:
  // Block 1 ('A1'): has hot water (proc_av_ac = 100), tarif_et = 350
  // Block 2 ('A2'): no hot water (proc_av_ac = 0), tarif_et = 350
  const b1Info = db.prepare(`
    INSERT INTO blocuri (
      id, asociatie_id, bloc, strada, numar, total_apartamente,
      proc_av_ac, proc_av_in, ecart_temp, rand_tr, tarif_et,
      ivar, inar, ivac, inac, ivin, inin, constin,
      can_met, gaz, gunoi, curent, curent_sc, curent_li,
      ascensor, sal_tesa, sal_feme, ch_admin, ch_sediu, prest_serv, abonament
    ) VALUES (
      1, 1, 'A1', 'Str. Florilor', '10', 2,
      100, 100, 35, 95, 350.00,
      100, 130, 50, 70, 10, 15, 1.0,
      20, 80, 120, 60, 40, 20,
      40, 100, 80, 50, 30, 25, 15
    )
  `).run();

  const b2Info = db.prepare(`
    INSERT INTO blocuri (
      id, asociatie_id, bloc, strada, numar, total_apartamente,
      proc_av_ac, proc_av_in, ecart_temp, rand_tr, tarif_et,
      ivar, inar, ivac, inac, ivin, inin, constin,
      can_met, gaz, gunoi, curent, curent_sc, curent_li,
      ascensor, sal_tesa, sal_feme, ch_admin, ch_sediu, prest_serv, abonament
    ) VALUES (
      2, 1, 'A2', 'Str. Florilor', '12', 1,
      0, 100, 30, 90, 350.00,
      80, 95, 0, 0, 5, 8, 1.0,
      10, 40, 60, 30, 20, 10,
      20, 50, 40, 25, 15, 10, 10
    )
  `).run();

  // Seed 3 apartments:
  // Apt 1 & Apt 2 in Block A1, Apt 3 in Block A2
  db.prepare(`
    INSERT INTO apartamente (
      id, bloc_id, numar_apart, nume_proprietar, persoane, suprafata, sup_ec_ter,
      iv_ar_bu, in_ar_bu, d_v_ar_bu, ser_ar_bu,
      iv_ar_ba1, in_ar_ba1, d_v_ar_ba1, ser_ar_ba1,
      iv_ar_ba2, in_ar_ba2, d_v_ar_ba2, ser_ar_ba2,
      iv_ac_bu, in_ac_bu, d_v_ac_bu, ser_ac_bu,
      iv_ac_ba1, in_ac_ba1, d_v_ac_ba1, ser_ac_ba1,
      iv_ac_ba2, in_ac_ba2, d_v_ac_ba2, ser_ac_ba2,
      ivin, inin, iv_incalzire, in_incalzire, d_v_inin, ser_inin,
      repar_crt, altele, i, fond_repar, fond_reparatii, ch_box, ch_hav, max_fr, rulment
    ) VALUES
      (
        1, 1, '1', 'Popescu Ion', 2, 50.0, 10.0,
        100, 115, '2025-04-10', 'AR-BU-1',
        50, 55, '2028-11-20', 'AR-BA1-1',
        20, 25, '', 'AR-BA2-1',
        40, 48, '2024-08-01', 'AC-BU-1',
        10, 14, NULL, 'AC-BA1-1',
        0, 5, ' . . ', 'AC-BA2-1',
        12.5, 18.75, 12.5, 18.75, '2029-01-15', 'IN-1',
        10, 5, 2, 20, 20, 8, 4, 100, 15
      ),
      (
        2, 1, '2', 'Ionescu Maria', 3, 65.0, 14.0,
        200, 210, '2025-01-15', 'AR-BU-2',
        80, 90, NULL, 'AR-BA1-2',
        0, 0, NULL, '',
        60, 70, NULL, 'AC-BU-2',
        30, 35, NULL, '',
        0, 0, NULL, '',
        25.0, 30.0, 25.0, 30.0, NULL, 'IN-2',
        12, 6, 3, 25, 25, 0, 0, 120, 20
      ),
      (
        3, 2, '1', 'Georgesccu Dan', 2, 48.0, 9.5,
        150, 162, NULL, 'AR-BU-3',
        40, 44, NULL, '',
        0, 0, NULL, '',
        0, 0, NULL, '',
        0, 0, NULL, '',
        0, 0, NULL, '',
        10.0, 14.0, 10.0, 14.0, NULL, '',
        8, 4, 1, 15, 15, 5, 0, 90, 10
      )
  `).run();

  const app = express();
  app.use(express.json());
  app.locals.db = db;
  app.use('/api/operatiuni', operatiuniRouter);
  app.use('/api/rapoarte', rapoarteRouter);
  app.use('/api/chitante', chitanteRouter);

  const server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  async function request(method, path, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (body !== undefined) {
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`${baseUrl}${path}`, opts);
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (_) {}
    return { status: res.status, body: json, text, headers: res.headers };
  }

  return {
    db,
    server,
    baseUrl,
    request,
    bloc1Id: Number(b1Info.lastInsertRowid),
    bloc2Id: Number(b2Info.lastInsertRowid),
    cleanup() {
      try {
        server.close();
      } catch (_) {}
      try {
        db.close();
      } catch (_) {}
    }
  };
}

// ============================================================================
//  SECTION A: routes/operatiuni.js
// ============================================================================
describe('Section A: Operatiuni Routes & FoxPro Actualizare Parity', () => {
  let env;

  beforeEach(async () => {
    env = await createIsolatedTestServer();
  });

  afterEach(() => {
    env.cleanup();
  });

  it('A.1: PUT /api/operatiuni/casa/:id & PUT /api/operatiuni/banca/:id — valid edit, 404 on non-existent ID, invalid/zero sum rejection', async () => {
    const { request } = env;

    // 1. Create a CASA entry and edit it validly
    const cPost = await request('POST', '/api/operatiuni/casa', {
      document: 'CH-10',
      data: '2026-09-10',
      tip: 'I',
      act_pas: 'A',
      suma: 250.5,
      explicatie: 'Incasare initiala'
    });
    assert.equal(cPost.status, 201);
    const casaId = cPost.body.id;

    const cPut = await request('PUT', `/api/operatiuni/casa/${casaId}`, {
      document: 'DISP-99',
      data: '2026-09-12',
      inc_pla: 'P',
      act_pas: 'P',
      suma: 310.75,
      cheltuiala: 'Plata reparatie usa'
    });
    assert.equal(cPut.status, 200);
    assert.equal(cPut.body.success, true);
    assert.equal(cPut.body.entry.document, 'DISP-99');
    assert.equal(cPut.body.entry.data, '2026-09-12');
    assert.equal(cPut.body.entry.tip, 'P');
    assert.equal(cPut.body.entry.act_pas, 'P');
    assert.equal(cPut.body.entry.suma, 310.75);
    assert.equal(cPut.body.entry.explicatie, 'Plata reparatie usa');

    // CASA 404 on non-existent ID
    const c404 = await request('PUT', '/api/operatiuni/casa/999999', { suma: 100 });
    assert.equal(c404.status, 404);

    // CASA invalid / zero sum rejection
    for (const badSuma of [0, '0', 'invalid_num', '', null, true]) {
      const cBad = await request('PUT', `/api/operatiuni/casa/${casaId}`, { suma: badSuma });
      assert.equal(cBad.status, 400, `Expected 400 for CASA suma=${JSON.stringify(badSuma)}`);
    }

    // CASA empty payload rejection
    const cEmpty = await request('PUT', `/api/operatiuni/casa/${casaId}`, {});
    assert.equal(cEmpty.status, 400);

    // 2. Create a BANCA entry and edit it validly
    const bPost = await request('POST', '/api/operatiuni/banca', {
      document: 'EXT-1',
      data: '2026-09-11',
      tip: 'D',
      act_pas: 'A',
      suma: 1000,
      explicatie: 'Depunere initiala'
    });
    assert.equal(bPost.status, 201);
    const bancaId = bPost.body.id;

    const bPut = await request('PUT', `/api/operatiuni/banca/${bancaId}`, {
      document: 'OP-42',
      data: '2026-09-14',
      dep_vir: 'V',
      act_pas: 'P',
      suma: 845.2,
      cheltuiala: 'Virament furnizor apa'
    });
    assert.equal(bPut.status, 200);
    assert.equal(bPut.body.success, true);
    assert.equal(bPut.body.entry.document, 'OP-42');
    assert.equal(bPut.body.entry.data, '2026-09-14');
    assert.equal(bPut.body.entry.tip, 'V');
    assert.equal(bPut.body.entry.act_pas, 'P');
    assert.equal(bPut.body.entry.suma, 845.2);
    assert.equal(bPut.body.entry.explicatie, 'Virament furnizor apa');

    // BANCA 404 on non-existent ID
    const b404 = await request('PUT', '/api/operatiuni/banca/999999', { suma: 500 });
    assert.equal(b404.status, 404);

    // BANCA invalid / zero sum rejection
    for (const badSuma of [0, '0', 'nan_val', '', null, false]) {
      const bBad = await request('PUT', `/api/operatiuni/banca/${bancaId}`, { suma: badSuma });
      assert.equal(bBad.status, 400, `Expected 400 for BANCA suma=${JSON.stringify(badSuma)}`);
    }

    // BANCA empty payload rejection
    const bEmpty = await request('PUT', `/api/operatiuni/banca/${bancaId}`, {});
    assert.equal(bEmpty.status, 400);
  });

  it('A.2: POST /api/operatiuni/casa/preia-incasari-zi (PRINZ) — sums active payments (ISO & DD.MM.YYYY), ignores cancelled receipts, duplicate guard, and 0-collection date', async () => {
    const { db, request } = env;

    // Seed debt rows for Apt 1 and Apt 2
    db.prepare(`
      INSERT INTO datorii (id, apartament_id, bloc_id, an, luna, categorie, valoare, sursa)
      VALUES
        (10, 1, 1, 2026, 8, 'R', 300, 'IMPORT'),
        (11, 2, 1, 2026, 8, 'R', 400, 'IMPORT')
    `).run();

    // Insert 2 active receipts and 1 cancelled receipt on 2026-09-18
    db.prepare(`
      INSERT INTO chitante (id, serie, numar, data_emiterii, apartament_id, bloc_id, perioada_id, suma, anulata)
      VALUES
        (101, 'ORH', 101, '2026-09-18', 1, 1, 1, 120.50, 0),
        (102, 'ORH', 102, '18.09.2026', 2, 1, 1, 79.50, 0),
        (103, 'ORH', 103, '2026-09-18', 1, 1, 1, 500.00, 1)
    `).run();

    db.prepare(`
      INSERT INTO plati (datorie_id, chitanta_id, suma, data, sursa)
      VALUES
        (10, 101, 120.50, '2026-09-18', 'CASA'),
        (11, 102, 79.50, '18.09.2026', 'CASA'),
        (10, 103, 500.00, '2026-09-18', 'CASA')
    `).run();

    // 1. First call with YYYY-MM-DD creates the INC-ZI row with sum = 120.50 + 79.50 = 200.00 (cancelled 500 ignored)
    const r1 = await request('POST', '/api/operatiuni/casa/preia-incasari-zi', {
      data: '2026-09-18',
      overwrite: false
    });
    assert.equal(r1.status, 200);
    assert.equal(r1.body.success, true);
    assert.equal(r1.body.alreadyExists, false);
    assert.equal(r1.body.suma, 200.00);
    assert.equal(r1.body.entry.explicatie, 'INCASARILE ZILEI DE 18.09.2026');

    // 2. Duplicate guard: calling a second time with DD.MM.YYYY and overwrite: false returns { alreadyExists: true }
    const r2 = await request('POST', '/api/operatiuni/casa/preia-incasari-zi', {
      data: '18.09.2026',
      overwrite: false
    });
    assert.equal(r2.status, 200);
    assert.equal(r2.body.alreadyExists, true);
    assert.equal(r2.body.suma, 200.00);
    const countAfterGuard = db.prepare("SELECT COUNT(*) AS cnt FROM casa WHERE document = 'INC-ZI'").get().cnt;
    assert.equal(countAfterGuard, 1, 'Duplicate guard must not insert a second row');

    // 3. Add another active payment of 50.00 on 2026-09-18 and call with overwrite: true
    db.prepare(`
      INSERT INTO chitante (id, serie, numar, data_emiterii, apartament_id, bloc_id, perioada_id, suma, anulata)
      VALUES (104, 'ORH', 104, '2026-09-18', 1, 1, 1, 50.00, 0)
    `).run();
    db.prepare(`
      INSERT INTO plati (datorie_id, chitanta_id, suma, data, sursa)
      VALUES (10, 104, 50.00, '2026-09-18', 'CASA')
    `).run();

    const r3 = await request('POST', '/api/operatiuni/casa/preia-incasari-zi', {
      data: '18.09.2026',
      overwrite: true
    });
    assert.equal(r3.status, 200);
    assert.equal(r3.body.success, true);
    assert.equal(r3.body.alreadyExists, false);
    assert.equal(r3.body.overwritten, true);
    assert.equal(r3.body.suma, 250.00);
    const rowsAfterOverwrite = db.prepare("SELECT * FROM casa WHERE document = 'INC-ZI'").all();
    assert.equal(rowsAfterOverwrite.length, 1, 'Overwrite must replace existing row cleanly without duplication');
    assert.equal(rowsAfterOverwrite[0].suma, 250.00);

    // 4. Edge case: calling on a date with 0 collections returns { success: true, suma: 0 }
    const rZero = await request('POST', '/api/operatiuni/casa/preia-incasari-zi', {
      data: '2026-09-01'
    });
    assert.equal(rZero.status, 200);
    assert.equal(rZero.body.success, true);
    assert.equal(rZero.body.suma, 0);
  });

  it('A.3: POST /api/operatiuni/apartamente/batch-inlocuire (INLO) — scope BLOC vs TOATE and partial field selection', async () => {
    const { db, request, bloc1Id } = env;

    // 1. Scope 'BLOC' with partial field selection via `enabled` map
    const resBloc = await request('POST', '/api/operatiuni/apartamente/batch-inlocuire', {
      scope: 'BLOC',
      bloc_id: bloc1Id,
      repar_crt: 45.5,
      altele: 99.0,
      i: 77.0,
      fond_repar: 60.0,
      enabled: {
        repar_crt: true,
        altele: false,
        i: false,
        fond_repar: true
      }
    });
    assert.equal(resBloc.status, 200);
    assert.equal(resBloc.body.success, true);
    assert.equal(resBloc.body.scope, 'BLOC');
    assert.equal(resBloc.body.updatedCount, 2);

    const apt1 = db.prepare('SELECT * FROM apartamente WHERE id = 1').get();
    const apt2 = db.prepare('SELECT * FROM apartamente WHERE id = 2').get();
    const apt3 = db.prepare('SELECT * FROM apartamente WHERE id = 3').get();

    // Block 1 apartments updated ONLY on repar_crt and fond_repar; altele and i untouched!
    assert.equal(apt1.repar_crt, 45.5);
    assert.equal(apt1.fond_repar, 60.0);
    assert.equal(apt1.altele, 5, 'Disabled field altele must remain untouched on Apt 1');
    assert.equal(apt1.i, 2, 'Disabled field i must remain untouched on Apt 1');

    assert.equal(apt2.repar_crt, 45.5);
    assert.equal(apt2.fond_repar, 60.0);
    assert.equal(apt2.altele, 6, 'Disabled field altele must remain untouched on Apt 2');

    // Block 2 apartment (apt3) completely untouched
    assert.equal(apt3.repar_crt, 8);
    assert.equal(apt3.fond_repar, 15);

    // 2. Scope 'TOATE' updates all 3 apartments in the association on the provided field
    const resToate = await request('POST', '/api/operatiuni/apartamente/batch-inlocuire', {
      scope: 'TOATE',
      altele: 33.25
    });
    assert.equal(resToate.status, 200);
    assert.equal(resToate.body.scope, 'TOATE');
    assert.equal(resToate.body.updatedCount, 3);

    const allApts = db.prepare('SELECT id, altele, repar_crt FROM apartamente ORDER BY id').all();
    assert.deepEqual(allApts.map(a => a.altele), [33.25, 33.25, 33.25]);
    // Unspecified fields remain preserved
    assert.deepEqual(allApts.map(a => a.repar_crt), [45.5, 45.5, 8]);

    // 3. Edge cases: no fields enabled -> 400; non-existent block -> 404
    const resNoFields = await request('POST', '/api/operatiuni/apartamente/batch-inlocuire', {
      scope: 'TOATE',
      repar_crt: 10,
      enabled: { repar_crt: false }
    });
    assert.equal(resNoFields.status, 400);

    const resBadBloc = await request('POST', '/api/operatiuni/apartamente/batch-inlocuire', {
      scope: 'BLOC',
      bloc_id: 9999,
      repar_crt: 10
    });
    assert.equal(resBadBloc.status, 404);
  });

  it('A.4: POST /api/operatiuni/apartamente/batch-max-fr (CMFR) — computes max_fr from apartamente_luna excluding repar_crt and rulment, 404 on missing period', async () => {
    const { db, request } = env;

    // Seed reference period 2026/08 and apartamente_luna snapshots with known values
    const p8Info = db.prepare(`
      INSERT INTO perioade (asociatie_id, an, luna, status, ultima_zi)
      VALUES (1, 2026, 8, 'INCHISA', '2026-08-31')
    `).run();
    const p8Id = Number(p8Info.lastInsertRowid);

    // For Apt 1: eligible components sum to 185.50, while repar_crt = 500 and rulment = 300 and fond_repar = 200 (must be excluded!)
    db.prepare(`
      INSERT INTO apartamente_luna (
        perioada_id, apartament_id, bloc_id, an, luna, bloc, numar_apart,
        apa_rece, can_mnj, can_met, apa_calda, incalzire, gaz, gunoi, curent,
        ascensor, sal_feme, sal_tesa, chelt_inc, ch_admin, ch_sediu, prest_serv,
        difarar, altele, difarac, difcanar, difcanac, difetac, difetin,
        abonament, ch_box, ch_hav, i,
        repar_crt, rulment, fond_repar, total_luna
      ) VALUES (
        ?, 1, 1, 2026, 8, 'A1', '1',
        20, 10, 5, 30, 40, 10, 15, 8,
        7, 6, 12, 2, 4, 3, 1.5,
        1, 2, 0.5, 0.5, 0.5, 1, 1,
        2, 2, 1, 0.5,
        500, 300, 200, 1185.50
      )
    `).run(p8Id);

    const res = await request('POST', '/api/operatiuni/apartamente/batch-max-fr', {
      ref_an: 2026,
      ref_luna: 8,
      bloc_id: 1
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.updatedCount, 1);
    assert.equal(res.body.missingApartments.length, 1, 'Apt 2 had no snapshot in 2026/08 so it is reported in missingApartments');

    const apt1 = db.prepare('SELECT max_fr, max_fond_rulment FROM apartamente WHERE id = 1').get();
    // Exact sum of the 26 eligible columns:
    // 20+10+5+30+40+10+15+8 + 7+6+12+2+4+3+1.5 + 1+2+0.5+0.5+0.5+1+1 + 2+2+1+0.5 = 185.50
    assert.equal(apt1.max_fr, 185.5);
    assert.equal(apt1.max_fond_rulment, 185.5);

    // Edge case: non-existent reference period returns 404
    const res404 = await request('POST', '/api/operatiuni/apartamente/batch-max-fr', {
      ref_an: 2021,
      ref_luna: 3
    });
    assert.equal(res404.status, 404);

    // Edge case: missing ref_an / ref_luna returns 400
    const res400 = await request('POST', '/api/operatiuni/apartamente/batch-max-fr', {});
    assert.equal(res400.status, 400);
  });

  it('A.5: POST /api/operatiuni/patrimoniu/init-luna (INITL) & batch-data (SCHD) — copies previous month, rolls forward perioada & data_pres, respects overwrite:false', async () => {
    const { db, request } = env;

    // Create period 2026/08 (previous month) and 2026/07 (two months prior)
    const p7Info = db.prepare(`
      INSERT INTO perioade (asociatie_id, an, luna, status, ultima_zi)
      VALUES (1, 2026, 7, 'INCHISA', '2026-07-31')
    `).run();
    const p8Info = db.prepare(`
      INSERT INTO perioade (asociatie_id, an, luna, status, ultima_zi)
      VALUES (1, 2026, 8, 'INCHISA', '2026-08-31')
    `).run();
    const p8Id = Number(p8Info.lastInsertRowid);

    // Seed patrimoniu rows in 2026/08 referencing AUGUST 2026 / 2026-08-31 and IULIE 2026 / 31.07.2026
    db.prepare(`
      INSERT INTO patrimoniu (perioada_id, asoc, document, data, suma, act_pas, explicatie, perioada, data_pres)
      VALUES
        (?, 'ASOC TEST', 'DOC-A1', '2026-08-31', 5000, 'A', 'Sold casa', 'AUGUST 2026', '2026-08-31'),
        (?, 'ASOC TEST', 'DOC-P1', '2026-08-31', 5000, 'P', 'Restante', 'IULIE 2026', '31.07.2026')
    `).run(p8Id, p8Id);

    // 1. Call init-luna for active period 2026/09 (perioada_id = 1)
    const init1 = await request('POST', '/api/operatiuni/patrimoniu/init-luna', {
      perioada_id: 1,
      overwrite: false
    });
    assert.equal(init1.status, 200);
    assert.equal(init1.body.success, true);
    assert.equal(init1.body.alreadyInitialized, false);
    assert.equal(init1.body.count, 2);

    const rowsA = init1.body.rows.find(r => r.act_pas === 'A');
    const rowsP = init1.body.rows.find(r => r.act_pas === 'P');
    assert.equal(rowsA.data, '2026-09-30');
    assert.equal(rowsA.perioada, 'SEPTEMBRIE 2026', 'AUGUST 2026 must roll forward to SEPTEMBRIE 2026');
    assert.equal(rowsA.data_pres, '2026-09-30', '2026-08-31 must roll forward to 2026-09-30');
    assert.equal(rowsP.perioada, 'AUGUST 2026', 'IULIE 2026 must roll forward to AUGUST 2026');
    assert.equal(rowsP.data_pres, '31.08.2026', '31.07.2026 must roll forward to 31.08.2026');

    // 2. Call init-luna again with overwrite: false -> returns alreadyInitialized: true without duplicating
    const initGuard = await request('POST', '/api/operatiuni/patrimoniu/init-luna', {
      perioada_id: 1,
      overwrite: false
    });
    assert.equal(initGuard.status, 200);
    assert.equal(initGuard.body.alreadyInitialized, true);
    assert.equal(initGuard.body.alreadyExists, true);
    assert.equal(initGuard.body.count, 2);

    // 3. Call batch-data (SCHD) with DD.MM.YYYY format to update all rows in period 1
    const schd = await request('POST', '/api/operatiuni/patrimoniu/batch-data', {
      perioada_id: 1,
      data: '28.09.2026'
    });
    assert.equal(schd.status, 200);
    assert.equal(schd.body.success, true);
    assert.equal(schd.body.data, '2026-09-28');
    assert.equal(schd.body.updatedCount, 2);
    assert.ok(schd.body.rows.every(r => r.data === '2026-09-28'));

    // Edge case: batch-data without `data` returns 400
    const schdBad = await request('POST', '/api/operatiuni/patrimoniu/batch-data', { perioada_id: 1 });
    assert.equal(schdBad.status, 400);
  });

  it('A.6: POST /api/operatiuni/blocuri/batch-termic (ACEL) — updates only blocks with proc_av_ac != 0 by default, and all blocks when only_with_hot_water: false', async () => {
    const { db, request } = env;

    // Default (only_with_hot_water: true) -> updates Block 1 (proc_av_ac=100), skips Block 2 (proc_av_ac=0)
    const rDefault = await request('POST', '/api/operatiuni/blocuri/batch-termic', {
      ecart_temp: 42.5,
      rand_tr: 98.5
    });
    assert.equal(rDefault.status, 200);
    assert.equal(rDefault.body.success, true);
    assert.equal(rDefault.body.only_with_hot_water, true);
    assert.equal(rDefault.body.updatedCount, 1);

    const b1After1 = db.prepare('SELECT ecart_temp, rand_tr FROM blocuri WHERE id = 1').get();
    const b2After1 = db.prepare('SELECT ecart_temp, rand_tr FROM blocuri WHERE id = 2').get();
    assert.equal(b1After1.ecart_temp, 42.5);
    assert.equal(b1After1.rand_tr, 98.5);
    assert.equal(b2After1.ecart_temp, 30, 'Block 2 with proc_av_ac=0 must not be updated by default');
    assert.equal(b2After1.rand_tr, 90);

    // Explicit only_with_hot_water: false -> updates both Block 1 and Block 2
    const rAll = await request('POST', '/api/operatiuni/blocuri/batch-termic', {
      ecart_temp: 45.0,
      rand_tr: 99.0,
      only_with_hot_water: false
    });
    assert.equal(rAll.status, 200);
    assert.equal(rAll.body.only_with_hot_water, false);
    assert.equal(rAll.body.updatedCount, 2);

    const b2After2 = db.prepare('SELECT ecart_temp, rand_tr FROM blocuri WHERE id = 2').get();
    assert.equal(b2After2.ecart_temp, 45.0);
    assert.equal(b2After2.rand_tr, 99.0);

    // Edge case: missing both ecart_temp and rand_tr returns 400
    const rBad = await request('POST', '/api/operatiuni/blocuri/batch-termic', {});
    assert.equal(rBad.status, 400);
  });

  it('A.7: POST /api/operatiuni/apartamente/:id/egalizare-indexuri & /batch-egalizare-indexuri (EGAL) — sets in_* = iv_* across all water/heating meters', async () => {
    const { db, request } = env;

    // 1. Single apartment equalization on Apt 1
    const rSingle = await request('POST', '/api/operatiuni/apartamente/1/egalizare-indexuri');
    assert.equal(rSingle.status, 200);
    assert.equal(rSingle.body.success, true);

    const a1 = rSingle.body.apartament;
    assert.equal(a1.in_ar_bu, a1.iv_ar_bu);
    assert.equal(a1.in_ar_ba1, a1.iv_ar_ba1);
    assert.equal(a1.in_ar_ba2, a1.iv_ar_ba2);
    assert.equal(a1.in_ac_bu, a1.iv_ac_bu);
    assert.equal(a1.in_ac_ba1, a1.iv_ac_ba1);
    assert.equal(a1.in_ac_ba2, 0, 'When iv_ac_ba2 is 0, in_ac_ba2 must become 0');
    assert.equal(a1.inin, a1.ivin);
    assert.equal(a1.in_incalzire, a1.iv_incalzire);

    // Apt 2 still has unequalized indices
    const a2Before = db.prepare('SELECT iv_ar_bu, in_ar_bu FROM apartamente WHERE id = 2').get();
    assert.notEqual(a2Before.in_ar_bu, a2Before.iv_ar_bu);

    // 2. Batch equalization across all apartments (TOATE)
    const rBatch = await request('POST', '/api/operatiuni/apartamente/batch-egalizare-indexuri', {
      scope: 'TOATE'
    });
    assert.equal(rBatch.status, 200);
    assert.equal(rBatch.body.updatedCount, 3);

    const allApts = db.prepare('SELECT * FROM apartamente').all();
    for (const apt of allApts) {
      assert.equal(apt.in_ar_bu, apt.iv_ar_bu);
      assert.equal(apt.in_ar_ba1, apt.iv_ar_ba1);
      assert.equal(apt.in_ar_ba2, apt.iv_ar_ba2);
      assert.equal(apt.in_ac_bu, apt.iv_ac_bu);
      assert.equal(apt.in_ac_ba1, apt.iv_ac_ba1);
      assert.equal(apt.in_ac_ba2, apt.iv_ac_ba2);
      assert.equal(apt.inin, apt.ivin);
      assert.equal(apt.in_incalzire, apt.iv_incalzire);
    }

    // Edge cases: 404 on non-existent apartment or block
    const r404Apt = await request('POST', '/api/operatiuni/apartamente/9999/egalizare-indexuri');
    assert.equal(r404Apt.status, 404);

    const r404Bloc = await request('POST', '/api/operatiuni/apartamente/batch-egalizare-indexuri', {
      scope: 'BLOC',
      bloc_id: 9999
    });
    assert.equal(r404Bloc.status, 404);
  });

  it('A.8: PUT /api/operatiuni/apartamente/:id/extins with gcal_red_lei — divides gcal_red_lei by tarif_et to 4 decimals', async () => {
    const { request } = env;

    // Block 1 has tarif_et = 350.00. Passing gcal_red_lei = 100 -> 100 / 350 = 0.285714... -> 0.2857
    const res1 = await request('PUT', '/api/operatiuni/apartamente/1/extins', {
      gcal_red_lei: 100
    });
    assert.equal(res1.status, 200);
    assert.equal(res1.body.success, true);
    assert.equal(res1.body.apartament.gcal_red, 0.2857);

    // Passing explicit tarif_et = 400 and gcal_red_lei = 123.45 -> 123.45 / 400 = 0.308625 -> 0.3086
    const res2 = await request('PUT', '/api/operatiuni/apartamente/1/extins', {
      gcal_red_lei: 123.45,
      tarif_et: 400
    });
    assert.equal(res2.status, 200);
    assert.equal(res2.body.apartament.gcal_red, 0.3086);
  });
});

// ============================================================================
//  SECTION B: services/reports.js & routes/rapoarte.js
// ============================================================================
describe('Section B: Reports Engine & Query Filters (IN1, IN2, CED, LAR_INST, CCA, COM, LSC/LSA, LFA, LIP/LIR/LAF/LAR, LVE)', () => {
  let env;

  beforeEach(async () => {
    env = await createIsolatedTestServer();
    const { db } = env;

    // Seed multi-month snapshots in apartamente_luna for CED & COM (months 6, 7, 8 of 2026)
    const p6 = Number(db.prepare("INSERT INTO perioade (asociatie_id, an, luna, status, ultima_zi) VALUES (1, 2026, 6, 'INCHISA', '2026-06-30')").run().lastInsertRowid);
    const p7 = Number(db.prepare("INSERT INTO perioade (asociatie_id, an, luna, status, ultima_zi) VALUES (1, 2026, 7, 'INCHISA', '2026-07-31')").run().lastInsertRowid);
    const p8 = Number(db.prepare("INSERT INTO perioade (asociatie_id, an, luna, status, ultima_zi) VALUES (1, 2026, 8, 'INCHISA', '2026-08-31')").run().lastInsertRowid);

    db.prepare(`
      INSERT INTO apartamente_luna (perioada_id, apartament_id, bloc_id, an, luna, bloc, numar_apart, nume_proprietar, apa_rece, total_luna)
      VALUES
        (?, 1, 1, 2026, 6, 'A1', '1', 'Popescu Ion', 30, 150.00),
        (?, 1, 1, 2026, 7, 'A1', '1', 'Popescu Ion', 35, 175.00),
        (?, 1, 1, 2026, 8, 'A1', '1', 'Popescu Ion', 40, 200.00),
        (?, 2, 1, 2026, 8, 'A1', '2', 'Ionescu Maria', 50, 500.00),
        (?, 3, 2, 2026, 8, 'A2', '1', 'Georgescu Dan', 45, 300.00)
    `).run(p6, p7, p8, p8, p8);

    // Seed debts across multiple months & categories for IN1, IN2, LAR_INST, LSC/LSA
    db.prepare(`
      INSERT INTO datorii (id, apartament_id, bloc_id, an, luna, luna_text, categorie, valoare, sursa)
      VALUES
        (1, 1, 1, 2026, 5, 'MAI', 'R', 100.00, 'IMPORT'),
        (2, 1, 1, 2026, 5, 'MAI', 'F', 30.00, 'IMPORT'),
        (3, 1, 1, 2026, 7, 'IULIE', 'A', 50.00, 'IMPORT'),
        (4, 2, 1, 2026, 6, 'IUNIE', 'R', 200.00, 'IMPORT'),
        (5, 2, 1, 2026, 8, 'AUGUST', 'R', 150.00, 'IMPORT'),
        (6, 3, 2, 2026, 5, 'MAI', 'R', 120.00, 'IMPORT'),
        (7, 3, 2, 2026, 5, 'MAI', 'P', 15.00, 'PENALTY')
    `).run();

    // Seed receipts & payments on different dates for IN1, IN2, and LSC zilim cutoff
    // Receipt #202 on 2026-09-05 for Apt 2 (Block A1, Cat R, 80 RON)
    // Receipt #201 on 2026-09-12 for Apt 1 (Block A1, Cat F, 30 RON)
    // Receipt #203 on 2026-09-25 for Apt 3 (Block A2, Cat P, 15 RON)
    db.prepare(`
      INSERT INTO chitante (id, serie, numar, data_emiterii, apartament_id, bloc_id, perioada_id, suma, anulata)
      VALUES
        (202, 'ORH', 202, '2026-09-05', 2, 1, 1, 80.00, 0),
        (201, 'ORH', 201, '2026-09-12', 1, 1, 1, 30.00, 0),
        (203, 'ORH', 203, '2026-09-25', 3, 2, 1, 15.00, 0)
    `).run();

    db.prepare(`
      INSERT INTO plati (datorie_id, chitanta_id, suma, data, sursa)
      VALUES
        (4, 202, 80.00, '2026-09-05', 'CASA'),
        (2, 201, 30.00, '2026-09-12', 'CASA'),
        (7, 203, 15.00, '2026-09-25', 'CASA')
    `).run();

    // Seed CASA rows on different dates for CCA
    db.prepare(`
      INSERT INTO casa (perioada_id, asoc, document, data, suma, tip, act_pas, explicatie)
      VALUES
        (1, 'ASOC TEST', 'CH-202', '2026-09-05', 80.00, 'I', 'A', 'Incasare 5 sept'),
        (1, 'ASOC TEST', 'DISP-1', '2026-09-10', 25.00, 'P', 'A', 'Plata consumabile'),
        (1, 'ASOC TEST', 'CH-201', '2026-09-12', 30.00, 'I', 'A', 'Incasare 12 sept'),
        (1, 'ASOC TEST', 'CH-203', '2026-09-25', 15.00, 'I', 'A', 'Incasare 25 sept')
    `).run();
  });

  afterEach(() => {
    env.cleanup();
  });

  it('B.1: IN1 & IN2 — date range (data_inceput..data_sfarsit), block/apartment filter, category filter (R, F, A, P), and sort order', async () => {
    const { request } = env;

    // 1. Unfiltered IN1 vs IN2 ordering:
    // IN1 orders by bloc ASC, apart ASC, numar ASC -> Apt 1 (#201), Apt 2 (#202), Block A2 Apt 1 (#203)
    // IN2 orders by numar ASC -> #201, #202, #203
    const in1All = await request('GET', '/api/rapoarte/IN1');
    assert.equal(in1All.status, 200);
    assert.deepEqual(
      in1All.body.rows.map(r => `${r.bloc}:${r.apart}:${r.numar_chitanta}`),
      ['A1:1:ORH-00201', 'A1:2:ORH-00202', 'A2:1:ORH-00203']
    );

    const in2All = await request('GET', '/api/rapoarte/IN2');
    assert.equal(in2All.status, 200);
    assert.deepEqual(
      in2All.body.rows.map(r => r.numar_chitanta),
      ['ORH-00201', 'ORH-00202', 'ORH-00203']
    );

    // 2. Date range filter (2026-09-01 .. 2026-09-15) excludes 2026-09-25
    const in1Range = await request('GET', '/api/rapoarte/IN1?data_inceput=2026-09-01&data_sfarsit=2026-09-15');
    assert.equal(in1Range.body.rows.length, 2);
    assert.ok(in1Range.body.rows.every(r => r.data <= '2026-09-15'));

    // 3. Block & apartment filter
    const in1BlocA1Apt2 = await request('GET', '/api/rapoarte/IN1?bloc=A1&apart=2');
    assert.equal(in1BlocA1Apt2.body.rows.length, 1);
    assert.equal(in1BlocA1Apt2.body.rows[0].numar_chitanta, 'ORH-00202');

    // 4. Category filter (R, F, P, A)
    const in2CatF = await request('GET', '/api/rapoarte/IN2?categorie=F');
    assert.equal(in2CatF.body.rows.length, 1);
    assert.equal(in2CatF.body.rows[0].categorie, 'F');
    assert.equal(in2CatF.body.rows[0].suma, 30.00);

    const in2CatP = await request('GET', '/api/rapoarte/IN2?categorie=P');
    assert.equal(in2CatP.body.rows.length, 1);
    assert.equal(in2CatP.body.rows[0].categorie, 'P');
    assert.equal(in2CatP.body.rows[0].suma, 15.00);

    const in2CatA = await request('GET', '/api/rapoarte/IN2?categorie=A');
    assert.equal(in2CatA.body.rows.length, 0);
  });

  it('B.2: CED & LAR_INST — period range (data_inceput..data_sfarsit) and multi-block filter (blocuri)', async () => {
    const { request } = env;

    // 1. CED for Apt 1 with period range 2026-07 .. 2026-08 (excludes 2026-06)
    const cedRange = await request('GET', '/api/rapoarte/CED?apartament_id=1&data_inceput=2026-07&data_sfarsit=2026-08');
    assert.equal(cedRange.status, 200);
    assert.equal(cedRange.body.rows.length, 2);
    assert.deepEqual(cedRange.body.rows.map(r => `${r.an}-${r.luna}`), ['2026-8', '2026-7']);

    // 2. LAR_INST with multi-block filter & period range
    const larInstA1 = await request('GET', '/api/rapoarte/LAR_INST?blocuri=A1&data_inceput=2026-06&data_sfarsit=2026-08&target_date=2026-10-20');
    assert.equal(larInstA1.status, 200);
    assert.ok(larInstA1.body.rows.length > 0);
    assert.ok(larInstA1.body.rows.every(r => r.bloc === 'A1'), 'Must only include Block A1');
    assert.ok(larInstA1.body.rows.every(r => r.luna >= 6 && r.luna <= 8), 'Must only include periods 2026/06..2026/08');

    const larInstBoth = await request('GET', '/api/rapoarte/LAR_INST?blocuri=A1,A2&target_date=2026-10-20');
    const blocksInBoth = new Set(larInstBoth.body.rows.map(r => r.bloc));
    assert.ok(blocksInBoth.has('A1') && blocksInBoth.has('A2'), 'Multi-block filter A1,A2 must return rows from both blocks');
  });

  it('B.3: CCA — date range (data_inceput..data_sfarsit) filtering and running balance calculation', async () => {
    const { request } = env;

    const cca = await request('GET', '/api/rapoarte/CCA?data_inceput=2026-09-08&data_sfarsit=2026-09-15&sold_initial=100');
    assert.equal(cca.status, 200);
    // Row 0 is SOLD ZIUA PRECEDENTA (100), Row 1 is 2026-09-10 Plata 25 (sold 75), Row 2 is 2026-09-12 Incasare 30 (sold 105)
    assert.equal(cca.body.rows.length, 3);
    assert.equal(cca.body.rows[0].explicatie, 'SOLD ZIUA PRECEDENTA');
    assert.equal(cca.body.rows[0].sold, 100.00);
    assert.equal(cca.body.rows[1].data, '2026-09-10');
    assert.equal(cca.body.rows[1].plata, 25.00);
    assert.equal(cca.body.rows[1].sold, 75.00);
    assert.equal(cca.body.rows[2].data, '2026-09-12');
    assert.equal(cca.body.rows[2].incasare, 30.00);
    assert.equal(cca.body.rows[2].sold, 105.00);
  });

  it('B.4: COM — proc_tolerat threshold filtering out small variations and keeping variations exceeding ±proc_tolerat%', async () => {
    const { db, request } = env;

    // Reference month 2026/08 has:
    // Apt 1: total_luna = 200.00
    // Apt 2: total_luna = 500.00
    // Apt 3: total_luna = 300.00
    // First get baseline COM with proc_tolerat = 0 to see current calculated totals for 2026/09
    const comBase = generateReport(db, 'COM', { ref_an: 2026, ref_luna: 8, proc_tolerat: 0 });
    assert.equal(comBase.rows.length, 3);

    // Set 2026/08 reference totals so that:
    // Apt 1 has a +2% variation (within ±10% tolerance -> filtered out when proc_tolerat=10)
    // Apt 2 has a +50% variation (exceeds +10% -> kept)
    // Apt 3 has a -40% variation (exceeds -10% -> kept)
    const cur1 = comBase.rows.find(r => r.bloc === 'A1' && String(r.apart) === '1').total_curent;
    const cur2 = comBase.rows.find(r => r.bloc === 'A1' && String(r.apart) === '2').total_curent;
    const cur3 = comBase.rows.find(r => r.bloc === 'A2' && String(r.apart) === '1').total_curent;

    db.prepare("UPDATE apartamente_luna SET total_luna = ? WHERE an = 2026 AND luna = 8 AND bloc = 'A1' AND numar_apart = '1'").run(
      Number((cur1 / 1.02).toFixed(2))
    );
    db.prepare("UPDATE apartamente_luna SET total_luna = ? WHERE an = 2026 AND luna = 8 AND bloc = 'A1' AND numar_apart = '2'").run(
      Number((cur2 / 1.50).toFixed(2))
    );
    db.prepare("UPDATE apartamente_luna SET total_luna = ? WHERE an = 2026 AND luna = 8 AND bloc = 'A2' AND numar_apart = '1'").run(
      Number((cur3 / 0.60).toFixed(2))
    );

    const comFiltered = await request('GET', '/api/rapoarte/COM?ref_an=2026&ref_luna=8&proc_tolerat=10');
    assert.equal(comFiltered.status, 200);
    assert.equal(comFiltered.body.meta.proc_tolerat, 10);
    assert.equal(comFiltered.body.rows.length, 2, 'Apt 1 (~2% variation) must be filtered out by proc_tolerat=10');
    assert.ok(comFiltered.body.rows.every(r => Math.abs(r.procent_variatie) > 10));
    assert.ok(comFiltered.body.rows.some(r => r.procent_variatie > 10), 'Must keep positive variation > +10%');
    assert.ok(comFiltered.body.rows.some(r => r.procent_variatie < -10), 'Must keep negative variation < -10%');
  });

  it('B.5: LSC & LSA — zilim payment cutoff date, pana_la_an/pana_la_luna, and varianta=LSA returning borderou_semnaturi', async () => {
    const { request } = env;

    // Apt 1 has debts: 2026/05 R=100, 2026/05 F=30, 2026/07 A=50.
    // Apt 1 paid F=30 on 2026-09-12.
    // 1. With zilim=2026-09-10 (before payment on 2026-09-12), Apt 1's payment of 30 is ignored -> restanta = 100 + 30 + 50 = 180.
    const lscBeforePay = await request('GET', '/api/rapoarte/LSC?apartament_id=1&zilim=2026-09-10&target_date=2026-10-20');
    assert.equal(lscBeforePay.status, 200);
    assert.equal(lscBeforePay.body.rows[0].restanta, 180.00);

    // 2. With zilim=2026-09-15 (after payment on 2026-09-12), Apt 1's payment of 30 is counted -> restanta = 100 + 0 + 50 = 150.
    const lscAfterPay = await request('GET', '/api/rapoarte/LSC?apartament_id=1&zilim=2026-09-15&target_date=2026-10-20');
    assert.equal(lscAfterPay.status, 200);
    assert.equal(lscAfterPay.body.rows[0].restanta, 150.00);

    // 3. With pana_la_an=2026 & pana_la_luna=5 (and zilim=2026-09-15), 2026/07 debt (A=50) is excluded -> restanta = 100.
    const lscCutoffPeriod = await request(
      'GET',
      '/api/rapoarte/LSC?apartament_id=1&zilim=2026-09-15&pana_la_an=2026&pana_la_luna=5&target_date=2026-10-20'
    );
    assert.equal(lscCutoffPeriod.status, 200);
    assert.equal(lscCutoffPeriod.body.rows[0].restanta, 100.00);

    // 4. varianta=LSA (or /api/rapoarte/LSA) returns borderou_semnaturi and signature columns
    const lsa = await request('GET', '/api/rapoarte/LSC?varianta=LSA&target_date=2026-10-20');
    assert.equal(lsa.status, 200);
    assert.equal(lsa.body.frx, 'LSA.FRX');
    assert.equal(lsa.body.meta.varianta, 'LSA');
    assert.ok(Array.isArray(lsa.body.meta.borderou_semnaturi));
    assert.equal(lsa.body.meta.borderou_semnaturi.length, lsa.body.rows.length);
    assert.ok(lsa.body.columns.some(c => c.key === 'semnatura'));
  });

  it('B.6: LFA — ordonare=BLOC vs SERVICIU, cu_energie_termica=2 hiding thermal rows, and defalcare_lfa metadata', async () => {
    const { request } = env;

    // 1. Default ordonare=SERVICIU with thermal rows included (15 categories)
    const lfaServ = await request(
      'GET',
      '/api/rapoarte/LFA?ordonare=SERVICIU&m11=100&m12=50&m21=30&m22=20&m31=15&m32=25&mchb=Chelt%20Birotica&nota1=Nota%20Test'
    );
    assert.equal(lfaServ.status, 200);
    assert.equal(lfaServ.body.meta.ordonare, 'SERVICIU');
    assert.equal(lfaServ.body.meta.cu_energie_termica, true);
    assert.equal(lfaServ.body.rows.length, 15);
    assert.ok(!lfaServ.body.columns.some(c => c.key === 'bloc'));
    assert.equal(lfaServ.body.meta.defalcare_lfa.total_salarii, 150.00);
    assert.equal(lfaServ.body.meta.defalcare_lfa.total_admin, 50.00);
    assert.equal(lfaServ.body.meta.defalcare_lfa.total_colaboratori, 40.00);
    assert.equal(lfaServ.body.meta.defalcare_lfa.mchb, 'Chelt Birotica');
    assert.equal(lfaServ.body.meta.defalcare_lfa.nota1, 'Nota Test');
    assert.ok(lfaServ.body.rows.some(r => r.categorie === 'Chelt Birotica'));

    // 2. cu_energie_termica=2 hides Apă Caldă and Încălzire (13 categories instead of 15)
    const lfaNoTermic = await request('GET', '/api/rapoarte/LFA?ordonare=SERVICIU&cu_energie_termica=2');
    assert.equal(lfaNoTermic.status, 200);
    assert.equal(lfaNoTermic.body.meta.cu_energie_termica, false);
    assert.equal(lfaNoTermic.body.rows.length, 13);
    assert.ok(!lfaNoTermic.body.rows.some(r => r.categorie === 'Apă Caldă' || r.categorie === 'Încălzire'));

    // 3. ordonare=BLOC across 2 blocks with cu_energie_termica=2 -> 2 * 13 = 26 rows, includes 'bloc' column
    const lfaBloc = await request('GET', '/api/rapoarte/LFA?ordonare=BLOC&cu_energie_termica=2');
    assert.equal(lfaBloc.status, 200);
    assert.equal(lfaBloc.body.meta.ordonare, 'BLOC');
    assert.equal(lfaBloc.body.rows.length, 26);
    assert.ok(lfaBloc.body.columns.some(c => c.key === 'bloc'));
  });

  it('B.7: LIP/LIR/LAF/LAR — format=prescurtat vs extins, cu_energie_termica=2 hiding apa_calda/incalzire columns, and termen_plata', async () => {
    const { request } = env;

    for (const code of ['LIP', 'LIR', 'LAF', 'LAR']) {
      // 1. Extins with thermal energy
      const extWith = await request('GET', `/api/rapoarte/${code}?format_lista=extins&cu_energie_termica=1&termen_plata=2026-10-25`);
      assert.equal(extWith.status, 200);
      assert.equal(extWith.body.meta.format, 'extins');
      assert.equal(extWith.body.meta.cu_energie_termica, true);
      assert.equal(extWith.body.meta.termen_plata, '2026-10-25');
      assert.ok(extWith.body.columns.some(c => c.key === 'incalzire'), `${code} extins with thermal must include incalzire`);

      // 2. Extins with cu_energie_termica=2
      const extNo = await request('GET', `/api/rapoarte/${code}?format_lista=extins&cu_energie_termica=2`);
      assert.equal(extNo.status, 200);
      assert.equal(extNo.body.meta.cu_energie_termica, false);
      assert.ok(!extNo.body.columns.some(c => c.key === 'incalzire'), `${code} extins with cu_energie_termica=2 must hide incalzire`);
      assert.ok(!extNo.body.columns.some(c => c.key === 'apa_calda'), `${code} extins with cu_energie_termica=2 must hide apa_calda`);

      // 3. Prescurtat with thermal energy vs cu_energie_termica=2
      const prescWith = await request('GET', `/api/rapoarte/${code}?format_lista=prescurtat&cu_energie_termica=1`);
      assert.equal(prescWith.status, 200);
      assert.equal(prescWith.body.meta.format, 'prescurtat');
      assert.ok(prescWith.body.columns.some(c => c.key === 'apa_calda'));
      assert.ok(prescWith.body.columns.some(c => c.key === 'incalzire'));
      assert.ok(prescWith.body.columns.length < extWith.body.columns.length, `${code} prescurtat must have fewer columns than extins`);

      const prescNo = await request('GET', `/api/rapoarte/${code}?format_lista=prescurtat&cu_energie_termica=2`);
      assert.equal(prescNo.status, 200);
      assert.ok(!prescNo.body.columns.some(c => c.key === 'apa_calda'), `${code} prescurtat with cu_energie_termica=2 must hide apa_calda`);
      assert.ok(!prescNo.body.columns.some(c => c.key === 'incalzire'), `${code} prescurtat with cu_energie_termica=2 must hide incalzire`);
    }
  });

  it('B.8: LVE — includeValid=true vs false (expired only vs all valid-date meters, ignoring blank dates)', async () => {
    const { request } = env;

    // Seeded meters on Apt 1 & Apt 2:
    // Expired (< 2026-09-30): Apt 1 d_v_ar_bu (2025-04-10), Apt 1 d_v_ac_bu (2024-08-01), Apt 2 d_v_ar_bu (2025-01-15) -> 3 expired
    // Valid (>= 2026-09-30): Apt 1 d_v_ar_ba1 (2028-11-20), Apt 1 d_v_inin (2029-01-15) -> 2 valid
    // All other meter dates are NULL, '', or ' . . ' -> ignored!
    const lveExpiredOnly = await request('GET', '/api/rapoarte/LVE?target_date=2026-09-30&includeValid=false');
    assert.equal(lveExpiredOnly.status, 200);
    assert.equal(lveExpiredOnly.body.rows.length, 3);
    assert.ok(lveExpiredOnly.body.rows.every(r => r.status === 'EXPIRAT'));

    const lveAll = await request('GET', '/api/rapoarte/LVE?target_date=2026-09-30&includeValid=true');
    assert.equal(lveAll.status, 200);
    assert.equal(lveAll.body.rows.length, 5);
    assert.equal(lveAll.body.rows.filter(r => r.status === 'EXPIRAT').length, 3);
    assert.equal(lveAll.body.rows.filter(r => r.status === 'VALID').length, 2);
  });
});

// ============================================================================
//  SECTION C: services/cashier.js & routes/chitante.js
// ============================================================================
describe('Section C: Cashier & Chitante Routes (PUT/DELETE datorii, PUNNR 2-slot rule, Fonduri-Sumar, CHO Colectiv)', () => {
  let env;

  beforeEach(async () => {
    env = await createIsolatedTestServer();
  });

  afterEach(() => {
    env.cleanup();
  });

  it('C.1: PUT /api/chitante/datorii/:id & DELETE /api/chitante/datorii/:id — valid edit, validation errors, and deleting debt row with payments', async () => {
    const { db, request } = env;

    // 1. Create a manual debt row
    const postRes = await request('POST', '/api/chitante/datorii', {
      apartament_id: 1,
      an: 2026,
      luna: 8,
      categorie: 'R',
      valoare: 150.00,
      explicatie: 'Debit initial'
    });
    assert.equal(postRes.status, 201);
    const datId = postRes.body.id;

    // 2. Valid inline edit via PUT /api/chitante/datorii/:id
    const putRes = await request('PUT', `/api/chitante/datorii/${datId}`, {
      categorie: 'A',
      valoare: 225.50,
      an: 2026,
      luna: 7,
      explicatie: 'Fond reparatii corectat'
    });
    assert.equal(putRes.status, 200);
    assert.equal(putRes.body.success, true);
    assert.equal(putRes.body.datorie.categorie, 'A');
    assert.equal(putRes.body.datorie.valoare, 225.50);
    assert.equal(putRes.body.datorie.luna, 7);
    assert.equal(putRes.body.datorie.restanta, 225.50);

    // 3. Validation errors on PUT /api/chitante/datorii/:id
    const badCat = await request('PUT', `/api/chitante/datorii/${datId}`, { categorie: 'Z' });
    assert.equal(badCat.status, 400);

    for (const invalidVal of ['not_a_number', '', null, true]) {
      const badVal = await request('PUT', `/api/chitante/datorii/${datId}`, { valoare: invalidVal });
      assert.equal(badVal.status, 400, `Expected 400 for valoare=${JSON.stringify(invalidVal)}`);
    }

    const badLuna = await request('PUT', `/api/chitante/datorii/${datId}`, { luna: 13 });
    assert.equal(badLuna.status, 400);

    const put404 = await request('PUT', '/api/chitante/datorii/999999', { valoare: 100 });
    assert.equal(put404.status, 404);

    // 4. Issue a partial payment against this debt row, then DELETE the debt row
    issueReceipt(db, {
      apartament_id: 1,
      data_emiterii: '2026-09-16',
      sursa: 'CASA',
      allocations: [{ datorie_id: datId, suma: 100.00 }]
    });

    const platiBefore = db.prepare('SELECT COUNT(*) AS cnt FROM plati WHERE datorie_id = ?').get(datId).cnt;
    assert.equal(platiBefore, 1);

    const delRes = await request('DELETE', `/api/chitante/datorii/${datId}`);
    assert.equal(delRes.status, 200);
    assert.equal(delRes.body.success, true);
    assert.equal(delRes.body.deletedId, datId);
    assert.equal(delRes.body.deleted_plati, 1);

    const platiAfter = db.prepare('SELECT COUNT(*) AS cnt FROM plati WHERE datorie_id = ?').get(datId).cnt;
    assert.equal(platiAfter, 0, 'Associated plati must be deleted');
    const aptAfter = db.prepare('SELECT restante FROM apartamente WHERE id = 1').get();
    assert.equal(aptAfter.restante, 0, 'Apartment restante scalar must be resynced to 0');

    // DELETE non-existent ID returns 404
    const del404 = await request('DELETE', '/api/chitante/datorii/999999');
    assert.equal(del404.status, 404);
  });

  it('C.2: POST /api/chitante/datorii/:id/punnr (F1 = PUNNR) — stamps receipt on unpaid row, partial payment slot 2, 3rd payment 2-slot rejection, and already-paid rejection', async () => {
    const { db, request } = env;

    // Case 1: Unpaid row stamped in 1 shot -> fills PLATA1 and brings restanta to 0
    const d1Info = db.prepare(`
      INSERT INTO datorii (apartament_id, bloc_id, an, luna, categorie, valoare, sursa)
      VALUES (1, 1, 2026, 8, 'R', 120.00, 'IMPORT')
    `).run();
    const d1Id = Number(d1Info.lastInsertRowid);

    const p1 = await request('POST', `/api/chitante/datorii/${d1Id}/punnr`, { data: '2026-09-18' });
    assert.equal(p1.status, 200);
    assert.equal(p1.body.success, true);
    assert.equal(p1.body.slot, 'PLATA1');
    assert.equal(p1.body.suma_achitata, 120.00);
    assert.equal(p1.body.datorie.restanta, 0);

    // Calling punnr on already-paid row returns 400
    const p1AlreadyPaid = await request('POST', `/api/chitante/datorii/${d1Id}/punnr`, { data: '2026-09-18' });
    assert.equal(p1AlreadyPaid.status, 400);
    assert.match(p1AlreadyPaid.body.error, /deja achitat/i);

    // Case 2: Row with 1 partial payment (PLATA1) -> calling punnr stamps remaining balance into PLATA2
    const d2Info = db.prepare(`
      INSERT INTO datorii (apartament_id, bloc_id, an, luna, categorie, valoare, sursa)
      VALUES (1, 1, 2026, 9, 'R', 200.00, 'IMPORT')
    `).run();
    const d2Id = Number(d2Info.lastInsertRowid);

    issueReceipt(db, {
      apartament_id: 1,
      data_emiterii: '2026-09-10',
      allocations: [{ datorie_id: d2Id, suma: 75.00 }]
    });

    const p2 = await request('POST', `/api/chitante/datorii/${d2Id}/punnr`, { data: '2026-09-19' });
    assert.equal(p2.status, 200);
    assert.equal(p2.body.slot, 'PLATA2');
    assert.equal(p2.body.suma_achitata, 125.00);
    assert.equal(p2.body.datorie.restanta, 0);
    assert.equal(p2.body.datorie.active_payments_count, 2);

    // Case 3: Row with 2 partial payments (PLATA1 & PLATA2 occupied) and remaining unpaid balance -> 3rd payment rejected with 400 'NU AM UNDE SA SCRIU CHITANTA'
    const d3Info = db.prepare(`
      INSERT INTO datorii (apartament_id, bloc_id, an, luna, categorie, valoare, sursa)
      VALUES (2, 1, 2026, 9, 'R', 300.00, 'IMPORT')
    `).run();
    const d3Id = Number(d3Info.lastInsertRowid);

    issueReceipt(db, {
      apartament_id: 2,
      data_emiterii: '2026-09-10',
      allocations: [{ datorie_id: d3Id, suma: 100.00 }]
    });
    issueReceipt(db, {
      apartament_id: 2,
      data_emiterii: '2026-09-12',
      allocations: [{ datorie_id: d3Id, suma: 100.00 }]
    });

    const p3 = await request('POST', `/api/chitante/datorii/${d3Id}/punnr`, { data: '2026-09-20' });
    assert.equal(p3.status, 400);
    assert.match(p3.body.error, /NU AM UNDE SA SCRIU CHITANTA/);
  });

  it('C.3: GET /api/chitante/fonduri-sumar/:apartamentId (FNDRU, FNDRE, FNDPE) — accurately returns total_calculat, total_achitat, and sold_neachitat for F, A, P, R', async () => {
    const { db, request } = env;

    // Seed debts for Apt 1 across F, A, P, R
    db.prepare(`
      INSERT INTO datorii (id, apartament_id, bloc_id, an, luna, categorie, valoare, sursa)
      VALUES
        (201, 1, 1, 2026, 7, 'F', 50.00, 'IMPORT'),
        (202, 1, 1, 2026, 8, 'F', 50.00, 'IMPORT'),
        (203, 1, 1, 2026, 8, 'A', 80.00, 'IMPORT'),
        (204, 1, 1, 2026, 8, 'P', 25.00, 'PENALTY'),
        (205, 1, 1, 2026, 8, 'R', 300.00, 'IMPORT')
    `).run();

    // Pay F=60, A=30, P=10, R=100 via active receipt, plus a cancelled receipt of F=40 (which must be ignored)
    issueReceipt(db, {
      apartament_id: 1,
      data_emiterii: '2026-09-15',
      allocations: [
        { datorie_id: 201, suma: 50.00 },
        { datorie_id: 202, suma: 10.00 },
        { datorie_id: 203, suma: 30.00 },
        { datorie_id: 204, suma: 10.00 },
        { datorie_id: 205, suma: 100.00 }
      ]
    });

    db.prepare(`
      INSERT INTO chitante (id, serie, numar, data_emiterii, apartament_id, bloc_id, suma, anulata)
      VALUES (999, 'ORH', 999, '2026-09-16', 1, 1, 40.00, 1)
    `).run();
    db.prepare(`
      INSERT INTO plati (datorie_id, chitanta_id, suma, data, sursa)
      VALUES (202, 999, 40.00, '2026-09-16', 'CASA')
    `).run();

    const res = await request('GET', '/api/chitante/fonduri-sumar/1');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.fond_rulment, {
      total_calculat: 100.00,
      total_achitat: 60.00,
      sold_neachitat: 40.00
    });
    assert.deepEqual(res.body.fond_reparatii, {
      total_calculat: 80.00,
      total_achitat: 30.00,
      sold_neachitat: 50.00
    });
    assert.deepEqual(res.body.penalitati, {
      total_calculat: 25.00,
      total_achitat: 10.00,
      sold_neachitat: 15.00
    });
    assert.deepEqual(res.body.regie, {
      total_calculat: 300.00,
      total_achitat: 100.00,
      sold_neachitat: 200.00
    });

    // 404 on non-existent apartment
    const res404 = await request('GET', '/api/chitante/fonduri-sumar/99999');
    assert.equal(res404.status, 404);
  });

  it('C.4: POST /api/chitante/colectiv (CHO.FXP) — mod_valoare TOTAL_BLOC (including negative storno) and mod_numar UNIC vs INCREMENTAL', async () => {
    const { db, request, bloc1Id } = env;

    // Initial urmatorul_numar_chitanta is 100. Block 1 has 2 apartments (Apt 1 & Apt 2).
    // 1. TOTAL_BLOC + UNIC: total 150.00 across 2 apartments -> 75.00 per apartment, both get receipt #100, urmatorul_numar_chitanta becomes 101
    const choUnic = await request('POST', '/api/chitante/colectiv', {
      bloc_id: bloc1Id,
      mod_valoare: 'TOTAL_BLOC',
      mod_numar: 'UNIC',
      categorie: 'A',
      valoare_totala: 150.00,
      lucrare: 'Fond reparatii acoperis',
      data_emiterii: '2026-09-20'
    });
    assert.equal(choUnic.status, 200);
    assert.equal(choUnic.body.success, true);
    assert.equal(choUnic.body.mod_valoare, 'TOTAL_BLOC');
    assert.equal(choUnic.body.mod_numar, 'UNIC');
    assert.equal(choUnic.body.apartamente_afectate, 2);
    assert.equal(choUnic.body.valoare_per_apartament, 75.00);
    assert.equal(choUnic.body.valoare_totala, 150.00);
    assert.deepEqual(choUnic.body.affected.map(a => a.numar_chitanta), [100, 100]);
    assert.equal(choUnic.body.urmatorul_numar_chitanta, 101);

    const asocAfterUnic = db.prepare('SELECT urmatorul_numar_chitanta FROM asociatie WHERE id = 1').get();
    assert.equal(asocAfterUnic.urmatorul_numar_chitanta, 101);

    // 2. TOTAL_BLOC + INCREMENTAL + Negative storno/diminuare (-90.00 across 2 apartments -> -45.00 per apartment)
    // Assigns sequential receipt numbers #101 and #102, advancing urmatorul_numar_chitanta to 103
    const choIncNeg = await request('POST', '/api/chitante/colectiv', {
      bloc_id: bloc1Id,
      mod_valoare: 'TOTAL_BLOC',
      mod_numar: 'INCREMENTAL',
      categorie: 'A',
      valoare_totala: -90.00,
      lucrare: 'Descarcare fond reparatii lucrare subsol',
      data_emiterii: '2026-09-21'
    });
    assert.equal(choIncNeg.status, 200);
    assert.equal(choIncNeg.body.mod_valoare, 'TOTAL_BLOC');
    assert.equal(choIncNeg.body.mod_numar, 'INCREMENTAL');
    assert.equal(choIncNeg.body.valoare_per_apartament, -45.00);
    assert.equal(choIncNeg.body.valoare_totala, -90.00);
    assert.deepEqual(choIncNeg.body.affected.map(a => a.numar_chitanta), [101, 102]);
    assert.equal(choIncNeg.body.urmatorul_numar_chitanta, 103);

    const asocAfterInc = db.prepare('SELECT urmatorul_numar_chitanta FROM asociatie WHERE id = 1').get();
    assert.equal(asocAfterInc.urmatorul_numar_chitanta, 103);
  });
});
