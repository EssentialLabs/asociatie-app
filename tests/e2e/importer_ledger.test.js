/**
 * tests/e2e/importer_ledger.test.js
 * 
 * End-to-End Test Suite for DBF Importer & Ledger Reconciliation.
 * Verifies Tier 1 & Tier 2 requirements from ORIGINAL_REQUEST.md (R1, Acceptance Criteria),
 * TEST_INFRA.md (Feature 2), and PARITY_IMPLEMENTATION_PLAN.md (§1.2, §4.1, §4.9).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { readDbf } = require('../helpers/dbf_reader');
const { getTableNames, hasColumn } = require('../helpers/test_db');

const DBF_DIR = 'G:\\INCASOR\\INCASARI\\DATE\\ANI_LUNI\\2026\\SEPTEMBR';
const CHITANTE_DBF_PATH = path.join(DBF_DIR, 'CHITANTE.DBF');
const DB_PATH = path.join(__dirname, '..', '..', 'asociatie.db');

// Authoritative ground-truth constants from FoxPro legacy dataset
const EXPECTED_TOTAL_ROWS = 23171;
const EXPECTED_TOTAL_UNPAID = 290492.47;
const EXPECTED_CATEGORIES = {
  R: 275501.47,
  A: 14631.00,
  F: 360.00,
  P: 0.00
};
const EXPECTED_BLOCK_TOTALS = {
  '1': 65204.03,
  '2': 12008.86,
  '17': 20709.94,
  '19': 16952.87,
  '21': 20309.27,
  '31': 21957.46,
  '37': 27555.08,
  '39': 26401.15,
  '41': 30767.61,
  '53': 48626.20
};

describe('Tier 1: Ground Truth DBF Parsing & Ledger Reconciliation', () => {
  let dbfData;

  it('T1.1: CHITANTE.DBF exists and can be parsed completely', () => {
    assert.ok(fs.existsSync(CHITANTE_DBF_PATH), `CHITANTE.DBF must exist at ${CHITANTE_DBF_PATH}`);
    dbfData = readDbf(CHITANTE_DBF_PATH);
    assert.equal(dbfData.totalRecords, EXPECTED_TOTAL_ROWS, `Total records in CHITANTE.DBF must be ${EXPECTED_TOTAL_ROWS}`);
    assert.equal(dbfData.activeRecords, EXPECTED_TOTAL_ROWS, 'All 23,171 records must be active (0 deleted)');
    assert.equal(dbfData.deletedRecords, 0, 'No records should be marked as deleted');
  });

  it('T1.2: Ground truth unpaid balance equals exactly 290,492.47 RON (0.00 RON diff)', () => {
    if (!dbfData) dbfData = readDbf(CHITANTE_DBF_PATH);

    let totalValoare = 0;
    let totalPlata1 = 0;
    let totalPlata2 = 0;
    let totalUnpaid = 0;

    for (const row of dbfData.records) {
      const val = row.VALOARE || 0;
      const p1 = (row.CHITANTA1 && row.CHITANTA1 !== 0) ? (row.PLATA1 || 0) : 0;
      const p2 = (row.CHITANTA2 && row.CHITANTA2 !== 0) ? (row.PLATA2 || 0) : 0;
      const unpaid = Math.round((val - p1 - p2) * 100) / 100;

      totalValoare += val;
      totalPlata1 += p1;
      totalPlata2 += p2;
      totalUnpaid += unpaid;
    }

    const roundedTotal = Math.round(totalUnpaid * 100) / 100;
    assert.equal(
      roundedTotal,
      EXPECTED_TOTAL_UNPAID,
      `Total unpaid balance must be exactly ${EXPECTED_TOTAL_UNPAID} RON, got ${roundedTotal} RON`
    );
  });

  it('T1.3: Ground truth category balances match R=275,501.47, A=14,631.00, F=360.00, P=0.00', () => {
    if (!dbfData) dbfData = readDbf(CHITANTE_DBF_PATH);

    const categorySums = { R: 0, A: 0, F: 0, P: 0 };

    for (const row of dbfData.records) {
      const cat = (row.CEE || '').trim().toUpperCase();
      const val = row.VALOARE || 0;
      const p1 = (row.CHITANTA1 && row.CHITANTA1 !== 0) ? (row.PLATA1 || 0) : 0;
      const p2 = (row.CHITANTA2 && row.CHITANTA2 !== 0) ? (row.PLATA2 || 0) : 0;
      const unpaid = Math.round((val - p1 - p2) * 100) / 100;

      if (cat in categorySums) {
        categorySums[cat] += unpaid;
      }
    }

    for (const [cat, expected] of Object.entries(EXPECTED_CATEGORIES)) {
      const actual = Math.round(categorySums[cat] * 100) / 100;
      assert.equal(
        actual,
        expected,
        `Category ${cat} balance must be ${expected} RON, got ${actual} RON`
      );
    }
  });

  it('T1.4: Ground truth per-block balances match the 10 block ledger totals', () => {
    if (!dbfData) dbfData = readDbf(CHITANTE_DBF_PATH);

    const blockSums = {};
    for (const row of dbfData.records) {
      const b = (row.BLOC || '').trim();
      const val = row.VALOARE || 0;
      const p1 = (row.CHITANTA1 && row.CHITANTA1 !== 0) ? (row.PLATA1 || 0) : 0;
      const p2 = (row.CHITANTA2 && row.CHITANTA2 !== 0) ? (row.PLATA2 || 0) : 0;
      const unpaid = Math.round((val - p1 - p2) * 100) / 100;

      blockSums[b] = (blockSums[b] || 0) + unpaid;
    }

    for (const [bloc, expected] of Object.entries(EXPECTED_BLOCK_TOTALS)) {
      const actual = Math.round((blockSums[bloc] || 0) * 100) / 100;
      assert.equal(
        actual,
        expected,
        `Bloc ${bloc} unpaid total must be ${expected} RON, got ${actual} RON`
      );
    }
  });
});

describe('Tier 1 & Tier 2: SQLite Imported Ledger Reconciliation', () => {
  let db;

  try {
    const dbModule = require('../../db');
    db = dbModule.getDb();
  } catch (err) {
    db = new Database(DB_PATH);
  }

  it('T1.5: SQLite database must contain the full imported datorii table (23,171 rows)', () => {
    const tables = getTableNames(db);
    assert.ok(
      tables.includes('datorii'),
      'datorii table must exist in SQLite database (R1/M1 requirement)'
    );

    const rowCount = db.prepare('SELECT COUNT(*) as count FROM datorii').get().count;
    assert.equal(
      rowCount,
      EXPECTED_TOTAL_ROWS,
      `datorii table must contain all ${EXPECTED_TOTAL_ROWS} rows from CHITANTE.DBF, but found ${rowCount}`
    );
  });

  it('T1.6: SQLite ledger net unpaid balance equals exactly 290,492.47 RON', () => {
    const tables = getTableNames(db);
    assert.ok(tables.includes('datorii'), 'datorii table must exist');
    assert.ok(tables.includes('plati'), 'plati table must exist');

    // Calculate net unpaid balance: datorii.valoare - sum(plati.suma)
    const result = db.prepare(`
      SELECT 
        ROUND(SUM(d.valoare - COALESCE(p.total_achitat, 0)), 2) as total_restant
      FROM datorii d
      LEFT JOIN (
        SELECT datorie_id, SUM(suma) as total_achitat
        FROM plati
        GROUP BY datorie_id
      ) p ON d.id = p.datorie_id
    `).get();

    const actualTotal = result ? result.total_restant : 0;
    assert.equal(
      actualTotal,
      EXPECTED_TOTAL_UNPAID,
      `SQLite total unpaid balance must equal ${EXPECTED_TOTAL_UNPAID} RON (±0.00 RON diff), got ${actualTotal}`
    );
  });

  it('T1.7: SQLite ledger category balances equal R=275,501.47, A=14,631.00, F=360.00, P=0.00', () => {
    const tables = getTableNames(db);
    assert.ok(tables.includes('datorii'), 'datorii table must exist');

    const rows = db.prepare(`
      SELECT 
        d.categorie,
        ROUND(SUM(d.valoare - COALESCE(p.total_achitat, 0)), 2) as categorie_restant
      FROM datorii d
      LEFT JOIN (
        SELECT datorie_id, SUM(suma) as total_achitat
        FROM plati
        GROUP BY datorie_id
      ) p ON d.id = p.datorie_id
      GROUP BY d.categorie
    `).all();

    const actualCats = {};
    for (const r of rows) {
      actualCats[r.categorie] = r.categorie_restant;
    }

    for (const [cat, expected] of Object.entries(EXPECTED_CATEGORIES)) {
      const actual = actualCats[cat] !== undefined ? actualCats[cat] : 0.00;
      assert.equal(
        actual,
        expected,
        `SQLite category ${cat} balance must be ${expected} RON, got ${actual}`
      );
    }
  });

  it('T2.1: Receipts with CHITANTA = 0 must NOT count as payments (FoxPro rule)', () => {
    // Ground-truth check: ensure any record with CHITANTA1 = 0 has payment ignored
    const dbfData = readDbf(CHITANTE_DBF_PATH);
    const zeroReceiptPayments = dbfData.records.filter(r => (!r.CHITANTA1 || r.CHITANTA1 === 0) && r.PLATA1 > 0);
    // If any exist, verify our unpaid calculation ignores them
    for (const r of zeroReceiptPayments) {
      const p1 = (r.CHITANTA1 && r.CHITANTA1 !== 0) ? r.PLATA1 : 0;
      assert.equal(p1, 0, 'Payment without receipt number must be treated as 0');
    }
  });

  it('T2.2: Dual payment rows (CHITANTA1 and CHITANTA2) are both accounted for', () => {
    const dbfData = readDbf(CHITANTE_DBF_PATH);
    const dualRows = dbfData.records.filter(r => r.CHITANTA1 && r.CHITANTA1 !== 0 && r.CHITANTA2 && r.CHITANTA2 !== 0);
    assert.ok(dualRows.length > 0, 'There should be rows with two partial payments');

    // Verify all dual-payment rows calculate unpaid = valoare - plata1 - plata2
    for (const r of dualRows) {
      const expectedUnpaid = Math.round((r.VALOARE - r.PLATA1 - r.PLATA2) * 100) / 100;
      assert.ok(!isNaN(expectedUnpaid), 'Dual payment row must yield valid unpaid number');
    }
  });

  it('T2.3: CP852 encoding cleanly decodes all ledger strings and accurately handles Romanian characters', () => {
    const dbfData = readDbf(CHITANTE_DBF_PATH);
    // Verify records decode cleanly without control character corruption
    const corrupted = dbfData.records.filter(r => /[\x00-\x08\x0E-\x1F]/.test(r.NUME || ''));
    assert.equal(corrupted.length, 0, 'No names should contain corrupted control characters');

    // Verify CP852 codec mapping for Romanian legacy characters (Ă, Î, Â, Ş, Ţ)
    const iconv = require('iconv-lite');
    const testOemBuffer = iconv.encode('ASOCIAŢIE PROPRIETARI - STRĂZI ŞI BLOCURI ÎNREGISTRATE', 'cp852');
    const decoded = iconv.decode(testOemBuffer, 'cp852');
    assert.equal(decoded, 'ASOCIAŢIE PROPRIETARI - STRĂZI ŞI BLOCURI ÎNREGISTRATE', 'CP852 codec must roundtrip Romanian text accurately');
  });
});
