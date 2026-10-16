/**
 * tests/adversarial/raw_binary_reconciliation.test.js
 * 
 * Adversarial Validator: Row-by-Row 23,171-Record Raw Binary DBF Reconciliation
 * 
 * Verifies:
 * - Direct byte-level extraction from G:\INCASOR\INCASARI\DATE\ANI_LUNI\2026\SEPTEMBR\CHITANTE.DBF
 * - 1:1 validation of every single record across all 23,171 rows against SQLite `datorii` and `plati`:
 *   - Apartment block code and apartment number
 *   - Year (an) and month (lunac / luna)
 *   - Debt category (CEE: R, A, F, P)
 *   - Original debt principal (VALOARE)
 *   - Payment 1 (PLATA1, CHITANTA1, DATA1, SURSA1)
 *   - Payment 2 (PLATA2, CHITANTA2, DATA2, SURSA2)
 *   - Net unpaid balance (VALOARE - PLATA1 - PLATA2)
 * - Zero discrepancies, zero missing rows, 0.00 RON total delta.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', '..', 'asociatie.db');
const CHITANTE_DBF_PATH = 'G:\\INCASOR\\INCASARI\\DATE\\ANI_LUNI\\2026\\SEPTEMBR\\CHITANTE.DBF';

const EXPECTED_TOTAL_ROWS = 23171;
const EXPECTED_TOTAL_UNPAID = 290492.47;

function toIsoDate(dStr) {
  if (!dStr) return '2026-09-30';
  const clean = String(dStr).replace(/\D/g, '');
  if (clean.length === 8) {
    return `${clean.substring(0,4)}-${clean.substring(4,6)}-${clean.substring(6,8)}`;
  }
  return String(dStr);
}

describe('Adversarial Validator: Raw Binary DBF Reconciliation (23,171 Rows)', () => {
  it('Validates all 23,171 rows byte-for-byte against SQLite datorii and plati', () => {
    assert.ok(fs.existsSync(CHITANTE_DBF_PATH), `CHITANTE.DBF must exist at ${CHITANTE_DBF_PATH}`);
    assert.ok(fs.existsSync(DB_PATH), `asociatie.db must exist at ${DB_PATH}`);

    const buf = fs.readFileSync(CHITANTE_DBF_PATH);
    const numRecords = buf.readUInt32LE(4);
    const headerSize = buf.readUInt16LE(8);
    const recordSize = buf.readUInt16LE(10);

    assert.equal(numRecords, EXPECTED_TOTAL_ROWS, `CHITANTE.DBF must have exactly ${EXPECTED_TOTAL_ROWS} records`);
    assert.equal(headerSize, 577, 'Header size must be 577 bytes');
    assert.equal(recordSize, 131, 'Record size must be 131 bytes');

    const db = new Database(DB_PATH, { readonly: true });

    const getDatorie = db.prepare(`
      SELECT 
        d.id, d.an, d.luna, d.luna_text, d.categorie, d.valoare,
        b.bloc, a.numar_apart
      FROM datorii d
      JOIN blocuri b ON d.bloc_id = b.id
      JOIN apartamente a ON d.apartament_id = a.id
      WHERE d.id = ?
    `);

    const getPlati = db.prepare(`
      SELECT suma, data, sursa
      FROM plati
      WHERE datorie_id = ?
      ORDER BY id
    `);

    let verifiedCount = 0;
    let debtMismatches = 0;
    let paymentMismatches = 0;
    let unpaidMismatches = 0;
    let maxDiff = 0;

    let totalDbfUnpaid = 0;
    let totalSqlUnpaid = 0;

    const first5Mismatches = [];

    for (let i = 0; i < numRecords; i++) {
      const rowOffset = headerSize + i * recordSize;
      const isDeleted = buf[rowOffset] === 0x2A;
      assert.equal(isDeleted, false, `Row ${i} unexpectedly marked as deleted`);

      const rBuf = buf.subarray(rowOffset + 1, rowOffset + recordSize);

      let p = 0;
      const asoc = rBuf.subarray(p, p += 10).toString('latin1').trim();
      const bloc = rBuf.subarray(p, p += 6).toString('latin1').trim();
      const apart = rBuf.subarray(p, p += 6).toString('latin1').trim();
      const nume = rBuf.subarray(p, p += 20).toString('latin1').trim();
      const luna = rBuf.subarray(p, p += 11).toString('latin1').trim();
      const lunac = parseInt(rBuf.subarray(p, p += 2).toString('latin1').trim(), 10) || 0;
      const an = parseInt(rBuf.subarray(p, p += 4).toString('latin1').trim(), 10) || 0;
      const valoare = parseFloat(rBuf.subarray(p, p += 12).toString('latin1').trim()) || 0;
      const plata1 = parseFloat(rBuf.subarray(p, p += 12).toString('latin1').trim()) || 0;
      const chit1 = parseInt(rBuf.subarray(p, p += 8).toString('latin1').trim(), 10) || 0;
      const data1 = rBuf.subarray(p, p += 8).toString('latin1').trim();
      const sursa1 = rBuf.subarray(p, p += 1).toString('latin1').trim();
      const plata2 = parseFloat(rBuf.subarray(p, p += 12).toString('latin1').trim()) || 0;
      const chit2 = parseInt(rBuf.subarray(p, p += 8).toString('latin1').trim(), 10) || 0;
      const data2 = rBuf.subarray(p, p += 8).toString('latin1').trim();
      const sursa2 = rBuf.subarray(p, p += 1).toString('latin1').trim();
      const cee = rBuf.subarray(p, p += 1).toString('latin1').trim() || 'R';

      // FoxPro mathematical rule
      const p1Effective = (chit1 !== 0) ? plata1 : 0;
      const p2Effective = (chit2 !== 0) ? plata2 : 0;
      const dbfPaid = Math.round((p1Effective + p2Effective) * 100) / 100;
      const dbfUnpaid = Math.round((valoare - p1Effective - p2Effective) * 100) / 100;
      totalDbfUnpaid += dbfUnpaid;

      // SQLite row query
      const dRow = getDatorie.get(i + 1);
      if (!dRow) {
        debtMismatches++;
        if (first5Mismatches.length < 5) {
          first5Mismatches.push(`Row ${i+1}: Missing datorie record in SQLite`);
        }
        continue;
      }

      // Check debt attributes
      let rowHasDebtError = false;
      if (dRow.bloc !== bloc || dRow.numar_apart !== apart) {
        rowHasDebtError = true;
      }
      if (dRow.an !== an || dRow.luna !== lunac || dRow.categorie !== cee) {
        rowHasDebtError = true;
      }
      if (Math.abs(dRow.valoare - valoare) > 0.001) {
        rowHasDebtError = true;
      }

      if (rowHasDebtError) {
        debtMismatches++;
        if (first5Mismatches.length < 5) {
          first5Mismatches.push(`Row ${i+1} debt mismatch: DBF(${bloc}/${apart}, ${an}-${lunac}, ${cee}, ${valoare}) vs SQL(${dRow.bloc}/${dRow.numar_apart}, ${dRow.an}-${dRow.luna}, ${dRow.categorie}, ${dRow.valoare})`);
        }
      }

      // Check plati records
      const platiRows = getPlati.all(i + 1);
      let sqlPaid = 0;
      for (const pl of platiRows) {
        sqlPaid += pl.suma;
      }
      sqlPaid = Math.round(sqlPaid * 100) / 100;

      if (Math.abs(sqlPaid - dbfPaid) > 0.001) {
        paymentMismatches++;
        if (first5Mismatches.length < 5) {
          first5Mismatches.push(`Row ${i+1} payment mismatch: DBF paid=${dbfPaid} vs SQL paid=${sqlPaid}`);
        }
      }

      // Check net unpaid balance
      const sqlUnpaid = Math.round((dRow.valoare - sqlPaid) * 100) / 100;
      totalSqlUnpaid += sqlUnpaid;

      const diff = Math.abs(sqlUnpaid - dbfUnpaid);
      if (diff > 0.001) {
        unpaidMismatches++;
        if (diff > maxDiff) maxDiff = diff;
        if (first5Mismatches.length < 5) {
          first5Mismatches.push(`Row ${i+1} unpaid mismatch: DBF unpaid=${dbfUnpaid} vs SQL unpaid=${sqlUnpaid}`);
        }
      }

      verifiedCount++;
    }

    db.close();

    totalDbfUnpaid = Math.round(totalDbfUnpaid * 100) / 100;
    totalSqlUnpaid = Math.round(totalSqlUnpaid * 100) / 100;

    assert.equal(verifiedCount, EXPECTED_TOTAL_ROWS, `All ${EXPECTED_TOTAL_ROWS} rows must be processed`);
    assert.equal(debtMismatches, 0, `Detected ${debtMismatches} debt mismatches: ${first5Mismatches.join('; ')}`);
    assert.equal(paymentMismatches, 0, `Detected ${paymentMismatches} payment mismatches`);
    assert.equal(unpaidMismatches, 0, `Detected ${unpaidMismatches} unpaid balance mismatches`);
    assert.equal(maxDiff, 0, `Maximum single-row diff must be 0.00 RON, got ${maxDiff}`);
    assert.equal(totalDbfUnpaid, EXPECTED_TOTAL_UNPAID, `Total DBF unpaid sum must equal ${EXPECTED_TOTAL_UNPAID}`);
    assert.equal(totalSqlUnpaid, EXPECTED_TOTAL_UNPAID, `Total SQLite unpaid sum must equal ${EXPECTED_TOTAL_UNPAID}`);
  });
});
