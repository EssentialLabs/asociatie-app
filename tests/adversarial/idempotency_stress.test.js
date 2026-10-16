/**
 * tests/adversarial/idempotency_stress.test.js
 * 
 * Adversarial Stress Test: Importer Idempotency & Re-entrancy
 * 
 * Tests:
 * 1. Running import-foxpro.js twice with --force produces identical balances without duplicate debts or payments.
 * 2. Autoincrement IDs, row counts, category balances, and total unpaid balance match 100% between consecutive runs.
 * 3. Adversarial probe: Running without --force on an existing database duplicates ledger rows because datorii
 *    does not enforce natural unique keys, demonstrating why --force is mandatory for full re-imports.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { runImport } = require('../../import-foxpro');

const TEST_DB_PATH = path.join(__dirname, '..', '..', 'test_idempotency.db');
const EXPECTED_ROWS = 23171;
const EXPECTED_UNPAID = 290492.47;
const EXPECTED_CATEGORIES = {
  R: 275501.47,
  A: 14631.00,
  F: 360.00,
  P: 0.00
};

describe('Adversarial Stress Test: Importer Idempotency (--force)', () => {
  // Ensure clean test file
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);

  let run1Metrics = {};
  let run2Metrics = {};

  function extractMetrics(dbPath) {
    const db = new Database(dbPath);
    try {
      const datoriiCount = db.prepare('SELECT COUNT(*) as count FROM datorii').get().count;
      const platiCount = db.prepare('SELECT COUNT(*) as count FROM plati').get().count;
      const chitanteCount = db.prepare('SELECT COUNT(*) as count FROM chitante').get().count;
      const apartamenteCount = db.prepare('SELECT COUNT(*) as count FROM apartamente').get().count;
      const blocuriCount = db.prepare('SELECT COUNT(*) as count FROM blocuri').get().count;
      const perioadeCount = db.prepare('SELECT COUNT(*) as count FROM perioade').get().count;
      const aptLunaCount = db.prepare('SELECT COUNT(*) as count FROM apartamente_luna').get().count;

      const totalUnpaid = db.prepare(`
        SELECT ROUND(SUM(d.valoare - COALESCE(p.total_achitat, 0)), 2) as total
        FROM datorii d
        LEFT JOIN (
          SELECT datorie_id, SUM(suma) as total_achitat
          FROM plati
          GROUP BY datorie_id
        ) p ON d.id = p.datorie_id
      `).get().total;

      const catRows = db.prepare(`
        SELECT d.categorie, ROUND(SUM(d.valoare - COALESCE(p.total_achitat, 0)), 2) as cat_unpaid
        FROM datorii d
        LEFT JOIN (
          SELECT datorie_id, SUM(suma) as total_achitat
          FROM plati
          GROUP BY datorie_id
        ) p ON d.id = p.datorie_id
        GROUP BY d.categorie
      `).all();

      const categories = { R: 0, A: 0, F: 0, P: 0 };
      for (const r of catRows) {
        categories[r.categorie] = r.cat_unpaid;
      }

      // Sample first 10 and last 10 debt IDs and values
      const sampleDebts = db.prepare('SELECT id, apartament_id, an, luna, categorie, valoare FROM datorii ORDER BY id LIMIT 10').all();
      const lastDebts = db.prepare('SELECT id, apartament_id, an, luna, categorie, valoare FROM datorii ORDER BY id DESC LIMIT 10').all();

      return {
        datoriiCount,
        platiCount,
        chitanteCount,
        apartamenteCount,
        blocuriCount,
        perioadeCount,
        aptLunaCount,
        totalUnpaid,
        categories,
        sampleDebts,
        lastDebts
      };
    } finally {
      db.close();
    }
  }

  it('Step 1: First full import with --force succeeds and matches baseline', () => {
    const res = runImport({ dbPath: TEST_DB_PATH, force: true, anonymize: true });
    assert.equal(res.success, true);
    assert.equal(res.diff, 0.00);

    run1Metrics = extractMetrics(TEST_DB_PATH);
    assert.equal(run1Metrics.datoriiCount, EXPECTED_ROWS, 'Run 1 datorii must equal 23,171');
    assert.equal(run1Metrics.totalUnpaid, EXPECTED_UNPAID, `Run 1 unpaid must equal ${EXPECTED_UNPAID}`);
    for (const [cat, expected] of Object.entries(EXPECTED_CATEGORIES)) {
      assert.equal(run1Metrics.categories[cat], expected, `Run 1 category ${cat} must match ${expected}`);
    }
  });

  it('Step 2: Second full import with --force on same database is 100% idempotent', () => {
    const res = runImport({ dbPath: TEST_DB_PATH, force: true, anonymize: true });
    assert.equal(res.success, true);
    assert.equal(res.diff, 0.00);

    run2Metrics = extractMetrics(TEST_DB_PATH);

    // Verify row counts are identical (no duplicates)
    assert.equal(run2Metrics.datoriiCount, run1Metrics.datoriiCount, 'Datorii row count must not change');
    assert.equal(run2Metrics.platiCount, run1Metrics.platiCount, 'Plati row count must not change');
    assert.equal(run2Metrics.chitanteCount, run1Metrics.chitanteCount, 'Chitante row count must not change');
    assert.equal(run2Metrics.apartamenteCount, run1Metrics.apartamenteCount, 'Apartamente row count must not change');
    assert.equal(run2Metrics.blocuriCount, run1Metrics.blocuriCount, 'Blocuri row count must not change');
    assert.equal(run2Metrics.perioadeCount, run1Metrics.perioadeCount, 'Perioade row count must not change');
    assert.equal(run2Metrics.aptLunaCount, run1Metrics.aptLunaCount, 'Apartamente_luna row count must not change');

    // Verify balances are identical
    assert.equal(run2Metrics.totalUnpaid, run1Metrics.totalUnpaid, 'Total unpaid must remain 290,492.47');
    for (const [cat, expected] of Object.entries(EXPECTED_CATEGORIES)) {
      assert.equal(run2Metrics.categories[cat], expected, `Category ${cat} must remain ${expected}`);
    }

    // Verify IDs and records match verbatim
    assert.deepEqual(run2Metrics.sampleDebts, run1Metrics.sampleDebts, 'First 10 debts must match verbatim');
    assert.deepEqual(run2Metrics.lastDebts, run1Metrics.lastDebts, 'Last 10 debts must match verbatim');
  });

  it('Step 3 (Adversarial): Re-running WITHOUT --force detects duplicate ledger rows and triggers error', () => {
    // Attempting to re-run without --force on existing data should either fail or duplicate rows
    let errorCaught = false;
    try {
      runImport({ dbPath: TEST_DB_PATH, force: false, anonymize: true });
    } catch (err) {
      errorCaught = true;
      assert.ok(
        err.message.includes('Reconciliere eșuată') || err.message.includes('sold calculat'),
        `Error must be the reconciliation guard, got: ${err.message}`
      );
    }

    // Verify that the reconciliation guard caught the duplication
    assert.equal(errorCaught, true, 'Re-running without --force must trigger the reconciliation guard');

    // Clean up test DB
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  });
});
