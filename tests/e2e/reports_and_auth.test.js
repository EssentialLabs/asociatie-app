/**
 * tests/e2e/reports_and_auth.test.js
 *
 * End-to-End & Adversarial Test Suite for Milestones 4, 5, and 6:
 * - M5.1: Complete 35-Report Catalog Execution (16 LISTARE, 17 SITUATII, 2 CENTRALIZARE)
 * - M5.2: GDPR Notice-Board Masking Default & Toggle (LAF, LAR, LP1, LP2, LPP, MAX)
 * - M5.3: Edge Case #15 (LVE Metrology Blank Dates Ignored) & UTF-8 BOM CSV Export
 * - M4.1 & Feature 24: Authentication, Impersonation Audit & Multi-Tenant Clean Workspace Provisioning
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { initializeSchema } = require('../../db');
const {
  REPORT_CATALOG,
  GDPR_NOTICE_BOARD_CODES,
  generateReport,
  reportToCsv
} = require('../../services/reports');
const {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  loginUser,
  impersonateAssociation,
  createAssociationWorkspace
} = require('../../services/auth');
const { getPeriodCalculationData } = require('../../services/ledger');
const { publishMonth } = require('../../services/lifecycle');
const { issueReceipt } = require('../../services/cashier');

function createSeededMemoryDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeSchema(db);

  // Ensure period 2026/09 has thermal tariff so heating & hot water charges are non-zero
  db.prepare(`
    UPDATE perioade SET tarif_ar = 9.48, tarif_ca = 9.67, proc_ca = 100, tarif_et = 350.00
    WHERE an = 2026 AND luna = 9
  `).run();

  // Seed a realistic block with cold water, hot water, heating, and common invoices
  const blocInfo = db.prepare(`
    INSERT INTO blocuri (
      asociatie_id, bloc, strada, numar, cota_fr,
      cp_ar, cp_ac, cp_in, mod_r_dif, mod_r_inc, modr_difin, mod_r_asc,
      ivar, inar, ivac, inac, ivin, inin, constin,
      ecart_temp, rand_tr, tarif_et, procinccom,
      gaz, gunoi, curent, curent_sc, curent_li, ascensor,
      sal_tesa, sal_feme, ch_admin, ch_sediu, prest_serv, chelt_inc, abonament, can_met
    ) VALUES (
      1, '19', 'Str. Orhideelor', '19', 15.0,
      'C', 'C', 'P', 'PER', 'SL', 'SL', 'PER',
      1000, 1055, 500, 520, 100, 106, 1.0,
      40, 100, 350.0, 20,
      80, 160, 90, 60, 30, 75,
      200, 150, 120, 40, 50, 25, 30, 45
    )
  `).run();
  const blocId = Number(blocInfo.lastInsertRowid);

  // Apartment 1: Metered cold/hot water, allocator heating (CP_IN='R'), expired metrology on AR Buc, blank on others
  const apt1Info = db.prepare(`
    INSERT INTO apartamente (
      bloc_id, numar_apart, nume_proprietar, persoane, suprafata, sup_ec_ter,
      cp_ar, cp_ac, cp_in, proc_av_in, proc_av_ac,
      iv_ar_bu, in_ar_bu, d_v_ar_bu, ser_ar_bu,
      iv_ar_ba1, in_ar_ba1, d_v_ar_ba1, ser_ar_ba1,
      d_v_ar_ba2, d_v_ac_bu, d_v_ac_ba1, d_v_ac_ba2, d_v_inin,
      iv_ac_bu, in_ac_bu, ser_ac_bu,
      serie_r1, iv_r1, in_r1, facttr_r1, coefsp_r1,
      serie_r2, iv_r2, in_r2, facttr_r2, coefsp_r2,
      max_fr, calc_fr, fond_repar, ch_box
    ) VALUES (
      ?, '1', 'Popescu Ion', 2, 52.5, 12.0,
      'C', 'C', 'R', 100, 100,
      100, 112, '2025-05-15', 'AR-BU-001',
      50, 58, '2028-12-31', 'AR-BA-001',
      '', ' . . ', NULL, '   ', '15.06.2024',
      40, 46, 'AC-BU-001',
      'R1-101', 100, 150, 1.15, 0.9,
      'R2-102', 80, 120, 1.0, 1.0,
      150, 50, 30, 15
    )
  `).run(blocId);
  const apt1Id = Number(apt1Info.lastInsertRowid);

  // Apartment 2: Flat-rate water (CP_AR='P'), disconnected heating (PROC_AV_IN=0 for GOT report), blank metrology dates
  const apt2Info = db.prepare(`
    INSERT INTO apartamente (
      bloc_id, numar_apart, nume_proprietar, persoane, suprafata, sup_ec_ter,
      cp_ar, cp_ac, cp_in, proc_av_in, proc_av_ac,
      d_v_ar_bu, d_v_ar_ba1, d_v_ar_ba2, d_v_ac_bu, d_v_ac_ba1, d_v_ac_ba2, d_v_inin,
      max_fr, calc_fr, fond_repar
    ) VALUES (
      ?, '2', 'Ionescu Elena', 3, 68.0, 15.5,
      'P', 'P', 'P', 0, 100,
      NULL, '', ' . . ', '  /  /    ', NULL, '', NULL,
      150, 150, 30
    )
  `).run(blocId);
  const apt2Id = Number(apt2Info.lastInsertRowid);

  // Seed historical overdue debt on Apt 1 (2026/05) so SRE, RE1, LAR_INST, LSC have overdue arrears & penalties
  db.prepare(`
    INSERT INTO datorii (apartament_id, bloc_id, an, luna, luna_text, categorie, valoare, sursa)
    VALUES
      (?, ?, 2026, 5, 'MAI', 'R', 200.00, 'IMPORT'),
      (?, ?, 2026, 5, 'MAI', 'F', 25.00, 'IMPORT'),
      (?, ?, 2026, 5, 'MAI', 'A', 40.00, 'IMPORT'),
      (?, ?, 2026, 5, 'MAI', 'P', 12.50, 'PENALTY')
  `).run(apt1Id, blocId, apt1Id, blocId, apt1Id, blocId, apt1Id, blocId);

  // Publish current month (2026/09) to populate snapshots (apartamente_luna, blocuri_luna) and current datorii
  publishMonth(db);

  // Issue a partial receipt on Apt 1 so IN1, IN2, and CASA have realistic collection entries
  issueReceipt(db, {
    apartament_id: apt1Id,
    suma: 50.00,
    data_emiterii: '2026-09-18',
    sursa: 'CASA'
  });

  // Seed BANCA, PATRIMONIU, and ORDINE_PLATA rows for CBA, CP1, ORD reports
  db.prepare(`
    INSERT INTO banca (asoc, document, data, suma, tip, act_pas, explicatie)
    VALUES ('ASOCIATIA TEST', 'EXT-101', '2026-09-19', 1500.00, 'D', 'A', 'Depunere numerar casierie')
  `).run();

  db.prepare(`
    INSERT INTO patrimoniu (asoc, document, data, suma, act_pas, explicatie, perioada, data_pres)
    VALUES
      ('ASOCIATIA TEST', 'SOLD-A1', '2026-09-30', 12500.00, 'A', 'Sold Casa si Banca', 'SEPTEMBRIE 2026', '2026-09-30'),
      ('ASOCIATIA TEST', 'SOLD-P1', '2026-09-30', 12500.00, 'P', 'Fond Rulment si Reparatii', 'SEPTEMBRIE 2026', '2026-09-30')
  `).run();

  db.prepare(`
    INSERT INTO ordine_plata (
      numar, data, tip_ordin, suma,
      platitor1, codf_plat, cont_plat, banca_plat,
      beneficiar, codf_bene, cont_bene, banca_bene,
      reprez1, reprez2
    ) VALUES (
      14, '2026-09-22', 'A', 845.50,
      'ASOCIATIA DE PROPRIETARI TEST', 'RO00000000', 'RO49AAAA1B31007593840000', 'BCR ALBA',
      'APA CTTA SA ALBA', 'RO1765432', 'RO12TREZ0025069XXX001234', 'TREZORERIA ALBA',
      'Plata factura apa rece', 'Septembrie 2026'
    )
  `).run();

  return { db, blocId, apt1Id, apt2Id };
}

describe('Milestones 4, 5 & 6: 35-Report Engine, GDPR Masking, Edge Case #15, Auth & Clean Multi-Tenant Workspace', () => {
  let ctx;

  beforeEach(() => {
    ctx = createSeededMemoryDb();
  });

  it('M5.1: Complete 35-Report Catalog Execution (16 LISTARE, 17 SITUATII, 2 CENTRALIZARE)', () => {
    const { db } = ctx;

    assert.equal(REPORT_CATALOG.length, 35, 'REPORT_CATALOG must contain exactly 35 reports');
    const listareCount = REPORT_CATALOG.filter(r => r.menu === 'LISTARE').length;
    const situatiiCount = REPORT_CATALOG.filter(r => r.menu === 'SITUATII').length;
    const centralizareCount = REPORT_CATALOG.filter(r => r.menu === 'CENTRALIZARE').length;

    assert.equal(listareCount, 16, 'Must have 16 LISTARE reports');
    assert.equal(situatiiCount, 17, 'Must have 17 SITUATII reports');
    assert.equal(centralizareCount, 2, 'Must have 2 CENTRALIZARE reports');

    for (const item of REPORT_CATALOG) {
      const report = generateReport(db, item.code, { target_date: '2026-10-20' });

      assert.equal(report.code, item.code, `Report code mismatch for ${item.code}`);
      assert.equal(report.menu, item.menu, `Report menu mismatch for ${item.code}`);
      assert.ok(Array.isArray(report.columns) && report.columns.length > 0, `Report ${item.code} must return non-empty columns`);
      assert.ok(Array.isArray(report.rows) && report.rows.length > 0, `Report ${item.code} must return non-empty rows for seeded data`);
      assert.ok(report.period && report.period.an === 2026 && report.period.luna === 9, `Report ${item.code} must include valid period metadata`);
      assert.ok(report.asociatie && report.asociatie.nume, `Report ${item.code} must include valid asociatie metadata`);
      assert.equal(typeof report.totals, 'object', `Report ${item.code} must return a totals object`);
    }

    // Also verify LRI alias resolves to LAR_INST
    const lriReport = generateReport(db, 'LRI', { target_date: '2026-10-20' });
    assert.equal(lriReport.code, 'LAR_INST');
    assert.ok(lriReport.rows.length > 0);
  });

  it('M5.2: GDPR Notice-Board Masking Default & Toggle across all 6 public notice-board reports', () => {
    const { db } = ctx;
    const expectedGdprCodes = ['LAF', 'LAR', 'LP1', 'LP2', 'LPP', 'MAX'];

    assert.deepEqual([...GDPR_NOTICE_BOARD_CODES].sort(), [...expectedGdprCodes].sort());

    for (const code of expectedGdprCodes) {
      // 1. Default invocation -> gdpr_masked: true, owner names masked
      const maskedReport = generateReport(db, code);
      assert.equal(maskedReport.gdpr_applicable, true, `${code} must have gdpr_applicable: true`);
      assert.equal(maskedReport.gdpr_masked, true, `${code} must default to gdpr_masked: true`);
      assert.equal(maskedReport.show_names, false, `${code} must default to show_names: false`);

      for (const row of maskedReport.rows) {
        assert.match(
          row.nume,
          /^\[GDPR - Ap\. \d+\]$/,
          `${code} row.nume must be masked by default, got: ${row.nume}`
        );
        assert.ok(!row.nume.includes('Popescu') && !row.nume.includes('Ionescu'));
      }

      // 2. Explicit showNames: true -> gdpr_masked: false, real owner names revealed
      const unmaskedReport = generateReport(db, code, { showNames: true });
      assert.equal(unmaskedReport.gdpr_applicable, true);
      assert.equal(unmaskedReport.gdpr_masked, false, `${code} with showNames:true must set gdpr_masked: false`);
      assert.equal(unmaskedReport.show_names, true);

      const names = unmaskedReport.rows.map(r => r.nume);
      assert.ok(names.includes('Popescu Ion'), `${code} with showNames:true must reveal Popescu Ion`);
      assert.ok(names.includes('Ionescu Elena'), `${code} with showNames:true must reveal Ionescu Elena`);
    }

    // Verify internal reports (e.g., LIP, LIR) show names by default
    const lipReport = generateReport(db, 'LIP');
    assert.equal(lipReport.gdpr_applicable, false);
    assert.equal(lipReport.gdpr_masked, false);
    assert.ok(lipReport.rows.some(r => r.nume === 'Popescu Ion'));
  });

  it('M5.3: Edge Case #15 (LVE Metrology Blank Dates Ignored) & UTF-8 BOM CSV Export', () => {
    const { db } = ctx;

    // Apt 1 has:
    // - d_v_ar_bu = '2025-05-15' (expired < 2026-10-20)
    // - d_v_inin = '15.06.2024' (expired < 2026-10-20)
    // - d_v_ar_ba1 = '2028-12-31' (valid >= 2026-10-20)
    // - d_v_ar_ba2 = '', d_v_ac_bu = ' . . ', d_v_ac_ba1 = NULL, d_v_ac_ba2 = '   ' (all blank!)
    // Apt 2 has all blank/empty metrology dates.
    const lveReport = generateReport(db, 'LVE', { target_date: '2026-10-20' });

    assert.equal(lveReport.rows.length, 2, 'LVE must only flag the 2 genuinely expired meters and ignore all blank/future dates');
    assert.deepEqual(
      lveReport.rows.map(r => `${r.apart}:${r.tip_contor}:${r.data_verificare}:${r.status}`),
      [
        '1:AR Bucătărie:2025-05-15:EXPIRAT',
        '1:Contor Căldură:2024-06-15:EXPIRAT'
      ]
    );

    // Even with includeValid: true, blank/empty dates must still be ignored
    const lveWithValid = generateReport(db, 'LVE', { target_date: '2026-10-20', includeValid: true });
    assert.equal(lveWithValid.rows.length, 3, 'includeValid:true must add the 1 valid date and still ignore all blank dates');
    assert.ok(lveWithValid.rows.some(r => r.data_verificare === '2028-12-31' && r.status === 'VALID'));

    // Verify reportToCsv generates UTF-8 BOM + header + data rows
    const csv = reportToCsv(lveReport);
    assert.ok(csv.startsWith('\uFEFF'), 'CSV must start with UTF-8 BOM (\\uFEFF)');
    const lines = csv.slice(1).split('\r\n');
    assert.equal(lines.length, 3, 'CSV must have 1 header line + 2 data lines');
    assert.match(lines[0], /"Bloc","Ap\.","Proprietar","Contor","Serie","Data Expirării \/ Verificării","Stare"/);
    assert.match(lines[1], /"19","1","Popescu Ion","AR Bucătărie","AR-BU-001","2025-05-15","EXPIRAT"/);
  });

  it('M4.1 & Feature 24: Authentication, Impersonation Audit & Multi-Tenant Clean Workspace Provisioning', () => {
    const { db } = ctx;

    // 1. Password hashing & JWT token round-trip
    const hash = hashPassword('ParolaSecreta!2026');
    assert.equal(verifyPassword('ParolaSecreta!2026', hash), true);
    assert.equal(verifyPassword('Gresit', hash), false);

    // 2. Superadmin login & audit trail
    const loginRes = loginUser(db, 'superadmin', 'admin', '10.0.0.5');
    assert.ok(loginRes.token, 'loginUser must return a signed JWT token');
    assert.equal(loginRes.user.username, 'superadmin');
    assert.equal(loginRes.user.rol, 'superadmin');

    const decodedLogin = verifyToken(loginRes.token);
    assert.ok(decodedLogin, 'verifyToken must validate the login JWT');
    assert.equal(decodedLogin.username, 'superadmin');

    const loginAudit = db.prepare("SELECT * FROM audit_logs WHERE actiune = 'LOGIN' AND username = 'superadmin'").get();
    assert.ok(loginAudit, 'LOGIN action must be recorded in audit_logs');
    assert.equal(loginAudit.ip, '10.0.0.5');

    // Invalid login must throw
    assert.throws(() => loginUser(db, 'superadmin', 'parola_gresita'), /incorectă/i);

    // 3. Feature 24: Provision a brand-new, clean Association workspace
    const ws = createAssociationWorkspace(db, {
      nume: 'ASOCIATIA NOUA TEST',
      administrator: 'Admin Nou',
      cod_fiscal: '99887766',
      an_lucru: 2026,
      luna_lucru: 10
    });

    const newAsocId = ws.asociatie.id;
    assert.ok(newAsocId > 1, 'New association must receive id > 1');
    assert.equal(ws.asociatie.nume, 'ASOCIATIA NOUA TEST');
    assert.equal(ws.period.status, 'DESCHISA');
    assert.equal(ws.period.an, 2026);
    assert.equal(ws.period.luna, 10);
    assert.equal(ws.admin_user.asociatie_id, newAsocId);
    assert.equal(ws.admin_user.rol, 'administrator');

    // Verify new workspace is completely blank and isolated from asociatie_id = 1
    const cleanData = getPeriodCalculationData(db, { asociatie_id: newAsocId });
    assert.equal(cleanData.asociatie.id, newAsocId);
    assert.equal(cleanData.blocuri.length, 0, 'Clean workspace must have 0 blocks');
    assert.equal(cleanData.apartamente.length, 0, 'Clean workspace must have 0 apartments');
    assert.equal(cleanData.datorii.length, 0, 'Clean workspace must have 0 debts');

    // Verify asociatie_id = 1 still has its seeded block and apartments untouched
    const asoc1Data = getPeriodCalculationData(db, { asociatie_id: 1 });
    assert.equal(asoc1Data.blocuri.length, 1);
    assert.equal(asoc1Data.apartamente.length, 2);

    // 4. Impersonation & IMPERSONATE_START audit log
    const imp = impersonateAssociation(db, { id: 1, username: 'superadmin' }, newAsocId, '10.0.0.99');
    assert.ok(imp.token, 'impersonateAssociation must return a token');
    assert.equal(imp.asociatie.id, newAsocId);
    assert.equal(imp.impersonatedUser.asociatie_id, newAsocId);
    assert.equal(imp.impersonatedUser.impersonator_id, 1);

    const decodedImp = verifyToken(imp.token);
    assert.equal(decodedImp.asociatie_id, newAsocId);
    assert.equal(decodedImp.impersonator_id, 1);
    assert.equal(decodedImp.impersonator_username, 'superadmin');

    const impAudit = db.prepare("SELECT * FROM audit_logs WHERE actiune = 'IMPERSONATE_START' AND entitate_id = ?").get(newAsocId);
    assert.ok(impAudit, 'IMPERSONATE_START must be recorded in audit_logs');
    assert.equal(impAudit.impersonator_id, 1);
    assert.equal(impAudit.ip, '10.0.0.99');
  });
});
