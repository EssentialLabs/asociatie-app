/**
 * services/ledger.js
 *
 * Cumulative Receivables Ledger Service (datorii & plati) and Calculation Data Bridge.
 * Bridges SQLite tables (db.js) with the pure calculation engine (engine/calcul.js).
 */

const { getDb } = require('../db');
const { round2 } = require('../engine/round');

const LUNI_RO = [
  '',
  'IANUARIE',
  'FEBRUARIE',
  'MARTIE',
  'APRILIE',
  'MAI',
  'IUNIE',
  'IULIE',
  'AUGUST',
  'SEPTEMBRIE',
  'OCTOMBRIE',
  'NOIEMBRIE',
  'DECEMBRIE'
];

function resolveDb(dbOrNull) {
  if (dbOrNull && typeof dbOrNull.prepare === 'function') return dbOrNull;
  return getDb();
}

/**
 * Normalizes a SQLite apartamente row so both SQLite snake_case (iv_ar_bu)
 * and FoxPro engine keys (ivarbu / IVARBU) are populated.
 */
function mapSqliteAptToEngine(apt, blocCode) {
  const inarbu = Number(apt.inarbu ?? apt.in_ar_bu ?? 0);
  const ivarbu = Number(apt.ivarbu ?? apt.iv_ar_bu ?? 0);
  const inarba1 = Number(apt.inarba1 ?? apt.in_ar_ba1 ?? 0);
  const ivarba1 = Number(apt.ivarba1 ?? apt.iv_ar_ba1 ?? 0);
  const inarba2 = Number(apt.inarba2 ?? apt.in_ar_ba2 ?? 0);
  const ivarba2 = Number(apt.ivarba2 ?? apt.iv_ar_ba2 ?? 0);

  const inacbu = Number(apt.inacbu ?? apt.in_ac_bu ?? 0);
  const ivacbu = Number(apt.ivacbu ?? apt.iv_ac_bu ?? 0);
  const inacba1 = Number(apt.inacba1 ?? apt.in_ac_ba1 ?? 0);
  const ivacba1 = Number(apt.ivacba1 ?? apt.iv_ac_ba1 ?? 0);
  const inacba2 = Number(apt.inacba2 ?? apt.in_ac_ba2 ?? 0);
  const ivacba2 = Number(apt.ivacba2 ?? apt.iv_ac_ba2 ?? 0);

  const inin = Number(apt.inin ?? apt.in_incalzire ?? 0);
  const ivin = Number(apt.ivin ?? apt.iv_incalzire ?? 0);

  return {
    ...apt,
    bloc: blocCode || apt.bloc || '',
    BLOC: blocCode || apt.bloc || '',
    apart: String(apt.numar_apart ?? apt.apart ?? ''),
    APART: String(apt.numar_apart ?? apt.apart ?? ''),
    inarbu, INARBU: inarbu,
    ivarbu, IVARBU: ivarbu,
    inarba1, INARBA1: inarba1,
    ivarba1, IVARBA1: ivarba1,
    inarba2, INARBA2: inarba2,
    ivarba2, IVARBA2: ivarba2,
    inacbu, INACBU: inacbu,
    ivacbu, IVACBU: ivacbu,
    inacba1, INACBA1: inacba1,
    ivacba1, IVACBA1: ivacba1,
    inacba2, INACBA2: inacba2,
    ivacba2, IVACBA2: ivacba2,
    inin, ININ: inin,
    ivin, IVIN: ivin,
    max_fr: Number(apt.max_fr ?? apt.max_fond_rulment ?? 0),
    MAX_FR: Number(apt.max_fr ?? apt.max_fond_rulment ?? 0),
    fond_repar: Number(apt.fond_repar ?? apt.fond_reparatii ?? 0),
    FOND_REPAR: Number(apt.fond_repar ?? apt.fond_reparatii ?? 0),
    proc_sal_te: Number(apt.proc_sal_t ?? apt.p_saltesa ?? 100),
    PROC_SAL_TE: Number(apt.proc_sal_t ?? apt.p_saltesa ?? 100),
    proc_sal_fe: Number(apt.proc_sal_f ?? 100),
    PROC_SAL_FE: Number(apt.proc_sal_f ?? 100)
  };
}

/**
 * Loads period calculation inputs from SQLite for engine/calcul.js.
 */
function getPeriodCalculationData(dbOrId, maybeOptions = {}) {
  let d;
  let options = maybeOptions;
  if (dbOrId && typeof dbOrId.prepare === 'function') {
    d = dbOrId;
  } else {
    d = getDb();
    if (typeof dbOrId === 'number' || typeof dbOrId === 'string') {
      options = { ...maybeOptions, periodId: Number(dbOrId) };
    } else if (dbOrId && typeof dbOrId === 'object') {
      options = dbOrId;
    }
  }

  const asociatieId = Number(options.asociatie_id || options.asociatieId || 1);
  const asociatie =
    d.prepare('SELECT * FROM asociatie WHERE id = ?').get(asociatieId) ||
    d.prepare('SELECT * FROM asociatie ORDER BY id LIMIT 1').get() ||
    {};

  const effectiveAsocId = asociatie.id || 1;
  let period = null;
  if (options.periodId) {
    period = d.prepare('SELECT * FROM perioade WHERE id = ?').get(options.periodId);
  } else if (options.an && options.luna) {
    period = d.prepare('SELECT * FROM perioade WHERE an = ? AND luna = ?').get(Number(options.an), Number(options.luna));
  }
  if (!period) {
    period =
      d.prepare('SELECT * FROM perioade WHERE an = ? AND luna = ?').get(
        asociatie.an_lucru || 2026,
        asociatie.luna_lucru || 9
      ) ||
      d.prepare('SELECT * FROM perioade ORDER BY an DESC, luna DESC LIMIT 1').get() || {
        an: asociatie.an_lucru || 2026,
        luna: asociatie.luna_lucru || 9,
        status: 'DESCHISA',
        ultima_zi: '2026-09-30',
        tarif_ar: 9.48,
        tarif_ca: 9.67,
        proc_ca: 100,
        tarif_et: 0
      };
  }

  const generalRow =
    d.prepare('SELECT * FROM general WHERE an = ? AND luna = ?').get(period.an, period.luna) || {};

  const general = {
    ...period,
    ...generalRow,
    tarif_ar: Number(generalRow.tarif_ar ?? period.tarif_ar ?? 0),
    tarif_ca: Number(generalRow.tarif_ca ?? period.tarif_ca ?? 0),
    proc_ca: Number(generalRow.proc_ca ?? period.proc_ca ?? 100),
    tarif_et: Number(period.tarif_et ?? generalRow.tarif_et ?? 0),
    ultima_zi: generalRow.ultima_zi || period.ultima_zi || `${period.an}-${String(period.luna).padStart(2, '0')}-28`
  };

  // Check if blocuri has rows for effectiveAsocId
  let rawBlocuri = d.prepare('SELECT * FROM blocuri WHERE asociatie_id = ? ORDER BY bloc').all(effectiveAsocId);
  if (rawBlocuri.length === 0 && effectiveAsocId === 1) {
    rawBlocuri = d.prepare('SELECT * FROM blocuri ORDER BY bloc').all();
  }

  const blocMap = new Map();
  const blocuri = rawBlocuri.map(b => {
    blocMap.set(b.id, b.bloc);
    return {
      ...b,
      inar: Number(b.inar || b.index_nou_ar || 0),
      ivar: Number(b.ivar || b.index_vechi_ar || 0),
      inac: Number(b.inac || b.index_nou_ac || 0),
      ivac: Number(b.ivac || b.index_vechi_ac || 0),
      inin: Number(b.inin || b.index_nou_in || 0),
      ivin: Number(b.ivin || b.index_vechi_in || 0),
      constin: Number(b.constin || b.const_incalzire || 1)
    };
  });

  const blocIds = blocuri.map(b => b.id);
  let rawApartamente = [];
  if (blocIds.length > 0) {
    const placeholders = blocIds.map(() => '?').join(',');
    rawApartamente = d
      .prepare(`SELECT * FROM apartamente WHERE bloc_id IN (${placeholders}) ORDER BY bloc_id, CAST(numar_apart AS INTEGER), numar_apart`)
      .all(...blocIds);
  }

  const apartamente = rawApartamente.map(a => mapSqliteAptToEngine(a, blocMap.get(a.bloc_id)));

  // Working fund ledger rows (category F)
  let fRows = [];
  if (blocIds.length > 0) {
    const placeholders = blocIds.map(() => '?').join(',');
    fRows = d
      .prepare(`
        SELECT
          d.id, d.apartament_id, d.bloc_id, d.categorie, d.valoare,
          ROUND(d.valoare - COALESCE(SUM(CASE WHEN c.anulata = 1 THEN 0 ELSE p.suma END), 0), 2) AS restanta
        FROM datorii d
        LEFT JOIN plati p ON p.datorie_id = d.id
        LEFT JOIN chitante c ON c.id = p.chitanta_id
        WHERE d.categorie = 'F' AND d.bloc_id IN (${placeholders})
        GROUP BY d.id
      `)
      .all(...blocIds);
  }

  return {
    period,
    general,
    asociatie,
    blocuri,
    apartamente,
    datorii: fRows
  };
}

/**
 * Persists calculated period charges back into SQLite (apartamente, blocuri, asociatie).
 */
function savePeriodCalculationData(dbOrNull, calcOutput) {
  const d = resolveDb(dbOrNull);
  const { asociatie, blocuri = [], apartamente = [] } = calcOutput;

  const updApt = d.prepare(`
    UPDATE apartamente SET
      d1 = ?, d2 = ?, p1_scaz = ?, p2_scaz = ?, sl1_scaz = ?, sl2_scaz = ?, set_scaz = ?,
      tot_unit = ?, gcal_unit = ?, gcal_mp = ?, gcal_final = ?,
      inin = ?, ivin = ?, constin = ?,
      calc_fr = ?, plat_fr = ?, rulment = ?,
      apa_rece = ?, arra = ?, arca = ?,
      can_mnj = ?, can_mnjar = ?, can_mnjac = ?, can_met = ?,
      apa_calda = ?, incalzire = ?, gaz = ?, gunoi = ?,
      curent = ?, curent_sc = ?, curent_li = ?,
      ascensor = ?, sal_feme = ?, sal_tesa = ?,
      ch_admin = ?, ch_sediu = ?, prest_serv = ?, abonament = ?, chelt_inc = ?,
      difarar = ?, difarac = ?, difcanar = ?, difcanac = ?, difetac = ?, difetin = ?,
      observatii = ?
    WHERE id = ?
  `);

  const updBloc = d.prepare(`
    UPDATE blocuri SET
      difarar = ?, difarac = ?, difcanar = ?, difcanac = ?, difetac = ?, difetin = ?,
      arac = ?, ardifer = ?, acac = ?, acdifer = ?,
      etac = ?, etacac = ?, etinac = ?, inccap = ?, incrap = ?, incsupr = ?, inccomun = ?,
      gunoi = ?, ch_admin = ?, ch_sediu = ?, abonament = ?, sal_tesa = ?, sal_feme = ?
    WHERE id = ?
  `);

  const tx = d.transaction(() => {
    for (const c of apartamente) {
      if (!c.id) continue;
      updApt.run(
        c.d1 ?? null,
        c.d2 ?? null,
        Number(c.p1_scaz ?? 0),
        Number(c.p2_scaz ?? 0),
        Number(c.sl1_scaz ?? 0),
        Number(c.sl2_scaz ?? 0),
        Number(c.set_scaz ?? 0),
        Number(c.tot_unit ?? 0),
        Number(c.gcal_unit ?? 0),
        Number(c.gcal_mp ?? 0),
        Number(c.gcal_final ?? 0),
        Number(c.inin ?? 0),
        Number(c.ivin ?? 0),
        Number(c.constin ?? 1),
        Number(c.calc_fr ?? 0),
        Number(c.plat_fr ?? 0),
        Number(c.rulment ?? 0),
        Number(c.apa_rece ?? 0),
        Number(c.arra ?? 0),
        Number(c.arca ?? 0),
        Number(c.can_mnj ?? 0),
        Number(c.can_mnjar ?? 0),
        Number(c.can_mnjac ?? 0),
        Number(c.can_met ?? 0),
        Number(c.apa_calda ?? 0),
        Number(c.incalzire ?? 0),
        Number(c.gaz ?? 0),
        Number(c.gunoi ?? 0),
        Number(c.curent ?? 0),
        Number(c.curent_sc ?? 0),
        Number(c.curent_li ?? 0),
        Number(c.ascensor ?? 0),
        Number(c.sal_feme ?? 0),
        Number(c.sal_tesa ?? 0),
        Number(c.ch_admin ?? 0),
        Number(c.ch_sediu ?? 0),
        Number(c.prest_serv ?? 0),
        Number(c.abonament ?? 0),
        Number(c.chelt_inc ?? 0),
        Number(c.difarar ?? 0),
        Number(c.difarac ?? 0),
        Number(c.difcanar ?? 0),
        Number(c.difcanac ?? 0),
        Number(c.difetac ?? 0),
        Number(c.difetin ?? 0),
        String(c.observatii ?? ''),
        c.id
      );
    }

    for (const b of blocuri) {
      if (!b.id) continue;
      updBloc.run(
        Number(b.difarar ?? 0),
        Number(b.difarac ?? 0),
        Number(b.difcanar ?? 0),
        Number(b.difcanac ?? 0),
        Number(b.difetac ?? 0),
        Number(b.difetin ?? 0),
        Number(b.arac ?? 0),
        Number(b.ardifer ?? 0),
        Number(b.acac ?? 0),
        Number(b.acdifer ?? 0),
        Number(b.etac ?? 0),
        Number(b.etacac ?? 0),
        Number(b.etinac ?? 0),
        Number(b.inccap ?? 0),
        Number(b.incrap ?? 0),
        Number(b.incsupr ?? 0),
        Number(b.inccomun ?? 0),
        Number(b.gunoi ?? 0),
        Number(b.ch_admin ?? 0),
        Number(b.ch_sediu ?? 0),
        Number(b.abonament ?? 0),
        Number(b.sal_tesa ?? 0),
        Number(b.sal_feme ?? 0),
        b.id
      );
    }
  });

  tx();
  return calcOutput;
}

/**
 * Returns the complete ledger state for a single apartment.
 */
function getApartmentLedger(dbOrNull, apartamentId, options = {}) {
  const d = resolveDb(dbOrNull);
  const apt = d
    .prepare(`
      SELECT a.*, b.bloc AS bloc_cod, b.strada, b.numar AS bloc_numar, b.asociatie_id
      FROM apartamente a
      JOIN blocuri b ON b.id = a.bloc_id
      WHERE a.id = ?
    `)
    .get(apartamentId);

  if (!apt) {
    return null;
  }

  const rows = d
    .prepare(`
      SELECT
        d.id,
        d.apartament_id,
        d.bloc_id,
        d.an,
        d.luna,
        d.luna_text,
        d.categorie,
        d.valoare,
        d.sursa,
        d.perioada_id,
        d.explicatie,
        d.penalizat_pana_la,
        ROUND(COALESCE(SUM(CASE WHEN c.anulata = 1 THEN 0 ELSE p.suma END), 0), 2) AS achitat,
        ROUND(d.valoare - COALESCE(SUM(CASE WHEN c.anulata = 1 THEN 0 ELSE p.suma END), 0), 2) AS restanta
      FROM datorii d
      LEFT JOIN plati p ON p.datorie_id = d.id
      LEFT JOIN chitante c ON c.id = p.chitanta_id
      WHERE d.apartament_id = ?
      GROUP BY d.id
      ORDER BY
        d.an ASC,
        d.luna ASC,
        CASE d.categorie
          WHEN 'P' THEN 1
          WHEN 'A' THEN 2
          WHEN 'F' THEN 3
          WHEN 'R' THEN 4
          ELSE 5
        END ASC,
        d.id ASC
    `)
    .all(apartamentId);

  const totals = {
    R: 0,
    F: 0,
    A: 0,
    P: 0,
    totalValoare: 0,
    totalAchitat: 0,
    totalRestanta: 0
  };

  let oldestUnpaidPeriod = null;

  for (const r of rows) {
    const cat = String(r.categorie || 'R').toUpperCase();
    const rest = round2(r.restanta);
    r.restanta = rest;
    r.achitat = round2(r.achitat);
    r.valoare = round2(r.valoare);
    r.luna_nume = r.luna_text || LUNI_RO[r.luna] || String(r.luna);

    if (cat in totals) {
      totals[cat] = round2(totals[cat] + rest);
    }
    totals.totalValoare = round2(totals.totalValoare + r.valoare);
    totals.totalAchitat = round2(totals.totalAchitat + r.achitat);
    totals.totalRestanta = round2(totals.totalRestanta + rest);

    if (rest > 0 && !oldestUnpaidPeriod) {
      oldestUnpaidPeriod = { an: r.an, luna: r.luna, luna_nume: r.luna_nume };
    }
  }

  const unpaidRows = options.includePaid ? rows : rows.filter(r => Math.abs(r.restanta) > 0.001);

  return {
    apartament: apt,
    rows: unpaidRows,
    allRows: rows,
    totals,
    hjkg: totals.totalRestanta,
    oldestUnpaidPeriod
  };
}

/**
 * Returns dynamic ledger summary across an association or block.
 */
function getAssociationLedgerSummary(dbOrNull, asociatieId = 1, blocId = null) {
  const d = resolveDb(dbOrNull);

  const filterSql = blocId
    ? 'WHERE b.id = ?'
    : 'WHERE (b.asociatie_id = ? OR (? = 1 AND b.asociatie_id IS NULL))';
  const params = blocId ? [blocId] : [asociatieId, asociatieId];

  const categoryRows = d
    .prepare(`
      SELECT
        d.categorie,
        ROUND(SUM(d.valoare), 2) AS total_valoare,
        ROUND(SUM(COALESCE(p.achitat, 0)), 2) AS total_achitat,
        ROUND(SUM(d.valoare - COALESCE(p.achitat, 0)), 2) AS total_restant
      FROM datorii d
      JOIN blocuri b ON b.id = d.bloc_id
      LEFT JOIN (
        SELECT p.datorie_id, SUM(CASE WHEN c.anulata = 1 THEN 0 ELSE p.suma END) AS achitat
        FROM plati p
        LEFT JOIN chitante c ON c.id = p.chitanta_id
        GROUP BY p.datorie_id
      ) p ON p.datorie_id = d.id
      ${filterSql}
      GROUP BY d.categorie
    `)
    .all(...params);

  const categories = { R: 0, F: 0, A: 0, P: 0 };
  let totalUnpaid = 0;
  for (const r of categoryRows) {
    const cat = String(r.categorie || '').toUpperCase();
    if (cat in categories) {
      categories[cat] = round2(r.total_restant);
    }
    totalUnpaid = round2(totalUnpaid + Number(r.total_restant || 0));
  }

  const blockRows = d
    .prepare(`
      SELECT
        b.id AS bloc_id,
        b.bloc,
        ROUND(SUM(CASE WHEN d.categorie = 'R' THEN d.valoare - COALESCE(p.achitat, 0) ELSE 0 END), 2) AS restant_r,
        ROUND(SUM(CASE WHEN d.categorie = 'F' THEN d.valoare - COALESCE(p.achitat, 0) ELSE 0 END), 2) AS restant_f,
        ROUND(SUM(CASE WHEN d.categorie = 'A' THEN d.valoare - COALESCE(p.achitat, 0) ELSE 0 END), 2) AS restant_a,
        ROUND(SUM(CASE WHEN d.categorie = 'P' THEN d.valoare - COALESCE(p.achitat, 0) ELSE 0 END), 2) AS restant_p,
        ROUND(SUM(d.valoare - COALESCE(p.achitat, 0)), 2) AS total_restant
      FROM blocuri b
      LEFT JOIN datorii d ON d.bloc_id = b.id
      LEFT JOIN (
        SELECT p.datorie_id, SUM(CASE WHEN c.anulata = 1 THEN 0 ELSE p.suma END) AS achitat
        FROM plati p
        LEFT JOIN chitante c ON c.id = p.chitanta_id
        GROUP BY p.datorie_id
      ) p ON p.datorie_id = d.id
      ${filterSql}
      GROUP BY b.id
      ORDER BY b.bloc
    `)
    .all(...params);

  return {
    asociatie_id: asociatieId,
    total_restant: totalUnpaid,
    categories,
    blocuri: blockRows
  };
}

module.exports = {
  LUNI_RO,
  mapSqliteAptToEngine,
  getPeriodCalculationData,
  savePeriodCalculationData,
  getApartmentLedger,
  getAssociationLedgerSummary
};
