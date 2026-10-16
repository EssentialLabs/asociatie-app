/**
 * scripts/build-web-seed.js
 *
 * Builds:
 * 1. `asociatie.db.gz` (compressed 8MB SQLite database for GitHub & Cloud deployments)
 * 2. `public/demo-seed.json` (lightweight seed for static GitHub Pages interactive mode)
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const Database = require('better-sqlite3');
const { REPORT_CATALOG, generateReport } = require('../services/reports');

const ROOT = path.join(__dirname, '..');
const DB_PATH = path.join(ROOT, 'asociatie.db');
const DB_GZ_PATH = path.join(ROOT, 'asociatie.db.gz');
const SEED_PATH = path.join(ROOT, 'public', 'demo-seed.json');

function buildWebAssets() {
  const db = new Database(DB_PATH, { readonly: true });

  const asoc1 = db.prepare('SELECT * FROM asociatie WHERE id = 1').get() || {
    id: 1,
    nume: 'ASOCIATIA DE PROPRIETARI TEST',
    cod_fiscal: 'RO00000000',
    n_r_com: '',
    administrator: 'Administrator Test',
    presedinte: 'Presedinte Test',
    adresa: 'Strada Test nr. 1',
    cod_postal: '510000',
    judet: 'ALBA',
    cont_bancar: '',
    banca: '',
    program: 'Luni - Vineri: 16:00 - 18:00',
    telefon: '',
    proc_penalizare: 0.2,
    zile_penalizare: 45,
    serie_chitante: 'ORH',
    urmatorul_numar_chitanta: 1,
    luna_lucru: 9,
    an_lucru: 2026,
    cota_fr: 0
  };
  const asoc2 = db.prepare('SELECT * FROM asociatie WHERE id = 2').get() || {
    id: 2,
    nume: 'ASOCIATIA DEMO CURATA (Workspace Nou)',
    cod_fiscal: 'RO11111111',
    n_r_com: 'J40/100/2026',
    administrator: 'Administrator Nou',
    presedinte: 'Presedinte Nou',
    adresa: 'Strada Noua nr. 2',
    cod_postal: '010101',
    judet: 'BUCURESTI',
    cont_bancar: 'RO49AAAA1B31007593840000',
    banca: 'Banca Transilvania',
    program: 'Luni - Vineri: 09:00 - 17:00',
    telefon: '0722 000 000',
    proc_penalizare: 0.2,
    zile_penalizare: 45,
    serie_chitante: 'AGN',
    urmatorul_numar_chitanta: 1,
    luna_lucru: 9,
    an_lucru: 2026,
    cota_fr: 0,
    apa_rece: 0, can_met: 0, apa_calda: 0, etac: 0, incalzire: 0, gunoi: 0,
    ch_admin: 0, sal_tesa: 0, sal_feme: 0, abonament: 0, ch_sediu: 0, rulment: 0
  };

  const perioade = db.prepare('SELECT * FROM perioade ORDER BY an DESC, luna DESC LIMIT 50').all();
  const p2 = db.prepare('SELECT * FROM perioade WHERE asociatie_id = 2 LIMIT 1').get() || {
    id: 9999, asociatie_id: 2, an: 2026, luna: 9, status: 'DESCHISA', ultima_zi: '2026-09-30', tarif_ar: 9.48, tarif_ca: 9.67, proc_ca: 100, tarif_et: 0
  };
  const perioadeList = perioade.some(p => p.asociatie_id === 2) ? perioade : [...perioade, p2];
  const blocuri = db.prepare(
    'SELECT b.*, (SELECT COUNT(*) FROM apartamente a WHERE a.bloc_id = b.id) as nr_apartamente_actual, (SELECT COALESCE(SUM(a.persoane),0) FROM apartamente a WHERE a.bloc_id = b.id) as nr_persoane FROM blocuri b ORDER BY b.bloc'
  ).all();
  const apartamente = db.prepare('SELECT * FROM apartamente ORDER BY bloc_id, CAST(numar_apart AS INTEGER), numar_apart').all();
  const datoriiUnpaid = db.prepare(`
    SELECT
      d.id, d.apartament_id, d.bloc_id, d.an, d.luna, d.luna_text, d.categorie, d.valoare, d.sursa, d.perioada_id, d.explicatie, d.penalizat_pana_la,
      ROUND(COALESCE(SUM(CASE WHEN c.anulata = 1 THEN 0 ELSE p.suma END), 0), 2) AS achitat,
      ROUND(d.valoare - COALESCE(SUM(CASE WHEN c.anulata = 1 THEN 0 ELSE p.suma END), 0), 2) AS restanta
    FROM datorii d
    LEFT JOIN plati p ON p.datorie_id = d.id
    LEFT JOIN chitante c ON c.id = p.chitanta_id
    GROUP BY d.id
    HAVING ABS(restanta) > 0.004
    ORDER BY d.an ASC, d.luna ASC, d.id ASC
  `).all();
  const chitante = db.prepare('SELECT * FROM chitante ORDER BY id DESC LIMIT 150').all();

  const precomputedReports = {};
  for (const item of REPORT_CATALOG) {
    try {
      precomputedReports[item.code] = generateReport(db, item.code, { showNames: true, target_date: '2026-10-20' });
    } catch (_) {}
  }

  const seed = {
    generated_at: new Date().toISOString(),
    asociatii: [asoc1, asoc2],
    perioade: perioadeList,
    blocuri,
    apartamente,
    datorii: datoriiUnpaid,
    chitante,
    report_catalog: REPORT_CATALOG,
    precomputed_reports: precomputedReports
  };

  fs.writeFileSync(SEED_PATH, JSON.stringify(seed));
  console.log('[Seed] public/demo-seed.json generat (' + (fs.statSync(SEED_PATH).size / 1024).toFixed(1) + ' KB)');

  db.close();

  const rawBuf = fs.readFileSync(DB_PATH);
  const gzBuf = zlib.gzipSync(rawBuf, { level: 9 });
  fs.writeFileSync(DB_GZ_PATH, gzBuf);
  console.log('[DB.gz] asociatie.db.gz generat (' + (gzBuf.length / 1048576).toFixed(2) + ' MB)');
}

buildWebAssets();
