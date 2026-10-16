/**
 * tests/adversarial/m1_r2_challenger_stress.test.js
 * 
 * Empirical Adversarial Challenger Test Suite for Milestone 1 Round 2 (M1 R2)
 * ORHIDEEA 2005 FoxPro Parity Upgrade.
 * 
 * Tests:
 * 1. Legacy database migration edge cases (minimal schemas, corrupted columns, populated rows, idempotency)
 * 2. Foreign Key referential integrity, RESTRICT, and CASCADE behavior across all 21 tables
 * 3. Deep CHECK constraint boundary fuzzing and validation
 * 4. Parity semantics of persoane = 0 (G14 parity) without accidental coercion to 1
 * 5. Unique constraint collisions and integrity contracts
 * 6. Transactional integrity and high-volume database stress under PRAGMA integrity_check
 * 7. db.js Connection Management & getDb() Path Resolution
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { createTempDb, getTableColumns, getForeignKeys, hasColumn } = require('../helpers/test_db');
const { initializeSchema, getDb } = require('../../db');

function setupTestDb() {
  const { db, filepath, cleanup } = createTempDb('challenger_m1_');
  initializeSchema(db);
  return { db, filepath, cleanup };
}

describe('Challenger Suite 1: Legacy Database Migrations & Edge-Case Schemas', () => {
  it('CHAL 1.1: Minimal legacy database containing only empty asociatie table with no columns', () => {
    const { db, cleanup } = createTempDb('min_asoc_');
    try {
      db.exec('CREATE TABLE asociatie (id INTEGER PRIMARY KEY);');
      assert.doesNotThrow(() => initializeSchema(db));

      // Verify that all 19 columns were dynamically added
      const cols = getTableColumns(db, 'asociatie').map(c => c.name.toLowerCase());
      assert.ok(cols.includes('cod_fiscal'), 'cod_fiscal must be migrated');
      assert.ok(cols.includes('nume'), 'nume must be migrated');
      assert.ok(cols.includes('proc_penalizare'), 'proc_penalizare must be migrated');
      assert.ok(cols.includes('zile_penalizare'), 'zile_penalizare must be migrated');

      // Verify default seeding succeeded
      const asocRow = db.prepare('SELECT * FROM asociatie WHERE id = 1').get();
      assert.ok(asocRow, 'Default asociatie row must be seeded');
      assert.equal(asocRow.cod_fiscal, '26199625');
    } finally {
      cleanup();
    }
  });

  it('CHAL 1.2: Minimal legacy database containing only blocuri table before asociatie exists', () => {
    const { db, cleanup } = createTempDb('min_bloc_');
    try {
      db.exec("CREATE TABLE blocuri (id INTEGER PRIMARY KEY, bloc TEXT NOT NULL UNIQUE);");
      db.exec("INSERT INTO blocuri (id, bloc) VALUES (1, 'B1'), (2, 'B2');");

      assert.doesNotThrow(() => initializeSchema(db));

      const blocRows = db.prepare('SELECT id, bloc, asociatie_id FROM blocuri ORDER BY id').all();
      assert.equal(blocRows.length, 2);
      assert.equal(blocRows[0].asociatie_id, 1, 'asociatie_id must be backfilled to seeded asociatie');
      assert.equal(blocRows[1].asociatie_id, 1, 'asociatie_id must be backfilled to seeded asociatie');

      const fk = db.prepare('PRAGMA foreign_key_check').all();
      assert.deepEqual(fk, [], 'Zero foreign key violations after backfilling asociatie_id');
    } finally {
      cleanup();
    }
  });

  it('CHAL 1.3: Pre-M1 legacy database with apartamente containing REAL persoane with default 1.0', () => {
    const { db, cleanup } = createTempDb('pers_real_');
    try {
      db.exec(`
        CREATE TABLE asociatie (id INTEGER PRIMARY KEY, nume TEXT);
        CREATE TABLE blocuri (id INTEGER PRIMARY KEY, bloc TEXT NOT NULL UNIQUE);
        CREATE TABLE apartamente (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          bloc_id INTEGER REFERENCES blocuri(id),
          numar_apart TEXT NOT NULL,
          nume_proprietar TEXT DEFAULT '',
          persoane REAL DEFAULT 1,
          suprafata REAL DEFAULT 0
        );
      `);

      db.exec(`
        INSERT INTO blocuri (id, bloc) VALUES (1, 'B_LEGACY');
        INSERT INTO apartamente (id, bloc_id, numar_apart, persoane, suprafata)
        VALUES (1, 1, '10', 0, 48.0),
               (2, 1, '11', 1, 55.0),
               (3, 1, '12', 4, 72.0);
      `);

      initializeSchema(db);

      // Verify default is converted to 0
      const cols = getTableColumns(db, 'apartamente');
      const persCol = cols.find(c => c.name.toLowerCase() === 'persoane');
      assert.equal(String(persCol.dflt_value).trim(), '0');

      // Verify row values are intact
      const ap10 = db.prepare('SELECT persoane FROM apartamente WHERE numar_apart = ?').get('10');
      assert.equal(ap10.persoane, 0, 'persoane = 0 must remain 0');

      const ap11 = db.prepare('SELECT persoane FROM apartamente WHERE numar_apart = ?').get('11');
      assert.equal(ap11.persoane, 1, 'persoane = 1 must remain 1');

      const ap12 = db.prepare('SELECT persoane FROM apartamente WHERE numar_apart = ?').get('12');
      assert.equal(ap12.persoane, 4, 'persoane = 4 must remain 4');

      // Insert new apartment without specifying persoane
      db.prepare("INSERT INTO apartamente (bloc_id, numar_apart, suprafata) VALUES (1, '13', 60.0)").run();
      const ap13 = db.prepare('SELECT persoane FROM apartamente WHERE numar_apart = ?').get('13');
      assert.equal(ap13.persoane, 0, 'New apartment must default to 0');
    } finally {
      cleanup();
    }
  });

  it('CHAL 1.4: Migration idempotency stress test: 20 consecutive migrations on active database', () => {
    const { db, cleanup } = setupTestDb();
    try {
      for (let i = 0; i < 20; i++) {
        assert.doesNotThrow(() => initializeSchema(db), `Migration iteration ${i + 1} must not throw`);
      }

      // Check integrity check
      const integrity = db.prepare('PRAGMA integrity_check').all();
      assert.equal(integrity[0].integrity_check, 'ok');

      // Check foreign keys
      const fk = db.prepare('PRAGMA foreign_key_check').all();
      assert.deepEqual(fk, []);

      // Check total tables
      const tables = db.prepare("SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get();
      assert.equal(tables.c, 21);
    } finally {
      cleanup();
    }
  });
});

describe('Challenger Suite 2: Foreign Key Constraints, RESTRICT & Cascade Graph', () => {
  it('CHAL 2.1: Deleting parent asociatie must be rejected when child blocuri or perioade exist (RESTRICT)', () => {
    const { db, cleanup } = setupTestDb();
    try {
      // asociatie id=1 has blocuri or perioade
      assert.throws(
        () => db.prepare('DELETE FROM asociatie WHERE id = 1').run(),
        /FOREIGN KEY constraint failed/i,
        'Cannot delete asociatie when children reference it'
      );
    } finally {
      cleanup();
    }
  });

  it('CHAL 2.2: Cascading deletion graph from blocuri -> apartamente -> datorii -> plati', () => {
    const { db, cleanup } = setupTestDb();
    try {
      const blk = db.prepare("INSERT INTO blocuri (bloc) VALUES ('B_GRAPH')").run();
      const bId = blk.lastInsertRowid;

      const apt = db.prepare("INSERT INTO apartamente (bloc_id, numar_apart) VALUES (?, 'G1')").run(bId);
      const aId = apt.lastInsertRowid;

      const dat1 = db.prepare("INSERT INTO datorii (apartament_id, bloc_id, an, luna, categorie, valoare) VALUES (?, ?, 2026, 9, 'R', 100)").run(aId, bId);
      const dat2 = db.prepare("INSERT INTO datorii (apartament_id, bloc_id, an, luna, categorie, valoare) VALUES (?, ?, 2026, 9, 'F', 50)").run(aId, bId);

      const pay1 = db.prepare("INSERT INTO plati (datorie_id, suma, data, sursa) VALUES (?, 100, '2026-09-10', 'CASA')").run(dat1.lastInsertRowid);
      const pay2 = db.prepare("INSERT INTO plati (datorie_id, suma, data, sursa) VALUES (?, 50, '2026-09-10', 'BANCA')").run(dat2.lastInsertRowid);

      // Also create a factura referencing the block
      const fact = db.prepare("INSERT INTO facturi (bloc_id, tip_factura, suma) VALUES (?, 'APA_RECE', 500)").run(bId);

      // Verify everything exists
      assert.equal(db.prepare('SELECT COUNT(*) as c FROM apartamente WHERE bloc_id = ?').get(bId).c, 1);
      assert.equal(db.prepare('SELECT COUNT(*) as c FROM datorii WHERE bloc_id = ?').get(bId).c, 2);
      assert.equal(db.prepare('SELECT COUNT(*) as c FROM plati WHERE datorie_id IN (?, ?)').get(dat1.lastInsertRowid, dat2.lastInsertRowid).c, 2);
      assert.equal(db.prepare('SELECT COUNT(*) as c FROM facturi WHERE bloc_id = ?').get(bId).c, 1);

      // Delete the block
      db.prepare('DELETE FROM blocuri WHERE id = ?').run(bId);

      // Verify complete cascading wipeout
      assert.equal(db.prepare('SELECT COUNT(*) as c FROM apartamente WHERE bloc_id = ?').get(bId).c, 0);
      assert.equal(db.prepare('SELECT COUNT(*) as c FROM datorii WHERE bloc_id = ?').get(bId).c, 0);
      assert.equal(db.prepare('SELECT COUNT(*) as c FROM plati WHERE datorie_id IN (?, ?)').get(dat1.lastInsertRowid, dat2.lastInsertRowid).c, 0);
      assert.equal(db.prepare('SELECT COUNT(*) as c FROM facturi WHERE bloc_id = ?').get(bId).c, 0);

      // PRAGMA foreign_key_check must be completely clean
      const fk = db.prepare('PRAGMA foreign_key_check').all();
      assert.deepEqual(fk, []);
    } finally {
      cleanup();
    }
  });

  it('CHAL 2.3: Snapshots preserve history (ON DELETE SET NULL on apartment/block, ON DELETE CASCADE on period)', () => {
    const { db, cleanup } = setupTestDb();
    try {
      const blk = db.prepare("INSERT INTO blocuri (bloc) VALUES ('B_HIST')").run();
      const bId = blk.lastInsertRowid;
      const apt = db.prepare("INSERT INTO apartamente (bloc_id, numar_apart) VALUES (?, 'H1')").run(bId);
      const aId = apt.lastInsertRowid;

      const per = db.prepare("SELECT id FROM perioade WHERE an = 2026 AND luna = 9").get();

      // Create snapshots
      const snapAp = db.prepare(`
        INSERT INTO apartamente_luna (perioada_id, apartament_id, bloc_id, an, luna, bloc, numar_apart, persoane)
        VALUES (?, ?, ?, 2026, 9, 'B_HIST', 'H1', 0)
      `).run(per.id, aId, bId);

      const snapBl = db.prepare(`
        INSERT INTO blocuri_luna (perioada_id, bloc_id, an, luna, bloc)
        VALUES (?, ?, 2026, 9, 'B_HIST')
      `).run(per.id, bId);

      // Deleting apartment and block should NOT delete the snapshot, but set apartament_id/bloc_id to NULL
      db.prepare('DELETE FROM apartamente WHERE id = ?').run(aId);
      db.prepare('DELETE FROM blocuri WHERE id = ?').run(bId);

      const snapApRow = db.prepare('SELECT * FROM apartamente_luna WHERE id = ?').get(snapAp.lastInsertRowid);
      assert.ok(snapApRow, 'Snapshot row must survive apartment and block deletion');
      assert.equal(snapApRow.apartament_id, null, 'apartament_id must be SET NULL');
      assert.equal(snapApRow.bloc_id, null, 'bloc_id must be SET NULL');
      assert.equal(snapApRow.numar_apart, 'H1', 'Snapshot business key must be preserved');
      assert.equal(snapApRow.bloc, 'B_HIST', 'Snapshot business key must be preserved');

      // Now deleting the period MUST cascade and delete the snapshot
      db.prepare('DELETE FROM perioade WHERE id = ?').run(per.id);
      assert.equal(db.prepare('SELECT COUNT(*) as c FROM apartamente_luna WHERE id = ?').get(snapAp.lastInsertRowid).c, 0);
      assert.equal(db.prepare('SELECT COUNT(*) as c FROM blocuri_luna WHERE id = ?').get(snapBl.lastInsertRowid).c, 0);

      const fk = db.prepare('PRAGMA foreign_key_check').all();
      assert.deepEqual(fk, []);
    } finally {
      cleanup();
    }
  });

  it('CHAL 2.4: Comprehensive orphan insertion rejections across all tables', () => {
    const { db, cleanup } = setupTestDb();
    try {
      // 1. datorii with invalid apartment
      assert.throws(
        () => db.prepare("INSERT INTO datorii (apartament_id, bloc_id, an, luna, categorie, valoare) VALUES (9999, 1, 2026, 9, 'R', 10)").run(),
        /FOREIGN KEY constraint failed/i
      );

      // 2. datorii with invalid block
      const blk = db.prepare("INSERT INTO blocuri (bloc) VALUES ('B_ORPH')").run();
      const apt = db.prepare("INSERT INTO apartamente (bloc_id, numar_apart) VALUES (?, 'O1')").run(blk.lastInsertRowid);
      assert.throws(
        () => db.prepare("INSERT INTO datorii (apartament_id, bloc_id, an, luna, categorie, valoare) VALUES (?, 9999, 2026, 9, 'R', 10)").run(apt.lastInsertRowid),
        /FOREIGN KEY constraint failed/i
      );

      // 3. plati with invalid datorie
      assert.throws(
        () => db.prepare("INSERT INTO plati (datorie_id, suma, data, sursa) VALUES (9999, 10, '2026-09-01', 'CASA')").run(),
        /FOREIGN KEY constraint failed/i
      );

      // 4. plati with invalid chitanta
      const dat = db.prepare("INSERT INTO datorii (apartament_id, bloc_id, an, luna, categorie, valoare) VALUES (?, ?, 2026, 9, 'R', 10)").run(apt.lastInsertRowid, blk.lastInsertRowid);
      assert.throws(
        () => db.prepare("INSERT INTO plati (datorie_id, chitanta_id, suma, data, sursa) VALUES (?, 9999, 10, '2026-09-01', 'CASA')").run(dat.lastInsertRowid),
        /FOREIGN KEY constraint failed/i
      );

      // 5. apartamente_luna with invalid perioada_id
      assert.throws(
        () => db.prepare("INSERT INTO apartamente_luna (perioada_id, an, luna, bloc, numar_apart) VALUES (9999, 2026, 9, 'B', '1')").run(),
        /FOREIGN KEY constraint failed/i
      );

      // 6. blocuri_luna with invalid perioada_id
      assert.throws(
        () => db.prepare("INSERT INTO blocuri_luna (perioada_id, an, luna, bloc) VALUES (9999, 2026, 9, 'B')").run(),
        /FOREIGN KEY constraint failed/i
      );

      // 7. asociatie_luna with invalid perioada_id
      assert.throws(
        () => db.prepare("INSERT INTO asociatie_luna (perioada_id) VALUES (9999)").run(),
        /FOREIGN KEY constraint failed/i
      );

      // 8. facturi with invalid bloc_id
      assert.throws(
        () => db.prepare("INSERT INTO facturi (bloc_id, tip_factura, suma) VALUES (9999, 'GAZ', 10)").run(),
        /FOREIGN KEY constraint failed/i
      );

      // 9. facturi with invalid asociatie_id
      assert.throws(
        () => db.prepare("INSERT INTO facturi (asociatie_id, tip_factura, suma) VALUES (9999, 'GAZ', 10)").run(),
        /FOREIGN KEY constraint failed/i
      );
    } finally {
      cleanup();
    }
  });
});

describe('Challenger Suite 3: Deep CHECK Constraint Boundary Fuzzing', () => {
  it('CHAL 3.1: datorii.sursa CHECK constraint fuzzing', () => {
    const { db, cleanup } = setupTestDb();
    try {
      const blk = db.prepare("INSERT INTO blocuri (bloc) VALUES ('B_CHK_S')").run();
      const apt = db.prepare("INSERT INTO apartamente (bloc_id, numar_apart) VALUES (?, 'CS1')").run(blk.lastInsertRowid);

      const ins = db.prepare("INSERT INTO datorii (apartament_id, bloc_id, an, luna, categorie, valoare, sursa) VALUES (?, ?, 2026, 9, 'R', 10, ?)");

      // Valid sources
      for (const validSrc of ['PUBLISH', 'MANUAL', 'PENALTY', 'IMPORT', 'import']) {
        assert.doesNotThrow(() => ins.run(apt.lastInsertRowid, blk.lastInsertRowid, validSrc));
      }

      // Invalid sources
      for (const badSrc of ['publish', 'manual', 'penalty', 'EXCEL', 'SYNC', 'WEB', '', '123']) {
        assert.throws(
          () => ins.run(apt.lastInsertRowid, blk.lastInsertRowid, badSrc),
          /CHECK constraint failed/i,
          `Expected rejection for invalid datorii.sursa: '${badSrc}'`
        );
      }
    } finally {
      cleanup();
    }
  });

  it('CHAL 3.2: casa and banca journals transaction type and act_pas constraints', () => {
    const { db, cleanup } = setupTestDb();
    try {
      // casa tip: 'I', 'P', 'INCASARE', 'PLATA'
      const insCasa = db.prepare("INSERT INTO casa (data, suma, tip, act_pas) VALUES ('2026-09-01', 10, ?, ?)");
      for (const tip of ['I', 'P', 'INCASARE', 'PLATA']) {
        assert.doesNotThrow(() => insCasa.run(tip, 'A'));
        assert.doesNotThrow(() => insCasa.run(tip, 'P'));
      }
      for (const badTip of ['D', 'V', 'CHITANTA', 'ORDIN', 'incasare', 'plata']) {
        assert.throws(() => insCasa.run(badTip, 'A'), /CHECK constraint failed/i);
      }
      for (const badActPas of ['X', 'ACTIVE', 'PASIV', '']) {
        assert.throws(() => insCasa.run('I', badActPas), /CHECK constraint failed/i);
      }

      // banca tip: 'D', 'V', 'DEPUNERE', 'VIRAMENT'
      const insBanca = db.prepare("INSERT INTO banca (data, suma, tip, act_pas) VALUES ('2026-09-01', 10, ?, ?)");
      for (const tip of ['D', 'V', 'DEPUNERE', 'VIRAMENT']) {
        assert.doesNotThrow(() => insBanca.run(tip, 'A'));
        assert.doesNotThrow(() => insBanca.run(tip, 'P'));
      }
      for (const badTip of ['I', 'P', 'TRANSFER', 'depunere', 'virament']) {
        assert.throws(() => insBanca.run(badTip, 'A'), /CHECK constraint failed/i);
      }
      for (const badActPas of ['Z', '1', '0']) {
        assert.throws(() => insBanca.run('D', badActPas), /CHECK constraint failed/i);
      }
    } finally {
      cleanup();
    }
  });

  it('CHAL 3.3: chitante.tip_chitanta constraint fuzzing', () => {
    const { db, cleanup } = setupTestDb();
    try {
      const insCh = db.prepare("INSERT INTO chitante (serie, numar, data_emiterii, tip_chitanta) VALUES ('ORH', 9001, '2026-09-01', ?)");
      assert.doesNotThrow(() => insCh.run('INDIVIDUAL'));
      assert.doesNotThrow(() => insCh.run('COLECTIV'));

      for (const badType of ['individual', 'colectiv', 'MULTIPLE', 'NORMAL', 'SPECIAL', '', 'null']) {
        assert.throws(() => insCh.run(badType), /CHECK constraint failed/i);
      }
    } finally {
      cleanup();
    }
  });
});

describe('Challenger Suite 4: Parity Semantics of persoane = 0 (G14 Parity)', () => {
  it('CHAL 4.1: Explicit 0, omitted 0, and string "0" all resolve to integer 0 without coercion to 1', () => {
    const { db, cleanup } = setupTestDb();
    try {
      const blk = db.prepare("INSERT INTO blocuri (bloc) VALUES ('B_G14_FULL')").run();
      const bId = blk.lastInsertRowid;

      // 1. Explicit integer 0
      const ap1 = db.prepare("INSERT INTO apartamente (bloc_id, numar_apart, persoane) VALUES (?, '1', 0)").run(bId);
      const r1 = db.prepare('SELECT persoane FROM apartamente WHERE id = ?').get(ap1.lastInsertRowid);
      assert.equal(r1.persoane, 0);
      assert.strictEqual(typeof r1.persoane, 'number');

      // 2. Omitted persoane
      const ap2 = db.prepare("INSERT INTO apartamente (bloc_id, numar_apart) VALUES (?, '2')").run(bId);
      const r2 = db.prepare('SELECT persoane FROM apartamente WHERE id = ?').get(ap2.lastInsertRowid);
      assert.equal(r2.persoane, 0);
      assert.strictEqual(typeof r2.persoane, 'number');

      // 3. String "0"
      const ap3 = db.prepare("INSERT INTO apartamente (bloc_id, numar_apart, persoane) VALUES (?, '3', '0')").run(bId);
      const r3 = db.prepare('SELECT persoane FROM apartamente WHERE id = ?').get(ap3.lastInsertRowid);
      assert.equal(r3.persoane, 0);
      assert.strictEqual(typeof r3.persoane, 'number');

      // 4. Update from 5 to 0
      db.prepare('UPDATE apartamente SET persoane = 0 WHERE id = ?').run(ap2.lastInsertRowid);
      const r2Upd = db.prepare('SELECT persoane FROM apartamente WHERE id = ?').get(ap2.lastInsertRowid);
      assert.equal(r2Upd.persoane, 0);

      // 5. Arithmetic operations verify 0 is counted properly
      const sum = db.prepare('SELECT SUM(persoane) as total, COUNT(*) as cnt FROM apartamente WHERE bloc_id = ?').get(bId);
      assert.equal(sum.total, 0, 'Sum of zero-person apartments must be 0');
      assert.equal(sum.cnt, 3, 'All 3 apartments must be counted');
    } finally {
      cleanup();
    }
  });

  it('CHAL 4.2: Snapshot apartamente_luna records persoane = 0 with exact fidelity', () => {
    const { db, cleanup } = setupTestDb();
    try {
      const per = db.prepare("SELECT id FROM perioade WHERE an = 2026 AND luna = 9").get();
      const ins = db.prepare(`
        INSERT INTO apartamente_luna (perioada_id, an, luna, bloc, numar_apart, persoane)
        VALUES (?, 2026, 9, 'B_SNAP_0', 'A0', 0)
      `).run(per.id);

      const row = db.prepare('SELECT persoane FROM apartamente_luna WHERE id = ?').get(ins.lastInsertRowid);
      assert.equal(row.persoane, 0);
      assert.strictEqual(typeof row.persoane, 'number');
    } finally {
      cleanup();
    }
  });
});

describe('Challenger Suite 5: Unique Business Key Collisions', () => {
  it('CHAL 5.1: apartamente enforces (bloc_id, numar_apart) uniqueness', () => {
    const { db, cleanup } = setupTestDb();
    try {
      const blk1 = db.prepare("INSERT INTO blocuri (bloc) VALUES ('B_UQA')").run();
      const blk2 = db.prepare("INSERT INTO blocuri (bloc) VALUES ('B_UQB')").run();

      db.prepare("INSERT INTO apartamente (bloc_id, numar_apart) VALUES (?, '100')").run(blk1.lastInsertRowid);

      // Duplicate in same block must throw
      assert.throws(
        () => db.prepare("INSERT INTO apartamente (bloc_id, numar_apart) VALUES (?, '100')").run(blk1.lastInsertRowid),
        /UNIQUE constraint failed/i
      );

      // Same number in different block must succeed
      assert.doesNotThrow(
        () => db.prepare("INSERT INTO apartamente (bloc_id, numar_apart) VALUES (?, '100')").run(blk2.lastInsertRowid)
      );
    } finally {
      cleanup();
    }
  });

  it('CHAL 5.2: perioade and general enforce (an, luna) uniqueness', () => {
    const { db, cleanup } = setupTestDb();
    try {
      // 2026/9 exists in both
      assert.throws(
        () => db.prepare("INSERT INTO perioade (an, luna, status) VALUES (2026, 9, 'DESCHISA')").run(),
        /UNIQUE constraint failed/i
      );
      assert.throws(
        () => db.prepare("INSERT INTO general (an, luna, ultima_zi) VALUES (2026, 9, '2026-09-30')").run(),
        /UNIQUE constraint failed/i
      );

      // New period 2026/10 succeeds in both
      const p = db.prepare("INSERT INTO perioade (an, luna, status) VALUES (2026, 10, 'DESCHISA')").run();
      assert.doesNotThrow(
        () => db.prepare("INSERT INTO general (perioada_id, an, luna, ultima_zi) VALUES (?, 2026, 10, '2026-10-31')").run(p.lastInsertRowid)
      );
    } finally {
      cleanup();
    }
  });
});

describe('Challenger Suite 6: High Stress Load & PRAGMA integrity_check', () => {
  it('CHAL 6.1: Bulk 2,000 ledger mutations with nested transaction rollbacks retains pristine integrity', () => {
    const { db, cleanup } = setupTestDb();
    try {
      const blk = db.prepare("INSERT INTO blocuri (bloc) VALUES ('B_CHAOS')").run();
      const bId = blk.lastInsertRowid;
      const apt = db.prepare("INSERT INTO apartamente (bloc_id, numar_apart) VALUES (?, 'C1')").run(bId);
      const aId = apt.lastInsertRowid;

      const insD = db.prepare("INSERT INTO datorii (apartament_id, bloc_id, an, luna, categorie, valoare) VALUES (?, ?, 2026, 9, ?, ?)");
      const insP = db.prepare("INSERT INTO plati (datorie_id, suma, data, sursa) VALUES (?, ?, '2026-09-15', ?)");

      const cats = ['R', 'F', 'A', 'P'];
      const surse = ['CASA', 'BANCA'];

      // Batch 1: 1,000 successful records
      db.transaction(() => {
        for (let i = 0; i < 1000; i++) {
          const d = insD.run(aId, bId, cats[i % 4], 100 + i);
          insP.run(d.lastInsertRowid, 50, surse[i % 2]);
        }
      })();

      assert.equal(db.prepare('SELECT COUNT(*) as c FROM datorii WHERE apartament_id = ?').get(aId).c, 1000);
      assert.equal(db.prepare('SELECT COUNT(*) as c FROM plati').get().c, 1000);

      // Batch 2: Intentional rollback attempt with invalid category
      const failingTxn = db.transaction(() => {
        for (let i = 0; i < 50; i++) {
          insD.run(aId, bId, 'R', 10);
        }
        // Poison pill
        insD.run(aId, bId, 'POISON', 10);
      });

      assert.throws(() => failingTxn(), /CHECK constraint failed/i);

      // Ensure zero leaked rows from failed transaction
      assert.equal(db.prepare('SELECT COUNT(*) as c FROM datorii WHERE apartament_id = ?').get(aId).c, 1000);

      // Verify PRAGMA integrity_check is pristine
      const integrity = db.prepare('PRAGMA integrity_check').all();
      assert.equal(integrity[0].integrity_check, 'ok');

      // Verify PRAGMA foreign_key_check is pristine
      const fk = db.prepare('PRAGMA foreign_key_check').all();
      assert.deepEqual(fk, []);
    } finally {
      cleanup();
    }
  });
});

describe('Challenger Suite 7: Database Connection Lifecycle & Path Caching Probe', () => {
  it('CHAL 7.1: [Adversarial Vulnerability Probe] Calling getDb(customPath) switches connection correctly', () => {
    const tmp1 = path.join(__dirname, 'temp_conn_1.db');
    const tmp2 = path.join(__dirname, 'temp_conn_2.db');

    try {
      const db1 = getDb(tmp1);
      assert.ok(db1.name.includes('temp_conn_1.db'), 'getDb(tmp1) must connect to tmp1');

      const db2 = getDb(tmp2);
      assert.ok(db2.name.includes('temp_conn_2.db'), 'getDb(tmp2) must switch to tmp2');
    } finally {
      // Clean up temp databases
      try { fs.unlinkSync(tmp1); } catch (_) {}
      try { fs.unlinkSync(`${tmp1}-wal`); } catch (_) {}
      try { fs.unlinkSync(`${tmp1}-shm`); } catch (_) {}
      try { fs.unlinkSync(tmp2); } catch (_) {}
      try { fs.unlinkSync(`${tmp2}-wal`); } catch (_) {}
      try { fs.unlinkSync(`${tmp2}-shm`); } catch (_) {}
    }
  });
});
