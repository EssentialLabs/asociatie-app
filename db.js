/**
 * db.js - SQLite Database Layer for ORHIDEEA 2005 FoxPro Parity
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const DB_PATH = path.join(__dirname, 'asociatie.db');
const DB_GZ_PATH = path.join(__dirname, 'asociatie.db.gz');

let db;

function getDb(customPath) {
  if (!db || (customPath && customPath !== DB_PATH)) {
    const targetPath = customPath || DB_PATH;
    if (targetPath === DB_PATH && !fs.existsSync(DB_PATH) && fs.existsSync(DB_GZ_PATH)) {
      try {
        console.log('[DB] Decompresie automată asociatie.db.gz -> asociatie.db...');
        const compressed = fs.readFileSync(DB_GZ_PATH);
        const decompressed = zlib.gunzipSync(compressed);
        fs.writeFileSync(DB_PATH, decompressed);
      } catch (err) {
        console.error('[DB] Eroare la decompresia asociatie.db.gz:', err.message);
      }
    }
    db = new Database(targetPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initializeSchema(db);
  }
  return db;
}

function initializeSchema(database) {
  const d = database || db;

  d.exec(`
    -- 1. Asociatie (Association Profile & Global Settings)
    CREATE TABLE IF NOT EXISTS asociatie (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nume TEXT,
      cod_fiscal TEXT,
      n_r_com TEXT DEFAULT '',
      administrator TEXT DEFAULT '',
      presedinte TEXT DEFAULT '',
      adresa TEXT DEFAULT '',
      cod_postal TEXT DEFAULT '',
      judet TEXT DEFAULT '',
      cont_bancar TEXT DEFAULT '',
      banca TEXT DEFAULT '',
      program TEXT DEFAULT '',
      telefon TEXT DEFAULT '',
      proc_penalizare REAL DEFAULT 0.2,
      zile_penalizare INTEGER DEFAULT 45,
      serie_chitante TEXT DEFAULT 'ORH',
      urmatorul_numar_chitanta INTEGER DEFAULT 1,
      luna_lucru INTEGER DEFAULT 9,
      an_lucru INTEGER DEFAULT 2026,
      cota_fr REAL DEFAULT 0
    );

    -- 2. Perioade (Monthly Lifecycle Management)
    CREATE TABLE IF NOT EXISTS perioade (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asociatie_id INTEGER DEFAULT 1 REFERENCES asociatie(id),
      an INTEGER NOT NULL,
      luna INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'DESCHISA' CHECK(status IN ('DESCHISA', 'PUBLICATA', 'INCHISA')),
      ultima_zi TEXT,
      tarif_ar REAL DEFAULT 0,
      tarif_ca REAL DEFAULT 0,
      proc_ca REAL DEFAULT 100,
      tarif_et REAL DEFAULT 0,
      creat_la DATETIME DEFAULT CURRENT_TIMESTAMP,
      inchis_la DATETIME,
      inchis_de TEXT,
      CONSTRAINT uq_perioade_an_luna UNIQUE(asociatie_id, an, luna)
    );

    -- 3. General (Monthly General Settings & Tariffs)
    CREATE TABLE IF NOT EXISTS general (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      perioada_id INTEGER REFERENCES perioade(id) ON DELETE CASCADE,
      an INTEGER NOT NULL,
      luna INTEGER NOT NULL,
      ultima_zi TEXT NOT NULL,
      tarif_ar REAL NOT NULL DEFAULT 0,
      tarif_ca REAL NOT NULL DEFAULT 0,
      proc_ca REAL NOT NULL DEFAULT 100,
      creat_la DATETIME DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT uq_general_an_luna UNIQUE(an, luna)
    );

    -- 4. Blocuri (Blocks Profile, Modes, Meters, Invoices)
    CREATE TABLE IF NOT EXISTS blocuri (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asociatie_id INTEGER DEFAULT 1 REFERENCES asociatie(id),
      bloc TEXT NOT NULL UNIQUE,
      strada TEXT DEFAULT '',
      numar TEXT DEFAULT '',
      cod TEXT DEFAULT '',
      cod_postal TEXT DEFAULT '',
      total_apartamente INTEGER DEFAULT 0,
      suprafata_totala REAL DEFAULT 0,
      -- Allocation modes
      mod_r_dif TEXT DEFAULT 'PER',
      mod_repartizare_dif TEXT DEFAULT 'PER',
      mod_r_inc TEXT DEFAULT 'SL',
      modr_difin TEXT DEFAULT 'SL',
      mod_r_asc TEXT DEFAULT 'PER',
      -- Percentages
      procinccom REAL DEFAULT 0,
      proc_chsed REAL DEFAULT 100,
      proc_av_ac REAL DEFAULT 100,
      proc_av_in REAL DEFAULT 100,
      proc_sal_f REAL DEFAULT 100,
      proc_sal_femeie INTEGER DEFAULT 100,
      proc_sal_t REAL DEFAULT 100,
      proc_sal_tesa INTEGER DEFAULT 100,
      proc_abona REAL DEFAULT 100,
      proc_abonament INTEGER DEFAULT 100,
      proc_chadm REAL DEFAULT 100,
      proc_ch_admin INTEGER DEFAULT 100,
      procgunoi REAL DEFAULT 100,
      proc_gunoi INTEGER DEFAULT 100,
      cota_fond_reparatii REAL DEFAULT 10.0,
      tarif_apa_rece REAL DEFAULT 8.5,
      tarif_apa_calda REAL DEFAULT 18.0,
      tarif_canal REAL DEFAULT 4.0,
      -- Block meters
      index_vechi_ar INTEGER DEFAULT 0,
      index_nou_ar INTEGER DEFAULT 0,
      inar REAL DEFAULT 0,
      ivar REAL DEFAULT 0,
      index_vechi_ac INTEGER DEFAULT 0,
      index_nou_ac INTEGER DEFAULT 0,
      inac REAL DEFAULT 0,
      ivac REAL DEFAULT 0,
      index_vechi_in REAL DEFAULT 0,
      index_nou_in REAL DEFAULT 0,
      inin REAL DEFAULT 0,
      ivin REAL DEFAULT 0,
      const_incalzire REAL DEFAULT 1.0,
      constin REAL DEFAULT 1.0,
      cp_ar TEXT DEFAULT 'C',
      cp_ac TEXT DEFAULT 'C',
      cp_in TEXT DEFAULT 'P',
      -- Thermal parameters
      ecart_temp REAL DEFAULT 0,
      rand_tr REAL DEFAULT 100,
      tarif_et REAL DEFAULT 0,
      -- Block monthly invoices
      gaz REAL DEFAULT 0,
      gunoi REAL DEFAULT 0,
      curent REAL DEFAULT 0,
      curent_sc REAL DEFAULT 0,
      curent_li REAL DEFAULT 0,
      ascensor REAL DEFAULT 0,
      sal_tesa REAL DEFAULT 0,
      sal_feme REAL DEFAULT 0,
      ch_admin REAL DEFAULT 0,
      ch_sediu REAL DEFAULT 0,
      cota_fr REAL DEFAULT 0,
      prest_serv REAL DEFAULT 0,
      chelt_inc REAL DEFAULT 0,
      abonament REAL DEFAULT 0,
      can_met REAL DEFAULT 0,
      -- Differences and bases
      difarar REAL DEFAULT 0,
      difarac REAL DEFAULT 0,
      difcanar REAL DEFAULT 0,
      difcanac REAL DEFAULT 0,
      difetac REAL DEFAULT 0,
      difetin REAL DEFAULT 0,
      arac REAL DEFAULT 0,
      ardifer REAL DEFAULT 0,
      acac REAL DEFAULT 0,
      acdifer REAL DEFAULT 0,
      etac REAL DEFAULT 0,
      etacac REAL DEFAULT 0,
      etinac REAL DEFAULT 0,
      inccap REAL DEFAULT 0,
      incrap REAL DEFAULT 0,
      incsupr REAL DEFAULT 0,
      inccomun REAL DEFAULT 0,
      observatii TEXT DEFAULT ''
    );

    -- 5. Apartamente (Apartments Model, Reductions, 16 Percentages, Meters, Allocators, Manual Charges)
    CREATE TABLE IF NOT EXISTS apartamente (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bloc_id INTEGER REFERENCES blocuri(id) ON DELETE CASCADE,
      numar_apart TEXT NOT NULL,
      nume_proprietar TEXT DEFAULT '',
      persoane INTEGER DEFAULT 0,
      suprafata REAL DEFAULT 0,
      sup_ec_ter REAL DEFAULT 0,
      supr_redus REAL DEFAULT 0,
      -- Reductions (TCE)
      d1 TEXT,
      d2 TEXT,
      p1_scaz INTEGER DEFAULT 0,
      p2_scaz INTEGER DEFAULT 0,
      sl1_scaz REAL DEFAULT 0,
      sl2_scaz REAL DEFAULT 0,
      set_scaz REAL DEFAULT 0,
      -- 16 Percentages
      proc_av_ac REAL DEFAULT 100,
      proc_av_in REAL DEFAULT 100,
      procg REAL DEFAULT 100,
      procgunoi REAL DEFAULT 100,
      procascens REAL DEFAULT 100,
      proc_cu_sc REAL DEFAULT 100,
      proc_cu_li REAL DEFAULT 100,
      proc_sal_f REAL DEFAULT 100,
      proc_sal_t REAL DEFAULT 100,
      proc_abona REAL DEFAULT 100,
      p_saltesa REAL DEFAULT 100,
      p_presserv REAL DEFAULT 100,
      proc_chadm REAL DEFAULT 100,
      proc_difer REAL DEFAULT 100,
      proc_difin REAL DEFAULT 100,
      proc_chsed REAL DEFAULT 100,
      -- 6 Water meters (indexes, metrology dates, serials)
      iv_ar_bu REAL DEFAULT 0, in_ar_bu REAL DEFAULT 0, d_v_ar_bu TEXT, ser_ar_bu TEXT,
      iv_ar_ba1 REAL DEFAULT 0, in_ar_ba1 REAL DEFAULT 0, d_v_ar_ba1 TEXT, ser_ar_ba1 TEXT,
      iv_ar_ba2 REAL DEFAULT 0, in_ar_ba2 REAL DEFAULT 0, d_v_ar_ba2 TEXT, ser_ar_ba2 TEXT,
      iv_ac_bu REAL DEFAULT 0, in_ac_bu REAL DEFAULT 0, d_v_ac_bu TEXT, ser_ac_bu TEXT,
      iv_ac_ba1 REAL DEFAULT 0, in_ac_ba1 REAL DEFAULT 0, d_v_ac_ba1 TEXT, ser_ac_ba1 TEXT,
      iv_ac_ba2 REAL DEFAULT 0, in_ac_ba2 REAL DEFAULT 0, d_v_ac_ba2 TEXT, ser_ac_ba2 TEXT,
      -- Heat meter
      in_incalzire REAL DEFAULT 0, iv_incalzire REAL DEFAULT 0,
      inin REAL DEFAULT 0, ivin REAL DEFAULT 0, constin REAL DEFAULT 1.0, d_v_in TEXT, ser_in TEXT,
      d_v_inin TEXT, ser_inin TEXT,
      -- Meter modes
      cp_ar TEXT DEFAULT 'C', cp_ac TEXT DEFAULT 'C', cp_in TEXT DEFAULT 'P',
      -- 7 Heat cost allocators
      serie_r1 TEXT, iv_r1 REAL DEFAULT 0, in_r1 REAL DEFAULT 0, facttr_r1 REAL DEFAULT 1.0, coefsp_r1 REAL DEFAULT 1.0,
      serie_r2 TEXT, iv_r2 REAL DEFAULT 0, in_r2 REAL DEFAULT 0, facttr_r2 REAL DEFAULT 1.0, coefsp_r2 REAL DEFAULT 1.0,
      serie_r3 TEXT, iv_r3 REAL DEFAULT 0, in_r3 REAL DEFAULT 0, facttr_r3 REAL DEFAULT 1.0, coefsp_r3 REAL DEFAULT 1.0,
      serie_r4 TEXT, iv_r4 REAL DEFAULT 0, in_r4 REAL DEFAULT 0, facttr_r4 REAL DEFAULT 1.0, coefsp_r4 REAL DEFAULT 1.0,
      serie_r5 TEXT, iv_r5 REAL DEFAULT 0, in_r5 REAL DEFAULT 0, facttr_r5 REAL DEFAULT 1.0, coefsp_r5 REAL DEFAULT 1.0,
      serie_r6 TEXT, iv_r6 REAL DEFAULT 0, in_r6 REAL DEFAULT 0, facttr_r6 REAL DEFAULT 1.0, coefsp_r6 REAL DEFAULT 1.0,
      serie_r7 TEXT, iv_r7 REAL DEFAULT 0, in_r7 REAL DEFAULT 0, facttr_r7 REAL DEFAULT 1.0, coefsp_r7 REAL DEFAULT 1.0,
      tot_unit REAL DEFAULT 0, gcal_unit REAL DEFAULT 0, gcal_mp REAL DEFAULT 0, gcal_calc REAL DEFAULT 0, gcal_red REAL DEFAULT 0, gcal_final REAL DEFAULT 0,
      -- Working fund
      max_fond_rulment REAL DEFAULT 0, max_fr REAL DEFAULT 0, calc_fr REAL DEFAULT 0, plat_fr REAL DEFAULT 0, rulment REAL DEFAULT 0,
      fond_rulment_constituit REAL DEFAULT 0,
      -- Manual charges
      fond_reparatii REAL DEFAULT 0, fond_repar REAL DEFAULT 0,
      ch_box REAL DEFAULT 0, ch_hav REAL DEFAULT 0, repar_crt REAL DEFAULT 0, altele REAL DEFAULT 0, i REAL DEFAULT 0,
      fond_reparatii_constituit REAL DEFAULT 0,
      -- Legacy compatibility scalars
      restante REAL DEFAULT 0, penalizari REAL DEFAULT 0,
      -- Computed charges
      apa_rece REAL DEFAULT 0, arra REAL DEFAULT 0, arca REAL DEFAULT 0,
      can_mnj REAL DEFAULT 0, can_mnjar REAL DEFAULT 0, can_mnjac REAL DEFAULT 0, can_met REAL DEFAULT 0,
      apa_calda REAL DEFAULT 0, incalzire REAL DEFAULT 0, gaz REAL DEFAULT 0, gunoi REAL DEFAULT 0,
      curent REAL DEFAULT 0, curent_sc REAL DEFAULT 0, curent_li REAL DEFAULT 0,
      ascensor REAL DEFAULT 0, sal_feme REAL DEFAULT 0, sal_tesa REAL DEFAULT 0,
      ch_admin REAL DEFAULT 0, ch_sediu REAL DEFAULT 0, prest_serv REAL DEFAULT 0, abonament REAL DEFAULT 0, chelt_inc REAL DEFAULT 0,
      difarar REAL DEFAULT 0, difarac REAL DEFAULT 0, difcanar REAL DEFAULT 0, difcanac REAL DEFAULT 0, difetac REAL DEFAULT 0, difetin REAL DEFAULT 0,
      observatii TEXT DEFAULT '',
      CONSTRAINT uq_apartamente_bloc_apart UNIQUE(bloc_id, numar_apart)
    );

    -- 6. Facturi (Supplier Invoices)
    CREATE TABLE IF NOT EXISTS facturi (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bloc_id INTEGER REFERENCES blocuri(id) ON DELETE CASCADE,
      asociatie_id INTEGER REFERENCES asociatie(id) ON DELETE CASCADE,
      perioada_id INTEGER REFERENCES perioade(id) ON DELETE SET NULL,
      luna INTEGER,
      an INTEGER,
      tip_factura TEXT NOT NULL,
      denumire TEXT DEFAULT '',
      suma REAL NOT NULL DEFAULT 0,
      mod_repartizare TEXT NOT NULL DEFAULT 'PERSOANE',
      data_factura TEXT,
      numar_factura TEXT DEFAULT '',
      furnizor TEXT DEFAULT '',
      categorie_cheltuiala TEXT DEFAULT ''
    );

    -- 7. Cheltuieli Apartament (Legacy Distribution Rows)
    CREATE TABLE IF NOT EXISTS cheltuieli_apartament (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      factura_id INTEGER REFERENCES facturi(id) ON DELETE CASCADE,
      apartament_id INTEGER REFERENCES apartamente(id) ON DELETE CASCADE,
      suma_repartizata REAL DEFAULT 0
    );

    -- 8. Chitante (Receipts Header)
    CREATE TABLE IF NOT EXISTS chitante (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      serie TEXT NOT NULL DEFAULT 'ORH',
      numar INTEGER NOT NULL,
      data_emiterii TEXT NOT NULL,
      apartament_id INTEGER REFERENCES apartamente(id) ON DELETE SET NULL,
      bloc_id INTEGER REFERENCES blocuri(id) ON DELETE SET NULL,
      perioada_id INTEGER REFERENCES perioade(id) ON DELETE SET NULL,
      tip_chitanta TEXT DEFAULT 'INDIVIDUAL' CHECK(tip_chitanta IN ('INDIVIDUAL', 'COLECTIV')),
      nume_platitor TEXT NOT NULL DEFAULT '',
      numar_apart TEXT DEFAULT '',
      cod_bloc TEXT DEFAULT '',
      suma REAL NOT NULL DEFAULT 0,
      suma_litere TEXT DEFAULT '',
      explicatie TEXT DEFAULT 'Cote cheltuieli intretinere',
      tip_plata TEXT DEFAULT 'NUMERAR',
      anulata INTEGER DEFAULT 0,
      anulat_la DATETIME,
      anulat_de TEXT,
      motiv_anulare TEXT,
      creat_la DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 9. Datorii (Cumulative Receivables Ledger)
    CREATE TABLE IF NOT EXISTS datorii (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      apartament_id INTEGER NOT NULL REFERENCES apartamente(id) ON DELETE CASCADE,
      bloc_id INTEGER NOT NULL REFERENCES blocuri(id) ON DELETE CASCADE,
      an INTEGER NOT NULL,
      luna INTEGER NOT NULL,
      luna_text TEXT DEFAULT '',
      categorie TEXT NOT NULL CHECK(categorie IN ('R', 'F', 'A', 'P')),
      valoare REAL NOT NULL DEFAULT 0,
      creat_la DATETIME DEFAULT CURRENT_TIMESTAMP,
      sursa TEXT DEFAULT 'PUBLISH' CHECK(sursa IN ('PUBLISH', 'MANUAL', 'PENALTY', 'IMPORT', 'import')),
      perioada_id INTEGER REFERENCES perioade(id) ON DELETE SET NULL,
      explicatie TEXT DEFAULT '',
      penalizat_pana_la TEXT
    );

    -- 10. Plati (Payments & Allocations)
    CREATE TABLE IF NOT EXISTS plati (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      datorie_id INTEGER NOT NULL REFERENCES datorii(id) ON DELETE CASCADE,
      chitanta_id INTEGER REFERENCES chitante(id) ON DELETE SET NULL,
      suma REAL NOT NULL,
      data TEXT NOT NULL,
      sursa TEXT NOT NULL DEFAULT 'CASA' CHECK(sursa IN ('CASA', 'BANCA')),
      creat_la DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 11. Apartamente Luna (Immutable Per-Period Apartment Snapshots)
    CREATE TABLE IF NOT EXISTS apartamente_luna (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      perioada_id INTEGER NOT NULL REFERENCES perioade(id) ON DELETE CASCADE,
      apartament_id INTEGER REFERENCES apartamente(id) ON DELETE SET NULL,
      bloc_id INTEGER REFERENCES blocuri(id) ON DELETE SET NULL,
      an INTEGER NOT NULL,
      luna INTEGER NOT NULL,
      bloc TEXT NOT NULL DEFAULT '',
      numar_apart TEXT NOT NULL DEFAULT '',
      nume_proprietar TEXT DEFAULT '',
      persoane INTEGER DEFAULT 0,
      suprafata REAL DEFAULT 0,
      sup_ec_ter REAL DEFAULT 0,
      supr_redus REAL DEFAULT 0,
      d1 TEXT, d2 TEXT, p1_scaz INTEGER DEFAULT 0, p2_scaz INTEGER DEFAULT 0,
      sl1_scaz REAL DEFAULT 0, sl2_scaz REAL DEFAULT 0, set_scaz REAL DEFAULT 0,
      proc_av_ac REAL DEFAULT 100, proc_av_in REAL DEFAULT 100, procg REAL DEFAULT 100,
      procgunoi REAL DEFAULT 100, procascens REAL DEFAULT 100, proc_cu_sc REAL DEFAULT 100,
      proc_cu_li REAL DEFAULT 100, proc_sal_f REAL DEFAULT 100, proc_sal_t REAL DEFAULT 100,
      proc_abona REAL DEFAULT 100, p_saltesa REAL DEFAULT 100, p_presserv REAL DEFAULT 100,
      proc_chadm REAL DEFAULT 100, proc_difer REAL DEFAULT 100, proc_difin REAL DEFAULT 100,
      proc_chsed REAL DEFAULT 100,
      iv_ar_bu REAL DEFAULT 0, in_ar_bu REAL DEFAULT 0, d_v_ar_bu TEXT, ser_ar_bu TEXT,
      iv_ar_ba1 REAL DEFAULT 0, in_ar_ba1 REAL DEFAULT 0, d_v_ar_ba1 TEXT, ser_ar_ba1 TEXT,
      iv_ar_ba2 REAL DEFAULT 0, in_ar_ba2 REAL DEFAULT 0, d_v_ar_ba2 TEXT, ser_ar_ba2 TEXT,
      iv_ac_bu REAL DEFAULT 0, in_ac_bu REAL DEFAULT 0, d_v_ac_bu TEXT, ser_ac_bu TEXT,
      iv_ac_ba1 REAL DEFAULT 0, in_ac_ba1 REAL DEFAULT 0, d_v_ac_ba1 TEXT, ser_ac_ba1 TEXT,
      iv_ac_ba2 REAL DEFAULT 0, in_ac_ba2 REAL DEFAULT 0, d_v_ac_ba2 TEXT, ser_ac_ba2 TEXT,
      in_incalzire REAL DEFAULT 0, iv_incalzire REAL DEFAULT 0,
      inin REAL DEFAULT 0, ivin REAL DEFAULT 0, constin REAL DEFAULT 1.0, d_v_in TEXT, ser_in TEXT,
      d_v_inin TEXT, ser_inin TEXT,
      cp_ar TEXT DEFAULT 'C', cp_ac TEXT DEFAULT 'C', cp_in TEXT DEFAULT 'P',
      serie_r1 TEXT, iv_r1 REAL DEFAULT 0, in_r1 REAL DEFAULT 0, facttr_r1 REAL DEFAULT 1.0, coefsp_r1 REAL DEFAULT 1.0,
      serie_r2 TEXT, iv_r2 REAL DEFAULT 0, in_r2 REAL DEFAULT 0, facttr_r2 REAL DEFAULT 1.0, coefsp_r2 REAL DEFAULT 1.0,
      serie_r3 TEXT, iv_r3 REAL DEFAULT 0, in_r3 REAL DEFAULT 0, facttr_r3 REAL DEFAULT 1.0, coefsp_r3 REAL DEFAULT 1.0,
      serie_r4 TEXT, iv_r4 REAL DEFAULT 0, in_r4 REAL DEFAULT 0, facttr_r4 REAL DEFAULT 1.0, coefsp_r4 REAL DEFAULT 1.0,
      serie_r5 TEXT, iv_r5 REAL DEFAULT 0, in_r5 REAL DEFAULT 0, facttr_r5 REAL DEFAULT 1.0, coefsp_r5 REAL DEFAULT 1.0,
      serie_r6 TEXT, iv_r6 REAL DEFAULT 0, in_r6 REAL DEFAULT 0, facttr_r6 REAL DEFAULT 1.0, coefsp_r6 REAL DEFAULT 1.0,
      serie_r7 TEXT, iv_r7 REAL DEFAULT 0, in_r7 REAL DEFAULT 0, facttr_r7 REAL DEFAULT 1.0, coefsp_r7 REAL DEFAULT 1.0,
      tot_unit REAL DEFAULT 0, gcal_unit REAL DEFAULT 0, gcal_mp REAL DEFAULT 0, gcal_calc REAL DEFAULT 0, gcal_red REAL DEFAULT 0, gcal_final REAL DEFAULT 0,
      ch_box REAL DEFAULT 0, ch_hav REAL DEFAULT 0, repar_crt REAL DEFAULT 0, altele REAL DEFAULT 0, i REAL DEFAULT 0,
      fond_repar REAL DEFAULT 0, fond_reparatii REAL DEFAULT 0,
      max_fr REAL DEFAULT 0, max_fond_rulment REAL DEFAULT 0, calc_fr REAL DEFAULT 0, plat_fr REAL DEFAULT 0, rulment REAL DEFAULT 0,
      apa_rece REAL DEFAULT 0, arra REAL DEFAULT 0, arca REAL DEFAULT 0,
      can_mnj REAL DEFAULT 0, can_mnjar REAL DEFAULT 0, can_mnjac REAL DEFAULT 0, can_met REAL DEFAULT 0,
      apa_calda REAL DEFAULT 0, incalzire REAL DEFAULT 0, gaz REAL DEFAULT 0, gunoi REAL DEFAULT 0,
      curent REAL DEFAULT 0, curent_sc REAL DEFAULT 0, curent_li REAL DEFAULT 0,
      ascensor REAL DEFAULT 0, sal_feme REAL DEFAULT 0, sal_tesa REAL DEFAULT 0,
      ch_admin REAL DEFAULT 0, ch_sediu REAL DEFAULT 0, prest_serv REAL DEFAULT 0, abonament REAL DEFAULT 0, chelt_inc REAL DEFAULT 0,
      difarar REAL DEFAULT 0, difarac REAL DEFAULT 0, difcanar REAL DEFAULT 0, difcanac REAL DEFAULT 0, difetac REAL DEFAULT 0, difetin REAL DEFAULT 0,
      total_luna REAL DEFAULT 0, restante REAL DEFAULT 0, penalizari REAL DEFAULT 0, total_general REAL DEFAULT 0,
      observatii TEXT DEFAULT '',
      creat_la DATETIME DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT uq_apartamente_luna UNIQUE(perioada_id, bloc, numar_apart)
    );

    -- 12. Blocuri Luna (Immutable Per-Period Block Snapshots)
    CREATE TABLE IF NOT EXISTS blocuri_luna (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      perioada_id INTEGER NOT NULL REFERENCES perioade(id) ON DELETE CASCADE,
      bloc_id INTEGER REFERENCES blocuri(id) ON DELETE SET NULL,
      an INTEGER NOT NULL,
      luna INTEGER NOT NULL,
      bloc TEXT NOT NULL DEFAULT '',
      strada TEXT DEFAULT '', numar TEXT DEFAULT '', cod TEXT DEFAULT '', cod_postal TEXT DEFAULT '',
      total_apartamente INTEGER DEFAULT 0, suprafata_totala REAL DEFAULT 0,
      mod_r_dif TEXT DEFAULT 'PER', mod_r_inc TEXT DEFAULT 'SL', modr_difin TEXT DEFAULT 'SL', mod_r_asc TEXT DEFAULT 'PER',
      proc_av_ac REAL DEFAULT 100, proc_av_in REAL DEFAULT 100, procinccom REAL DEFAULT 0,
      proc_sal_f REAL DEFAULT 100, proc_sal_t REAL DEFAULT 100, proc_abona REAL DEFAULT 100,
      proc_chadm REAL DEFAULT 100, procgunoi REAL DEFAULT 100, proc_chsed REAL DEFAULT 100,
      inar REAL DEFAULT 0, ivar REAL DEFAULT 0, cp_ar TEXT DEFAULT 'C',
      inac REAL DEFAULT 0, ivac REAL DEFAULT 0, cp_ac TEXT DEFAULT 'C',
      inin REAL DEFAULT 0, ivin REAL DEFAULT 0, constin REAL DEFAULT 1.0, cp_in TEXT DEFAULT 'P',
      ecart_temp REAL DEFAULT 0, rand_tr REAL DEFAULT 100, tarif_et REAL DEFAULT 0,
      gaz REAL DEFAULT 0, gunoi REAL DEFAULT 0, curent REAL DEFAULT 0, curent_sc REAL DEFAULT 0, curent_li REAL DEFAULT 0,
      ascensor REAL DEFAULT 0, sal_tesa REAL DEFAULT 0, sal_feme REAL DEFAULT 0, ch_admin REAL DEFAULT 0, ch_sediu REAL DEFAULT 0,
      cota_fr REAL DEFAULT 0, prest_serv REAL DEFAULT 0, chelt_inc REAL DEFAULT 0, abonament REAL DEFAULT 0, can_met REAL DEFAULT 0,
      difarar REAL DEFAULT 0, difarac REAL DEFAULT 0, difcanar REAL DEFAULT 0, difcanac REAL DEFAULT 0, difetac REAL DEFAULT 0, difetin REAL DEFAULT 0,
      arac REAL DEFAULT 0, ardifer REAL DEFAULT 0, acac REAL DEFAULT 0, acdifer REAL DEFAULT 0,
      etac REAL DEFAULT 0, etacac REAL DEFAULT 0, etinac REAL DEFAULT 0, inccap REAL DEFAULT 0, incrap REAL DEFAULT 0, incsupr REAL DEFAULT 0, inccomun REAL DEFAULT 0,
      persoane1 INTEGER DEFAULT 0, persoane2 INTEGER DEFAULT 0, persgu INTEGER DEFAULT 0,
      pers_ar INTEGER DEFAULT 0, pers_ac INTEGER DEFAULT 0, pers_acx INTEGER DEFAULT 0,
      pascens INTEGER DEFAULT 0, pcurent_sc INTEGER DEFAULT 0, pcurent_li INTEGER DEFAULT 0, per_sal_fe INTEGER DEFAULT 0, perdifar REAL DEFAULT 0, perdifac REAL DEFAULT 0,
      suprafata1 REAL DEFAULT 0, suprafata2 REAL DEFAULT 0, sl_inc REAL DEFAULT 0, sl_incd REAL DEFAULT 0, sl_dinc REAL DEFAULT 0, sl_difin REAL DEFAULT 0, set_difin REAL DEFAULT 0, set_comun REAL DEFAULT 0, sup_ec_ter REAL DEFAULT 0,
      sl_abon REAL DEFAULT 0, sl_salte REAL DEFAULT 0, sl_salfe REAL DEFAULT 0, sl_presse REAL DEFAULT 0, sl_chsed REAL DEFAULT 0, sl_ascen REAL DEFAULT 0, sl_chadm REAL DEFAULT 0,
      observatii TEXT DEFAULT '',
      creat_la DATETIME DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT uq_blocuri_luna UNIQUE(perioada_id, bloc)
    );

    -- 13. Asociatie Luna (Immutable Per-Period Association Snapshots)
    CREATE TABLE IF NOT EXISTS asociatie_luna (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      perioada_id INTEGER NOT NULL REFERENCES perioade(id) ON DELETE CASCADE,
      asoc TEXT DEFAULT 'ASOCIATIA TEST',
      apa_rece REAL DEFAULT 0, can_met REAL DEFAULT 0, apa_calda REAL DEFAULT 0, etac REAL DEFAULT 0, incalzire REAL DEFAULT 0,
      gunoi REAL DEFAULT 0, ch_admin REAL DEFAULT 0, sal_tesa REAL DEFAULT 0, sal_feme REAL DEFAULT 0,
      abonament REAL DEFAULT 0, ch_sediu REAL DEFAULT 0, rulment REAL DEFAULT 0,
      tot_apart INTEGER DEFAULT 0, persoane1 INTEGER DEFAULT 0, persoane2 INTEGER DEFAULT 0, persgu INTEGER DEFAULT 0,
      pers_ar INTEGER DEFAULT 0, pers_ac INTEGER DEFAULT 0, pers_acx INTEGER DEFAULT 0,
      pascens INTEGER DEFAULT 0, pcurent_sc INTEGER DEFAULT 0, pcurent_li INTEGER DEFAULT 0, per_sal_fe INTEGER DEFAULT 0,
      suprafata1 REAL DEFAULT 0, suprafata2 REAL DEFAULT 0,
      sl_inc REAL DEFAULT 0, sl_abon REAL DEFAULT 0, sl_salte REAL DEFAULT 0, sl_salfe REAL DEFAULT 0, sl_chsed REAL DEFAULT 0, sl_chadm REAL DEFAULT 0,
      sup_ec_ter REAL DEFAULT 0,
      creat_la DATETIME DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT uq_asociatie_luna UNIQUE(perioada_id)
    );

    -- 14. Casa (Cash Journal)
    CREATE TABLE IF NOT EXISTS casa (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      perioada_id INTEGER REFERENCES perioade(id) ON DELETE SET NULL,
      asoc TEXT DEFAULT 'ASOCIATIA TEST',
      document TEXT DEFAULT '',
      data TEXT NOT NULL,
      suma REAL NOT NULL,
      tip TEXT NOT NULL CHECK(tip IN ('I', 'P', 'INCASARE', 'PLATA')),
      act_pas TEXT DEFAULT 'A' CHECK(act_pas IN ('A', 'P')),
      explicatie TEXT DEFAULT '',
      chitanta_id INTEGER REFERENCES chitante(id) ON DELETE SET NULL,
      creat_la DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 15. Banca (Bank Journal)
    CREATE TABLE IF NOT EXISTS banca (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      perioada_id INTEGER REFERENCES perioade(id) ON DELETE SET NULL,
      asoc TEXT DEFAULT 'ASOCIATIA TEST',
      document TEXT DEFAULT '',
      data TEXT NOT NULL,
      suma REAL NOT NULL,
      tip TEXT NOT NULL CHECK(tip IN ('D', 'V', 'DEPUNERE', 'VIRAMENT')),
      act_pas TEXT DEFAULT 'A' CHECK(act_pas IN ('A', 'P')),
      explicatie TEXT DEFAULT '',
      chitanta_id INTEGER REFERENCES chitante(id) ON DELETE SET NULL,
      creat_la DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 16. Patrimoniu (Balance Sheet Items)
    CREATE TABLE IF NOT EXISTS patrimoniu (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      perioada_id INTEGER REFERENCES perioade(id) ON DELETE SET NULL,
      asoc TEXT DEFAULT 'ASOCIATIA TEST',
      document TEXT DEFAULT '',
      data TEXT DEFAULT '',
      suma REAL NOT NULL DEFAULT 0,
      act_pas TEXT NOT NULL CHECK(act_pas IN ('A', 'P')),
      explicatie TEXT DEFAULT '',
      perioada TEXT DEFAULT '',
      data_pres TEXT DEFAULT '',
      creat_la DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 17. Ordine de Plata (Payment Orders)
    CREATE TABLE IF NOT EXISTS ordine_plata (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      perioada_id INTEGER REFERENCES perioade(id) ON DELETE SET NULL,
      numar INTEGER NOT NULL,
      data TEXT NOT NULL,
      tip_ordin TEXT DEFAULT 'A',
      suma REAL NOT NULL DEFAULT 0,
      platitor1 TEXT DEFAULT '', platitor2 TEXT DEFAULT '',
      adrplat TEXT DEFAULT '', codf_plat TEXT DEFAULT '', cont_plat TEXT DEFAULT '',
      banca_plat TEXT DEFAULT '', filia_plat TEXT DEFAULT '', bicp TEXT DEFAULT '',
      beneficiar TEXT DEFAULT '', cont_bene TEXT DEFAULT '',
      banca_bene TEXT DEFAULT '', filia_bene TEXT DEFAULT '', bicb TEXT DEFAULT '',
      adrben TEXT DEFAULT '', codf_bene TEXT DEFAULT '',
      reprez1 TEXT DEFAULT '', reprez2 TEXT DEFAULT '', reprez3 TEXT DEFAULT '',
      creat_la DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 18. Users (Authentication & Authorization)
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      nume TEXT NOT NULL DEFAULT '',
      rol TEXT NOT NULL CHECK(rol IN ('superadmin', 'administrator', 'casier')),
      creat_la DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 19. Audit Logs (Security Audit Trail)
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      impersonator_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      username TEXT DEFAULT '',
      actiune TEXT NOT NULL,
      entitate TEXT DEFAULT '',
      entitate_id INTEGER,
      detalii TEXT DEFAULT '',
      ip TEXT DEFAULT '',
      creat_la DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Legacy tables compatibility
    CREATE TABLE IF NOT EXISTS istoric_luni (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      luna INTEGER NOT NULL,
      an INTEGER NOT NULL,
      data_inchidere TEXT NOT NULL,
      inchis_de TEXT DEFAULT 'Administrator',
      total_calculat REAL DEFAULT 0,
      total_incasat REAL DEFAULT 0,
      observatii TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS system_error_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platforma TEXT DEFAULT 'web',
      mesaj TEXT NOT NULL,
      stack TEXT,
      rezolvat INTEGER DEFAULT 0,
      creat_la DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Run dynamic schema migrations on existing tables BEFORE creating indexes on new columns
  migrateExistingTables(d);

  // Indexes on all tables (safe after migrations)
  d.exec(`
    CREATE INDEX IF NOT EXISTS idx_datorii_apt_per ON datorii (apartament_id, an, luna);
    CREATE INDEX IF NOT EXISTS idx_datorii_bloc_per ON datorii (bloc_id, an, luna);
    CREATE INDEX IF NOT EXISTS idx_datorii_cat ON datorii (categorie);
    CREATE INDEX IF NOT EXISTS idx_datorii_per ON datorii (perioada_id);

    CREATE INDEX IF NOT EXISTS idx_plati_datorie ON plati (datorie_id);
    CREATE INDEX IF NOT EXISTS idx_plati_chitanta ON plati (chitanta_id);
    CREATE INDEX IF NOT EXISTS idx_plati_data ON plati (data);

    CREATE INDEX IF NOT EXISTS idx_perioade_an_luna ON perioade (an, luna);

    CREATE INDEX IF NOT EXISTS idx_apartamente_luna_per_apt ON apartamente_luna (perioada_id, apartament_id);
    CREATE INDEX IF NOT EXISTS idx_apartamente_luna_per_bloc ON apartamente_luna (perioada_id, bloc_id);
    CREATE INDEX IF NOT EXISTS idx_blocuri_luna_per_bloc ON blocuri_luna (perioada_id, bloc_id);

    CREATE INDEX IF NOT EXISTS idx_casa_perioada ON casa (perioada_id);
    CREATE INDEX IF NOT EXISTS idx_casa_data ON casa (data);
    CREATE INDEX IF NOT EXISTS idx_banca_perioada ON banca (perioada_id);
    CREATE INDEX IF NOT EXISTS idx_banca_data ON banca (data);
    CREATE INDEX IF NOT EXISTS idx_patrimoniu_perioada ON patrimoniu (perioada_id);
    CREATE INDEX IF NOT EXISTS idx_ordine_plata_numar ON ordine_plata (numar);
    CREATE INDEX IF NOT EXISTS idx_ordine_plata_data ON ordine_plata (data);

    CREATE INDEX IF NOT EXISTS idx_chitante_serie_numar ON chitante (serie, numar);
    CREATE INDEX IF NOT EXISTS idx_chitante_apartament ON chitante (apartament_id);
    CREATE INDEX IF NOT EXISTS idx_chitante_perioada ON chitante (perioada_id);

    CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs (user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_actiune ON audit_logs (actiune);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_data ON audit_logs (creat_la);
  `);

  // Seed default data if empty
  seedDefaults(d);
}

function getExistingColumns(d, table) {
  try {
    const info = d.prepare(`PRAGMA table_info("${table}")`).all();
    return new Set(info.map(c => c.name.toLowerCase()));
  } catch (_) {
    return new Set();
  }
}

function migrateExistingTables(d) {
  const addCol = (table, col, def) => {
    try {
      d.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def};`);
    } catch (err) {
      if (/REFERENCES.*DEFAULT|DEFAULT.*REFERENCES/i.test(def)) {
        try {
          const fallbackDef = def.replace(/DEFAULT\s+\S+/i, '').trim();
          d.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${fallbackDef};`);
        } catch (_) {}
      }
    }
  };

  // 1a. Check and fix perioade table unique constraint to support multi-tenancy (asociatie_id, an, luna)
  try {
    const pIndexes = d.prepare("PRAGMA index_list('perioade')").all();
    let needsPerioadeMigration = false;
    for (const idx of pIndexes) {
      if (idx.unique) {
        const cols = d.prepare(`PRAGMA index_info("${idx.name}")`).all().map(c => c.name.toLowerCase());
        if (cols.includes('an') && cols.includes('luna') && !cols.includes('asociatie_id')) {
          needsPerioadeMigration = true;
          break;
        }
      }
    }

    if (needsPerioadeMigration) {
      d.pragma('foreign_keys = OFF');
      d.transaction(() => {
        d.exec(`
          CREATE TABLE perioade_migration_tmp (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            asociatie_id INTEGER DEFAULT 1 REFERENCES asociatie(id),
            an INTEGER NOT NULL,
            luna INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'DESCHISA' CHECK(status IN ('DESCHISA', 'PUBLICATA', 'INCHISA')),
            ultima_zi TEXT,
            tarif_ar REAL DEFAULT 0,
            tarif_ca REAL DEFAULT 0,
            proc_ca REAL DEFAULT 100,
            tarif_et REAL DEFAULT 0,
            creat_la DATETIME DEFAULT CURRENT_TIMESTAMP,
            inchis_la DATETIME,
            inchis_de TEXT,
            CONSTRAINT uq_perioade_an_luna UNIQUE(asociatie_id, an, luna)
          );
          INSERT INTO perioade_migration_tmp (id, asociatie_id, an, luna, status, ultima_zi, tarif_ar, tarif_ca, proc_ca, tarif_et, creat_la, inchis_la, inchis_de)
          SELECT id, COALESCE(asociatie_id, 1), an, luna, status, ultima_zi, tarif_ar, tarif_ca, proc_ca, tarif_et, creat_la, inchis_la, inchis_de FROM perioade;
          DROP TABLE perioade;
          ALTER TABLE perioade_migration_tmp RENAME TO perioade;
          CREATE INDEX IF NOT EXISTS idx_perioade_an_luna ON perioade (an, luna);
        `);
      })();
      d.pragma('foreign_keys = ON');
    }
  } catch (_) {}

  // 1. Check and fix apartamente.persoane default value (G14)
  const apCols = d.prepare('PRAGMA table_info(apartamente)').all();
  const persCol = apCols.find(c => c.name.toLowerCase() === 'persoane');
  if (persCol && String(persCol.dflt_value).trim() === '1') {
    // Rebuild apartamente table to set DEFAULT 0 safely
    d.pragma('foreign_keys = OFF');
    const existingColNames = apCols.map(c => `"${c.name}"`).join(', ');
    d.transaction(() => {
      d.exec(`
        CREATE TABLE apartamente_migration_tmp (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          bloc_id INTEGER REFERENCES blocuri(id) ON DELETE CASCADE,
          numar_apart TEXT NOT NULL,
          nume_proprietar TEXT DEFAULT '',
          persoane INTEGER DEFAULT 0,
          suprafata REAL DEFAULT 0,
          sup_ec_ter REAL DEFAULT 0,
          supr_redus REAL DEFAULT 0,
          d1 TEXT, d2 TEXT, p1_scaz INTEGER DEFAULT 0, p2_scaz INTEGER DEFAULT 0,
          sl1_scaz REAL DEFAULT 0, sl2_scaz REAL DEFAULT 0, set_scaz REAL DEFAULT 0,
          proc_av_ac REAL DEFAULT 100, proc_av_in REAL DEFAULT 100, procg REAL DEFAULT 100,
          procgunoi REAL DEFAULT 100, procascens REAL DEFAULT 100, proc_cu_sc REAL DEFAULT 100,
          proc_cu_li REAL DEFAULT 100, proc_sal_f REAL DEFAULT 100, proc_sal_t REAL DEFAULT 100,
          proc_abona REAL DEFAULT 100, p_saltesa REAL DEFAULT 100, p_presserv REAL DEFAULT 100,
          proc_chadm REAL DEFAULT 100, proc_difer REAL DEFAULT 100, proc_difin REAL DEFAULT 100,
          proc_chsed REAL DEFAULT 100,
          iv_ar_bu REAL DEFAULT 0, in_ar_bu REAL DEFAULT 0, d_v_ar_bu TEXT, ser_ar_bu TEXT,
          iv_ar_ba1 REAL DEFAULT 0, in_ar_ba1 REAL DEFAULT 0, d_v_ar_ba1 TEXT, ser_ar_ba1 TEXT,
          iv_ar_ba2 REAL DEFAULT 0, in_ar_ba2 REAL DEFAULT 0, d_v_ar_ba2 TEXT, ser_ar_ba2 TEXT,
          iv_ac_bu REAL DEFAULT 0, in_ac_bu REAL DEFAULT 0, d_v_ac_bu TEXT, ser_ac_bu TEXT,
          iv_ac_ba1 REAL DEFAULT 0, in_ac_ba1 REAL DEFAULT 0, d_v_ac_ba1 TEXT, ser_ac_ba1 TEXT,
          iv_ac_ba2 REAL DEFAULT 0, in_ac_ba2 REAL DEFAULT 0, d_v_ac_ba2 TEXT, ser_ac_ba2 TEXT,
          in_incalzire REAL DEFAULT 0, iv_incalzire REAL DEFAULT 0,
          inin REAL DEFAULT 0, ivin REAL DEFAULT 0, constin REAL DEFAULT 1.0, d_v_in TEXT, ser_in TEXT,
          d_v_inin TEXT, ser_inin TEXT,
          cp_ar TEXT DEFAULT 'C', cp_ac TEXT DEFAULT 'C', cp_in TEXT DEFAULT 'P',
          serie_r1 TEXT, iv_r1 REAL DEFAULT 0, in_r1 REAL DEFAULT 0, facttr_r1 REAL DEFAULT 1.0, coefsp_r1 REAL DEFAULT 1.0,
          serie_r2 TEXT, iv_r2 REAL DEFAULT 0, in_r2 REAL DEFAULT 0, facttr_r2 REAL DEFAULT 1.0, coefsp_r2 REAL DEFAULT 1.0,
          serie_r3 TEXT, iv_r3 REAL DEFAULT 0, in_r3 REAL DEFAULT 0, facttr_r3 REAL DEFAULT 1.0, coefsp_r3 REAL DEFAULT 1.0,
          serie_r4 TEXT, iv_r4 REAL DEFAULT 0, in_r4 REAL DEFAULT 0, facttr_r4 REAL DEFAULT 1.0, coefsp_r4 REAL DEFAULT 1.0,
          serie_r5 TEXT, iv_r5 REAL DEFAULT 0, in_r5 REAL DEFAULT 0, facttr_r5 REAL DEFAULT 1.0, coefsp_r5 REAL DEFAULT 1.0,
          serie_r6 TEXT, iv_r6 REAL DEFAULT 0, in_r6 REAL DEFAULT 0, facttr_r6 REAL DEFAULT 1.0, coefsp_r6 REAL DEFAULT 1.0,
          serie_r7 TEXT, iv_r7 REAL DEFAULT 0, in_r7 REAL DEFAULT 0, facttr_r7 REAL DEFAULT 1.0, coefsp_r7 REAL DEFAULT 1.0,
          tot_unit REAL DEFAULT 0, gcal_unit REAL DEFAULT 0, gcal_mp REAL DEFAULT 0, gcal_calc REAL DEFAULT 0, gcal_red REAL DEFAULT 0, gcal_final REAL DEFAULT 0,
          max_fond_rulment REAL DEFAULT 0, max_fr REAL DEFAULT 0, calc_fr REAL DEFAULT 0, plat_fr REAL DEFAULT 0, rulment REAL DEFAULT 0,
          fond_reparatii REAL DEFAULT 0, fond_repar REAL DEFAULT 0,
          ch_box REAL DEFAULT 0, ch_hav REAL DEFAULT 0, repar_crt REAL DEFAULT 0, altele REAL DEFAULT 0, i REAL DEFAULT 0,
          restante REAL DEFAULT 0, penalizari REAL DEFAULT 0,
          fond_rulment_constituit REAL DEFAULT 0, fond_reparatii_constituit REAL DEFAULT 0,
          apa_rece REAL DEFAULT 0, arra REAL DEFAULT 0, arca REAL DEFAULT 0,
          can_mnj REAL DEFAULT 0, can_mnjar REAL DEFAULT 0, can_mnjac REAL DEFAULT 0, can_met REAL DEFAULT 0,
          apa_calda REAL DEFAULT 0, incalzire REAL DEFAULT 0, gaz REAL DEFAULT 0, gunoi REAL DEFAULT 0,
          curent REAL DEFAULT 0, curent_sc REAL DEFAULT 0, curent_li REAL DEFAULT 0,
          ascensor REAL DEFAULT 0, sal_feme REAL DEFAULT 0, sal_tesa REAL DEFAULT 0,
          ch_admin REAL DEFAULT 0, ch_sediu REAL DEFAULT 0, prest_serv REAL DEFAULT 0, abonament REAL DEFAULT 0, chelt_inc REAL DEFAULT 0,
          difarar REAL DEFAULT 0, difarac REAL DEFAULT 0, difcanar REAL DEFAULT 0, difcanac REAL DEFAULT 0, difetac REAL DEFAULT 0, difetin REAL DEFAULT 0,
          observatii TEXT DEFAULT '',
          CONSTRAINT uq_apartamente_bloc_apart UNIQUE(bloc_id, numar_apart)
        );
        INSERT INTO apartamente_migration_tmp (${existingColNames})
        SELECT ${existingColNames} FROM apartamente;
        DROP TABLE apartamente;
        ALTER TABLE apartamente_migration_tmp RENAME TO apartamente;
      `);
    })();
    d.pragma('foreign_keys = ON');
  }

  // 2. Ensure all apartamente columns exist
  const apCurrent = getExistingColumns(d, 'apartamente');
  const apColsToAdd = [
    ['sup_ec_ter', 'REAL DEFAULT 0'],
    ['supr_redus', 'REAL DEFAULT 0'],
    ['d1', 'TEXT'], ['d2', 'TEXT'],
    ['p1_scaz', 'INTEGER DEFAULT 0'], ['p2_scaz', 'INTEGER DEFAULT 0'],
    ['sl1_scaz', 'REAL DEFAULT 0'], ['sl2_scaz', 'REAL DEFAULT 0'], ['set_scaz', 'REAL DEFAULT 0'],
    ['proc_av_ac', 'REAL DEFAULT 100'], ['proc_av_in', 'REAL DEFAULT 100'],
    ['procg', 'REAL DEFAULT 100'], ['procgunoi', 'REAL DEFAULT 100'],
    ['procascens', 'REAL DEFAULT 100'], ['proc_cu_sc', 'REAL DEFAULT 100'],
    ['proc_cu_li', 'REAL DEFAULT 100'], ['proc_sal_f', 'REAL DEFAULT 100'],
    ['proc_sal_t', 'REAL DEFAULT 100'], ['proc_abona', 'REAL DEFAULT 100'],
    ['p_saltesa', 'REAL DEFAULT 100'], ['p_presserv', 'REAL DEFAULT 100'],
    ['proc_chadm', 'REAL DEFAULT 100'], ['proc_difer', 'REAL DEFAULT 100'],
    ['proc_difin', 'REAL DEFAULT 100'], ['proc_chsed', 'REAL DEFAULT 100'],
    ['d_v_ar_bu', 'TEXT'], ['ser_ar_bu', 'TEXT'],
    ['d_v_ar_ba1', 'TEXT'], ['ser_ar_ba1', 'TEXT'],
    ['d_v_ar_ba2', 'TEXT'], ['ser_ar_ba2', 'TEXT'],
    ['d_v_ac_bu', 'TEXT'], ['ser_ac_bu', 'TEXT'],
    ['d_v_ac_ba1', 'TEXT'], ['ser_ac_ba1', 'TEXT'],
    ['d_v_ac_ba2', 'TEXT'], ['ser_ac_ba2', 'TEXT'],
    ['in_incalzire', 'REAL DEFAULT 0'], ['iv_incalzire', 'REAL DEFAULT 0'],
    ['inin', 'REAL DEFAULT 0'], ['ivin', 'REAL DEFAULT 0'], ['constin', 'REAL DEFAULT 1.0'],
    ['d_v_in', 'TEXT'], ['ser_in', 'TEXT'],
    ['d_v_inin', 'TEXT'], ['ser_inin', 'TEXT'],
    ['cp_ar', "TEXT DEFAULT 'C'"], ['cp_ac', "TEXT DEFAULT 'C'"], ['cp_in', "TEXT DEFAULT 'P'"],
    ['tot_unit', 'REAL DEFAULT 0'], ['gcal_unit', 'REAL DEFAULT 0'],
    ['gcal_mp', 'REAL DEFAULT 0'], ['gcal_calc', 'REAL DEFAULT 0'],
    ['gcal_red', 'REAL DEFAULT 0'], ['gcal_final', 'REAL DEFAULT 0'],
    ['max_fr', 'REAL DEFAULT 0'], ['max_fond_rulment', 'REAL DEFAULT 0'],
    ['calc_fr', 'REAL DEFAULT 0'], ['plat_fr', 'REAL DEFAULT 0'], ['rulment', 'REAL DEFAULT 0'],
    ['fond_repar', 'REAL DEFAULT 0'], ['fond_reparatii', 'REAL DEFAULT 0'],
    ['fond_rulment_constituit', 'REAL DEFAULT 0'], ['fond_reparatii_constituit', 'REAL DEFAULT 0'],
    ['ch_box', 'REAL DEFAULT 0'], ['ch_hav', 'REAL DEFAULT 0'],
    ['repar_crt', 'REAL DEFAULT 0'], ['altele', 'REAL DEFAULT 0'], ['i', 'REAL DEFAULT 0'],
    ['apa_rece', 'REAL DEFAULT 0'], ['arra', 'REAL DEFAULT 0'], ['arca', 'REAL DEFAULT 0'],
    ['can_mnj', 'REAL DEFAULT 0'], ['can_mnjar', 'REAL DEFAULT 0'], ['can_mnjac', 'REAL DEFAULT 0'], ['can_met', 'REAL DEFAULT 0'],
    ['apa_calda', 'REAL DEFAULT 0'], ['incalzire', 'REAL DEFAULT 0'], ['gaz', 'REAL DEFAULT 0'], ['gunoi', 'REAL DEFAULT 0'],
    ['curent', 'REAL DEFAULT 0'], ['curent_sc', 'REAL DEFAULT 0'], ['curent_li', 'REAL DEFAULT 0'],
    ['ascensor', 'REAL DEFAULT 0'], ['sal_feme', 'REAL DEFAULT 0'], ['sal_tesa', 'REAL DEFAULT 0'],
    ['ch_admin', 'REAL DEFAULT 0'], ['ch_sediu', 'REAL DEFAULT 0'], ['prest_serv', 'REAL DEFAULT 0'], ['abonament', 'REAL DEFAULT 0'], ['chelt_inc', 'REAL DEFAULT 0'],
    ['difarar', 'REAL DEFAULT 0'], ['difarac', 'REAL DEFAULT 0'], ['difcanar', 'REAL DEFAULT 0'], ['difcanac', 'REAL DEFAULT 0'], ['difetac', 'REAL DEFAULT 0'], ['difetin', 'REAL DEFAULT 0'],
    ['restante', 'REAL DEFAULT 0'], ['penalizari', 'REAL DEFAULT 0'],
    ['observatii', "TEXT DEFAULT ''"]
  ];
  for (let i = 1; i <= 7; i++) {
    apColsToAdd.push([`serie_r${i}`, 'TEXT']);
    apColsToAdd.push([`iv_r${i}`, 'REAL DEFAULT 0']);
    apColsToAdd.push([`in_r${i}`, 'REAL DEFAULT 0']);
    apColsToAdd.push([`facttr_r${i}`, 'REAL DEFAULT 1.0']);
    apColsToAdd.push([`coefsp_r${i}`, 'REAL DEFAULT 1.0']);
  }
  for (const [col, def] of apColsToAdd) {
    if (!apCurrent.has(col.toLowerCase())) addCol('apartamente', col, def);
  }

  // 3. Ensure all blocuri columns exist
  const blCurrent = getExistingColumns(d, 'blocuri');
  const blColsToAdd = [
    ['asociatie_id', 'INTEGER DEFAULT 1 REFERENCES asociatie(id)'],
    ['strada', "TEXT DEFAULT ''"],
    ['numar', "TEXT DEFAULT ''"],
    ['total_apartamente', 'INTEGER DEFAULT 0'],
    ['suprafata_totala', 'REAL DEFAULT 0'],
    ['mod_r_dif', "TEXT DEFAULT 'PER'"],
    ['mod_repartizare_dif', "TEXT DEFAULT 'PER'"],
    ['mod_r_inc', "TEXT DEFAULT 'SL'"],
    ['modr_difin', "TEXT DEFAULT 'SL'"],
    ['mod_r_asc', "TEXT DEFAULT 'PER'"],
    ['procinccom', 'REAL DEFAULT 0'],
    ['proc_chsed', 'REAL DEFAULT 100'],
    ['proc_av_ac', 'REAL DEFAULT 100'],
    ['proc_av_in', 'REAL DEFAULT 100'],
    ['proc_sal_f', 'REAL DEFAULT 100'],
    ['proc_sal_femeie', 'INTEGER DEFAULT 100'],
    ['proc_sal_t', 'REAL DEFAULT 100'],
    ['proc_sal_tesa', 'INTEGER DEFAULT 100'],
    ['proc_abona', 'REAL DEFAULT 100'],
    ['proc_abonament', 'INTEGER DEFAULT 100'],
    ['proc_chadm', 'REAL DEFAULT 100'],
    ['proc_ch_admin', 'INTEGER DEFAULT 100'],
    ['procgunoi', 'REAL DEFAULT 100'],
    ['proc_gunoi', 'INTEGER DEFAULT 100'],
    ['cota_fond_reparatii', 'REAL DEFAULT 10.0'],
    ['tarif_apa_rece', 'REAL DEFAULT 8.5'],
    ['tarif_apa_calda', 'REAL DEFAULT 18.0'],
    ['tarif_canal', 'REAL DEFAULT 4.0'],
    ['index_vechi_ar', 'INTEGER DEFAULT 0'], ['index_nou_ar', 'INTEGER DEFAULT 0'],
    ['index_vechi_ac', 'INTEGER DEFAULT 0'], ['index_nou_ac', 'INTEGER DEFAULT 0'],
    ['index_vechi_in', 'REAL DEFAULT 0'], ['index_nou_in', 'REAL DEFAULT 0'],
    ['const_incalzire', 'REAL DEFAULT 1.0'],
    ['ecart_temp', 'REAL DEFAULT 0'],
    ['rand_tr', 'REAL DEFAULT 100'],
    ['tarif_et', 'REAL DEFAULT 0'],
    ['inar', 'REAL DEFAULT 0'], ['ivar', 'REAL DEFAULT 0'],
    ['inac', 'REAL DEFAULT 0'], ['ivac', 'REAL DEFAULT 0'],
    ['inin', 'REAL DEFAULT 0'], ['ivin', 'REAL DEFAULT 0'], ['constin', 'REAL DEFAULT 1.0'],
    ['cp_ar', "TEXT DEFAULT 'C'"], ['cp_ac', "TEXT DEFAULT 'C'"], ['cp_in', "TEXT DEFAULT 'P'"],
    ['gaz', 'REAL DEFAULT 0'], ['gunoi', 'REAL DEFAULT 0'],
    ['curent', 'REAL DEFAULT 0'], ['curent_sc', 'REAL DEFAULT 0'], ['curent_li', 'REAL DEFAULT 0'],
    ['ascensor', 'REAL DEFAULT 0'], ['sal_tesa', 'REAL DEFAULT 0'], ['sal_feme', 'REAL DEFAULT 0'],
    ['ch_admin', 'REAL DEFAULT 0'], ['ch_sediu', 'REAL DEFAULT 0'], ['cota_fr', 'REAL DEFAULT 0'],
    ['prest_serv', 'REAL DEFAULT 0'], ['chelt_inc', 'REAL DEFAULT 0'], ['abonament', 'REAL DEFAULT 0'],
    ['can_met', 'REAL DEFAULT 0'],
    ['difarar', 'REAL DEFAULT 0'], ['difarac', 'REAL DEFAULT 0'],
    ['difcanar', 'REAL DEFAULT 0'], ['difcanac', 'REAL DEFAULT 0'],
    ['difetac', 'REAL DEFAULT 0'], ['difetin', 'REAL DEFAULT 0'],
    ['arac', 'REAL DEFAULT 0'], ['ardifer', 'REAL DEFAULT 0'],
    ['acac', 'REAL DEFAULT 0'], ['acdifer', 'REAL DEFAULT 0'],
    ['etac', 'REAL DEFAULT 0'], ['etacac', 'REAL DEFAULT 0'], ['etinac', 'REAL DEFAULT 0'],
    ['inccap', 'REAL DEFAULT 0'], ['incrap', 'REAL DEFAULT 0'], ['incsupr', 'REAL DEFAULT 0'], ['inccomun', 'REAL DEFAULT 0'],
    ['cod', "TEXT DEFAULT ''"], ['cod_postal', "TEXT DEFAULT ''"],
    ['observatii', "TEXT DEFAULT ''"]
  ];
  for (const [col, def] of blColsToAdd) {
    if (!blCurrent.has(col.toLowerCase())) addCol('blocuri', col, def);
  }
  try {
    d.exec('UPDATE blocuri SET asociatie_id = (SELECT id FROM asociatie ORDER BY id LIMIT 1) WHERE asociatie_id IS NULL AND EXISTS (SELECT 1 FROM asociatie);');
  } catch (_) {}

  // 4. Ensure all asociatie columns exist (including ADA.PRG association-level invoice totals)
  const asCurrent = getExistingColumns(d, 'asociatie');
  const asColsToAdd = [
    ['nume', "TEXT DEFAULT ''"],
    ['cod_fiscal', "TEXT DEFAULT ''"],
    ['n_r_com', "TEXT DEFAULT ''"],
    ['administrator', "TEXT DEFAULT ''"],
    ['presedinte', "TEXT DEFAULT ''"],
    ['adresa', "TEXT DEFAULT ''"],
    ['cod_postal', "TEXT DEFAULT ''"],
    ['judet', "TEXT DEFAULT ''"],
    ['cont_bancar', "TEXT DEFAULT ''"],
    ['banca', "TEXT DEFAULT ''"],
    ['program', "TEXT DEFAULT ''"],
    ['telefon', "TEXT DEFAULT ''"],
    ['proc_penalizare', 'REAL DEFAULT 0.2'],
    ['zile_penalizare', 'INTEGER DEFAULT 45'],
    ['serie_chitante', "TEXT DEFAULT 'ORH'"],
    ['urmatorul_numar_chitanta', 'INTEGER DEFAULT 1'],
    ['luna_lucru', 'INTEGER DEFAULT 9'],
    ['an_lucru', 'INTEGER DEFAULT 2026'],
    ['cota_fr', 'REAL DEFAULT 0'],
    ['apa_rece', 'REAL DEFAULT 0'],
    ['can_met', 'REAL DEFAULT 0'],
    ['apa_calda', 'REAL DEFAULT 0'],
    ['etac', 'REAL DEFAULT 0'],
    ['incalzire', 'REAL DEFAULT 0'],
    ['gunoi', 'REAL DEFAULT 0'],
    ['ch_admin', 'REAL DEFAULT 0'],
    ['sal_tesa', 'REAL DEFAULT 0'],
    ['sal_feme', 'REAL DEFAULT 0'],
    ['abonament', 'REAL DEFAULT 0'],
    ['ch_sediu', 'REAL DEFAULT 0'],
    ['rulment', 'REAL DEFAULT 0'],
    ['sl_salfe', 'REAL DEFAULT 0'],
    ['sl_salte', 'REAL DEFAULT 0'],
    ['sl_abon', 'REAL DEFAULT 0'],
    ['sl_chsed', 'REAL DEFAULT 0'],
    ['sl_chadm', 'REAL DEFAULT 0']
  ];
  for (const [col, def] of asColsToAdd) {
    if (!asCurrent.has(col.toLowerCase())) addCol('asociatie', col, def);
  }

  // 4b. Ensure users has asociatie_id for multi-tenant scoping
  const usrCurrent = getExistingColumns(d, 'users');
  if (!usrCurrent.has('asociatie_id')) {
    addCol('users', 'asociatie_id', 'INTEGER DEFAULT 1 REFERENCES asociatie(id)');
  }

  // 5. Ensure chitante extensions exist
  const chCurrent = getExistingColumns(d, 'chitante');
  const chColsToAdd = [
    ['apartament_id', 'INTEGER REFERENCES apartamente(id) ON DELETE SET NULL'],
    ['bloc_id', 'INTEGER REFERENCES blocuri(id) ON DELETE SET NULL'],
    ['perioada_id', 'INTEGER REFERENCES perioade(id) ON DELETE SET NULL'],
    ['tip_chitanta', "TEXT DEFAULT 'INDIVIDUAL'"],
    ['nume_platitor', "TEXT DEFAULT ''"],
    ['numar_apart', "TEXT DEFAULT ''"],
    ['cod_bloc', "TEXT DEFAULT ''"],
    ['suma_litere', "TEXT DEFAULT ''"],
    ['explicatie', "TEXT DEFAULT 'Cote cheltuieli intretinere'"],
    ['tip_plata', "TEXT DEFAULT 'NUMERAR'"],
    ['anulata', 'INTEGER DEFAULT 0'],
    ['anulat_la', 'DATETIME'],
    ['anulat_de', 'TEXT'],
    ['motiv_anulare', 'TEXT'],
    ['creat_la', 'DATETIME DEFAULT CURRENT_TIMESTAMP']
  ];
  for (const [col, def] of chColsToAdd) {
    if (!chCurrent.has(col.toLowerCase())) addCol('chitante', col, def);
  }

  // 6. Ensure facturi extensions exist
  const factCurrent = getExistingColumns(d, 'facturi');
  const factColsToAdd = [
    ['bloc_id', 'INTEGER REFERENCES blocuri(id) ON DELETE CASCADE'],
    ['asociatie_id', 'INTEGER REFERENCES asociatie(id) ON DELETE CASCADE'],
    ['perioada_id', 'INTEGER REFERENCES perioade(id) ON DELETE SET NULL'],
    ['luna', 'INTEGER'],
    ['an', 'INTEGER'],
    ['denumire', "TEXT DEFAULT ''"],
    ['mod_repartizare', "TEXT DEFAULT 'PERSOANE'"],
    ['data_factura', 'TEXT'],
    ['numar_factura', "TEXT DEFAULT ''"],
    ['furnizor', "TEXT DEFAULT ''"],
    ['categorie_cheltuiala', "TEXT DEFAULT ''"]
  ];
  for (const [col, def] of factColsToAdd) {
    if (!factCurrent.has(col.toLowerCase())) addCol('facturi', col, def);
  }
}

function seedDefaults(d) {
  // Default Association
  const asocCount = d.prepare('SELECT COUNT(*) as cnt FROM asociatie').get();
  if (asocCount.cnt === 0) {
    d.prepare(`
      INSERT INTO asociatie (
        nume, cod_fiscal, n_r_com, administrator, presedinte, adresa, cod_postal, judet, cont_bancar, banca,
        program, telefon, proc_penalizare, zile_penalizare, luna_lucru, an_lucru, serie_chitante, urmatorul_numar_chitanta
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0.2, 45, 9, 2026, 'ORH', 1)
    `).run(
      'ASOCIATIA DE PROPRIETARI TEST',
      'RO00000000',
      '',
      'Administrator Test',
      'Presedinte Test',
      'Str. Orhideelor, Bl. 19, Ap. 3',
      '510000',
      'ALBA',
      '',
      '',
      'Luni - Vineri: 16:00 - 18:00',
      ''
    );
  }

  try {
    d.exec('UPDATE blocuri SET asociatie_id = (SELECT id FROM asociatie ORDER BY id LIMIT 1) WHERE asociatie_id IS NULL AND EXISTS (SELECT 1 FROM asociatie);');
  } catch (_) {}

  // Default & Test Users
  const defaultHash = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
  const insUser = d.prepare('INSERT OR IGNORE INTO users (username, password_hash, nume, rol, asociatie_id) VALUES (?, ?, ?, ?, ?)');
  insUser.run('superadmin', defaultHash, 'Super Administrator (Turn de Control)', 'superadmin', 1);
  insUser.run('admin', defaultHash, 'Administrator Asociatie', 'administrator', 1);
  insUser.run('orhideea', defaultHash, 'Administrator Agenția TEST', 'administrator', 1);
  insUser.run('agentie_noua', defaultHash, 'Administrator Agenție Nouă (Blank)', 'administrator', 1);
  insUser.run('casier', defaultHash, 'Casier Principal', 'casier', 1);

  // Default Period (2026 / 9)
  const perCount = d.prepare('SELECT COUNT(*) as cnt FROM perioade WHERE an = 2026 AND luna = 9').get();
  if (perCount.cnt === 0) {
    d.prepare(`
      INSERT OR IGNORE INTO perioade (asociatie_id, an, luna, status, ultima_zi, tarif_ar, tarif_ca, proc_ca)
      VALUES (1, 2026, 9, 'DESCHISA', '2026-09-30', 9.48, 9.67, 100.0)
    `).run();
  }

  // Default General Settings
  const genCount = d.prepare('SELECT COUNT(*) as cnt FROM general WHERE an = 2026 AND luna = 9').get();
  if (genCount.cnt === 0) {
    const p = d.prepare('SELECT id FROM perioade WHERE an = 2026 AND luna = 9').get();
    d.prepare(`
      INSERT INTO general (perioada_id, an, luna, ultima_zi, tarif_ar, tarif_ca, proc_ca)
      VALUES (?, 2026, 9, '2026-09-30', 9.48, 9.67, 100.0)
    `).run(p ? p.id : null);
  }
}

module.exports = { getDb, initializeSchema };
