/**
 * tests/adversarial/stress_test_workspace_csv_anonymization.test.js
 *
 * Adversarial QA & Stress Test Suite:
 * - Test 1: Anonymization Verification: asociatie table scan (no 'ORHIDEEA' or '26199625', contains 'ASOCIATIA DE PROPRIETARI TEST' and 'RO00000000').
 * - Test 2: Multi-Tenant Workspace Isolation: asociatie_id = 1 (10 blocks, 78 apartments) vs asociatie_id = 2 (0 blocks, 0 apartments).
 * - Test 3: CSV Generation Integrity: Notice board & internal reports (LAF, LAR, LIP, SBL) via reportToCsv:
 *           UTF-8 BOM (\uFEFF), no HTML tags, header matches report columns, data row counts match report rows.
 * - Test 4: Financial Reconciliation: Full ledger integrity (23,171 datorii rows, exact 290,492.47 RON balance).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Database = require('better-sqlite3');
const { generateReport, reportToCsv } = require('../../services/reports');
const { getPeriodCalculationData } = require('../../services/ledger');

const DB_PATH = path.join(__dirname, '..', '..', 'asociatie.db');

describe('Adversarial Stress Test: Workspace Isolation, CSV Generation & Anonymization Integrity', () => {
  const db = new Database(DB_PATH, { readonly: true });

  // ---------------------------------------------------------------------------
  // Test 1: Anonymization Verification
  // ---------------------------------------------------------------------------
  describe('Test 1: Anonymization Verification in SQLite asociatie.db', () => {
    it('asociatie table does NOT contain "ORHIDEEA" or "26199625", and contains "ASOCIATIA DE PROPRIETARI TEST" and "RO00000000"', () => {
      const rows = db.prepare('SELECT * FROM asociatie').all();
      assert.ok(rows.length >= 1, 'asociatie table must contain at least 1 association');

      const asoc = rows[0];

      // Assert expected anonymized identity
      assert.equal(asoc.nume, 'ASOCIATIA DE PROPRIETARI TEST', 'Association name must be anonymized');
      assert.equal(asoc.cod_fiscal, 'RO00000000', 'Fiscal code must be anonymized to RO00000000');

      // Comprehensive row-level scan across all columns
      for (const row of rows) {
        for (const [colName, val] of Object.entries(row)) {
          const strVal = String(val ?? '');
          assert.ok(
            !strVal.toUpperCase().includes('ORHIDEEA'),
            `Column "${colName}" must not contain "ORHIDEEA", found: "${strVal}"`
          );
          assert.ok(
            !strVal.includes('26199625'),
            `Column "${colName}" must not contain legacy CUI "26199625", found: "${strVal}"`
          );
        }
      }

      // SQL-level query scan to ensure zero matching records
      const leakCount = db.prepare(`
        SELECT COUNT(*) as cnt FROM asociatie
        WHERE nume LIKE '%ORHIDEEA%'
           OR cod_fiscal LIKE '%26199625%'
           OR administrator LIKE '%ORHIDEEA%'
           OR presedinte LIKE '%ORHIDEEA%'
      `).get().cnt;

      assert.equal(leakCount, 0, 'SQL query must find 0 records containing sensitive identifiers');

      // Verify positive presence via SQL query
      const matchCount = db.prepare(`
        SELECT COUNT(*) as cnt FROM asociatie
        WHERE nume = 'ASOCIATIA DE PROPRIETARI TEST'
          AND cod_fiscal = 'RO00000000'
      `).get().cnt;

      assert.equal(matchCount, 1, 'Must find exactly 1 record matching anonymized credentials');
    });
  });

  // ---------------------------------------------------------------------------
  // Test 2: Multi-Tenant Workspace Isolation
  // ---------------------------------------------------------------------------
  describe('Test 2: Multi-Tenant Workspace Isolation', () => {
    it('asociatie_id = 1 retains 10 blocks and 78 apartments; asociatie_id = 2 has 0 blocks and 0 apartments', () => {
      // 1. Direct SQL verification for asociatie_id = 1
      const blocks1 = db.prepare('SELECT COUNT(*) as c FROM blocuri WHERE asociatie_id = 1').get().c;
      const apts1 = db.prepare(`
        SELECT COUNT(*) as c
        FROM apartamente a
        JOIN blocuri b ON a.bloc_id = b.id
        WHERE b.asociatie_id = 1
      `).get().c;

      assert.equal(blocks1, 10, 'asociatie_id = 1 must contain exactly 10 blocks');
      assert.equal(apts1, 78, 'asociatie_id = 1 must contain exactly 78 apartments');

      // 2. Direct SQL verification for asociatie_id = 2 (unprovisioned / blank tenant)
      const blocks2 = db.prepare('SELECT COUNT(*) as c FROM blocuri WHERE asociatie_id = 2').get().c;
      const apts2 = db.prepare(`
        SELECT COUNT(*) as c
        FROM apartamente a
        JOIN blocuri b ON a.bloc_id = b.id
        WHERE b.asociatie_id = 2
      `).get().c;

      assert.equal(blocks2, 0, 'asociatie_id = 2 must contain exactly 0 blocks');
      assert.equal(apts2, 0, 'asociatie_id = 2 must contain exactly 0 apartments');

      // 3. Debts query for asociatie_id = 2
      const debts2 = db.prepare(`
        SELECT COUNT(*) as c
        FROM datorii d
        JOIN blocuri b ON d.bloc_id = b.id
        WHERE b.asociatie_id = 2
      `).get().c;

      assert.equal(debts2, 0, 'asociatie_id = 2 must contain exactly 0 debts');
    });
  });

  // ---------------------------------------------------------------------------
  // Test 3: CSV Generation Integrity
  // ---------------------------------------------------------------------------
  describe('Test 3: CSV Generation Integrity (Notice Board & Internal Reports)', () => {
    const targetReports = ['LAF', 'LAR', 'LIP', 'SBL'];

    for (const reportCode of targetReports) {
      it(`Report ${reportCode}: exports valid UTF-8 BOM CSV matching columns and row counts without HTML tags`, () => {
        // Generate the report model
        const report = generateReport(db, reportCode);
        assert.ok(report, `generateReport("${reportCode}") must return a valid report object`);
        assert.ok(Array.isArray(report.columns) && report.columns.length > 0, `${reportCode} must have columns`);
        assert.ok(Array.isArray(report.rows) && report.rows.length > 0, `${reportCode} must have data rows`);

        // Convert report to CSV string
        const csv = reportToCsv(report);
        assert.equal(typeof csv, 'string', `${reportCode} CSV output must be a string`);

        // 1. Assert UTF-8 Byte Order Mark (\uFEFF)
        assert.ok(csv.startsWith('\uFEFF'), `${reportCode} CSV must start with UTF-8 BOM (\\uFEFF)`);

        // 2. Assert output does NOT contain HTML markup
        assert.ok(!csv.includes('<!DOCTYPE html>'), `${reportCode} CSV must not contain <!DOCTYPE html>`);
        assert.ok(!csv.toLowerCase().includes('<html>'), `${reportCode} CSV must not contain <html> tags`);
        assert.ok(!csv.includes('<table'), `${reportCode} CSV must not contain <table> tags`);

        // 3. Parse lines (strip BOM first)
        const rawContent = csv.slice(1);
        const lines = rawContent.split('\r\n').filter(line => line.length > 0);

        // Header + data rows
        const expectedLineCount = 1 + report.rows.length;
        assert.equal(
          lines.length,
          expectedLineCount,
          `${reportCode} CSV line count (${lines.length}) must equal 1 header + ${report.rows.length} rows`
        );

        // 4. Header matches report columns
        const expectedHeader = report.columns
          .map(c => `"${String(c.label || c.key).replace(/"/g, '""')}"`)
          .join(',');
        assert.equal(lines[0], expectedHeader, `${reportCode} CSV header must exactly match column definitions`);

        // 5. Data rows count matches report rows count
        const dataLines = lines.slice(1);
        assert.equal(
          dataLines.length,
          report.rows.length,
          `${reportCode} CSV data lines count must match report.rows.length`
        );
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Test 4: Financial Reconciliation
  // ---------------------------------------------------------------------------
  describe('Test 4: Financial Reconciliation & Ledger Invariance', () => {
    it('datorii retains exactly 23,171 rows and the exact 290,492.47 RON balance', () => {
      // 1. Row count assertion
      const countRow = db.prepare('SELECT COUNT(*) as cnt FROM datorii').get();
      assert.equal(countRow.cnt, 23171, 'datorii must retain all 23,171 historical records');

      // 2. Net unpaid balance assertion
      const totalRow = db.prepare(`
        SELECT ROUND(SUM(d.valoare - COALESCE(p.total_achitat, 0)), 2) as total_unpaid
        FROM datorii d
        LEFT JOIN (
          SELECT datorie_id, SUM(suma) as total_achitat
          FROM plati
          GROUP BY datorie_id
        ) p ON d.id = p.datorie_id
      `).get();

      assert.equal(
        totalRow.total_unpaid,
        290492.47,
        'Cumulative net unpaid balance in datorii must equal exactly 290,492.47 RON'
      );

      // 3. Category distribution reconciliation
      const catRows = db.prepare(`
        SELECT d.categorie, ROUND(SUM(d.valoare - COALESCE(p.total_achitat, 0)), 2) as unpaid
        FROM datorii d
        LEFT JOIN (
          SELECT datorie_id, SUM(suma) as total_achitat
          FROM plati
          GROUP BY datorie_id
        ) p ON d.id = p.datorie_id
        GROUP BY d.categorie
        ORDER BY d.categorie
      `).all();

      const expectedCategories = {
        A: 14631.00,
        F: 360.00,
        P: 0.00,
        R: 275501.47
      };

      const actualCategories = { A: 0, F: 0, P: 0, R: 0 };
      for (const r of catRows) {
        actualCategories[r.categorie] = r.unpaid;
      }

      assert.deepEqual(
        actualCategories,
        expectedCategories,
        'Category breakdown (R, A, F, P) must match expected ground truth balances'
      );
    });
  });
});
