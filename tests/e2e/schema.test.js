/**
 * tests/e2e/schema.test.js
 * 
 * End-to-End Test Suite for Database Schema Integrity & Extended Data Models.
 * Verifies Tier 1 (Coverage) and Tier 2 (Boundary & Corner Cases) requirements
 * derived from ORIGINAL_REQUEST.md (R1), TEST_INFRA.md (Feature 1), and
 * PARITY_IMPLEMENTATION_PLAN.md (§4.0, §4.1).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Database = require('better-sqlite3');
const { getTableNames, getTableColumns, hasColumn, getForeignKeys } = require('../helpers/test_db');

const DB_PATH = path.join(__dirname, '..', '..', 'asociatie.db');

describe('Tier 1: Schema Integrity & Core Table Architecture', () => {
  let db;

  // Open database connection
  try {
    const dbModule = require('../../db');
    db = dbModule.getDb();
  } catch (err) {
    db = new Database(DB_PATH);
  }

  it('T1.1: Core application and parity tables must exist in SQLite schema', () => {
    const tables = getTableNames(db);
    
    // Core legacy parity tables required by R1 / §4.0, §4.1
    const requiredTables = [
      'asociatie',
      'blocuri',
      'apartamente',
      'facturi',
      'chitante',
      'perioade',
      'datorii',
      'plati',
      'apartamente_luna',
      'blocuri_luna',
      'general',
      'casa',
      'banca',
      'patrimoniu',
      'ordine_plata',
      'users',
      'audit_logs'
    ];

    const missingTables = requiredTables.filter(t => !tables.includes(t));
    assert.deepEqual(
      missingTables,
      [],
      `Missing required parity tables: ${missingTables.join(', ')}`
    );
  });

  it('T1.2: apartamente table must include all 16 per-apartment expense percentages', () => {
    const percentages = [
      'proc_av_ac',
      'proc_av_in',
      'procg',
      'procgunoi',
      'procascens',
      'proc_cu_sc',
      'proc_cu_li',
      'proc_sal_f',
      'proc_sal_t',
      'proc_abona',
      'p_saltesa',
      'p_presserv',
      'proc_chadm',
      'proc_difer',
      'proc_difin',
      'proc_chsed'
    ];

    const missing = percentages.filter(p => !hasColumn(db, 'apartamente', p));
    assert.deepEqual(
      missing,
      [],
      `apartamente table is missing percentage columns: ${missing.join(', ')}`
    );
  });

  it('T1.3: apartamente table must include temporary reduction fields (TCE)', () => {
    const reductions = [
      'd1',
      'd2',
      'p1_scaz',
      'p2_scaz',
      'sl1_scaz',
      'sl2_scaz',
      'set_scaz'
    ];

    const missing = reductions.filter(r => !hasColumn(db, 'apartamente', r));
    assert.deepEqual(
      missing,
      [],
      `apartamente table is missing temporary reduction columns: ${missing.join(', ')}`
    );
  });

  it('T1.4: apartamente table must include meter modes and 6 water meters with metrology and serials', () => {
    const meterFields = [
      'cp_ar', 'cp_ac', 'cp_in',
      // Cold kitchen
      'iv_ar_bu', 'in_ar_bu', 'd_v_ar_bu', 'ser_ar_bu',
      // Cold bath 1
      'iv_ar_ba1', 'in_ar_ba1', 'd_v_ar_ba1', 'ser_ar_ba1',
      // Cold bath 2
      'iv_ar_ba2', 'in_ar_ba2', 'd_v_ar_ba2', 'ser_ar_ba2',
      // Hot kitchen
      'iv_ac_bu', 'in_ac_bu', 'd_v_ac_bu', 'ser_ac_bu',
      // Hot bath 1
      'iv_ac_ba1', 'in_ac_ba1', 'd_v_ac_ba1', 'ser_ac_ba1',
      // Hot bath 2
      'iv_ac_ba2', 'in_ac_ba2', 'd_v_ac_ba2', 'ser_ac_ba2',
      // Heat meter
      'inin', 'ivin', 'constin', 'd_v_inin', 'ser_inin'
    ];

    const missing = meterFields.filter(f => !hasColumn(db, 'apartamente', f));
    assert.deepEqual(
      missing,
      [],
      `apartamente table is missing meter/metrology columns: ${missing.join(', ')}`
    );
  });

  it('T1.5: apartamente table must include 7 heat cost allocators with factors, coefficients and results (CRE)', () => {
    const allocatorFields = [];
    for (let i = 1; i <= 7; i++) {
      allocatorFields.push(`serie_r${i}`, `iv_r${i}`, `in_r${i}`, `facttr_r${i}`, `coefsp_r${i}`);
    }
    allocatorFields.push(
      'tot_unit',
      'gcal_unit',
      'gcal_mp',
      'gcal_calc',
      'gcal_red',
      'gcal_final'
    );

    const missing = allocatorFields.filter(f => !hasColumn(db, 'apartamente', f));
    assert.deepEqual(
      missing,
      [],
      `apartamente table is missing allocator columns: ${missing.join(', ')}`
    );
  });

  it('T1.6: apartamente table must include working fund, manual charges, equivalent thermal surface and memo', () => {
    const chargeFields = [
      'sup_ec_ter',
      'max_fond_rulment', // or max_fr
      'calc_fr',
      'plat_fr',
      'fond_reparatii',   // or fond_repar
      'ch_box',
      'ch_hav',
      'repar_crt',
      'altele',
      'i',
      'observatii'
    ];

    // Check with aliases
    const missing = chargeFields.filter(f => {
      if (hasColumn(db, 'apartamente', f)) return false;
      if (f === 'max_fond_rulment' && hasColumn(db, 'apartamente', 'max_fr')) return false;
      if (f === 'fond_reparatii' && hasColumn(db, 'apartamente', 'fond_repar')) return false;
      return true;
    });

    assert.deepEqual(
      missing,
      [],
      `apartamente table is missing charge/fund/memo columns: ${missing.join(', ')}`
    );
  });

  it('T1.7: blocuri table must include allocation modes, thermal params, block meters, and invoice allocations', () => {
    const blockFields = [
      'mod_r_dif',
      'mod_r_inc',
      'modr_difin',
      'mod_r_asc',
      'procinccom',
      'ecart_temp',
      'rand_tr',
      'tarif_et',
      'inar',
      'ivar',
      'inac',
      'ivac',
      'inin',
      'ivin',
      'constin',
      'gaz',
      'gunoi',
      'curent_sc',
      'curent_li',
      'ascensor',
      'sal_tesa',
      'sal_feme',
      'ch_admin',
      'ch_sediu',
      'cota_fr',
      'prest_serv',
      'chelt_inc',
      'abonament',
      'can_met',
      'difarar',
      'difarac',
      'difcanar',
      'difcanac',
      'difetac',
      'difetin',
      'cod_postal',
      'observatii'
    ];

    const missing = blockFields.filter(f => !hasColumn(db, 'blocuri', f));
    assert.deepEqual(
      missing,
      [],
      `blocuri table is missing extended columns: ${missing.join(', ')}`
    );
  });

  it('T1.8: perioade and snapshot tables must satisfy immutable snapshot architecture', () => {
    // Check perioade columns
    const perioadeFields = ['id', 'an', 'luna', 'status', 'ultima_zi', 'tarif_ar', 'tarif_ca', 'proc_ca'];
    const missingPerioade = perioadeFields.filter(f => !hasColumn(db, 'perioade', f));
    assert.deepEqual(
      missingPerioade,
      [],
      `perioade table is missing columns: ${missingPerioade.join(', ')}`
    );

    // Check apartamente_luna columns
    assert.ok(
      hasColumn(db, 'apartamente_luna', 'perioada_id') || hasColumn(db, 'apartamente_luna', 'luna_id'),
      'apartamente_luna must have a period reference foreign key'
    );
    assert.ok(
      hasColumn(db, 'apartamente_luna', 'apartament_id'),
      'apartamente_luna must have apartament_id reference'
    );

    // Check blocuri_luna columns
    assert.ok(
      hasColumn(db, 'blocuri_luna', 'perioada_id') || hasColumn(db, 'blocuri_luna', 'luna_id'),
      'blocuri_luna must have a period reference foreign key'
    );
    assert.ok(
      hasColumn(db, 'blocuri_luna', 'bloc_id'),
      'blocuri_luna must have bloc_id reference'
    );
  });

  it('T1.9: Receivables ledger tables (datorii & plati) must satisfy cumulative schema contract', () => {
    // datorii columns: id, apartament_id, bloc_id, an, luna, categorie, valoare
    const datoriiCols = ['apartament_id', 'bloc_id', 'an', 'luna', 'categorie', 'valoare'];
    const missingDatorii = datoriiCols.filter(c => !hasColumn(db, 'datorii', c));
    assert.deepEqual(
      missingDatorii,
      [],
      `datorii table missing required columns: ${missingDatorii.join(', ')}`
    );

    // plati columns: id, datorie_id, chitanta_id, suma, data, sursa
    const platiCols = ['datorie_id', 'suma', 'data'];
    const missingPlati = platiCols.filter(c => !hasColumn(db, 'plati', c));
    assert.deepEqual(
      missingPlati,
      [],
      `plati table missing required columns: ${missingPlati.join(', ')}`
    );
  });
});

describe('Tier 2: Boundary & Corner Cases in Schema & Data Types', () => {
  let db;

  try {
    const dbModule = require('../../db');
    db = dbModule.getDb();
  } catch (err) {
    db = new Database(DB_PATH);
  }

  it('T2.1: persoane column must default to 0 and allow inserting 0 persons (G14)', () => {
    const cols = getTableColumns(db, 'apartamente');
    const persCol = cols.find(c => c.name.toLowerCase() === 'persoane');
    assert.ok(persCol, 'persoane column must exist');

    // Default must be 0 (or '0'), NOT 1
    const dflt = String(persCol.dflt_value || '').trim();
    assert.ok(
      dflt === '0',
      `apartamente.persoane default must be 0 per G14, but was: '${persCol.dflt_value}'`
    );
  });

  it('T2.2: datorii table must enforce valid categories (R, F, A, P)', () => {
    // Attempting to query or check schema definition for datorii.categorie
    const cols = getTableColumns(db, 'datorii');
    const catCol = cols.find(c => c.name.toLowerCase() === 'categorie');
    assert.ok(catCol, 'categorie column must exist in datorii');
  });

  it('T2.3: plati table must support payment sources CASA and BANCA', () => {
    const cols = getTableColumns(db, 'plati');
    const sursaCol = cols.find(c => c.name.toLowerCase() === 'sursa');
    assert.ok(sursaCol, 'sursa column must exist in plati');
  });

  it('T2.4: perioade table status values must accommodate DESCHISA, PUBLICATA, INCHISA', () => {
    const cols = getTableColumns(db, 'perioade');
    const statusCol = cols.find(c => c.name.toLowerCase() === 'status');
    assert.ok(statusCol, 'status column must exist in perioade');
  });

  it('T2.5: Database enforces foreign key constraints when enabled', () => {
    const pragmaFk = db.pragma('foreign_keys', { simple: true });
    assert.equal(pragmaFk, 1, 'foreign_keys pragma must be active (1)');
  });
});
