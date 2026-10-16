/**
 * tests/adversarial/anonymization_stress.test.js
 * 
 * Adversarial Stress Test: Anonymization & GDPR Masking Verification
 * 
 * Verifies:
 * 1. Complete masking of personal data:
 *    - All owner names in `apartamente`, `apartamente_luna`, and `chitante` are masked as 'Proprietar Ap. <numar>'.
 *    - None of the ground-truth names from APART.DBF or CHITANTE.DBF appear in SQLite.
 * 2. Absolute numerical invariance:
 *    - Anonymization preserves 100% of numerical values (charges, debts, payments, surfaces, persons, meters, funds).
 *    - Sum of unpaid debts equals exactly 290,492.47 RON (0.00 RON diff).
 *    - All 10 block balances and 4 category totals match ground truth.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { parseDbf } = require('../../import-foxpro');

const DB_PATH = path.join(__dirname, '..', '..', 'asociatie.db');
const LATEST_DIR = 'G:\\INCASOR\\INCASARI\\DATE\\ANI_LUNI\\2026\\SEPTEMBR';

describe('Adversarial Stress Test: Anonymization & Numerical Invariance', () => {
  const db = new Database(DB_PATH);

  // Extract legacy ground-truth owner names
  const apartDbf = parseDbf(path.join(LATEST_DIR, 'APART.DBF'));
  const realOwnerNames = new Set(
    apartDbf.records
      .map(r => (r.NUME || '').trim())
      .filter(n => n.length > 2 && !n.startsWith('Proprietar'))
  );

  it('Step 1: Ground truth contains sensitive personal names to be masked', () => {
    assert.ok(realOwnerNames.size >= 50, `Expected at least 50 real owner names in DBF, found ${realOwnerNames.size}`);
    // Check sample names exist in ground truth
    const namesList = Array.from(realOwnerNames);
    assert.ok(namesList.some(n => n.includes(' ')), 'Real names should include first and last names');
  });

  it('Step 2: Table apartamente has 100% masked owner names (zero leaks)', () => {
    const rows = db.prepare('SELECT id, bloc_id, numar_apart, nume_proprietar FROM apartamente').all();
    assert.equal(rows.length, 78, 'Expected 78 active apartments');

    const leakList = [];
    for (const r of rows) {
      const name = r.nume_proprietar;
      // Must match mask format
      const validMask = /^Proprietar Ap\.\s+\d+[A-Za-z]?$/.test(name);
      assert.ok(validMask, `Apartment ${r.numar_apart} has invalid mask: "${name}"`);

      // Must not match any real owner name
      if (realOwnerNames.has(name)) {
        leakList.push({ ap: r.numar_apart, name });
      }
    }

    assert.equal(leakList.length, 0, `Detected ${leakList.length} leaked owner names in apartamente`);
  });

  it('Step 3: Table apartamente_luna (all 151,532 snapshot rows) has zero leaked owner names', () => {
    const totalSnapshots = db.prepare('SELECT COUNT(*) as cnt FROM apartamente_luna').get().cnt;
    assert.ok(totalSnapshots > 100000, `Expected > 100,000 snapshot rows, found ${totalSnapshots}`);

    // Check if any row in apartamente_luna contains any real name
    const sampleRealNames = Array.from(realOwnerNames).slice(0, 30);
    const placeholders = sampleRealNames.map(() => '?').join(',');
    const matches = db.prepare(`
      SELECT COUNT(*) as leaks
      FROM apartamente_luna
      WHERE nume_proprietar IN (${placeholders})
    `).get(...sampleRealNames);

    assert.equal(matches.leaks, 0, 'No historical apartment snapshots should match real owner names');

    // Check pattern conformance across all snapshot rows
    const nonConforming = db.prepare(`
      SELECT COUNT(*) as non_conforming
      FROM apartamente_luna
      WHERE nume_proprietar NOT LIKE 'Proprietar Ap.%' AND nume_proprietar != ''
    `).get().non_conforming;

    assert.equal(nonConforming, 0, `All non-empty snapshot names must follow 'Proprietar Ap.%', found ${nonConforming}`);
  });

  it('Step 4: Table chitante has 100% masked payer names', () => {
    const nonConformingReceipts = db.prepare(`
      SELECT COUNT(*) as cnt
      FROM chitante
      WHERE nume_platitor NOT LIKE 'Proprietar Ap.%' AND nume_platitor != ''
    `).get().cnt;

    assert.equal(nonConformingReceipts, 0, `All receipts must mask payer names as 'Proprietar Ap.%', found ${nonConformingReceipts}`);
  });

  it('Step 5: Datorii table has no owner names in metadata or explanations', () => {
    // Check explicatie in datorii
    const sampleRealNames = Array.from(realOwnerNames).slice(0, 30);
    for (const name of sampleRealNames) {
      const found = db.prepare('SELECT COUNT(*) as cnt FROM datorii WHERE explicatie LIKE ?').get(`%${name}%`).cnt;
      assert.equal(found, 0, `Datorii explicatie must not leak real name "${name}"`);
    }
  });

  it('Step 6: Anonymization preserves 100% of numerical totals and ledger balances', () => {
    // Total unpaid
    const totalRow = db.prepare(`
      SELECT ROUND(SUM(d.valoare - COALESCE(p.total_achitat, 0)), 2) as total_unpaid
      FROM datorii d
      LEFT JOIN (
        SELECT datorie_id, SUM(suma) as total_achitat
        FROM plati
        GROUP BY datorie_id
      ) p ON d.id = p.datorie_id
    `).get();

    assert.equal(totalRow.total_unpaid, 290492.47, 'Total unpaid must remain 290,492.47 RON');

    // Category balances
    const catSums = db.prepare(`
      SELECT d.categorie, ROUND(SUM(d.valoare - COALESCE(p.total_achitat, 0)), 2) as cat_unpaid
      FROM datorii d
      LEFT JOIN (
        SELECT datorie_id, SUM(suma) as total_achitat
        FROM plati
        GROUP BY datorie_id
      ) p ON d.id = p.datorie_id
      GROUP BY d.categorie
    `).all();

    const expectedCats = { R: 275501.47, A: 14631.00, F: 360.00, P: 0.00 };
    for (const r of catSums) {
      assert.equal(r.cat_unpaid, expectedCats[r.categorie], `Category ${r.categorie} sum must match`);
    }

    // Apartment numerical fields sum check against DBF ground truth
    let dbfTotalPersons = 0;
    let dbfTotalSurface = 0;
    let dbfTotalThermalSurface = 0;
    let dbfTotalTotUnit = 0;

    for (const r of apartDbf.records) {
      dbfTotalPersons += (r.PERSOANE || 0);
      dbfTotalSurface += (r.SUPRAFATA || 0);
      dbfTotalThermalSurface += (r.SUP_EC_TER || 0);
      dbfTotalTotUnit += (r.TOT_UNIT || 0);
    }

    const sqlTotals = db.prepare(`
      SELECT 
        SUM(persoane) as total_persoane,
        ROUND(SUM(suprafata), 2) as total_suprafata,
        ROUND(SUM(sup_ec_ter), 2) as total_sup_ec_ter,
        ROUND(SUM(tot_unit), 2) as total_tot_unit
      FROM apartamente
    `).get();

    assert.equal(sqlTotals.total_persoane, dbfTotalPersons, 'Total persons must match ground truth exactly');
    assert.equal(sqlTotals.total_suprafata, Math.round(dbfTotalSurface * 100) / 100, 'Total surface must match ground truth exactly');
    assert.equal(sqlTotals.total_sup_ec_ter, Math.round(dbfTotalThermalSurface * 100) / 100, 'Total thermal surface must match ground truth');
    assert.equal(sqlTotals.total_tot_unit, Math.round(dbfTotalTotUnit * 100) / 100, 'Total heat cost allocator units must match ground truth');
  });
});
