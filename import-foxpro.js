/**
 * import-foxpro.js
 * 
 * Full FoxPro DBF & Memo Importer for ORHIDEEA (Partaj 3, 2005) Parity Upgrade.
 * 
 * Features:
 * - Binary DBF parser supporting CP852 encoding, deleted flags (0x2A), dynamic header offsets, types (C, N, D, M, L)
 * - 64-byte block .FPT memo parser for OBSERVATII
 * - Multi-period chronological importer (284 months under DATE\ANI_LUNI)
 * - Cumulative ledger importer (23,171 rows of CHITANTE.DBF)
 * - Dual payment slot conversion (PLATA1/PLATA2) into plati and linked chitante
 * - Full support for payment reversals (negative PLATA2)
 * - Dynamic baseline financial reconciliation computed directly from raw DBF records (0.00 RON difference)
 * - Dynamic active working period and tariff extraction from active directory & GENERAL.DBF
 * - CLI options: --force (-f), --anonymize (-a), custom dbf-dir and db-path
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const iconv = require('iconv-lite');
const dbPathCandidates = [
  path.join(__dirname, 'db.js'),
  path.resolve(__dirname, '../../../db.js'),
  path.resolve(__dirname, '../../db.js')
];
const resolvedDbPath = dbPathCandidates.find(p => fs.existsSync(p)) || './db';
const { initializeSchema } = require(resolvedDbPath);

const DEFAULT_BASE_DIR = 'G:\\INCASOR\\INCASARI\\DATE\\ANI_LUNI';
const DEFAULT_LATEST_DIR = 'G:\\INCASOR\\INCASARI\\DATE\\ANI_LUNI\\2026\\SEPTEMBR';
const DEFAULT_DB_PATH = path.join(__dirname, 'asociatie.db');

const MONTH_MAP = {
  'IANUARIE': 1, 'FEBRUARI': 2, 'FEBRUARIE': 2, 'MARTIE': 3,
  'APRILIE': 4, 'MAI': 5, 'IUNIE': 6, 'IULIE': 7,
  'AUGUST': 8, 'SEPTEMBR': 9, 'SEPTEMBRIE': 9, 'OCTOMBRI': 10,
  'OCTOMBRIE': 10, 'NOIEMBRI': 11, 'NOIEMBRIE': 11, 'DECEMBRI': 12, 'DECEMBRIE': 12
};

/**
 * Dynamically derives the active working period (an_lucru, luna_lucru)
 * from target directory path or period metadata.
 * @param {string} targetDir Path to active period directory (e.g. ...\2026\SEPTEMBR)
 * @param {Array<{an: number, luna: number}>} [periods] Optional scanned periods list
 * @returns {{ an_lucru: number, luna_lucru: number }}
 */
function deriveActivePeriod(targetDir, periods = []) {
  if (targetDir) {
    const norm = path.resolve(targetDir);
    const parts = norm.split(path.sep).filter(Boolean);
    const monthFolder = parts[parts.length - 1] ? parts[parts.length - 1].toUpperCase() : '';
    const yearFolder = parts[parts.length - 2] ? parts[parts.length - 2] : '';
    const luna = MONTH_MAP[monthFolder] || null;
    const an = /^\d{4}$/.test(yearFolder) ? parseInt(yearFolder, 10) : null;
    if (an && luna) {
      return { an_lucru: an, luna_lucru: luna };
    }
  }

  if (periods && periods.length > 0) {
    const sorted = [...periods].sort((a, b) => (a.an !== b.an ? a.an - b.an : a.luna - b.luna));
    const latest = sorted[sorted.length - 1];
    return { an_lucru: latest.an, luna_lucru: latest.luna };
  }

  const now = new Date();
  return { an_lucru: now.getFullYear(), luna_lucru: now.getMonth() + 1 };
}

/**
 * Binary DBF & .FPT Memo Parser
 * @param {string} filepath Absolute path to .DBF file
 * @returns {{ fields: Array<Object>, records: Array<Object>, totalRecords: number, activeRecords: number }}
 */
function parseDbf(filepath) {
  if (!fs.existsSync(filepath)) {
    return { fields: [], records: [], totalRecords: 0, activeRecords: 0 };
  }

  const buf = fs.readFileSync(filepath);
  if (buf.length < 32) {
    return { fields: [], records: [], totalRecords: 0, activeRecords: 0 };
  }

  const numRecords = buf.readUInt32LE(4);
  const headerSize = buf.readUInt16LE(8);
  const recordSize = buf.readUInt16LE(10);

  const fields = [];
  let pos = 32;
  while (pos < headerSize && buf[pos] !== 0x0D) {
    if (pos + 32 > buf.length) break;
    const nameBuf = buf.subarray(pos, pos + 11);
    const zeroIdx = nameBuf.indexOf(0);
    const name = nameBuf.subarray(0, zeroIdx === -1 ? 11 : zeroIdx).toString('ascii').trim();
    const type = String.fromCharCode(buf[pos + 11]);
    const length = buf[pos + 16];
    const decimals = buf[pos + 17];
    fields.push({ name, type, length, decimals });
    pos += 32;
  }

  // Check for accompanying .FPT memo file
  const fptPath = filepath.replace(/\.DBF$/i, '.FPT');
  let fptBuf = null;
  let fptBlockSize = 64;
  if (fs.existsSync(fptPath)) {
    try {
      fptBuf = fs.readFileSync(fptPath);
      if (fptBuf.length >= 512) {
        fptBlockSize = fptBuf.readUInt16BE(6) || 64;
      }
    } catch (_) {
      fptBuf = null;
    }
  }

  const records = [];
  let offset = headerSize;

  for (let i = 0; i < numRecords; i++) {
    if (offset + recordSize > buf.length) break;

    const isDeleted = buf[offset] === 0x2A; // '*'
    offset += 1;

    if (isDeleted) {
      offset += (recordSize - 1);
      continue;
    }

    const rec = {};
    for (const f of fields) {
      const fieldBuf = buf.subarray(offset, offset + f.length);
      offset += f.length;

      if (f.type === 'M') {
        const blockStr = fieldBuf.toString('ascii').trim();
        const blockNum = parseInt(blockStr, 10);
        if (fptBuf && !isNaN(blockNum) && blockNum > 0) {
          const blkOffset = blockNum * fptBlockSize;
          if (blkOffset + 8 <= fptBuf.length) {
            const memoLen = fptBuf.readUInt32BE(blkOffset + 4);
            if (memoLen > 0 && blkOffset + 8 + memoLen <= fptBuf.length) {
              rec[f.name] = iconv.decode(fptBuf.subarray(blkOffset + 8, blkOffset + 8 + memoLen), 'cp852').trim();
            } else {
              rec[f.name] = '';
            }
          } else {
            rec[f.name] = '';
          }
        } else {
          rec[f.name] = '';
        }
      } else if (f.type === 'N') {
        const raw = fieldBuf.toString('ascii').trim();
        rec[f.name] = raw === '' ? 0 : (parseFloat(raw) || 0);
      } else if (f.type === 'D') {
        const raw = fieldBuf.toString('ascii').trim();
        rec[f.name] = raw === '' || raw === '00000000' ? null : (
          raw.length === 8 ? `${raw.substring(0,4)}-${raw.substring(4,6)}-${raw.substring(6,8)}` : raw
        );
      } else if (f.type === 'L') {
        const raw = fieldBuf.toString('ascii').trim().toUpperCase();
        rec[f.name] = (raw === 'T' || raw === 'Y' || raw === '1') ? 1 : 0;
      } else {
        rec[f.name] = iconv.decode(fieldBuf, 'cp852').trim();
      }
    }
    records.push(rec);
  }

  return {
    fields,
    records,
    totalRecords: numRecords,
    activeRecords: records.length
  };
}

function toIsoDate(dStr, fallback = null) {
  if (!dStr) return fallback;
  const clean = String(dStr).replace(/\D/g, '');
  if (clean.length === 8) {
    return `${clean.substring(0,4)}-${clean.substring(4,6)}-${clean.substring(6,8)}`;
  }
  return String(dStr);
}

/**
 * Creates schema and safely migrates columns if table exists
 */
function createSchema(db, force = false) {
  if (force) {
    console.log('[Schema] Reconstrucție curată tabele (--force)...');
    db.exec(`
      PRAGMA foreign_keys = OFF;
      DROP TABLE IF EXISTS plati;
      DROP TABLE IF EXISTS datorii;
      DROP TABLE IF EXISTS chitante;
      DROP TABLE IF EXISTS cheltuieli_apartament;
      DROP TABLE IF EXISTS facturi;
      DROP TABLE IF EXISTS apartamente_luna;
      DROP TABLE IF EXISTS blocuri_luna;
      DROP TABLE IF EXISTS asociatie_luna;
      DROP TABLE IF EXISTS apartamente;
      DROP TABLE IF EXISTS blocuri;
      DROP TABLE IF EXISTS general;
      DROP TABLE IF EXISTS perioade;
      DROP TABLE IF EXISTS asociatie;
      DROP TABLE IF EXISTS casa;
      DROP TABLE IF EXISTS banca;
      DROP TABLE IF EXISTS patrimoniu;
      DROP TABLE IF EXISTS ordine_plata;
      DROP TABLE IF EXISTS users;
      DROP TABLE IF EXISTS audit_logs;
      DROP TABLE IF EXISTS istoric_luni;
      DROP TABLE IF EXISTS system_error_logs;
      PRAGMA foreign_keys = ON;
    `);
  }

  initializeSchema(db);
}

/**
 * Main Importer Execution Function
 */
function runImport(options = {}) {
  const baseDir = options.baseDir || DEFAULT_BASE_DIR;
  const latestDir = options.latestDir || options.dbfDir || DEFAULT_LATEST_DIR;
  const dbPath = options.dbPath || DEFAULT_DB_PATH;
  const force = !!options.force;
  const anonymize = !!options.anonymize;

  console.log('======================================================================');
  console.log('  ORHIDEEA (FoxPro 2005) -> SQLITE FULL PARITY IMPORTER');
  console.log('======================================================================');
  console.log(`Director bază perioade : ${baseDir}`);
  console.log(`Director activ (latest) : ${latestDir}`);
  console.log(`Bază de date SQLite    : ${dbPath}`);
  console.log(`Mod forțat (--force)   : ${force ? 'DA (reconstrucție completă)' : 'NU'}`);
  console.log(`Mod anonimizare GDPR   : ${anonymize ? 'DA (Proprietar Ap. X)' : 'NU (nume reale)'}`);
  console.log('======================================================================\n');

  fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');

  try {
    // 1. Schema
    createSchema(db, force);

    // Derive active working period and extract tariffs dynamically
    const activePeriod = deriveActivePeriod(latestDir);
    const genFile = path.join(latestDir, 'GENERAL.DBF');
    const { records: genRecords } = parseDbf(genFile);
    const gActive = genRecords[0] || {};
    const activeTarifAr = gActive.TARIF_AR || 0;
    const activeTarifCa = gActive.TARIF_CA || 0;

    // 2. Import Live Association & Parameters
    console.log(`[1/4] Import date asociație și parametri activi (Luna ${activePeriod.luna_lucru}/${activePeriod.an_lucru})...`);
    const asocFile = path.join(latestDir, 'ASOC.DBF');
    const { records: asocRecords } = parseDbf(asocFile);
    const aRec = asocRecords[0] || {};

    let asociatieId = 1;
    const existingAsoc = db.prepare('SELECT id FROM asociatie LIMIT 1').get();
    if (existingAsoc) {
      asociatieId = existingAsoc.id;
      db.prepare(`
        UPDATE asociatie SET
          nume = ?, cod_fiscal = ?, n_r_com = ?, administrator = ?, presedinte = ?,
          adresa = ?, cod_postal = ?, judet = ?, cont_bancar = ?, banca = ?,
          program = ?, telefon = ?, proc_penalizare = ?, zile_penalizare = ?,
          serie_chitante = ?, urmatorul_numar_chitanta = ?, luna_lucru = ?, an_lucru = ?
        WHERE id = ?
      `).run(
        anonymize ? 'ASOCIATIA DE PROPRIETARI TEST' : (aRec.ASOC || 'ASOCIATIA DE PROPRIETARI TEST'),
        anonymize ? 'RO00000000' : (aRec.COD_FISCAL || 'RO00000000'),
        aRec.N_R_COM || '',
        anonymize ? 'Administrator Test' : (aRec.ADMINISTR || ''),
        anonymize ? 'Presedinte Test' : (aRec.PRESEDINTE || ''),
        anonymize ? 'Strada Test nr. 1' : (aRec.ADRESA || ''),
        aRec.COD ? String(aRec.COD) : '510000',
        aRec.JUDET || 'ALBA',
        aRec.CONT || '',
        aRec.BANCA || '',
        aRec.PROGRAM || 'Luni - Vineri: 16:00 - 18:00',
        aRec.TELINST || '',
        aRec.PROC_PENAL || 0.2,
        aRec.ZILE_PENAL || 45,
        aRec.SERIE_CHIT || 'ORH',
        aRec.ULT_CH || 1,
        activePeriod.luna_lucru,
        activePeriod.an_lucru,
        asociatieId
      );
    } else {
      const asocInfo = db.prepare(`
        INSERT INTO asociatie (
          nume, cod_fiscal, n_r_com, administrator, presedinte,
          adresa, cod_postal, judet, cont_bancar, banca, program, telefon,
          proc_penalizare, zile_penalizare, serie_chitante, urmatorul_numar_chitanta,
          luna_lucru, an_lucru
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        anonymize ? 'ASOCIATIA DE PROPRIETARI TEST' : (aRec.ASOC || 'ASOCIATIA DE PROPRIETARI TEST'),
        anonymize ? 'RO00000000' : (aRec.COD_FISCAL || 'RO00000000'),
        aRec.N_R_COM || '',
        anonymize ? 'Administrator Test' : (aRec.ADMINISTR || ''),
        anonymize ? 'Presedinte Test' : (aRec.PRESEDINTE || ''),
        anonymize ? 'Strada Test nr. 1' : (aRec.ADRESA || ''),
        aRec.COD ? String(aRec.COD) : '510000',
        aRec.JUDET || 'ALBA',
        aRec.CONT || '',
        aRec.BANCA || '',
        aRec.PROGRAM || 'Luni - Vineri: 16:00 - 18:00',
        aRec.TELINST || '',
        aRec.PROC_PENAL || 0.2,
        aRec.ZILE_PENAL || 45,
        aRec.SERIE_CHIT || 'ORH',
        aRec.ULT_CH || 1,
        activePeriod.luna_lucru,
        activePeriod.an_lucru
      );
      asociatieId = Number(asocInfo.lastInsertRowid);
    }

    // 3. Import Live Blocks
    const targetFolder = path.basename(path.dirname(latestDir)) + '\\' + path.basename(latestDir);
    console.log(`[2/4] Import blocuri și apartamente active (${targetFolder})...`);
    const blocFile = path.join(latestDir, 'BLOCURI.DBF');
    const { records: blocRecords } = parseDbf(blocFile);

    const insertBloc = db.prepare(`
      INSERT INTO blocuri (
        asociatie_id, bloc, strada, numar, cod, cod_postal, total_apartamente, suprafata_totala,
        mod_r_dif, mod_repartizare_dif, mod_r_inc, modr_difin, mod_r_asc,
        procinccom, proc_chsed, proc_av_ac, proc_av_in, proc_sal_f, proc_sal_femeie,
        proc_sal_t, proc_sal_tesa, proc_abona, proc_abonament, proc_chadm, proc_ch_admin,
        procgunoi, proc_gunoi, cota_fond_reparatii, tarif_apa_rece, tarif_apa_calda, tarif_canal,
        index_vechi_ar, index_nou_ar, inar, ivar, index_vechi_ac, index_nou_ac, inac, ivac,
        index_vechi_in, index_nou_in, inin, ivin, const_incalzire, constin,
        cp_ar, cp_ac, cp_in, ecart_temp, rand_tr, tarif_et,
        gaz, gunoi, curent, curent_sc, curent_li, ascensor, sal_tesa, sal_feme, ch_admin, ch_sediu,
        cota_fr, prest_serv, chelt_inc, abonament, can_met,
        difarar, difarac, difcanar, difcanac, difetac, difetin,
        arac, ardifer, acac, acdifer, etac, etacac, etinac, inccap, incrap, incsupr, inccomun,
        observatii
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?
      )
      ON CONFLICT(bloc) DO UPDATE SET
        strada=excluded.strada, numar=excluded.numar, cod=excluded.cod, cod_postal=excluded.cod_postal,
        total_apartamente=excluded.total_apartamente, suprafata_totala=excluded.suprafata_totala,
        mod_r_dif=excluded.mod_r_dif, mod_repartizare_dif=excluded.mod_repartizare_dif,
        mod_r_inc=excluded.mod_r_inc, modr_difin=excluded.modr_difin, mod_r_asc=excluded.mod_r_asc,
        procinccom=excluded.procinccom, proc_chsed=excluded.proc_chsed, proc_av_ac=excluded.proc_av_ac, proc_av_in=excluded.proc_av_in,
        proc_sal_f=excluded.proc_sal_f, proc_sal_t=excluded.proc_sal_t, proc_abona=excluded.proc_abona, proc_chadm=excluded.proc_chadm, procgunoi=excluded.procgunoi,
        cota_fond_reparatii=excluded.cota_fond_reparatii, tarif_apa_rece=excluded.tarif_apa_rece, tarif_apa_calda=excluded.tarif_apa_calda, tarif_canal=excluded.tarif_canal,
        index_vechi_ar=excluded.index_vechi_ar, index_nou_ar=excluded.index_nou_ar, inar=excluded.inar, ivar=excluded.ivar,
        index_vechi_ac=excluded.index_vechi_ac, index_nou_ac=excluded.index_nou_ac, inac=excluded.inac, ivac=excluded.ivac,
        index_vechi_in=excluded.index_vechi_in, index_nou_in=excluded.index_nou_in, inin=excluded.inin, ivin=excluded.ivin,
        const_incalzire=excluded.const_incalzire, constin=excluded.constin, cp_ar=excluded.cp_ar, cp_ac=excluded.cp_ac, cp_in=excluded.cp_in,
        ecart_temp=excluded.ecart_temp, rand_tr=excluded.rand_tr, tarif_et=excluded.tarif_et,
        gaz=excluded.gaz, gunoi=excluded.gunoi, curent=excluded.curent, curent_sc=excluded.curent_sc, curent_li=excluded.curent_li,
        ascensor=excluded.ascensor, sal_tesa=excluded.sal_tesa, sal_feme=excluded.sal_feme, ch_admin=excluded.ch_admin, ch_sediu=excluded.ch_sediu,
        cota_fr=excluded.cota_fr, prest_serv=excluded.prest_serv, chelt_inc=excluded.chelt_inc, abonament=excluded.abonament, can_met=excluded.can_met,
        difarar=excluded.difarar, difarac=excluded.difarac, difcanar=excluded.difcanar, difcanac=excluded.difcanac, difetac=excluded.difetac, difetin=excluded.difetin,
        arac=excluded.arac, ardifer=excluded.ardifer, acac=excluded.acac, acdifer=excluded.acdifer,
        etac=excluded.etac, etacac=excluded.etacac, etinac=excluded.etinac, inccap=excluded.inccap, incrap=excluded.incrap, incsupr=excluded.incsupr, inccomun=excluded.inccomun,
        observatii=excluded.observatii
    `);

    const blocMap = new Map();
    for (const b of blocRecords) {
      const blocCode = String(b.BLOC).trim();
      insertBloc.run(
        asociatieId, blocCode, b.STRADA || '', b.NUMAR || '', b.COD ? String(b.COD) : '', b.COD ? String(b.COD) : '',
        b.TOT_APART || 0, b.SUPRAFATA1 || 0,
        b.MOD_R_DIF || 'PER', b.MOD_R_DIF || 'PER', b.MOD_R_INC || 'SL', b.MODR_DIFIN || 'SL', b.MOD_R_ASC || 'PER',
        b.PROCINCCOM || 0, b.PROC_CHSED || 100, b.PROC_AV_AC || 100, b.PROC_AV_IN || 100,
        b.PROC_SAL_F || 100, b.PROC_SAL_F || 100, b.PROC_SAL_T || 100, b.PROC_SAL_T || 100,
        b.PROC_ABONA || 100, b.PROC_ABONA || 100, b.PROC_CHADM || 100, b.PROC_CHADM || 100,
        b.PROCGUNOI || 100, b.PROCGUNOI || 100, b.COTA_FR || 10.0, activeTarifAr, activeTarifCa, activeTarifCa,
        b.IVAR || 0, b.INAR || 0, b.INAR || 0, b.IVAR || 0, b.IVAC || 0, b.INAC || 0, b.INAC || 0, b.IVAC || 0,
        b.IVIN || 0, b.ININ || 0, b.ININ || 0, b.IVIN || 0, b.CONSTIN || 1.0, b.CONSTIN || 1.0,
        b.CP_AR || 'C', b.CP_AC || 'C', b.CP_IN || 'P',
        b.ECART_TEMP || 0, b.RAND_TR || 100, b.TARIF_ET || 0,
        b.GAZ || 0, b.GUNOI || 0, b.CURENT || 0, b.CURENT_SC || 0, b.CURENT_LI || 0,
        b.ASCENSOR || 0, b.SAL_TESA || 0, b.SAL_FEME || 0, b.CH_ADMIN || 0, b.CH_SEDIU || 0,
        b.COTA_FR || 0, b.PREST_SERV || 0, b.CHELT_INC || 0, b.ABONAMENT || 0, b.CAN_MET || 0,
        b.DIFARAR || 0, b.DIFARAC || 0, b.DIFCANAR || 0, b.DIFCANAC || 0, b.DIFETAC || 0, b.DIFETIN || 0,
        b.ARAC || 0, b.ARDIFER || 0, b.ACAC || 0, b.ACDIFER || 0,
        b.ETAC || 0, b.ETACAC || 0, b.ETINAC || 0, b.INCCAP || 0, b.INCRAP || 0, b.INCSUPR || 0, b.INCCOMUN || 0,
        b.OBSERVATII || ''
      );
      const row = db.prepare('SELECT id FROM blocuri WHERE bloc = ?').get(blocCode);
      blocMap.set(blocCode, row.id);
    }

    // 4. Import Live Apartamente (with all 143 fields & FPT memos)
    const apartFile = path.join(latestDir, 'APART.DBF');
    const { records: apartRecords } = parseDbf(apartFile);

    const insertApart = db.prepare(`
      INSERT INTO apartamente (
        bloc_id, numar_apart, nume_proprietar, persoane, suprafata, sup_ec_ter, supr_redus,
        d1, d2, p1_scaz, p2_scaz, sl1_scaz, sl2_scaz, set_scaz,
        proc_av_ac, proc_av_in, procg, procgunoi, procascens, proc_cu_sc, proc_cu_li,
        proc_sal_f, proc_sal_t, proc_abona, p_saltesa, p_presserv, proc_chadm, proc_difer, proc_difin, proc_chsed,
        iv_ar_bu, in_ar_bu, d_v_ar_bu, ser_ar_bu, iv_ar_ba1, in_ar_ba1, d_v_ar_ba1, ser_ar_ba1, iv_ar_ba2, in_ar_ba2, d_v_ar_ba2, ser_ar_ba2,
        iv_ac_bu, in_ac_bu, d_v_ac_bu, ser_ac_bu, iv_ac_ba1, in_ac_ba1, d_v_ac_ba1, ser_ac_ba1, iv_ac_ba2, in_ac_ba2, d_v_ac_ba2, ser_ac_ba2,
        in_incalzire, iv_incalzire, inin, ivin, constin, d_v_in, ser_in, d_v_inin, ser_inin,
        cp_ar, cp_ac, cp_in,
        serie_r1, iv_r1, in_r1, facttr_r1, coefsp_r1,
        serie_r2, iv_r2, in_r2, facttr_r2, coefsp_r2,
        serie_r3, iv_r3, in_r3, facttr_r3, coefsp_r3,
        serie_r4, iv_r4, in_r4, facttr_r4, coefsp_r4,
        serie_r5, iv_r5, in_r5, facttr_r5, coefsp_r5,
        serie_r6, iv_r6, in_r6, facttr_r6, coefsp_r6,
        serie_r7, iv_r7, in_r7, facttr_r7, coefsp_r7,
        tot_unit, gcal_unit, gcal_mp, gcal_calc, gcal_red, gcal_final,
        max_fond_rulment, max_fr, calc_fr, plat_fr, rulment, fond_rulment_constituit,
        fond_reparatii, fond_repar, ch_box, ch_hav, repar_crt, altele, i, fond_reparatii_constituit,
        restante, penalizari,
        apa_rece, arra, arca, can_mnj, can_mnjar, can_mnjac, can_met,
        apa_calda, incalzire, gaz, gunoi, curent, curent_sc, curent_li, ascensor,
        sal_feme, sal_tesa, ch_admin, ch_sediu, prest_serv, abonament, chelt_inc,
        difarar, difarac, difcanar, difcanac, difetac, difetin, observatii
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?
      )
      ON CONFLICT(bloc_id, numar_apart) DO UPDATE SET
        nume_proprietar=excluded.nume_proprietar, persoane=excluded.persoane, suprafata=excluded.suprafata, sup_ec_ter=excluded.sup_ec_ter, supr_redus=excluded.supr_redus,
        d1=excluded.d1, d2=excluded.d2, p1_scaz=excluded.p1_scaz, p2_scaz=excluded.p2_scaz, sl1_scaz=excluded.sl1_scaz, sl2_scaz=excluded.sl2_scaz, set_scaz=excluded.set_scaz,
        proc_av_ac=excluded.proc_av_ac, proc_av_in=excluded.proc_av_in, procg=excluded.procg, procgunoi=excluded.procgunoi, procascens=excluded.procascens,
        proc_cu_sc=excluded.proc_cu_sc, proc_cu_li=excluded.proc_cu_li, proc_sal_f=excluded.proc_sal_f, proc_sal_t=excluded.proc_sal_t, proc_abona=excluded.proc_abona,
        p_saltesa=excluded.p_saltesa, p_presserv=excluded.p_presserv, proc_chadm=excluded.proc_chadm, proc_difer=excluded.proc_difer, proc_difin=excluded.proc_difin, proc_chsed=excluded.proc_chsed,
        iv_ar_bu=excluded.iv_ar_bu, in_ar_bu=excluded.in_ar_bu, d_v_ar_bu=excluded.d_v_ar_bu, ser_ar_bu=excluded.ser_ar_bu,
        iv_ar_ba1=excluded.iv_ar_ba1, in_ar_ba1=excluded.in_ar_ba1, d_v_ar_ba1=excluded.d_v_ar_ba1, ser_ar_ba1=excluded.ser_ar_ba1,
        iv_ar_ba2=excluded.iv_ar_ba2, in_ar_ba2=excluded.in_ar_ba2, d_v_ar_ba2=excluded.d_v_ar_ba2, ser_ar_ba2=excluded.ser_ar_ba2,
        iv_ac_bu=excluded.iv_ac_bu, in_ac_bu=excluded.in_ac_bu, d_v_ac_bu=excluded.d_v_ac_bu, ser_ac_bu=excluded.ser_ac_bu,
        iv_ac_ba1=excluded.iv_ac_ba1, in_ac_ba1=excluded.in_ac_ba1, d_v_ac_ba1=excluded.d_v_ac_ba1, ser_ac_ba1=excluded.ser_ac_ba1,
        iv_ac_ba2=excluded.iv_ac_ba2, in_ac_ba2=excluded.in_ac_ba2, d_v_ac_ba2=excluded.d_v_ac_ba2, ser_ac_ba2=excluded.ser_ac_ba2,
        in_incalzire=excluded.in_incalzire, iv_incalzire=excluded.iv_incalzire, inin=excluded.inin, ivin=excluded.ivin, constin=excluded.constin,
        d_v_in=excluded.d_v_in, ser_in=excluded.ser_in, d_v_inin=excluded.d_v_inin, ser_inin=excluded.ser_inin,
        cp_ar=excluded.cp_ar, cp_ac=excluded.cp_ac, cp_in=excluded.cp_in,
        serie_r1=excluded.serie_r1, iv_r1=excluded.iv_r1, in_r1=excluded.in_r1, facttr_r1=excluded.facttr_r1, coefsp_r1=excluded.coefsp_r1,
        serie_r2=excluded.serie_r2, iv_r2=excluded.iv_r2, in_r2=excluded.in_r2, facttr_r2=excluded.facttr_r2, coefsp_r2=excluded.coefsp_r2,
        serie_r3=excluded.serie_r3, iv_r3=excluded.iv_r3, in_r3=excluded.in_r3, facttr_r3=excluded.facttr_r3, coefsp_r3=excluded.coefsp_r3,
        serie_r4=excluded.serie_r4, iv_r4=excluded.iv_r4, in_r4=excluded.in_r4, facttr_r4=excluded.facttr_r4, coefsp_r4=excluded.coefsp_r4,
        serie_r5=excluded.serie_r5, iv_r5=excluded.iv_r5, in_r5=excluded.in_r5, facttr_r5=excluded.facttr_r5, coefsp_r5=excluded.coefsp_r5,
        serie_r6=excluded.serie_r6, iv_r6=excluded.iv_r6, in_r6=excluded.in_r6, facttr_r6=excluded.facttr_r6, coefsp_r6=excluded.coefsp_r6,
        serie_r7=excluded.serie_r7, iv_r7=excluded.iv_r7, in_r7=excluded.in_r7, facttr_r7=excluded.facttr_r7, coefsp_r7=excluded.coefsp_r7,
        tot_unit=excluded.tot_unit, gcal_unit=excluded.gcal_unit, gcal_mp=excluded.gcal_mp, gcal_calc=excluded.gcal_calc, gcal_red=excluded.gcal_red, gcal_final=excluded.gcal_final,
        max_fond_rulment=excluded.max_fond_rulment, max_fr=excluded.max_fr, calc_fr=excluded.calc_fr, plat_fr=excluded.plat_fr, rulment=excluded.rulment,
        fond_reparatii=excluded.fond_reparatii, fond_repar=excluded.fond_repar, ch_box=excluded.ch_box, ch_hav=excluded.ch_hav, repar_crt=excluded.repar_crt, altele=excluded.altele, i=excluded.i,
        apa_rece=excluded.apa_rece, arra=excluded.arra, arca=excluded.arca, can_mnj=excluded.can_mnj, can_mnjar=excluded.can_mnjar, can_mnjac=excluded.can_mnjac, can_met=excluded.can_met,
        apa_calda=excluded.apa_calda, incalzire=excluded.incalzire, gaz=excluded.gaz, gunoi=excluded.gunoi, curent=excluded.curent, curent_sc=excluded.curent_sc, curent_li=excluded.curent_li,
        ascensor=excluded.ascensor, sal_feme=excluded.sal_feme, sal_tesa=excluded.sal_tesa, ch_admin=excluded.ch_admin, ch_sediu=excluded.ch_sediu, prest_serv=excluded.prest_serv, abonament=excluded.abonament, chelt_inc=excluded.chelt_inc,
        difarar=excluded.difarar, difarac=excluded.difarac, difcanar=excluded.difcanar, difcanac=excluded.difcanac, difetac=excluded.difetac, difetin=excluded.difetin, observatii=excluded.observatii
    `);

    const aptMap = new Map();
    for (const a of apartRecords) {
      const blocCode = String(a.BLOC).trim();
      const aptNr = String(a.APART).trim();
      const blocId = blocMap.get(blocCode);
      if (!blocId) continue;

      const ownerName = anonymize ? `Proprietar Ap. ${aptNr}` : (a.NUME || '');
      insertApart.run(
        blocId, aptNr, ownerName, a.PERSOANE || 0, a.SUPRAFATA || 0, a.SUP_EC_TER || 0, a.SUPR_REDUS || 0,
        a.D1 || null, a.D2 || null, a.P1_SCAZ || 0, a.P2_SCAZ || 0, a.SL1_SCAZ || 0, a.SL2_SCAZ || 0, a.SET_SCAZ || 0,
        a.PROC_AV_AC !== undefined ? a.PROC_AV_AC : 100, a.PROC_AV_IN !== undefined ? a.PROC_AV_IN : 100,
        a.PROCG !== undefined ? a.PROCG : 100, a.PROCGUNOI !== undefined ? a.PROCGUNOI : 100,
        a.PROCASCENS !== undefined ? a.PROCASCENS : 100, a.PROC_CU_SC !== undefined ? a.PROC_CU_SC : 100,
        a.PROC_CU_LI !== undefined ? a.PROC_CU_LI : 100, a.PROC_SAL_F !== undefined ? a.PROC_SAL_F : 100,
        a.PROC_SAL_T !== undefined ? a.PROC_SAL_T : 100, a.PROC_ABONA !== undefined ? a.PROC_ABONA : 100,
        a.P_SALTESA !== undefined ? a.P_SALTESA : 100, a.P_PRESSERV !== undefined ? a.P_PRESSERV : 100,
        a.PROC_CHADM !== undefined ? a.PROC_CHADM : 100, a.PROC_DIFER !== undefined ? a.PROC_DIFER : 100,
        a.PROC_DIFIN !== undefined ? a.PROC_DIFIN : 100, a.PROC_CHSED !== undefined ? a.PROC_CHSED : 100,
        a.IVARBU || 0, a.INARBU || 0, a.D_V_AR_BU || null, a.SER_AR_BU ? String(a.SER_AR_BU) : null,
        a.IVARBA1 || 0, a.INARBA1 || 0, a.D_V_AR_BA1 || null, a.SER_AR_BA1 ? String(a.SER_AR_BA1) : null,
        a.IVARBA2 || 0, a.INARBA2 || 0, a.D_V_AR_BA2 || null, a.SER_AR_BA2 ? String(a.SER_AR_BA2) : null,
        a.IVACBU || 0, a.INACBU || 0, a.D_V_AC_BU || null, a.SER_AC_BU ? String(a.SER_AC_BU) : null,
        a.IVACBA1 || 0, a.INACBA1 || 0, a.D_V_AC_BA1 || null, a.SER_AC_BA1 ? String(a.SER_AC_BA1) : null,
        a.IVACBA2 || 0, a.INACBA2 || 0, a.D_V_AC_BA2 || null, a.SER_AC_BA2 ? String(a.SER_AC_BA2) : null,
        a.ININ || 0, a.IVIN || 0, a.ININ || 0, a.IVIN || 0, a.CONSTIN || 1.0,
        a.D_V_IN || null, a.SER_IN ? String(a.SER_IN) : null, a.D_V_IN || null, a.SER_IN ? String(a.SER_IN) : null,
        a.CP_AR || 'C', a.CP_AC || 'C', a.CP_IN || 'P',
        a.SERIE_R1 ? String(a.SERIE_R1) : null, a.IV_R1 || 0, a.IN_R1 || 0, a.FACTTR_R1 || 1.0, a.COEFSP_R1 || 1.0,
        a.SERIE_R2 ? String(a.SERIE_R2) : null, a.IV_R2 || 0, a.IN_R2 || 0, a.FACTTR_R2 || 1.0, a.COEFSP_R2 || 1.0,
        a.SERIE_R3 ? String(a.SERIE_R3) : null, a.IV_R3 || 0, a.IN_R3 || 0, a.FACTTR_R3 || 1.0, a.COEFSP_R3 || 1.0,
        a.SERIE_R4 ? String(a.SERIE_R4) : null, a.IV_R4 || 0, a.IN_R4 || 0, a.FACTTR_R4 || 1.0, a.COEFSP_R4 || 1.0,
        a.SERIE_R5 ? String(a.SERIE_R5) : null, a.IV_R5 || 0, a.IN_R5 || 0, a.FACTTR_R5 || 1.0, a.COEFSP_R5 || 1.0,
        a.SERIE_R6 ? String(a.SERIE_R6) : null, a.IV_R6 || 0, a.IN_R6 || 0, a.FACTTR_R6 || 1.0, a.COEFSP_R6 || 1.0,
        a.SERIE_R7 ? String(a.SERIE_R7) : null, a.IV_R7 || 0, a.IN_R7 || 0, a.FACTTR_R7 || 1.0, a.COEFSP_R7 || 1.0,
        a.TOT_UNIT || 0, a.GCAL_UNIT || 0, a.GCAL_MP || 0, a.GCAL_CALC || 0, a.GCAL_RED || 0, a.GCAL_FINAL || 0,
        a.MAX_FR || 0, a.MAX_FR || 0, a.CALC_FR || 0, a.PLAT_FR || 0, a.RULMENT || 0, 0,
        a.FOND_REPAR || 0, a.FOND_REPAR || 0, a.CH_BOX || 0, a.CH_HAV || 0, a.REPAR_CRT || 0, a.ALTELE || 0, a.I || 0, 0,
        a.RESTANTE || 0, a.PENALIZARI || 0,
        a.APA_RECE || 0, a.ARRA || 0, a.ARCA || 0, a.CAN_MNJ || 0, a.CAN_MNJAR || 0, a.CAN_MNJAC || 0, a.CAN_MET || 0,
        a.APA_CALDA || 0, a.INCALZIRE || 0, a.GAZ || 0, a.GUNOI || 0, a.CURENT || 0, a.CURENT_SC || 0, a.CURENT_LI || 0, a.ASCENSOR || 0,
        a.SAL_FEME || 0, a.SAL_TESA || 0, a.CH_ADMIN || 0, a.CH_SEDIU || 0, a.PREST_SERV || 0, a.ABONAMENT || 0, a.CHELT_INC || 0,
        a.DIFARAR || 0, a.DIFARAC || 0, a.DIFCANAR || 0, a.DIFCANAC || 0, a.DIFETAC || 0, a.DIFETIN || 0,
        a.OBSERVATII || ''
      );
      const row = db.prepare('SELECT id FROM apartamente WHERE bloc_id = ? AND numar_apart = ?').get(blocId, aptNr);
      aptMap.set(`${blocCode}:${aptNr}`, { aptId: row.id, blocId, nume: a.NUME || '' });
    }
    console.log(`  -> Blocuri active: ${blocMap.size}, Apartamente active: ${aptMap.size}`);

    // 5. Multi-Period Snapshot Importer (all historical periods)
    console.log('[3/4] Scanare și import perioade istorice & snapshot-uri...');
    const periodList = [];
    if (fs.existsSync(baseDir)) {
      const years = fs.readdirSync(baseDir).filter(y => /^\d{4}$/.test(y)).sort((a,b)=>parseInt(a)-parseInt(b));
      for (const y of years) {
        const yDir = path.join(baseDir, y);
        for (const m of fs.readdirSync(yDir)) {
          const mDir = path.join(yDir, m);
          if (!fs.statSync(mDir).isDirectory()) continue;
          const mNum = MONTH_MAP[m.toUpperCase()];
          if (!mNum) continue;
          periodList.push({ an: parseInt(y, 10), luna: mNum, dir: mDir });
        }
      }
    }
    periodList.sort((a,b) => (a.an !== b.an ? a.an - b.an : a.luna - b.luna));
    console.log(`  -> S-au identificat ${periodList.length} perioade lunare valide.`);

    const insertPer = db.prepare(`
      INSERT OR REPLACE INTO perioade (asociatie_id, an, luna, status, ultima_zi, tarif_ar, tarif_ca, proc_ca, tarif_et)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertBLuna = db.prepare(`
      INSERT OR REPLACE INTO blocuri_luna (
        perioada_id, bloc_id, an, luna, bloc, strada, numar, cod, cod_postal, total_apartamente, suprafata_totala,
        mod_r_dif, mod_r_inc, modr_difin, mod_r_asc,
        procinccom, proc_chsed, proc_av_ac, proc_av_in, proc_sal_f, proc_sal_t, proc_abona, proc_chadm, procgunoi,
        inar, ivar, cp_ar, inac, ivac, cp_ac, inin, ivin, constin, cp_in,
        ecart_temp, rand_tr, tarif_et,
        gaz, gunoi, curent, curent_sc, curent_li, ascensor, sal_tesa, sal_feme, ch_admin, ch_sediu,
        cota_fr, prest_serv, chelt_inc, abonament, can_met,
        difarar, difarac, difcanar, difcanac, difetac, difetin,
        arac, ardifer, acac, acdifer, etac, etacac, etinac, inccap, incrap, incsupr, inccomun,
        persoane1, persoane2, persgu, pers_ar, pers_ac, pers_acx, pascens, pcurent_sc, pcurent_li, per_sal_fe, perdifar, perdifac,
        suprafata1, suprafata2, sl_inc, sl_incd, sl_dinc, sl_difin, set_difin, set_comun, sup_ec_ter,
        sl_abon, sl_salte, sl_salfe, sl_presse, sl_chsed, sl_ascen, sl_chadm, observatii
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);

    const insertALuna = db.prepare(`
      INSERT OR REPLACE INTO apartamente_luna (
        perioada_id, apartament_id, bloc_id, an, luna, bloc, numar_apart, nume_proprietar,
        persoane, suprafata, sup_ec_ter, supr_redus, d1, d2, p1_scaz, p2_scaz, sl1_scaz, sl2_scaz, set_scaz,
        proc_av_ac, proc_av_in, procg, procgunoi, procascens, proc_cu_sc, proc_cu_li,
        proc_sal_f, proc_sal_t, proc_abona, p_saltesa, p_presserv, proc_chadm, proc_difer, proc_difin, proc_chsed,
        iv_ar_bu, in_ar_bu, d_v_ar_bu, ser_ar_bu, iv_ar_ba1, in_ar_ba1, d_v_ar_ba1, ser_ar_ba1, iv_ar_ba2, in_ar_ba2, d_v_ar_ba2, ser_ar_ba2,
        iv_ac_bu, in_ac_bu, d_v_ac_bu, ser_ac_bu, iv_ac_ba1, in_ac_ba1, d_v_ac_ba1, ser_ac_ba1, iv_ac_ba2, in_ac_ba2, d_v_ac_ba2, ser_ac_ba2,
        in_incalzire, iv_incalzire, inin, ivin, constin, d_v_in, ser_in, d_v_inin, ser_inin,
        cp_ar, cp_ac, cp_in,
        serie_r1, iv_r1, in_r1, facttr_r1, coefsp_r1,
        serie_r2, iv_r2, in_r2, facttr_r2, coefsp_r2,
        serie_r3, iv_r3, in_r3, facttr_r3, coefsp_r3,
        serie_r4, iv_r4, in_r4, facttr_r4, coefsp_r4,
        serie_r5, iv_r5, in_r5, facttr_r5, coefsp_r5,
        serie_r6, iv_r6, in_r6, facttr_r6, coefsp_r6,
        serie_r7, iv_r7, in_r7, facttr_r7, coefsp_r7,
        tot_unit, gcal_unit, gcal_mp, gcal_calc, gcal_red, gcal_final,
        ch_box, ch_hav, repar_crt, altele, i, fond_repar, fond_reparatii,
        max_fr, max_fond_rulment, calc_fr, plat_fr, rulment,
        apa_rece, arra, arca, can_mnj, can_mnjar, can_mnjac, can_met,
        apa_calda, incalzire, gaz, gunoi, curent, curent_sc, curent_li, ascensor,
        sal_feme, sal_tesa, ch_admin, ch_sediu, prest_serv, abonament, chelt_inc,
        difarar, difarac, difcanar, difcanac, difetac, difetin,
        total_luna, restante, penalizari, total_general, observatii
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?
      )
    `);

    const insertAsocLuna = db.prepare(`
      INSERT OR REPLACE INTO asociatie_luna (
        perioada_id, asoc, apa_rece, can_met, apa_calda, etac, incalzire, gunoi, ch_admin, sal_tesa, sal_feme, abonament, ch_sediu, rulment,
        tot_apart, persoane1, persoane2, persgu, pers_ar, pers_ac, pers_acx, pascens, pcurent_sc, pcurent_li, per_sal_fe,
        suprafata1, suprafata2, sl_inc, sl_abon, sl_salte, sl_salfe, sl_chsed, sl_chadm, sup_ec_ter
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);

    const snapTxn = db.transaction(() => {
      for (const p of periodList) {
        const isLatest = (p.an === activePeriod.an_lucru && p.luna === activePeriod.luna_lucru);
        const genPerFile = path.join(p.dir, 'GENERAL.DBF');
        const { records: gRecs } = parseDbf(genPerFile);
        const g = gRecs[0] || {};

        insertPer.run(
          asociatieId, p.an, p.luna, isLatest ? 'DESCHISA' : 'INCHISA',
          g.ULTIMA_ZI ? toIsoDate(g.ULTIMA_ZI) : `${p.an}-${String(p.luna).padStart(2,'0')}-28`,
          g.TARIF_AR || 0, g.TARIF_CA || 0, g.PROC_CA !== undefined ? g.PROC_CA : 100, g.TARIF_ET || 0
        );
        const pRow = db.prepare('SELECT id FROM perioade WHERE an = ? AND luna = ?').get(p.an, p.luna);
        const pId = pRow.id;

        // Snapshots asociatie
        const asFile = path.join(p.dir, 'ASOC.DBF');
        if (fs.existsSync(asFile)) {
          const { records: asRecs } = parseDbf(asFile);
          const as = asRecs[0] || {};
          insertAsocLuna.run(
            pId, anonymize ? 'ASOCIATIA TEST' : (as.ASOC || 'ASOCIATIA TEST'),
            as.APA_RECE || 0, as.CAN_MET || 0, as.APA_CALDA || 0, as.ETAC || 0, as.INCALZIRE || 0, as.GUNOI || 0,
            as.CH_ADMIN || 0, as.SAL_TESA || 0, as.SAL_FEME || 0, as.ABONAMENT || 0, as.CH_SEDIU || 0, as.RULMENT || 0,
            as.TOT_APART || 0, as.PERSOANE1 || 0, as.PERSOANE2 || 0, as.PERSGU || 0, as.PERS_AR || 0, as.PERS_AC || 0, as.PERS_ACX || 0,
            as.PASCENS || 0, as.PCURENT_SC || 0, as.PCURENT_LI || 0, as.PER_SAL_FE || 0,
            as.SUPRAFATA1 || 0, as.SUPRAFATA2 || 0, as.SL_INC || 0, as.SL_ABON || 0, as.SL_SALTE || 0, as.SL_SALFE || 0, as.SL_CHSED || 0, as.SL_CHADM || 0,
            as.SUP_EC_TER || 0
          );
        }

        // Snapshots blocuri
        const blFile = path.join(p.dir, 'BLOCURI.DBF');
        if (fs.existsSync(blFile)) {
          const { records: blRecs } = parseDbf(blFile);
          for (const b of blRecs) {
            const blocCode = String(b.BLOC).trim();
            const liveBId = blocMap.get(blocCode) || null;
            insertBLuna.run(
              pId, liveBId, p.an, p.luna, blocCode, b.STRADA || '', b.NUMAR || '', b.COD ? String(b.COD) : '', b.COD ? String(b.COD) : '',
              b.TOT_APART || 0, b.SUPRAFATA1 || 0,
              b.MOD_R_DIF || 'PER', b.MOD_R_INC || 'SL', b.MODR_DIFIN || 'SL', b.MOD_R_ASC || 'PER',
              b.PROCINCCOM || 0, b.PROC_CHSED || 100, b.PROC_AV_AC || 100, b.PROC_AV_IN || 100,
              b.PROC_SAL_F || 100, b.PROC_SAL_T || 100, b.PROC_ABONA || 100, b.PROC_CHADM || 100, b.PROCGUNOI || 100,
              b.INAR || 0, b.IVAR || 0, b.CP_AR || 'C', b.INAC || 0, b.IVAC || 0, b.CP_AC || 'C',
              b.ININ || 0, b.IVIN || 0, b.CONSTIN || 1.0, b.CP_IN || 'P',
              b.ECART_TEMP || 0, b.RAND_TR || 100, b.TARIF_ET || 0,
              b.GAZ || 0, b.GUNOI || 0, b.CURENT || 0, b.CURENT_SC || 0, b.CURENT_LI || 0,
              b.ASCENSOR || 0, b.SAL_TESA || 0, b.SAL_FEME || 0, b.CH_ADMIN || 0, b.CH_SEDIU || 0,
              b.COTA_FR || 0, b.PREST_SERV || 0, b.CHELT_INC || 0, b.ABONAMENT || 0, b.CAN_MET || 0,
              b.DIFARAR || 0, b.DIFARAC || 0, b.DIFCANAR || 0, b.DIFCANAC || 0, b.DIFETAC || 0, b.DIFETIN || 0,
              b.ARAC || 0, b.ARDIFER || 0, b.ACAC || 0, b.ACDIFER || 0,
              b.ETAC || 0, b.ETACAC || 0, b.ETINAC || 0, b.INCCAP || 0, b.INCRAP || 0, b.INCSUPR || 0, b.INCCOMUN || 0,
              b.PERSOANE1 || 0, b.PERSOANE2 || 0, b.PERSGU || 0, b.PERS_AR || 0, b.PERS_AC || 0, b.PERS_ACX || 0,
              b.PASCENS || 0, b.PCURENT_SC || 0, b.PCURENT_LI || 0, b.PER_SAL_FE || 0, b.PERDIFAR || 0, b.PERDIFAC || 0,
              b.SUPRAFATA1 || 0, b.SUPRAFATA2 || 0, b.SL_INC || 0, b.SL_INCD || 0, b.SL_DINC || 0, b.SL_DIFIN || 0, b.SET_DIFIN || 0, b.SET_COMUN || 0, b.SUP_EC_TER || 0,
              b.SL_ABON || 0, b.SL_SALTE || 0, b.SL_SALFE || 0, b.SL_PRESSE || 0, b.SL_CHSED || 0, b.SL_ASCEN || 0, b.SL_CHADM || 0,
              b.OBSERVATII || ''
            );
          }
        }

        // Snapshots apartamente
        const apFile = path.join(p.dir, 'APART.DBF');
        if (fs.existsSync(apFile)) {
          const { records: apRecs } = parseDbf(apFile);
          for (const a of apRecs) {
            const blocCode = String(a.BLOC).trim();
            const aptNr = String(a.APART).trim();
            const aptInfo = aptMap.get(`${blocCode}:${aptNr}`);
            const aptId = aptInfo ? aptInfo.aptId : null;
            const bId = aptInfo ? aptInfo.blocId : (blocMap.get(blocCode) || null);
            const owner = anonymize ? `Proprietar Ap. ${aptNr}` : (a.NUME || '');

            const totLuna = (
              (a.APA_RECE || 0) + (a.CAN_MNJ || 0) + (a.CAN_MET || 0) + (a.APA_CALDA || 0) + (a.INCALZIRE || 0) +
              (a.GAZ || 0) + (a.GUNOI || 0) + (a.CURENT || 0) + (a.ASCENSOR || 0) + (a.CH_ADMIN || 0) +
              (a.CH_SEDIU || 0) + (a.PREST_SERV || 0) + (a.ALTELE || 0) + (a.I || 0) + (a.REPAR_CRT || 0) +
              (a.DIFARAR || 0) + (a.DIFARAC || 0) + (a.DIFCANAR || 0) + (a.DIFCANAC || 0) + (a.DIFETAC || 0) + (a.DIFETIN || 0) +
              (a.CH_BOX || 0) + (a.CH_HAV || 0) + (a.ABONAMENT || 0) + (a.CHELT_INC || 0) + (a.SAL_FEME || 0) + (a.SAL_TESA || 0)
            );
            const restante = a.RESTANTE || 0;
            const penalizari = a.PENALIZARI || 0;
            const totGen = Math.round((totLuna + restante + penalizari) * 100) / 100;

            insertALuna.run(
              pId, aptId, bId, p.an, p.luna, blocCode, aptNr, owner,
              a.PERSOANE || 0, a.SUPRAFATA || 0, a.SUP_EC_TER || 0, a.SUPR_REDUS || 0,
              a.D1 || null, a.D2 || null, a.P1_SCAZ || 0, a.P2_SCAZ || 0, a.SL1_SCAZ || 0, a.SL2_SCAZ || 0, a.SET_SCAZ || 0,
              a.PROC_AV_AC !== undefined ? a.PROC_AV_AC : 100, a.PROC_AV_IN !== undefined ? a.PROC_AV_IN : 100,
              a.PROCG !== undefined ? a.PROCG : 100, a.PROCGUNOI !== undefined ? a.PROCGUNOI : 100,
              a.PROCASCENS !== undefined ? a.PROCASCENS : 100, a.PROC_CU_SC !== undefined ? a.PROC_CU_SC : 100,
              a.PROC_CU_LI !== undefined ? a.PROC_CU_LI : 100, a.PROC_SAL_F !== undefined ? a.PROC_SAL_F : 100,
              a.PROC_SAL_T !== undefined ? a.PROC_SAL_T : 100, a.PROC_ABONA !== undefined ? a.PROC_ABONA : 100,
              a.P_SALTESA !== undefined ? a.P_SALTESA : 100, a.P_PRESSERV !== undefined ? a.P_PRESSERV : 100,
              a.PROC_CHADM !== undefined ? a.PROC_CHADM : 100, a.PROC_DIFER !== undefined ? a.PROC_DIFER : 100,
              a.PROC_DIFIN !== undefined ? a.PROC_DIFIN : 100, a.PROC_CHSED !== undefined ? a.PROC_CHSED : 100,
              a.IVARBU || 0, a.INARBU || 0, a.D_V_AR_BU || null, a.SER_AR_BU ? String(a.SER_AR_BU) : null,
              a.IVARBA1 || 0, a.INARBA1 || 0, a.D_V_AR_BA1 || null, a.SER_AR_BA1 ? String(a.SER_AR_BA1) : null,
              a.IVARBA2 || 0, a.INARBA2 || 0, a.D_V_AR_BA2 || null, a.SER_AR_BA2 ? String(a.SER_AR_BA2) : null,
              a.IVACBU || 0, a.INACBU || 0, a.D_V_AC_BU || null, a.SER_AC_BU ? String(a.SER_AC_BU) : null,
              a.IVACBA1 || 0, a.INACBA1 || 0, a.D_V_AC_BA1 || null, a.SER_AC_BA1 ? String(a.SER_AC_BA1) : null,
              a.IVACBA2 || 0, a.INACBA2 || 0, a.D_V_AC_BA2 || null, a.SER_AC_BA2 ? String(a.SER_AC_BA2) : null,
              a.ININ || 0, a.IVIN || 0, a.ININ || 0, a.IVIN || 0, a.CONSTIN || 1.0,
              a.D_V_IN || null, a.SER_IN ? String(a.SER_IN) : null, a.D_V_IN || null, a.SER_IN ? String(a.SER_IN) : null,
              a.CP_AR || 'C', a.CP_AC || 'C', a.CP_IN || 'P',
              a.SERIE_R1 ? String(a.SERIE_R1) : null, a.IV_R1 || 0, a.IN_R1 || 0, a.FACTTR_R1 || 1.0, a.COEFSP_R1 || 1.0,
              a.SERIE_R2 ? String(a.SERIE_R2) : null, a.IV_R2 || 0, a.IN_R2 || 0, a.FACTTR_R2 || 1.0, a.COEFSP_R2 || 1.0,
              a.SERIE_R3 ? String(a.SERIE_R3) : null, a.IV_R3 || 0, a.IN_R3 || 0, a.FACTTR_R3 || 1.0, a.COEFSP_R3 || 1.0,
              a.SERIE_R4 ? String(a.SERIE_R4) : null, a.IV_R4 || 0, a.IN_R4 || 0, a.FACTTR_R4 || 1.0, a.COEFSP_R4 || 1.0,
              a.SERIE_R5 ? String(a.SERIE_R5) : null, a.IV_R5 || 0, a.IN_R5 || 0, a.FACTTR_R5 || 1.0, a.COEFSP_R5 || 1.0,
              a.SERIE_R6 ? String(a.SERIE_R6) : null, a.IV_R6 || 0, a.IN_R6 || 0, a.FACTTR_R6 || 1.0, a.COEFSP_R6 || 1.0,
              a.SERIE_R7 ? String(a.SERIE_R7) : null, a.IV_R7 || 0, a.IN_R7 || 0, a.FACTTR_R7 || 1.0, a.COEFSP_R7 || 1.0,
              a.TOT_UNIT || 0, a.GCAL_UNIT || 0, a.GCAL_MP || 0, a.GCAL_CALC || 0, a.GCAL_RED || 0, a.GCAL_FINAL || 0,
              a.CH_BOX || 0, a.CH_HAV || 0, a.REPAR_CRT || 0, a.ALTELE || 0, a.I || 0, a.FOND_REPAR || 0, a.FOND_REPAR || 0,
              a.MAX_FR || 0, a.MAX_FR || 0, a.CALC_FR || 0, a.PLAT_FR || 0, a.RULMENT || 0,
              a.APA_RECE || 0, a.ARRA || 0, a.ARCA || 0, a.CAN_MNJ || 0, a.CAN_MNJAR || 0, a.CAN_MNJAC || 0, a.CAN_MET || 0,
              a.APA_CALDA || 0, a.INCALZIRE || 0, a.GAZ || 0, a.GUNOI || 0, a.CURENT || 0, a.CURENT_SC || 0, a.CURENT_LI || 0, a.ASCENSOR || 0,
              a.SAL_FEME || 0, a.SAL_TESA || 0, a.CH_ADMIN || 0, a.CH_SEDIU || 0, a.PREST_SERV || 0, a.ABONAMENT || 0, a.CHELT_INC || 0,
              a.DIFARAR || 0, a.DIFARAC || 0, a.DIFCANAR || 0, a.DIFCANAC || 0, a.DIFETAC || 0, a.DIFETIN || 0,
              Math.round(totLuna * 100) / 100, restante, penalizari, totGen, a.OBSERVATII || ''
            );
          }
        }
      }
    });
    snapTxn();
    console.log(`  -> Snapshot-urile celor ${periodList.length} perioade au fost salvate cu succes.`);

    // 6. Cumulative Ledger Importer (CHITANTE.DBF)
    console.log('[4/4] Import registru istoric debite & plăți (CHITANTE.DBF)...');
    const chFile = path.join(latestDir, 'CHITANTE.DBF');
    const chBuf = fs.readFileSync(chFile);
    const chNum = chBuf.readUInt32LE(4);
    const chHdr = chBuf.readUInt16LE(8);
    const chRec = chBuf.readUInt16LE(10);

    const insertD = db.prepare(`
      INSERT INTO datorii (apartament_id, bloc_id, an, luna, luna_text, categorie, valoare, sursa)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'IMPORT')
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

    // Dynamically accumulate ground-truth totals from raw DBF records for anti-cheating verification
    let foxproExpectedTotal = 0;
    const foxproCategoryTotals = new Map();

    const ledgerTxn = db.transaction(() => {
      let offset = chHdr;
      for (let i = 0; i < chNum; i++) {
        const isDel = chBuf[offset] === 0x2A;
        const rowBuf = chBuf.subarray(offset + 1, offset + chRec);
        offset += chRec;

        if (isDel) continue;

        let p = 0;
        const asoc = rowBuf.subarray(p, p += 10).toString('latin1').trim();
        const bloc = rowBuf.subarray(p, p += 6).toString('latin1').trim();
        const apart = rowBuf.subarray(p, p += 6).toString('latin1').trim();
        const nume = iconv.decode(rowBuf.subarray(p, p += 20), 'cp852').trim();
        const luna = rowBuf.subarray(p, p += 11).toString('latin1').trim();
        const lunac = parseInt(rowBuf.subarray(p, p += 2).toString('latin1').trim(), 10) || 0;
        const an = parseInt(rowBuf.subarray(p, p += 4).toString('latin1').trim(), 10) || 0;
        const valoare = parseFloat(rowBuf.subarray(p, p += 12).toString('latin1').trim()) || 0;
        const plata1 = parseFloat(rowBuf.subarray(p, p += 12).toString('latin1').trim()) || 0;
        const chit1 = parseInt(rowBuf.subarray(p, p += 8).toString('latin1').trim(), 10) || 0;
        const data1 = rowBuf.subarray(p, p += 8).toString('latin1').trim();
        const sursa1 = rowBuf.subarray(p, p += 1).toString('latin1').trim();
        const plata2 = parseFloat(rowBuf.subarray(p, p += 12).toString('latin1').trim()) || 0;
        const chit2 = parseInt(rowBuf.subarray(p, p += 8).toString('latin1').trim(), 10) || 0;
        const data2 = rowBuf.subarray(p, p += 8).toString('latin1').trim();
        const sursa2 = rowBuf.subarray(p, p += 1).toString('latin1').trim();
        const cee = rowBuf.subarray(p, p += 1).toString('latin1').trim() || 'R';

        // Ground-truth accumulation from DBF binary stream
        const rowUnpaid = valoare - plata1 - plata2;
        foxproExpectedTotal += rowUnpaid;
        foxproCategoryTotals.set(cee, (foxproCategoryTotals.get(cee) || 0) + rowUnpaid);

        const aptInfo = aptMap.get(`${bloc}:${apart}`);
        if (!aptInfo) {
          throw new Error(`Apartament negăsit în APART: bloc=${bloc}, ap=${apart}`);
        }

        const dRes = insertD.run(aptInfo.aptId, aptInfo.blocId, an, lunac, luna, cee, valoare);
        const datorieId = Number(dRes.lastInsertRowid);

        // Payment 1
        if (chit1 !== 0 && plata1 !== 0) {
          const d1 = toIsoDate(data1, `${an}-${String(lunac || 1).padStart(2, '0')}-01`);
          const s1 = sursa1 === 'B' ? 'BANCA' : 'CASA';
          const rKey = `ORH_${chit1}_${d1}_${s1}_${aptInfo.aptId}`;
          let rId = receiptMap.get(rKey);
          if (!rId) {
            const payer = anonymize ? `Proprietar Ap. ${apart}` : (nume || aptInfo.nume);
            const cRes = insertC.run(
              'ORH', chit1, d1, aptInfo.aptId, aptInfo.blocId,
              payer, apart, bloc, plata1,
              s1 === 'BANCA' ? 'VIRAMENT' : 'NUMERAR',
              `Încasare istorică ${cee} (${luna} ${an})`
            );
            rId = Number(cRes.lastInsertRowid);
            receiptMap.set(rKey, rId);
          } else {
            updateCSum.run(plata1, rId);
          }
          insertP.run(datorieId, rId, plata1, d1, s1);
        }

        // Payment 2 (support negative reversals)
        if (chit2 !== 0 && plata2 !== 0) {
          const d2 = toIsoDate(data2, `${an}-${String(lunac || 1).padStart(2, '0')}-01`);
          const s2 = sursa2 === 'B' ? 'BANCA' : 'CASA';
          const rKey2 = `ORH_${chit2}_${d2}_${s2}_${aptInfo.aptId}`;
          let rId2 = receiptMap.get(rKey2);
          if (!rId2) {
            const payer = anonymize ? `Proprietar Ap. ${apart}` : (nume || aptInfo.nume);
            const cRes = insertC.run(
              'ORH', chit2, d2, aptInfo.aptId, aptInfo.blocId,
              payer, apart, bloc, plata2,
              s2 === 'BANCA' ? 'VIRAMENT' : 'NUMERAR',
              `Încasare istorică ${cee} (${luna} ${an})`
            );
            rId2 = Number(cRes.lastInsertRowid);
            receiptMap.set(rKey2, rId2);
          } else {
            updateCSum.run(plata2, rId2);
          }
          insertP.run(datorieId, rId2, plata2, d2, s2);
        }
      }
    });
    ledgerTxn();
    console.log('  -> Înregistrările din CHITANTE.DBF au fost convertite cu succes.');

    // 7. Dynamic Reconciliation Check against FoxPro DBF ground-truth
    console.log('\n======================================================================');
    console.log('  VERIFICARE RECONCILIERE FINANCIARĂ (BASELINE FOXPRO DINAMIC)');
    console.log('======================================================================');
    const catSums = db.prepare(`
      SELECT 
        d.categorie,
        ROUND(SUM(d.valoare - COALESCE(p.total_achitat, 0)), 2) as unpaid
      FROM datorii d
      LEFT JOIN (
        SELECT datorie_id, SUM(suma) as total_achitat
        FROM plati
        GROUP BY datorie_id
      ) p ON d.id = p.datorie_id
      GROUP BY d.categorie
      ORDER BY d.categorie
    `).all();

    const totalRow = db.prepare(`
      SELECT 
        ROUND(SUM(d.valoare - COALESCE(p.total_achitat, 0)), 2) as total_unpaid
      FROM datorii d
      LEFT JOIN (
        SELECT datorie_id, SUM(suma) as total_achitat
        FROM plati
        GROUP BY datorie_id
      ) p ON d.id = p.datorie_id
    `).get();

    const expectedTotal = Math.round(foxproExpectedTotal * 100) / 100;
    const actualTotal = totalRow ? totalRow.total_unpaid : 0;
    const diff = Math.round(Math.abs(actualTotal - expectedTotal) * 100) / 100;

    console.log('Rezultate solduri neachitate pe categorii (SQLite vs FoxPro DBF):');
    for (const r of catSums) {
      const expCat = Math.round((foxproCategoryTotals.get(r.categorie) || 0) * 100) / 100;
      const catDiff = Math.round(Math.abs(r.unpaid - expCat) * 100) / 100;
      console.log(`  - Categoria ${r.categorie} : SQLite ${r.unpaid.toFixed(2)} RON | FoxPro ${expCat.toFixed(2)} RON (diff: ${catDiff.toFixed(2)} RON)`);
    }
    console.log('----------------------------------------------------------------------');
    console.log(`  Total Neachitat SQLite : ${actualTotal.toFixed(2)} RON`);
    console.log(`  Total Neachitat FoxPro : ${expectedTotal.toFixed(2)} RON`);
    console.log(`  Diferență reconciliere : ${diff.toFixed(2)} RON`);

    if (diff < 0.001) {
      console.log('\n✅ RECONCILIERE 100% EXACTĂ: PARITATE ABSOLUTĂ (0.00 RON DIFERENȚĂ)!');
    } else {
      console.error(`\n❌ EROARE RECONCILIERE: Diferență de ${diff.toFixed(2)} RON!`);
      throw new Error(`Reconciliere eșuată: sold calculat ${actualTotal} != așteptat ${expectedTotal}`);
    }
    console.log('======================================================================\n');

    return {
      success: true,
      totalUnpaid: actualTotal,
      diff
    };
  } finally {
    db.close();
  }
}

// CLI Entrypoint
if (require.main === module) {
  const args = process.argv.slice(2);
  const force = args.includes('--force') || args.includes('-f');
  const anonymize = args.includes('--anonymize') || args.includes('-a');
  const positional = args.filter(a => !a.startsWith('-'));

  const dbfDir = positional[0] || DEFAULT_LATEST_DIR;
  const dbPath = positional[1] || DEFAULT_DB_PATH;

  try {
    runImport({ dbfDir, dbPath, force, anonymize });
  } catch (err) {
    console.error('\n❌ Eroare la execuția importului:', err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  }
}

module.exports = {
  parseDbf,
  deriveActivePeriod,
  createSchema,
  runImport
};
