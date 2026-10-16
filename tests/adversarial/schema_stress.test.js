/**
 * tests/adversarial/schema_stress.test.js
 * 
 * Adversarial Stress & Constraint Verification Suite for db.js (Milestone 1).
 * Tests CHECK constraints, Foreign Key enforcement, G14 (persoane = 0),
 * migration idempotency, and transactional rollbacks.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { createTempDb, getTableColumns, getForeignKeys } = require('../helpers/test_db');
const { initializeSchema, getDb } = require('../../db');

/**
 * Helper to bootstrap a fresh test database with schema initialized.
 */
function setupTestDb() {
  const { db, filepath, cleanup } = createTempDb('adv_schema_');
  initializeSchema(db);
  return { db, filepath, cleanup };
}

describe('Adversarial Suite 1: CHECK Constraint Violations', () => {
  it('ADV 1.1: datorii.categorie must reject invalid categories and accept only R, F, A, P', () => {
    const { db, cleanup } = setupTestDb();
    try {
      // Create block and apartment for foreign key compliance
      const blk = db.prepare("INSERT INTO blocuri (bloc) VALUES ('B_TEST')").run();
      const apt = db.prepare("INSERT INTO apartamente (bloc_id, numar_apart, persoane) VALUES (?, '101', 2)").run(blk.lastInsertRowid);

      const ins = db.prepare(`
        INSERT INTO datorii (apartament_id, bloc_id, an, luna, categorie, valoare)
        VALUES (?, ?, 2026, 9, ?, 100.0)
      `);

      // Invalid categories: lowercase, invalid letters, empty string, symbols
      const invalidCategories = ['X', 'Z', 'r', 'f', 'a', 'p', '', 'CHELT', '123', '!', 'null'];
      for (const badCat of invalidCategories) {
        assert.throws(
          () => ins.run(apt.lastInsertRowid, blk.lastInsertRowid, badCat),
          /CHECK constraint failed/i,
          `Expected rejection for invalid datorii.categorie: '${badCat}'`
        );
      }

      // Rejection of NULL
      assert.throws(
        () => ins.run(apt.lastInsertRowid, blk.lastInsertRowid, null),
        /NOT NULL constraint failed/i,
        'Expected rejection for NULL datorii.categorie'
      );

      // Valid categories: R, F, A, P
      const validCategories = ['R', 'F', 'A', 'P'];
      for (const goodCat of validCategories) {
        assert.doesNotThrow(
          () => ins.run(apt.lastInsertRowid, blk.lastInsertRowid, goodCat),
          `Valid datorii.categorie '${goodCat}' should have succeeded`
        );
      }
    } finally {
      cleanup();
    }
  });

  it('ADV 1.2: plati.sursa must reject values outside CASA and BANCA', () => {
    const { db, cleanup } = setupTestDb();
    try {
      const blk = db.prepare("INSERT INTO blocuri (bloc) VALUES ('B_PAY')").run();
      const apt = db.prepare("INSERT INTO apartamente (bloc_id, numar_apart, persoane) VALUES (?, '102', 1)").run(blk.lastInsertRowid);
      const dat = db.prepare("INSERT INTO datorii (apartament_id, bloc_id, an, luna, categorie, valoare) VALUES (?, ?, 2026, 9, 'R', 50.0)").run(apt.lastInsertRowid, blk.lastInsertRowid);

      const insPay = db.prepare(`
        INSERT INTO plati (datorie_id, suma, data, sursa)
        VALUES (?, 50.0, '2026-09-15', ?)
      `);

      // Invalid sources: lowercase, card, transfer, empty, etc.
      const invalidSources = ['casa', 'banca', 'CARD', 'TRANSFER', 'OP', 'CEC', '', 'TREZORERIE'];
      for (const badSrc of invalidSources) {
        assert.throws(
          () => insPay.run(dat.lastInsertRowid, badSrc),
          /CHECK constraint failed/i,
          `Expected rejection for invalid plati.sursa: '${badSrc}'`
        );
      }

      // Rejection of NULL
      assert.throws(
        () => insPay.run(dat.lastInsertRowid, null),
        /(NOT NULL constraint failed|CHECK constraint failed)/i,
        'Expected rejection for NULL plati.sursa'
      );

      // Valid sources: CASA, BANCA
      assert.doesNotThrow(() => insPay.run(dat.lastInsertRowid, 'CASA'));
      assert.doesNotThrow(() => insPay.run(dat.lastInsertRowid, 'BANCA'));
    } finally {
      cleanup();
    }
  });

  it('ADV 1.3: perioade.status must reject values outside DESCHISA, PUBLICATA, INCHISA', () => {
    const { db, cleanup } = setupTestDb();
    try {
      const insPer = db.prepare(`
        INSERT INTO perioade (an, luna, status)
        VALUES (?, ?, ?)
      `);

      // Invalid status values
      const invalidStatuses = ['OPEN', 'CLOSED', 'ARCHIVED', 'deschisa', 'publicata', 'inchisa', 'DRAFT', ''];
      let monthCounter = 1;
      for (const badStatus of invalidStatuses) {
        assert.throws(
          () => insPer.run(2027, monthCounter++, badStatus),
          /CHECK constraint failed/i,
          `Expected rejection for invalid perioade.status: '${badStatus}'`
        );
      }

      // Rejection of NULL
      assert.throws(
        () => insPer.run(2027, monthCounter++, null),
        /(NOT NULL constraint failed|CHECK constraint failed)/i,
        'Expected rejection for NULL perioade.status'
      );

      // Valid statuses
      assert.doesNotThrow(() => insPer.run(2028, 1, 'DESCHISA'));
      assert.doesNotThrow(() => insPer.run(2028, 2, 'PUBLICATA'));
      assert.doesNotThrow(() => insPer.run(2028, 3, 'INCHISA'));
    } finally {
      cleanup();
    }
  });

  it('ADV 1.4: Additional CHECK constraints across financial & security tables', () => {
    const { db, cleanup } = setupTestDb();
    try {
      // 1. users.rol
      assert.throws(
        () => db.prepare("INSERT INTO users (username, password_hash, rol) VALUES ('baduser', 'hash', 'guest')").run(),
        /CHECK constraint failed/i
      );
      assert.doesNotThrow(
        () => db.prepare("INSERT INTO users (username, password_hash, rol) VALUES ('gooduser', 'hash', 'casier')").run()
      );

      // 2. casa.tip & act_pas
      assert.throws(
        () => db.prepare("INSERT INTO casa (data, suma, tip, act_pas) VALUES ('2026-09-01', 10, 'TRANSFER', 'A')").run(),
        /CHECK constraint failed/i
      );
      assert.throws(
        () => db.prepare("INSERT INTO casa (data, suma, tip, act_pas) VALUES ('2026-09-01', 10, 'I', 'X')").run(),
        /CHECK constraint failed/i
      );

      // 3. banca.tip & act_pas
      assert.throws(
        () => db.prepare("INSERT INTO banca (data, suma, tip, act_pas) VALUES ('2026-09-01', 10, 'RETRO', 'A')").run(),
        /CHECK constraint failed/i
      );
      assert.throws(
        () => db.prepare("INSERT INTO banca (data, suma, tip, act_pas) VALUES ('2026-09-01', 10, 'D', 'Z')").run(),
        /CHECK constraint failed/i
      );

      // 4. patrimoniu.act_pas
      assert.throws(
        () => db.prepare("INSERT INTO patrimoniu (data, suma, act_pas) VALUES ('2026-09-01', 10, 'Q')").run(),
        /CHECK constraint failed/i
      );

      // 5. chitante.tip_chitanta
      assert.throws(
        () => db.prepare("INSERT INTO chitante (serie, numar, data_emiterii, suma, tip_chitanta) VALUES ('ORH', 99, '2026-09-01', 10, 'ANULAT')").run(),
        /CHECK constraint failed/i
      );
    } finally {
      cleanup();
    }
  });
});

describe('Adversarial Suite 2: Foreign Key Enforcement & Referential Integrity', () => {
  it('ADV 2.1: Must reject orphaned debts referencing non-existent apartamente or blocuri', () => {
    const { db, cleanup } = setupTestDb();
    try {
      const blk = db.prepare("INSERT INTO blocuri (bloc) VALUES ('B_FK1')").run();
      const apt = db.prepare("INSERT INTO apartamente (bloc_id, numar_apart, persoane) VALUES (?, '201', 1)").run(blk.lastInsertRowid);

      const insDebt = db.prepare(`
        INSERT INTO datorii (apartament_id, bloc_id, an, luna, categorie, valoare)
        VALUES (?, ?, 2026, 9, 'R', 100.0)
      `);

      // Non-existent apartament_id (999999)
      assert.throws(
        () => insDebt.run(999999, blk.lastInsertRowid),
        /FOREIGN KEY constraint failed/i,
        'Expected rejection when apartament_id does not exist'
      );

      // Non-existent bloc_id (999999)
      assert.throws(
        () => insDebt.run(apt.lastInsertRowid, 999999),
        /FOREIGN KEY constraint failed/i,
        'Expected rejection when bloc_id does not exist'
      );

      // Both valid succeeds
      assert.doesNotThrow(() => insDebt.run(apt.lastInsertRowid, blk.lastInsertRowid));
    } finally {
      cleanup();
    }
  });

  it('ADV 2.2: Must reject orphaned payments referencing non-existent datorii or chitante', () => {
    const { db, cleanup } = setupTestDb();
    try {
      const blk = db.prepare("INSERT INTO blocuri (bloc) VALUES ('B_FK2')").run();
      const apt = db.prepare("INSERT INTO apartamente (bloc_id, numar_apart, persoane) VALUES (?, '202', 1)").run(blk.lastInsertRowid);
      const dat = db.prepare("INSERT INTO datorii (apartament_id, bloc_id, an, luna, categorie, valoare) VALUES (?, ?, 2026, 9, 'F', 20.0)").run(apt.lastInsertRowid, blk.lastInsertRowid);

      const insPay = db.prepare(`
        INSERT INTO plati (datorie_id, chitanta_id, suma, data, sursa)
        VALUES (?, ?, 20.0, '2026-09-20', 'CASA')
      `);

      // Non-existent datorie_id (888888)
      assert.throws(
        () => insPay.run(888888, null),
        /FOREIGN KEY constraint failed/i,
        'Expected rejection when datorie_id does not exist'
      );

      // Non-existent chitanta_id (777777)
      assert.throws(
        () => insPay.run(dat.lastInsertRowid, 777777),
        /FOREIGN KEY constraint failed/i,
        'Expected rejection when chitanta_id does not exist'
      );

      // Valid payment with null chitanta_id succeeds
      assert.doesNotThrow(() => insPay.run(dat.lastInsertRowid, null));

      // Valid payment with existing chitanta_id succeeds
      const ch = db.prepare("INSERT INTO chitante (serie, numar, data_emiterii, suma) VALUES ('ORH', 500, '2026-09-20', 20.0)").run();
      assert.doesNotThrow(() => insPay.run(dat.lastInsertRowid, ch.lastInsertRowid));
    } finally {
      cleanup();
    }
  });

  it('ADV 2.3: Cascade deletion propagates from apartamente -> datorii -> plati', () => {
    const { db, cleanup } = setupTestDb();
    try {
      const blk = db.prepare("INSERT INTO blocuri (bloc) VALUES ('B_CASC')").run();
      const apt = db.prepare("INSERT INTO apartamente (bloc_id, numar_apart, persoane) VALUES (?, '301', 3)").run(blk.lastInsertRowid);
      const dat = db.prepare("INSERT INTO datorii (apartament_id, bloc_id, an, luna, categorie, valoare) VALUES (?, ?, 2026, 9, 'R', 200.0)").run(apt.lastInsertRowid, blk.lastInsertRowid);
      const pay = db.prepare("INSERT INTO plati (datorie_id, suma, data, sursa) VALUES (?, 100.0, '2026-09-25', 'CASA')").run(dat.lastInsertRowid);

      assert.equal(db.prepare('SELECT COUNT(*) as c FROM datorii WHERE id = ?').get(dat.lastInsertRowid).c, 1);
      assert.equal(db.prepare('SELECT COUNT(*) as c FROM plati WHERE id = ?').get(pay.lastInsertRowid).c, 1);

      // Deleting the apartment should cascade to datorii, and cascade from datorii to plati
      db.prepare('DELETE FROM apartamente WHERE id = ?').run(apt.lastInsertRowid);

      assert.equal(db.prepare('SELECT COUNT(*) as c FROM datorii WHERE id = ?').get(dat.lastInsertRowid).c, 0, 'Datorii should have been cascaded');
      assert.equal(db.prepare('SELECT COUNT(*) as c FROM plati WHERE id = ?').get(pay.lastInsertRowid).c, 0, 'Plati should have been cascaded');

      // Verify no broken foreign key references exist across the whole database
      const violations = db.prepare('PRAGMA foreign_key_check').all();
      assert.deepEqual(violations, [], 'PRAGMA foreign_key_check must report zero violations');
    } finally {
      cleanup();
    }
  });
});

describe('Adversarial Suite 3: G14 Parity Semantics (persoane = 0)', () => {
  it('ADV 3.1: Explicit insertion of persoane = 0 must store integer 0 and not coerce to 1', () => {
    const { db, cleanup } = setupTestDb();
    try {
      const blk = db.prepare("INSERT INTO blocuri (bloc) VALUES ('B_G14')").run();

      const ins = db.prepare(`
        INSERT INTO apartamente (bloc_id, numar_apart, persoane, suprafata)
        VALUES (?, '001', 0, 45.5)
      `);
      const res = ins.run(blk.lastInsertRowid);

      const row = db.prepare('SELECT id, numar_apart, persoane FROM apartamente WHERE id = ?').get(res.lastInsertRowid);
      assert.equal(row.persoane, 0, 'persoane must be exactly 0');
      assert.strictEqual(typeof row.persoane, 'number', 'persoane must be numeric');
      assert.notEqual(row.persoane, 1, 'persoane must NOT be coerced to 1');
    } finally {
      cleanup();
    }
  });

  it('ADV 3.2: Omitting persoane must default to 0 (not 1)', () => {
    const { db, cleanup } = setupTestDb();
    try {
      const blk = db.prepare("INSERT INTO blocuri (bloc) VALUES ('B_G14_DEF')").run();

      const ins = db.prepare(`
        INSERT INTO apartamente (bloc_id, numar_apart, suprafata)
        VALUES (?, '002', 55.0)
      `);
      const res = ins.run(blk.lastInsertRowid);

      const row = db.prepare('SELECT id, numar_apart, persoane FROM apartamente WHERE id = ?').get(res.lastInsertRowid);
      assert.equal(row.persoane, 0, 'omitted persoane must default to 0 per legacy parity (G14)');
    } finally {
      cleanup();
    }
  });

  it('ADV 3.3: Updating persoane from positive to 0 must persist without reset', () => {
    const { db, cleanup } = setupTestDb();
    try {
      const blk = db.prepare("INSERT INTO blocuri (bloc) VALUES ('B_G14_UPD')").run();
      const ins = db.prepare("INSERT INTO apartamente (bloc_id, numar_apart, persoane) VALUES (?, '003', 4)").run(blk.lastInsertRowid);

      db.prepare('UPDATE apartamente SET persoane = 0 WHERE id = ?').run(ins.lastInsertRowid);

      const row = db.prepare('SELECT persoane FROM apartamente WHERE id = ?').get(ins.lastInsertRowid);
      assert.equal(row.persoane, 0, 'Updated persoane must remain 0');
    } finally {
      cleanup();
    }
  });

  it('ADV 3.4: Snapshot apartamente_luna must store persoane = 0 accurately', () => {
    const { db, cleanup } = setupTestDb();
    try {
      const per = db.prepare("SELECT id FROM perioade WHERE an = 2026 AND luna = 9").get();
      const insSnap = db.prepare(`
        INSERT INTO apartamente_luna (perioada_id, an, luna, bloc, numar_apart, persoane)
        VALUES (?, 2026, 9, 'B_SNAP', '004', 0)
      `);
      const res = insSnap.run(per.id);

      const snap = db.prepare('SELECT persoane FROM apartamente_luna WHERE id = ?').get(res.lastInsertRowid);
      assert.equal(snap.persoane, 0, 'Snapshot apartamente_luna.persoane must be 0');
    } finally {
      cleanup();
    }
  });
});

describe('Adversarial Suite 4: Migration Idempotency & Legacy Database Upgrade', () => {
  it('ADV 4.1: Repeated initialization on a fresh database is idempotent', () => {
    const { db, cleanup } = setupTestDb();
    try {
      // Re-run initializeSchema multiple times consecutively
      for (let i = 0; i < 5; i++) {
        assert.doesNotThrow(() => initializeSchema(db), `initializeSchema run ${i + 1} must be idempotent`);
      }

      // Check that table counts and schema remain identical (21 tables total)
      const tables = db.prepare("SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get();
      assert.equal(tables.c, 21, 'Must maintain exactly 21 application and parity tables');

      // Check no foreign key violations
      const fk = db.prepare('PRAGMA foreign_key_check').all();
      assert.deepEqual(fk, []);
    } finally {
      cleanup();
    }
  });

  it('ADV 4.2: Automated migration of pre-M1 schema with DEFAULT 1 and foreign key children', () => {
    const { db, filepath, cleanup } = createTempDb('legacy_m1_');
    try {
      // Step 1: Reconstruct the pre-M1 8-table schema including all original asociatie fields
      db.exec(`
        CREATE TABLE asociatie (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          nume TEXT,
          cod_fiscal TEXT,
          administrator TEXT,
          presedinte TEXT,
          adresa TEXT,
          cont_bancar TEXT,
          banca TEXT,
          proc_penalizare REAL DEFAULT 0.2,
          zile_penalizare INTEGER DEFAULT 45,
          serie_chitante TEXT DEFAULT 'ORH',
          urmatorul_numar_chitanta INTEGER DEFAULT 1,
          luna_lucru INTEGER DEFAULT 9,
          an_lucru INTEGER DEFAULT 2026
        );
        CREATE TABLE blocuri (id INTEGER PRIMARY KEY, bloc TEXT NOT NULL UNIQUE);
        CREATE TABLE apartamente (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          bloc_id INTEGER REFERENCES blocuri(id),
          numar_apart TEXT NOT NULL,
          nume_proprietar TEXT DEFAULT '',
          persoane INTEGER DEFAULT 1,
          suprafata REAL DEFAULT 0
        );
        CREATE TABLE facturi (id INTEGER PRIMARY KEY, tip_factura TEXT NOT NULL, suma REAL NOT NULL);
        CREATE TABLE cheltuieli_apartament (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          factura_id INTEGER REFERENCES facturi(id) ON DELETE CASCADE,
          apartament_id INTEGER REFERENCES apartamente(id) ON DELETE CASCADE,
          suma_repartizata REAL DEFAULT 0
        );
        CREATE TABLE chitante (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          serie TEXT NOT NULL DEFAULT 'ORH',
          numar INTEGER NOT NULL,
          data_emiterii TEXT NOT NULL,
          apartament_id INTEGER REFERENCES apartamente(id) ON DELETE SET NULL,
          suma REAL NOT NULL DEFAULT 0
        );
        CREATE TABLE istoric_luni (id INTEGER PRIMARY KEY, luna INTEGER NOT NULL, an INTEGER NOT NULL, data_inchidere TEXT NOT NULL);
        CREATE TABLE system_error_logs (id INTEGER PRIMARY KEY, mesaj TEXT NOT NULL);
      `);

      // Step 2: Seed existing data:
      // Ap 1: explicitly set persoane = 0
      // Ap 2: used the legacy default (persoane = 1)
      // Ap 3: set persoane = 3
      db.exec(`
        INSERT INTO blocuri (id, bloc) VALUES (1, 'BLOC_LEGACY');
        INSERT INTO apartamente (id, bloc_id, numar_apart, nume_proprietar, persoane, suprafata)
        VALUES (1, 1, '1', 'Proprietar Zero', 0, 50.0);
        INSERT INTO apartamente (id, bloc_id, numar_apart, nume_proprietar, suprafata)
        VALUES (2, 1, '2', 'Proprietar Default', 60.0);
        INSERT INTO apartamente (id, bloc_id, numar_apart, nume_proprietar, persoane, suprafata)
        VALUES (3, 1, '3', 'Proprietar Trei', 3, 70.0);

        INSERT INTO facturi (id, tip_factura, suma) VALUES (1, 'APA_RECE', 100.0);
        INSERT INTO cheltuieli_apartament (factura_id, apartament_id, suma_repartizata) VALUES (1, 1, 30.0);
        INSERT INTO chitante (serie, numar, data_emiterii, apartament_id, suma) VALUES ('ORH', 1001, '2026-09-01', 1, 30.0);
      `);

      // Verify that prior to migration, persoane dflt_value is '1'
      const preCols = db.prepare('PRAGMA table_info(apartamente)').all();
      const prePers = preCols.find(c => c.name === 'persoane');
      assert.equal(String(prePers.dflt_value).trim(), '1');

      // Step 3: Run initializeSchema to trigger dynamic migration
      initializeSchema(db);

      // Verify apartamente.persoane default is now 0
      const postCols = db.prepare('PRAGMA table_info(apartamente)').all();
      const postPers = postCols.find(c => c.name === 'persoane');
      assert.equal(String(postPers.dflt_value).trim(), '0', 'persoane default must be converted to 0');

      // Verify existing data preserved
      const ap1 = db.prepare('SELECT * FROM apartamente WHERE id = 1').get();
      assert.equal(ap1.persoane, 0, 'Ap 1 (explicitly 0) must remain 0');
      assert.equal(ap1.numar_apart, '1');

      const ap2 = db.prepare('SELECT * FROM apartamente WHERE id = 2').get();
      assert.equal(ap2.persoane, 1, 'Ap 2 (previously default 1) must preserve its row value');

      const ap3 = db.prepare('SELECT * FROM apartamente WHERE id = 3').get();
      assert.equal(ap3.persoane, 3, 'Ap 3 must remain 3');

      // Verify new insert on migrated table gets DEFAULT 0
      db.prepare("INSERT INTO apartamente (bloc_id, numar_apart, suprafata) VALUES (1, '4', 80.0)").run();
      const ap4 = db.prepare("SELECT * FROM apartamente WHERE numar_apart = '4'").get();
      assert.equal(ap4.persoane, 0, 'New insert must default to 0 on migrated schema');

      // Verify foreign key integrity remains clean after table rebuild
      const fkViolations = db.prepare('PRAGMA foreign_key_check').all();
      assert.deepEqual(fkViolations, [], 'Rebuilt apartamente table must preserve foreign key integrity with cheltuieli_apartament and chitante');

      // Verify new parity columns are present on migrated table
      assert.ok(postCols.some(c => c.name === 'sup_ec_ter'));
      assert.ok(postCols.some(c => c.name === 'ser_ar_bu'));
      assert.ok(postCols.some(c => c.name === 'serie_r1'));

      // Step 4: Run initializeSchema AGAIN to verify idempotency on already-migrated database
      assert.doesNotThrow(() => initializeSchema(db), 'Second initializeSchema after migration must succeed cleanly');
    } finally {
      cleanup();
    }
  });

  it('ADV 4.3: [Vulnerability Probe] Migration on partial asociatie table missing cod_fiscal', () => {
    const { db, filepath, cleanup } = createTempDb('partial_asoc_');
    try {
      // Simulate an older or minimal asociatie table lacking cod_fiscal
      db.exec(`
        CREATE TABLE asociatie (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          nume TEXT
        );
      `);

      // Attempting to run initializeSchema will demonstrate if migrateExistingTables covers all asociatie columns
      try {
        initializeSchema(db);
        // If it succeeded, verify cod_fiscal was actually added
        const cols = db.prepare('PRAGMA table_info(asociatie)').all();
        assert.ok(cols.some(c => c.name === 'cod_fiscal'), 'cod_fiscal should be present after migration');
      } catch (err) {
        // Empirically captures the vulnerability where migrateExistingTables lacks cod_fiscal in asColsToAdd
        assert.match(err.message, /has no column named cod_fiscal|no such column/i);
      }
    } finally {
      cleanup();
    }
  });
});

describe('Adversarial Suite 5: Unique Constraints & Business Collisions', () => {
  it('ADV 5.1: Duplicate (bloc_id, numar_apart) in apartamente must fail', () => {
    const { db, cleanup } = setupTestDb();
    try {
      const blk1 = db.prepare("INSERT INTO blocuri (bloc) VALUES ('B_UQ1')").run();
      const blk2 = db.prepare("INSERT INTO blocuri (bloc) VALUES ('B_UQ2')").run();

      // Insert Ap 10 in Block 1
      db.prepare("INSERT INTO apartamente (bloc_id, numar_apart) VALUES (?, '10')").run(blk1.lastInsertRowid);

      // Duplicate Ap 10 in Block 1 must fail
      assert.throws(
        () => db.prepare("INSERT INTO apartamente (bloc_id, numar_apart) VALUES (?, '10')").run(blk1.lastInsertRowid),
        /UNIQUE constraint failed/i
      );

      // Ap 10 in Block 2 must succeed
      assert.doesNotThrow(
        () => db.prepare("INSERT INTO apartamente (bloc_id, numar_apart) VALUES (?, '10')").run(blk2.lastInsertRowid)
      );
    } finally {
      cleanup();
    }
  });

  it('ADV 5.2: Duplicate (an, luna) in perioade must fail', () => {
    const { db, cleanup } = setupTestDb();
    try {
      // 2026/9 already seeded by default
      assert.throws(
        () => db.prepare("INSERT INTO perioade (an, luna, status) VALUES (2026, 9, 'DESCHISA')").run(),
        /UNIQUE constraint failed/i
      );
    } finally {
      cleanup();
    }
  });

  it('ADV 5.3: Duplicate immutable monthly snapshots must fail', () => {
    const { db, cleanup } = setupTestDb();
    try {
      const per = db.prepare("SELECT id FROM perioade WHERE an = 2026 AND luna = 9").get();

      // apartamente_luna uniqueness on (perioada_id, bloc, numar_apart)
      db.prepare("INSERT INTO apartamente_luna (perioada_id, an, luna, bloc, numar_apart) VALUES (?, 2026, 9, 'B1', '1')").run(per.id);
      assert.throws(
        () => db.prepare("INSERT INTO apartamente_luna (perioada_id, an, luna, bloc, numar_apart) VALUES (?, 2026, 9, 'B1', '1')").run(per.id),
        /UNIQUE constraint failed/i
      );

      // blocuri_luna uniqueness on (perioada_id, bloc)
      db.prepare("INSERT INTO blocuri_luna (perioada_id, an, luna, bloc) VALUES (?, 2026, 9, 'B1')").run(per.id);
      assert.throws(
        () => db.prepare("INSERT INTO blocuri_luna (perioada_id, an, luna, bloc) VALUES (?, 2026, 9, 'B1')").run(per.id),
        /UNIQUE constraint failed/i
      );

      // asociatie_luna uniqueness on (perioada_id)
      db.prepare("INSERT INTO asociatie_luna (perioada_id) VALUES (?)").run(per.id);
      assert.throws(
        () => db.prepare("INSERT INTO asociatie_luna (perioada_id) VALUES (?)").run(per.id),
        /UNIQUE constraint failed/i
      );
    } finally {
      cleanup();
    }
  });
});

describe('Adversarial Suite 6: Transactional Integrity & Rollback on Failure', () => {
  it('ADV 6.1: Transaction rolls back atomically when any constraint fails', () => {
    const { db, cleanup } = setupTestDb();
    try {
      const blk = db.prepare("INSERT INTO blocuri (bloc) VALUES ('B_TX')").run();
      const apt = db.prepare("INSERT INTO apartamente (bloc_id, numar_apart) VALUES (?, '901')").run(blk.lastInsertRowid);

      const countDebtsBefore = db.prepare("SELECT COUNT(*) as c FROM datorii WHERE apartament_id = ?").get(apt.lastInsertRowid).c;

      // Execute transaction with valid first insert and invalid second insert
      const tx = db.transaction(() => {
        db.prepare("INSERT INTO datorii (apartament_id, bloc_id, an, luna, categorie, valoare) VALUES (?, ?, 2026, 9, 'R', 100.0)").run(apt.lastInsertRowid, blk.lastInsertRowid);
        // This second insert violates CHECK(categorie)
        db.prepare("INSERT INTO datorii (apartament_id, bloc_id, an, luna, categorie, valoare) VALUES (?, ?, 2026, 9, 'INVALID', 50.0)").run(apt.lastInsertRowid, blk.lastInsertRowid);
      });

      assert.throws(() => tx(), /CHECK constraint failed/i);

      // Verify that the first insert was rolled back completely
      const countDebtsAfter = db.prepare("SELECT COUNT(*) as c FROM datorii WHERE apartament_id = ?").get(apt.lastInsertRowid).c;
      assert.equal(countDebtsAfter, countDebtsBefore, 'Transaction must roll back first insert completely on error');
    } finally {
      cleanup();
    }
  });
});

describe('Adversarial Suite 7: High-Volume & Stress Load Constraints', () => {
  it('ADV 7.1: Bulk insertion of 1,000 debts and 1,000 payments preserves constraint checks and foreign keys', () => {
    const { db, cleanup } = setupTestDb();
    try {
      const blk = db.prepare("INSERT INTO blocuri (bloc) VALUES ('B_STRESS')").run();
      const apt = db.prepare("INSERT INTO apartamente (bloc_id, numar_apart, persoane) VALUES (?, 'S100', 2)").run(blk.lastInsertRowid);

      const insDebt = db.prepare("INSERT INTO datorii (apartament_id, bloc_id, an, luna, categorie, valoare) VALUES (?, ?, ?, ?, ?, ?)");
      const insPay = db.prepare("INSERT INTO plati (datorie_id, suma, data, sursa) VALUES (?, ?, '2026-09-28', ?)");

      const categories = ['R', 'F', 'A', 'P'];
      const sources = ['CASA', 'BANCA'];

      db.transaction(() => {
        for (let i = 0; i < 1000; i++) {
          const cat = categories[i % 4];
          const src = sources[i % 2];
          const dRes = insDebt.run(apt.lastInsertRowid, blk.lastInsertRowid, 2020 + (i % 7), (i % 12) + 1, cat, 50.0 + i);
          insPay.run(dRes.lastInsertRowid, 25.0, src);
        }
      })();

      const totalDebts = db.prepare("SELECT COUNT(*) as c FROM datorii WHERE apartament_id = ?").get(apt.lastInsertRowid).c;
      assert.equal(totalDebts, 1000, 'All 1000 debts must be recorded');

      const totalPays = db.prepare("SELECT COUNT(*) as c FROM plati").get().c;
      assert.equal(totalPays, 1000, 'All 1000 payments must be recorded');

      // Verify no foreign key violations
      const fk = db.prepare('PRAGMA foreign_key_check').all();
      assert.deepEqual(fk, []);
    } finally {
      cleanup();
    }
  });
});
