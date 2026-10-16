/**
 * tests/e2e/lifecycle_cashier_penalties.test.js
 *
 * End-to-End Test Suite for Milestone 3:
 * - TRE (publishMonth) & GOL (unpublishMonth with zero-payment guard)
 * - Penalties engine (CHI.PRG pen/Lpenal: 15th + ZILE_PENAL + 1, 0.2%/day, principal cap, HJKG < 0 guard, idempotent P booking)
 * - Cashier Individual (CHI: oldest month first, P -> A -> F -> R, CEX 15-branch builder, daily CASA summary, voidReceipt)
 * - Cashier Collective (CHO: block batch receipts and negative repair fund discharges)
 * - Month Close & Reopen (SLU: index rotation, charge zeroing, preserved fields, audited reopen)
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { initializeSchema } = require('../../db');
const { getApartmentLedger, getPeriodCalculationData } = require('../../services/ledger');
const { calculatePenalties, bookPenalties } = require('../../services/penalties');
const { buildExplanationCex, allocateLumpSum, issueReceipt, issueCollectiveReceipt, voidReceipt } = require('../../services/cashier');
const { publishMonth, unpublishMonth, closeMonth, reopenMonth } = require('../../services/lifecycle');

function createIsolatedDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeSchema(db);

  // Seed 1 block and 2 apartments for clean lifecycle testing
  const bInfo = db.prepare(`
    INSERT INTO blocuri (
      asociatie_id, bloc, strada, numar, cota_fr, cp_ar, cp_ac, cp_in,
      ivar, inar, ivac, inac, gunoi, curent_sc
    ) VALUES (1, 'B1', 'Str. Test', '10', 15, 'C', 'C', 'P', 100, 120, 0, 0, 100, 50)
  `).run();
  const blocId = Number(bInfo.lastInsertRowid);

  const a1Info = db.prepare(`
    INSERT INTO apartamente (
      bloc_id, numar_apart, nume_proprietar, persoane, suprafata,
      cp_ar, cp_ac, cp_in, iv_ar_bu, in_ar_bu, max_fr, calc_fr, fond_repar, ch_box,
      iv_r1, in_r1
    ) VALUES (?, '1', 'Popescu Ion', 2, 50, 'C', 'C', 'P', 10, 20, 100, 20, 25, 12, 50, 80)
  `).run(blocId);

  const a2Info = db.prepare(`
    INSERT INTO apartamente (
      bloc_id, numar_apart, nume_proprietar, persoane, suprafata,
      cp_ar, cp_ac, cp_in, iv_ar_bu, in_ar_bu, max_fr, calc_fr, fond_repar, ch_box,
      iv_r1, in_r1
    ) VALUES (?, '2', 'Ionescu Maria', 2, 50, 'C', 'C', 'P', 15, 25, 100, 100, 25, 0, 30, 60)
  `).run(blocId);

  return {
    db,
    blocId,
    apt1Id: Number(a1Info.lastInsertRowid),
    apt2Id: Number(a2Info.lastInsertRowid)
  };
}

describe('Milestone 3: TRE / GOL Publication, Cashier (CHI/CHO), Penalties & SLU Lifecycle', () => {
  let ctx;

  beforeEach(() => {
    ctx = createIsolatedDb();
  });

  it('M3.1: TRE (publishMonth) calculates charges, books R/F/A rows into datorii, and freezes snapshots', () => {
    const { db, apt1Id, apt2Id } = ctx;
    const res = publishMonth(db);

    assert.equal(res.status, 'PUBLICATA');
    assert.ok(res.inserted_rows >= 5, 'Must insert R, F, A for Apt 1 and R, A for Apt 2 (Apt 2 has calc_fr >= max_fr so F=0)');

    // Apt 1 has calc_fr (20) < max_fr (100) -> gets F = 15. Apt 2 has calc_fr (100) >= max_fr (100) -> F = 0
    const l1 = getApartmentLedger(db, apt1Id);
    const l2 = getApartmentLedger(db, apt2Id);

    assert.equal(l1.totals.F, 15);
    assert.equal(l1.totals.A, 25);
    assert.ok(l1.totals.R > 0);
    assert.equal(l2.totals.F, 0, 'Apt 2 reached max_fr=100 so working fund installment must be 0');
    assert.equal(l2.totals.A, 25);

    // Duplicate publish must be blocked
    assert.throws(() => publishMonth(db), /PUBLICATA|deja/);
  });

  it('M3.2: GOL (unpublishMonth) succeeds when 0 payments exist and is strictly blocked once any receipt is issued', () => {
    const { db, apt1Id } = ctx;
    publishMonth(db);

    // 0 payments -> GOL succeeds
    const unpub = unpublishMonth(db);
    assert.equal(unpub.status, 'DESCHISA');
    assert.ok(unpub.deleted_rows >= 5);

    // Re-publish and issue a receipt -> GOL must be blocked!
    publishMonth(db);
    issueReceipt(db, { apartament_id: apt1Id, suma: 10, data_emiterii: '2026-09-20' });

    assert.throws(
      () => unpublishMonth(db),
      /blocată|plăți/i,
      'GOL must throw when at least one receipt exists against the period'
    );
  });

  it('M3.3: On-demand Penalty Engine enforces 15th + ZILE_PENAL + 1 start date, 0.2%/day, principal cap, HJKG < 0 guard, and idempotent P booking', () => {
    const { db, blocId, apt1Id } = ctx;

    // Insert historical debt row for 2026 / 01 (due date = 2026-02-15, start date = 2026-02-15 + 45 + 1 = 2026-04-02)
    db.prepare(`
      INSERT INTO datorii (apartament_id, bloc_id, an, luna, luna_text, categorie, valoare, sursa)
      VALUES (?, ?, 2026, 1, 'IANUARIE', 'R', 100.00, 'IMPORT')
    `).run(apt1Id, blocId);

    // 1. On 2026-04-02 (0 delay days): penalty = 0
    const pZero = calculatePenalties(db, apt1Id, '2026-04-02');
    assert.equal(pZero.total_penalizare, 0);

    // 2. On 2026-04-12 (10 delay days): 10 * 0.2% * 100 = 2.00 RON
    const pTen = calculatePenalties(db, apt1Id, '2026-04-12');
    assert.equal(pTen.rows[0].zile_intarziere, 10);
    assert.equal(pTen.total_penalizare, 2.00);

    // 3. On 2028-04-12 (>500 days): capped at 100% of principal = 100.00 RON
    const pCap = calculatePenalties(db, apt1Id, '2028-04-12');
    assert.equal(pCap.total_penalizare, 100.00);
    assert.equal(pCap.rows[0].plafonat, true);

    // 4. Idempotent booking: calling bookPenalties twice does not duplicate P rows
    const b1 = bookPenalties(db, apt1Id, '2026-04-12');
    const b2 = bookPenalties(db, apt1Id, '2026-04-12');
    assert.equal(b1.total_booked, 2.00);
    assert.equal(b2.total_booked, 2.00);
    const pCount = db.prepare("SELECT COUNT(*) AS cnt FROM datorii WHERE apartament_id = ? AND categorie = 'P'").get(apt1Id).cnt;
    assert.equal(pCount, 1, 'Idempotent penalty booking must not create duplicate P rows');

    // 5. Net balance guard (HJKG < 0): if apartment has credit balance overall, penalties are suppressed to 0
    db.prepare(`
      INSERT INTO datorii (apartament_id, bloc_id, an, luna, luna_text, categorie, valoare, sursa)
      VALUES (?, ?, 2026, 2, 'FEBRUARIE', 'R', -250.00, 'MANUAL')
    `).run(apt1Id, blocId);
    const pCredit = calculatePenalties(db, apt1Id, '2026-05-01');
    assert.equal(pCredit.credit_suppressed, true);
    assert.equal(pCredit.total_penalizare, 0);
  });

  it('M3.4: Cashier Individual (CHI) allocates lump-sum oldest month first & P -> A -> F -> R, builds CEX, updates CASA, and supports voiding', () => {
    const { db, blocId, apt1Id } = ctx;

    // Seed debts across 2 months: 2026/07 (R=50, A=20) and 2026/08 (R=60, F=15, A=20, P=5)
    const ins = db.prepare(`
      INSERT INTO datorii (apartament_id, bloc_id, an, luna, categorie, valoare, sursa)
      VALUES (?, ?, ?, ?, ?, ?, 'IMPORT')
    `);
    ins.run(apt1Id, blocId, 2026, 7, 'R', 50);
    ins.run(apt1Id, blocId, 2026, 7, 'A', 20);
    ins.run(apt1Id, blocId, 2026, 8, 'R', 60);
    ins.run(apt1Id, blocId, 2026, 8, 'F', 15);
    ins.run(apt1Id, blocId, 2026, 8, 'A', 20);
    ins.run(apt1Id, blocId, 2026, 8, 'P', 5);

    // Pay 90 RON lump sum:
    // Should pay 2026/07 first: A (20) -> R (50) [subtotal 70]
    // Then 2026/08: P (5) -> A (15 partial out of 20) [subtotal 20, total 90]
    const receipt = issueReceipt(db, {
      apartament_id: apt1Id,
      suma: 90,
      data_emiterii: '2026-09-15',
      sursa: 'CASA'
    });

    assert.equal(receipt.suma, 90);
    assert.deepEqual(
      receipt.allocations.map(a => `${a.luna}:${a.categorie}:${a.suma}`),
      ['7:A:20', '7:R:50', '8:P:5', '8:A:15']
    );
    assert.equal(receipt.cex, 'REGIE, FOND REPARATII SI PENALITATI');

    // Verify daily CASA summary row created
    const casaRow = db.prepare("SELECT * FROM casa WHERE data = '2026-09-15'").get();
    assert.ok(casaRow, 'Daily CASA summary row must be created');
    assert.equal(casaRow.suma, 90);
    assert.equal(casaRow.explicatie, 'INCASARILE ZILEI DE 2026-09-15');

    // Void receipt and verify debt restoration
    voidReceipt(db, receipt.id, { motiv: 'Eroare operare' });
    const ledgerAfterVoid = getApartmentLedger(db, apt1Id);
    assert.equal(ledgerAfterVoid.totals.totalRestanta, 170);
  });

  it('M3.5: Cashier Collective (CHO) supports batch block receipts and negative repair fund discharges', () => {
    const { db, blocId, apt1Id, apt2Id } = ctx;
    publishMonth(db); // Each apt gets A = 25

    // Discharge -10 RON per apartment from Repair Fund (A)
    const cho = issueCollectiveReceipt(db, {
      bloc_id: blocId,
      mod: 'PER_APARTAMENT',
      categorie: 'A',
      suma_per_apartament: -10,
      lucrare: 'Reparatie acoperis',
      data_emiterii: '2026-09-25'
    });

    assert.equal(cho.apartamente_afectate, 2);
    assert.equal(cho.suma_totala, -20);
    assert.ok(cho.id > 0);
  });

  it('M3.6: SLU (closeMonth & reopenMonth) rotates meter/allocator indices, zeroes monthly charges, preserves recurring fields, and supports audited reopen', () => {
    const { db, apt1Id } = ctx;

    const closeRes = closeMonth(db, { inchis_de: 'Tester' });
    assert.equal(closeRes.closed_period.status, 'INCHISA');
    assert.equal(closeRes.next_period.an, 2026);
    assert.equal(closeRes.next_period.luna, 10);
    assert.equal(closeRes.next_period.status, 'DESCHISA');

    // Verify meter & allocator rotation and charge zeroing on Apt 1
    const aptAfterClose = db.prepare('SELECT * FROM apartamente WHERE id = ?').get(apt1Id);
    assert.equal(aptAfterClose.iv_ar_bu, 20, 'Old cold water index must become previous new index (20)');
    assert.equal(aptAfterClose.in_ar_bu, 0, 'New cold water index must be zeroed');
    assert.equal(aptAfterClose.iv_r1, 80, 'Old allocator R1 index must become previous new index (80)');
    assert.equal(aptAfterClose.in_r1, 0, 'New allocator R1 index must be zeroed');
    assert.equal(aptAfterClose.apa_rece, 0, 'Monthly computed apa_rece must be zeroed');
    assert.equal(aptAfterClose.ch_box, 12, 'Recurring manual ch_box must be preserved');
    assert.equal(aptAfterClose.fond_repar, 25, 'Recurring fond_repar must be preserved');

    // Reopen month 9/2026 and verify snapshot restoration + audit log
    const reopenRes = reopenMonth(db, { an: 2026, luna: 9, username: 'Auditor' });
    assert.equal(reopenRes.status, 'PUBLICATA');
    const aptAfterReopen = db.prepare('SELECT * FROM apartamente WHERE id = ?').get(apt1Id);
    assert.equal(aptAfterReopen.iv_ar_bu, 10, 'Reopened month must restore iv_ar_bu = 10 from snapshot');
    assert.equal(aptAfterReopen.in_ar_bu, 20, 'Reopened month must restore in_ar_bu = 20 from snapshot');
    assert.ok(aptAfterReopen.apa_rece > 0, 'Reopened month must restore computed apa_rece');

    const audit = db.prepare("SELECT * FROM audit_logs WHERE actiune = 'REOPEN_MONTH'").get();
    assert.ok(audit, 'Reopen must be logged in audit_logs');
  });
});
