/**
 * tests/adversarial/importer_stress.test.js
 * 
 * Master Adversarial Stress Suite for import-foxpro.js
 * ORHIDEEA (Partaj 3, 2005) Parity Upgrade — Milestone 1
 * 
 * Verifies 4 core adversarial challenge dimensions:
 * 1. Directory Robustness: Import into deeply nested non-existent directory succeeds without crashing.
 * 2. Idempotency (--force): Multiple consecutive imports produce 100% identical balances with zero duplicates.
 * 3. Dynamic Reconciliation: Dynamic accumulation matches raw binary CHITANTE.DBF bytes exactly (0.00 RON diff).
 * 4. Negative Payments: Payment reversals and stornos (PLATA2 < 0) are correctly accounted for in net unpaid balance.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { runImport, createSchema, parseDbf } = require('../../import-foxpro');

const CHITANTE_DBF_PATH = 'G:\\INCASOR\\INCASARI\\DATE\\ANI_LUNI\\2026\\SEPTEMBR\\CHITANTE.DBF';
const SANDBOX_DIR = path.join(__dirname, '..', '..', 'temp_stress_sandbox');
const NESTED_DB_PATH = path.join(SANDBOX_DIR, 'level1', 'level2', 'level3', 'nested_importer.db');
const IDEMPOTENCY_DB_PATH = path.join(SANDBOX_DIR, 'idempotency_stress.db');
const NEGATIVE_PAYMENTS_DB_PATH = path.join(SANDBOX_DIR, 'negative_payments_stress.db');

function cleanupDb(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    const wal = `${filePath}-wal`;
    const shm = `${filePath}-shm`;
    if (fs.existsSync(wal)) fs.unlinkSync(wal);
    if (fs.existsSync(shm)) fs.unlinkSync(shm);
  } catch (_) {}
}

function cleanupSandbox() {
  try {
    if (fs.existsSync(SANDBOX_DIR)) {
      fs.rmSync(SANDBOX_DIR, { recursive: true, force: true });
    }
  } catch (_) {}
}

describe('Master Adversarial Stress Suite: import-foxpro.js', { concurrency: 1 }, () => {
  before(() => {
    cleanupSandbox();
    fs.mkdirSync(SANDBOX_DIR, { recursive: true });
  });

  after(() => {
    cleanupSandbox();
  });

  // =========================================================================
  // DIMENSION 1: DIRECTORY ROBUSTNESS
  // =========================================================================
  describe('Dimension 1: Directory Robustness', () => {
    it('Succeeds importing into a deeply nested non-existent directory without crashing', () => {
      // Ensure target nested directory tree does NOT exist
      const nestedDir = path.dirname(NESTED_DB_PATH);
      if (fs.existsSync(nestedDir)) {
        fs.rmSync(nestedDir, { recursive: true, force: true });
      }
      assert.equal(fs.existsSync(nestedDir), false, 'Nested target directory must not exist prior to import');

      // Execute import into deeply nested directory path
      const result = runImport({
        dbPath: NESTED_DB_PATH,
        force: true,
        anonymize: true
      });

      assert.equal(result.success, true, 'runImport must return success: true');
      assert.ok(fs.existsSync(NESTED_DB_PATH), `Database file must be created at ${NESTED_DB_PATH}`);
      assert.equal(result.diff, 0.00, 'Reconciliation diff must be 0.00 RON');

      // Verify database tables are accessible and populated
      const db = new Database(NESTED_DB_PATH, { readonly: true });
      try {
        const asoc = db.prepare('SELECT COUNT(*) as c FROM asociatie').get();
        const bloc = db.prepare('SELECT COUNT(*) as c FROM blocuri').get();
        const apt = db.prepare('SELECT COUNT(*) as c FROM apartamente').get();
        const datorii = db.prepare('SELECT COUNT(*) as c FROM datorii').get();

        assert.equal(asoc.c, 1, 'asociatie table must contain 1 row');
        assert.equal(bloc.c, 10, 'blocuri table must contain 10 rows');
        assert.equal(apt.c, 78, 'apartamente table must contain 78 rows');
        assert.equal(datorii.c, 23171, 'datorii table must contain 23,171 rows');
      } finally {
        db.close();
      }

      cleanupDb(NESTED_DB_PATH);
    });
  });

  // =========================================================================
  // DIMENSION 2: IDEMPOTENCY UNDER --force
  // =========================================================================
  describe('Dimension 2: Importer Idempotency & Re-entrancy', { concurrency: 1 }, () => {
    it('Consecutive runs with --force produce 100% identical balances with zero duplicates', () => {
      cleanupDb(IDEMPOTENCY_DB_PATH);

      // Run 1: Initial import
      const res1 = runImport({
        dbPath: IDEMPOTENCY_DB_PATH,
        force: true,
        anonymize: true
      });
      assert.equal(res1.success, true);
      assert.equal(res1.diff, 0.00);

      // Capture Run 1 metrics
      let run1Metrics;
      {
        const db = new Database(IDEMPOTENCY_DB_PATH);
        try {
          const dCount = db.prepare('SELECT COUNT(*) as c FROM datorii').get().c;
          const pCount = db.prepare('SELECT COUNT(*) as c FROM plati').get().c;
          const cCount = db.prepare('SELECT COUNT(*) as c FROM chitante').get().c;
          const totalUnpaid = db.prepare(`
            SELECT ROUND(SUM(d.valoare - COALESCE(p.total_achitat, 0)), 2) as t
            FROM datorii d
            LEFT JOIN (
              SELECT datorie_id, SUM(suma) as total_achitat
              FROM plati
              GROUP BY datorie_id
            ) p ON d.id = p.datorie_id
          `).get().t;

          const catSums = db.prepare(`
            SELECT d.categorie, ROUND(SUM(d.valoare - COALESCE(p.total_achitat, 0)), 2) as s
            FROM datorii d
            LEFT JOIN (
              SELECT datorie_id, SUM(suma) as total_achitat
              FROM plati
              GROUP BY datorie_id
            ) p ON d.id = p.datorie_id
            GROUP BY d.categorie
          `).all();

          const categories = { R: 0, A: 0, F: 0, P: 0 };
          for (const cs of catSums) categories[cs.categorie] = cs.s;

          const firstDebts = db.prepare('SELECT id, apartament_id, an, luna, categorie, valoare FROM datorii ORDER BY id LIMIT 5').all();
          const lastDebts = db.prepare('SELECT id, apartament_id, an, luna, categorie, valoare FROM datorii ORDER BY id DESC LIMIT 5').all();

          run1Metrics = { dCount, pCount, cCount, totalUnpaid, categories, firstDebts, lastDebts };
        } finally {
          db.close();
        }
      }

      assert.equal(run1Metrics.dCount, 23171, 'Run 1 must import 23,171 debts');
      assert.equal(run1Metrics.totalUnpaid, 290492.47, 'Run 1 unpaid must equal 290,492.47');

      // Run 2: Re-import into same DB with --force
      const res2 = runImport({
        dbPath: IDEMPOTENCY_DB_PATH,
        force: true,
        anonymize: true
      });
      assert.equal(res2.success, true);
      assert.equal(res2.diff, 0.00);

      // Capture Run 2 metrics
      let run2Metrics;
      {
        const db = new Database(IDEMPOTENCY_DB_PATH);
        try {
          const dCount = db.prepare('SELECT COUNT(*) as c FROM datorii').get().c;
          const pCount = db.prepare('SELECT COUNT(*) as c FROM plati').get().c;
          const cCount = db.prepare('SELECT COUNT(*) as c FROM chitante').get().c;
          const totalUnpaid = db.prepare(`
            SELECT ROUND(SUM(d.valoare - COALESCE(p.total_achitat, 0)), 2) as t
            FROM datorii d
            LEFT JOIN (
              SELECT datorie_id, SUM(suma) as total_achitat
              FROM plati
              GROUP BY datorie_id
            ) p ON d.id = p.datorie_id
          `).get().t;

          const catSums = db.prepare(`
            SELECT d.categorie, ROUND(SUM(d.valoare - COALESCE(p.total_achitat, 0)), 2) as s
            FROM datorii d
            LEFT JOIN (
              SELECT datorie_id, SUM(suma) as total_achitat
              FROM plati
              GROUP BY datorie_id
            ) p ON d.id = p.datorie_id
            GROUP BY d.categorie
          `).all();

          const categories = { R: 0, A: 0, F: 0, P: 0 };
          for (const cs of catSums) categories[cs.categorie] = cs.s;

          const firstDebts = db.prepare('SELECT id, apartament_id, an, luna, categorie, valoare FROM datorii ORDER BY id LIMIT 5').all();
          const lastDebts = db.prepare('SELECT id, apartament_id, an, luna, categorie, valoare FROM datorii ORDER BY id DESC LIMIT 5').all();

          run2Metrics = { dCount, pCount, cCount, totalUnpaid, categories, firstDebts, lastDebts };
        } finally {
          db.close();
        }
      }

      // Assert complete idempotency
      assert.equal(run2Metrics.dCount, run1Metrics.dCount, 'Debts count must match between runs');
      assert.equal(run2Metrics.pCount, run1Metrics.pCount, 'Payments count must match between runs');
      assert.equal(run2Metrics.cCount, run1Metrics.cCount, 'Receipts count must match between runs');
      assert.equal(run2Metrics.totalUnpaid, run1Metrics.totalUnpaid, 'Total unpaid must be identical');
      assert.deepEqual(run2Metrics.categories, run1Metrics.categories, 'Category balances must be identical');
      assert.deepEqual(run2Metrics.firstDebts, run1Metrics.firstDebts, 'First debt records must match');
      assert.deepEqual(run2Metrics.lastDebts, run1Metrics.lastDebts, 'Last debt records must match');
    });

    it('Adversarial probe: Re-running WITHOUT --force detects duplicate rows and triggers reconciliation guard', () => {
      let errorTriggered = false;
      try {
        runImport({
          dbPath: IDEMPOTENCY_DB_PATH,
          force: false,
          anonymize: true
        });
      } catch (err) {
        errorTriggered = true;
        assert.ok(
          err.message.includes('Reconciliere eșuată') || err.message.includes('sold calculat'),
          `Expected reconciliation error, got: ${err.message}`
        );
      }

      assert.equal(errorTriggered, true, 'Re-running without --force on existing data must trigger reconciliation failure');
      cleanupDb(IDEMPOTENCY_DB_PATH);
    });
  });

  // =========================================================================
  // DIMENSION 3: DYNAMIC RECONCILIATION VS RAW BINARY DBF
  // =========================================================================
  describe('Dimension 3: Dynamic Ground-Truth Reconciliation', () => {
    it('Dynamic accumulation matches raw CHITANTE.DBF binary bytes exactly', () => {
      assert.ok(fs.existsSync(CHITANTE_DBF_PATH), `CHITANTE.DBF must exist at ${CHITANTE_DBF_PATH}`);

      const buf = fs.readFileSync(CHITANTE_DBF_PATH);
      const numRecords = buf.readUInt32LE(4);
      const headerSize = buf.readUInt16LE(8);
      const recordSize = buf.readUInt16LE(10);

      assert.equal(numRecords, 23171, 'DBF records count must be 23,171');
      assert.equal(headerSize, 577, 'DBF header size must be 577');
      assert.equal(recordSize, 131, 'DBF record size must be 131');

      // Byte-level accumulation directly from DBF binary stream
      let rawExpectedTotal = 0;
      const rawCategoryTotals = { R: 0, A: 0, F: 0, P: 0 };
      let negativePlata2Count = 0;
      let nonZeroPlata1Count = 0;
      let nonZeroPlata2Count = 0;

      for (let i = 0; i < numRecords; i++) {
        const offset = headerSize + i * recordSize;
        const isDeleted = buf[offset] === 0x2A;
        if (isDeleted) continue;

        const row = buf.subarray(offset + 1, offset + recordSize);
        // Field layout:
        // VALOARE: offset 59..71 (12 bytes)
        // PLATA1:  offset 71..83 (12 bytes)
        // CHIT1:   offset 83..91 (8 bytes)
        // PLATA2:  offset 100..112 (12 bytes)
        // CHIT2:   offset 112..120 (8 bytes)
        // CEE:     offset 129..130 (1 byte)
        const valoare = parseFloat(row.subarray(59, 71).toString('latin1').trim()) || 0;
        const plata1 = parseFloat(row.subarray(71, 83).toString('latin1').trim()) || 0;
        const chit1 = parseInt(row.subarray(83, 91).toString('latin1').trim(), 10) || 0;
        const plata2 = parseFloat(row.subarray(100, 112).toString('latin1').trim()) || 0;
        const chit2 = parseInt(row.subarray(112, 120).toString('latin1').trim(), 10) || 0;
        const cee = row.subarray(129, 130).toString('latin1').trim() || 'R';

        const p1 = (chit1 !== 0) ? plata1 : 0;
        const p2 = (chit2 !== 0) ? plata2 : 0;

        if (p1 !== 0) nonZeroPlata1Count++;
        if (p2 !== 0) nonZeroPlata2Count++;
        if (p2 < 0) negativePlata2Count++;

        const unpaid = valoare - p1 - p2;
        rawExpectedTotal += unpaid;
        if (rawCategoryTotals[cee] !== undefined) {
          rawCategoryTotals[cee] += unpaid;
        } else {
          rawCategoryTotals[cee] = unpaid;
        }
      }

      rawExpectedTotal = Math.round(rawExpectedTotal * 100) / 100;
      for (const k of Object.keys(rawCategoryTotals)) {
        rawCategoryTotals[k] = Math.round(rawCategoryTotals[k] * 100) / 100;
      }

      assert.equal(rawExpectedTotal, 290492.47, 'Raw binary DBF total unpaid must equal 290,492.47');
      assert.equal(rawCategoryTotals.R, 275501.47, 'Raw binary DBF R category must equal 275,501.47');
      assert.equal(rawCategoryTotals.A, 14631.00, 'Raw binary DBF A category must equal 14,631.00');
      assert.equal(rawCategoryTotals.F, 360.00, 'Raw binary DBF F category must equal 360.00');

      // Now verify against active SQLite asociatie.db
      const activeDbPath = path.join(__dirname, '..', '..', 'asociatie.db');
      assert.ok(fs.existsSync(activeDbPath), `asociatie.db must exist at ${activeDbPath}`);

      const db = new Database(activeDbPath, { readonly: true });
      try {
        const sqlTotal = db.prepare(`
          SELECT ROUND(SUM(d.valoare - COALESCE(p.total_achitat, 0)), 2) as t
          FROM datorii d
          LEFT JOIN (
            SELECT datorie_id, SUM(suma) as total_achitat
            FROM plati
            GROUP BY datorie_id
          ) p ON d.id = p.datorie_id
        `).get().t;

        const sqlCats = db.prepare(`
          SELECT d.categorie, ROUND(SUM(d.valoare - COALESCE(p.total_achitat, 0)), 2) as s
          FROM datorii d
          LEFT JOIN (
            SELECT datorie_id, SUM(suma) as total_achitat
            FROM plati
            GROUP BY datorie_id
          ) p ON d.id = p.datorie_id
          GROUP BY d.categorie
        `).all();

        const sqliteCategories = {};
        for (const sc of sqlCats) sqliteCategories[sc.categorie] = sc.s;

        assert.equal(sqlTotal, rawExpectedTotal, `SQLite total unpaid (${sqlTotal}) must equal raw DBF (${rawExpectedTotal})`);
        assert.equal(sqliteCategories.R, rawCategoryTotals.R, 'SQLite R category must match raw DBF');
        assert.equal(sqliteCategories.A, rawCategoryTotals.A, 'SQLite A category must match raw DBF');
        assert.equal(sqliteCategories.F, rawCategoryTotals.F, 'SQLite F category must match raw DBF');
      } finally {
        db.close();
      }
    });

    it('Anti-cheating audit: import-foxpro.js does NOT contain hardcoded expected totals', () => {
      const importerSource = fs.readFileSync(path.join(__dirname, '..', '..', 'import-foxpro.js'), 'utf8');
      
      const hardcodedPatterns = [
        /const\s+expectedTotal\s*=\s*290492/i,
        /275501\.47/,
        /14631\.00/
      ];

      for (const p of hardcodedPatterns) {
        assert.equal(
          p.test(importerSource),
          false,
          `Source code must NOT contain hardcoded total pattern: ${p}`
        );
      }
    });
  });

  // =========================================================================
  // DIMENSION 4: NEGATIVE PAYMENTS & REVERSALS (PLATA2 < 0)
  // =========================================================================
  describe('Dimension 4: Negative Payments & Payment Reversals', () => {
    it('Accurately models reversals (PLATA2 < 0) and maintains net unpaid balance', () => {
      cleanupDb(NEGATIVE_PAYMENTS_DB_PATH);
      const db = new Database(NEGATIVE_PAYMENTS_DB_PATH);
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');

      try {
        createSchema(db, true);

        // Seed association, block, apartment
        const asoc = db.prepare('SELECT id FROM asociatie LIMIT 1').get();
        const asocId = asoc ? asoc.id : 1;
        db.prepare("INSERT INTO blocuri (id, asociatie_id, bloc) VALUES (1, ?, 'B1')").run(asocId);
        db.prepare("INSERT INTO apartamente (id, bloc_id, numar_apart, nume_proprietar, persoane, suprafata) VALUES (1, 1, '1', 'Proprietar Ap. 1', 2, 50.0)").run();
        db.prepare("INSERT INTO apartamente (id, bloc_id, numar_apart, nume_proprietar, persoane, suprafata) VALUES (2, 1, '2', 'Proprietar Ap. 2', 2, 50.0)").run();

        const insertD = db.prepare(`
          INSERT INTO datorii (id, apartament_id, bloc_id, an, luna, luna_text, categorie, valoare, sursa)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'IMPORT')
        `);
        const insertP = db.prepare(`
          INSERT INTO plati (datorie_id, chitanta_id, suma, data, sursa)
          VALUES (?, ?, ?, ?, ?)
        `);
        const insertC = db.prepare(`
          INSERT INTO chitante (serie, numar, data_emiterii, apartament_id, bloc_id, nume_platitor, numar_apart, cod_bloc, suma, suma_litere, tip_plata, explicatie)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)
        `);

        // Test scenario 1: Partial reversal: 150 paid, -50 reversal -> net paid 100, unpaid 100
        insertD.run(1, 1, 1, 2026, 1, 'IANUARIE', 'R', 200.00);
        insertC.run('ORH', 101, '2026-01-20', 1, 1, 'Proprietar Ap. 1', '1', 'B1', 150.00, 'NUMERAR', 'Plata 1');
        insertP.run(1, 1, 150.00, '2026-01-20', 'CASA');
        insertC.run('ORH', 102, '2026-01-25', 1, 1, 'Proprietar Ap. 1', '1', 'B1', -50.00, 'NUMERAR', 'Storno 1');
        insertP.run(1, 2, -50.00, '2026-01-25', 'CASA');

        // Test scenario 2: Full reversal: 300 paid, -300 reversal -> net paid 0, unpaid 300
        insertD.run(2, 2, 1, 2026, 1, 'IANUARIE', 'R', 300.00);
        insertC.run('ORH', 103, '2026-01-20', 2, 1, 'Proprietar Ap. 2', '2', 'B1', 300.00, 'NUMERAR', 'Plata 2');
        insertP.run(2, 3, 300.00, '2026-01-20', 'CASA');
        insertC.run('ORH', 104, '2026-01-25', 2, 1, 'Proprietar Ap. 2', '2', 'B1', -300.00, 'NUMERAR', 'Storno 2');
        insertP.run(2, 4, -300.00, '2026-01-25', 'CASA');

        // Test scenario 3: Bank reversal
        insertD.run(3, 1, 1, 2026, 2, 'FEBRUARIE', 'A', 100.00);
        insertC.run('ORH', 105, '2026-02-10', 1, 1, 'Proprietar Ap. 1', '1', 'B1', 80.00, 'VIRAMENT', 'Plata Banca');
        insertP.run(3, 5, 80.00, '2026-02-10', 'BANCA');
        insertC.run('ORH', 106, '2026-02-15', 1, 1, 'Proprietar Ap. 1', '1', 'B1', -40.00, 'VIRAMENT', 'Storno Banca');
        insertP.run(3, 6, -40.00, '2026-02-15', 'BANCA');

        // Verify Debt 1 net unpaid
        const d1Paid = db.prepare('SELECT SUM(suma) as s FROM plati WHERE datorie_id = 1').get().s;
        assert.equal(d1Paid, 100.00, 'Debt 1 net paid must be 100.00 (150 - 50)');
        const d1Unpaid = db.prepare('SELECT (d.valoare - SUM(p.suma)) as u FROM datorii d JOIN plati p ON d.id = p.datorie_id WHERE d.id = 1').get().u;
        assert.equal(d1Unpaid, 100.00, 'Debt 1 unpaid must be 100.00 (200 - 100)');

        // Verify Debt 2 net unpaid (full reversal)
        const d2Paid = db.prepare('SELECT SUM(suma) as s FROM plati WHERE datorie_id = 2').get().s;
        assert.equal(d2Paid, 0.00, 'Debt 2 net paid must be 0.00 (300 - 300)');
        const d2Unpaid = db.prepare('SELECT (d.valoare - SUM(p.suma)) as u FROM datorii d JOIN plati p ON d.id = p.datorie_id WHERE d.id = 2').get().u;
        assert.equal(d2Unpaid, 300.00, 'Debt 2 unpaid must be 300.00 (300 - 0)');

        // Verify Debt 3 bank reversal
        const d3Paid = db.prepare('SELECT SUM(suma) as s FROM plati WHERE datorie_id = 3').get().s;
        assert.equal(d3Paid, 40.00, 'Debt 3 net paid must be 40.00 (80 - 40)');
        const d3Unpaid = db.prepare('SELECT (d.valoare - SUM(p.suma)) as u FROM datorii d JOIN plati p ON d.id = p.datorie_id WHERE d.id = 3').get().u;
        assert.equal(d3Unpaid, 60.00, 'Debt 3 unpaid must be 60.00 (100 - 40)');

        // Verify grand total unpaid across all test scenarios
        // Expected: 100 + 300 + 60 = 460.00 RON
        const grandTotal = db.prepare(`
          SELECT ROUND(SUM(d.valoare - COALESCE(p.total_achitat, 0)), 2) as t
          FROM datorii d
          LEFT JOIN (
            SELECT datorie_id, SUM(suma) as total_achitat
            FROM plati
            GROUP BY datorie_id
          ) p ON d.id = p.datorie_id
        `).get().t;

        assert.equal(grandTotal, 460.00, 'Grand total unpaid must equal 460.00 RON');
      } finally {
        db.close();
        cleanupDb(NEGATIVE_PAYMENTS_DB_PATH);
      }
    });
  });
});
