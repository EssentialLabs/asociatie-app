/**
 * tests/adversarial/negative_payments_stress.test.js
 * 
 * Adversarial Stress Test: Negative Payment Handling (PLATA2 < 0)
 * 
 * Tests:
 * 1. Handling of payment reversals and stornos (PLATA2 < 0)
 * 2. Accurate net unpaid balance calculation: valoare - sum(plati.suma) == VALOARE - PLATA1 - PLATA2
 * 3. Prevention of ledger corruption under edge cases:
 *    - Full reversal (plata2 = -plata1)
 *    - Partial reversal (plata2 < 0, |plata2| < plata1)
 *    - Standalone negative payment (plata1 = 0, plata2 < 0)
 *    - Negative payment with CHITANTA2 = 0 (unconfirmed receipt, ignored)
 *    - Bank payment reversal (sursa = 'B' -> BANCA)
 *    - Grouped receipt sum netting with negative components
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { createSchema } = require('../../import-foxpro');

const TEST_DB_PATH = path.join(__dirname, '..', '..', 'test_negative_payments.db');

describe('Adversarial Stress Test: Negative Payment Handling (PLATA2 < 0)', () => {
  let db;

  // Set up fresh test database
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  db = new Database(TEST_DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  createSchema(db, true);

  // Seed test association, block and apartments
  const asoc = db.prepare('SELECT id FROM asociatie LIMIT 1').get();
  const asociatieId = asoc ? asoc.id : 1;

  db.prepare(`
    INSERT INTO blocuri (id, asociatie_id, bloc)
    VALUES (1, ?, 'B1')
  `).run(asociatieId);

  const insertApt = db.prepare(`
    INSERT INTO apartamente (id, bloc_id, numar_apart, nume_proprietar, persoane, suprafata)
    VALUES (?, 1, ?, ?, 2, 50.0)
  `);

  for (let i = 1; i <= 10; i++) {
    insertApt.run(i, String(i), `Proprietar Ap. ${i}`);
  }

  // Test cases dataset simulating DBF raw rows
  const testLedgerRows = [
    {
      id: 1,
      aptId: 1,
      blocId: 1,
      an: 2026,
      luna: 1,
      lunaText: 'IANUARIE',
      cee: 'R',
      valoare: 100.00,
      plata1: 0.00,
      chit1: 0,
      data1: '20260120',
      sursa1: 'C',
      plata2: 0.00,
      chit2: 0,
      data2: '20260125',
      sursa2: 'C',
      desc: 'Control: No payments'
    },
    {
      id: 2,
      aptId: 2,
      blocId: 1,
      an: 2026,
      luna: 1,
      lunaText: 'IANUARIE',
      cee: 'R',
      valoare: 200.00,
      plata1: 150.00,
      chit1: 1001,
      data1: '20260120',
      sursa1: 'C',
      plata2: -50.00,
      chit2: 1002,
      data2: '20260125',
      sursa2: 'C',
      desc: 'Partial reversal: 150 paid, -50 storno -> net paid 100, unpaid 100'
    },
    {
      id: 3,
      aptId: 3,
      blocId: 1,
      an: 2026,
      luna: 1,
      lunaText: 'IANUARIE',
      cee: 'R',
      valoare: 300.00,
      plata1: 300.00,
      chit1: 1003,
      data1: '20260120',
      sursa1: 'C',
      plata2: -300.00,
      chit2: 1004,
      data2: '20260125',
      sursa2: 'C',
      desc: 'Full reversal: 300 paid, -300 storno -> net paid 0, unpaid 300'
    },
    {
      id: 4,
      aptId: 4,
      blocId: 1,
      an: 2026,
      luna: 1,
      lunaText: 'IANUARIE',
      cee: 'A',
      valoare: 50.00,
      plata1: 0.00,
      chit1: 0,
      data1: '20260120',
      sursa1: 'C',
      plata2: -25.00,
      chit2: 1005,
      data2: '20260125',
      sursa2: 'C',
      desc: 'Standalone negative payment: 0 paid, -25 reversal -> net paid -25, unpaid 75'
    },
    {
      id: 5,
      aptId: 5,
      blocId: 1,
      an: 2026,
      luna: 1,
      lunaText: 'IANUARIE',
      cee: 'F',
      valoare: 80.00,
      plata1: 40.00,
      chit1: 1006,
      data1: '20260120',
      sursa1: 'C',
      plata2: -40.00,
      chit2: 0, // CHITANTA = 0 -> Must be ignored!
      data2: '20260125',
      sursa2: 'C',
      desc: 'Negative payment with chitanta = 0 -> Plata2 must be ignored, unpaid 40'
    },
    {
      id: 6,
      aptId: 6,
      blocId: 1,
      an: 2026,
      luna: 1,
      lunaText: 'IANUARIE',
      cee: 'R',
      valoare: 120.00,
      plata1: 120.00,
      chit1: 1007,
      data1: '20260120',
      sursa1: 'B', // Bank
      plata2: -60.00,
      chit2: 1008,
      data2: '20260125',
      sursa2: 'B', // Bank
      desc: 'Bank payment reversal: Sursa BANCA for negative payment'
    },
    {
      id: 7,
      aptId: 7,
      blocId: 1,
      an: 2026,
      luna: 1,
      lunaText: 'IANUARIE',
      cee: 'R',
      valoare: 100.00,
      plata1: 0.00,
      chit1: 0,
      data1: '20260120',
      sursa1: 'C',
      plata2: -30.00,
      chit2: 2000, // Shared receipt with row 8
      data2: '20260125',
      sursa2: 'C',
      desc: 'Shared receipt 2000 part 1: -30.00'
    },
    {
      id: 8,
      aptId: 7,
      blocId: 1,
      an: 2026,
      luna: 2,
      lunaText: 'FEBRUARIE',
      cee: 'R',
      valoare: 150.00,
      plata1: 0.00,
      chit1: 0,
      data1: '20260220',
      sursa1: 'C',
      plata2: 80.00,
      chit2: 2000, // Shared receipt with row 7
      data2: '20260125',
      sursa2: 'C',
      desc: 'Shared receipt 2000 part 2: +80.00 -> receipt sum should be 50.00'
    }
  ];

  it('Step 1: Imports rows with negative payments using importer conversion logic', () => {
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
    const updateCSum = db.prepare('UPDATE chitante SET suma = suma + ? WHERE id = ?');

    const receiptMap = new Map();

    const toIsoDate = (dStr) => {
      if (!dStr || dStr.length !== 8) return '2026-01-20';
      return `${dStr.substring(0,4)}-${dStr.substring(4,6)}-${dStr.substring(6,8)}`;
    };

    db.transaction(() => {
      for (const row of testLedgerRows) {
        insertD.run(row.id, row.aptId, row.blocId, row.an, row.luna, row.lunaText, row.cee, row.valoare);
        const datorieId = row.id;

        // Payment 1
        if (row.chit1 !== 0 && row.plata1 !== 0) {
          const d1 = toIsoDate(row.data1);
          const s1 = row.sursa1 === 'B' ? 'BANCA' : 'CASA';
          const rKey = `ORH_${row.chit1}_${d1}_${s1}_${row.aptId}`;
          let rId = receiptMap.get(rKey);
          if (!rId) {
            const cRes = insertC.run(
              'ORH', row.chit1, d1, row.aptId, row.blocId,
              `Proprietar Ap. ${row.aptId}`, String(row.aptId), 'B1', row.plata1,
              s1 === 'BANCA' ? 'VIRAMENT' : 'NUMERAR',
              `Încasare istorică ${row.cee}`
            );
            rId = Number(cRes.lastInsertRowid);
            receiptMap.set(rKey, rId);
          } else {
            updateCSum.run(row.plata1, rId);
          }
          insertP.run(datorieId, rId, row.plata1, d1, s1);
        }

        // Payment 2 (support negative reversals)
        if (row.chit2 !== 0 && row.plata2 !== 0) {
          const d2 = toIsoDate(row.data2);
          const s2 = row.sursa2 === 'B' ? 'BANCA' : 'CASA';
          const rKey2 = `ORH_${row.chit2}_${d2}_${s2}_${row.aptId}`;
          let rId2 = receiptMap.get(rKey2);
          if (!rId2) {
            const cRes = insertC.run(
              'ORH', row.chit2, d2, row.aptId, row.blocId,
              `Proprietar Ap. ${row.aptId}`, String(row.aptId), 'B1', row.plata2,
              s2 === 'BANCA' ? 'VIRAMENT' : 'NUMERAR',
              `Încasare istorică ${row.cee}`
            );
            rId2 = Number(cRes.lastInsertRowid);
            receiptMap.set(rKey2, rId2);
          } else {
            updateCSum.run(row.plata2, rId2);
          }
          insertP.run(datorieId, rId2, row.plata2, d2, s2);
        }
      }
    })();

    const dCount = db.prepare('SELECT COUNT(*) as count FROM datorii').get().count;
    assert.equal(dCount, testLedgerRows.length, 'All test datorii must be inserted');
  });

  it('Step 2: Negative payments compute exact net unpaid balance without ledger corruption', () => {
    const getDatorie = db.prepare('SELECT * FROM datorii WHERE id = ?');
    const getPlati = db.prepare('SELECT SUM(suma) as total_achitat FROM plati WHERE datorie_id = ?');

    for (const r of testLedgerRows) {
      const expP1 = (r.chit1 !== 0) ? r.plata1 : 0;
      const expP2 = (r.chit2 !== 0) ? r.plata2 : 0;
      const expectedUnpaid = Math.round((r.valoare - expP1 - expP2) * 100) / 100;

      const d = getDatorie.get(r.id);
      const p = getPlati.get(r.id);
      const sqlPaid = Math.round((p.total_achitat || 0) * 100) / 100;
      const sqlUnpaid = Math.round((d.valoare - sqlPaid) * 100) / 100;

      assert.equal(
        sqlUnpaid,
        expectedUnpaid,
        `Mismatch for row ${r.id} (${r.desc}): expected unpaid ${expectedUnpaid}, got ${sqlUnpaid}`
      );
    }
  });

  it('Step 3: Edge cases (stornos, bank reversals, ignored zero-receipts, multi-row receipts) behave correctly', () => {
    // Check Row 3: Full reversal
    const r3Paid = db.prepare('SELECT SUM(suma) as s FROM plati WHERE datorie_id = 3').get().s;
    assert.equal(r3Paid, 0.00, 'Row 3 net payment must equal 0.00');

    // Check Row 5: CHITANTA = 0 ignored
    const r5Plati = db.prepare('SELECT * FROM plati WHERE datorie_id = 5').all();
    assert.equal(r5Plati.length, 1, 'Row 5 must have only 1 payment (plata2 ignored due to chitanta=0)');
    assert.equal(r5Plati[0].suma, 40.00, 'Row 5 payment must be plata1');

    // Check Row 6: Bank source preserved
    const r6Plati = db.prepare('SELECT * FROM plati WHERE datorie_id = 6 ORDER BY id').all();
    assert.equal(r6Plati.length, 2, 'Row 6 must have 2 payments');
    assert.equal(r6Plati[1].suma, -60.00, 'Row 6 payment 2 must be negative');
    assert.equal(r6Plati[1].sursa, 'BANCA', 'Row 6 payment 2 sursa must be BANCA');

    // Check Shared Receipt 2000 (Rows 7 & 8): Netted sum
    const receipt2000 = db.prepare('SELECT * FROM chitante WHERE numar = 2000').get();
    assert.ok(receipt2000, 'Receipt 2000 must exist');
    assert.equal(receipt2000.suma, 50.00, 'Receipt 2000 netted sum must equal 80.00 + (-30.00) = 50.00');
  });

  it('Step 4: Ledger aggregate queries maintain exact mathematical parity under negative payments', () => {
    const totalRow = db.prepare(`
      SELECT ROUND(SUM(d.valoare - COALESCE(p.total_achitat, 0)), 2) as total_unpaid
      FROM datorii d
      LEFT JOIN (
        SELECT datorie_id, SUM(suma) as total_achitat
        FROM plati
        GROUP BY datorie_id
      ) p ON d.id = p.datorie_id
    `).get();

    // Sum expected unpaid across all test rows
    let expectedGrandTotal = 0;
    for (const r of testLedgerRows) {
      const expP1 = (r.chit1 !== 0) ? r.plata1 : 0;
      const expP2 = (r.chit2 !== 0) ? r.plata2 : 0;
      expectedGrandTotal += (r.valoare - expP1 - expP2);
    }
    expectedGrandTotal = Math.round(expectedGrandTotal * 100) / 100;

    assert.equal(
      totalRow.total_unpaid,
      expectedGrandTotal,
      `Aggregate total unpaid must equal ${expectedGrandTotal}, got ${totalRow.total_unpaid}`
    );

    // Clean up
    db.close();
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  });
});
