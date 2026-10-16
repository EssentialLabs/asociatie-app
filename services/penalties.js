/**
 * services/penalties.js
 *
 * On-Demand Penalty Calculation Engine matching FoxPro CHI.PRG (pen & Lpenal).
 * Rules:
 * 1. Net balance guard (HJKG < 0): if apartment total net balance across all rows < 0, penalties = 0.00.
 * 2. Category filter: only non-'P' rows (R, F, A) with unpaid balance > 0 are penalized.
 * 3. Due date: 15th of the month following (an, luna).
 * 4. Penalty start date (incp): DueDate + ZILE_PENAL + 1 day.
 * 5. Delay days (NRZ): targetDate - incp (if <= 0, penalty = 0).
 * 6. Raw penalty: ROUND(NRZ * (PROC_PENAL / 100) * restanta, 2).
 * 7. Principal cap: PENAL = MIN(restanta, MAX(0, vpen)).
 * 8. Idempotent booking: books or updates 'P' rows in datorii without duplication.
 */

const { getDb } = require('../db');
const { round2 } = require('../engine/round');
const { parseCalendarDate } = require('../engine/tce');
const { getApartmentLedger, LUNI_RO } = require('./ledger');

function toUtcMs(dateInput) {
  const iso = parseCalendarDate(dateInput);
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function formatIsoDate(utcMs) {
  const d = new Date(utcMs);
  return d.toISOString().slice(0, 10);
}

function addDaysUtc(utcMs, days) {
  return utcMs + days * 86400000;
}

function diffDaysUtc(targetMs, startMs) {
  return Math.round((targetMs - startMs) / 86400000);
}

/**
 * Pure calculation of FoxPro CHI.PRG penalty for a single debt row.
 */
function calculateRowPenalty(row, targetDate, params = {}) {
  const procPenal = Number(params.procPenal ?? params.proc_penal ?? params.PROC_PENAL ?? 0.2);
  const zilePenal = Number(params.zilePenal ?? params.zile_penal ?? params.ZILE_PENAL ?? 45);
  const hjkg = Number(params.hjkg ?? 0);

  const categorie = String(row.categorie ?? row.CEE ?? row.cee ?? 'R').trim().toUpperCase();
  const an = Number(row.an ?? row.AN ?? 2026);
  const luna = Number(row.luna ?? row.LUNAC ?? row.lunac ?? 1);

  let restanta;
  if (row.restanta !== undefined || row.RESTANTA !== undefined) {
    restanta = Number(row.restanta ?? row.RESTANTA ?? 0);
  } else {
    const val = Number(row.valoare ?? row.VALOARE ?? 0);
    const ch1 = Number(row.chitanta1 ?? row.CHITANTA1 ?? 0);
    const ch2 = Number(row.chitanta2 ?? row.CHITANTA2 ?? 0);
    const p1 = ch1 !== 0 ? Number(row.plata1 ?? row.PLATA1 ?? 0) : 0;
    const p2 = ch2 !== 0 ? Number(row.plata2 ?? row.PLATA2 ?? 0) : 0;
    const achitat = Number(row.achitat ?? (p1 + p2));
    restanta = round2(val - achitat);
  }

  // Due date = 15th of following month
  const nextMonth = luna === 12 ? 1 : luna + 1;
  const nextYear = luna === 12 ? an + 1 : an;
  const dueMs = Date.UTC(nextYear, nextMonth - 1, 15);
  const incpMs = addDaysUtc(dueMs, zilePenal + 1);
  const targetMs = toUtcMs(targetDate) ?? Date.now();

  const nrzRaw = diffDaysUtc(targetMs, incpMs);
  const nrz = Math.max(0, nrzRaw);

  let pen4 = 0;
  if (categorie !== 'P') {
    if (hjkg < 0) {
      pen4 = 0;
    } else {
      pen4 = restanta;
    }
  }
  const pen3 = pen4 <= 0 ? 0 : round2(pen4);

  const vpen = nrz <= 0 || pen3 <= 0 ? 0 : round2(nrz * (procPenal / 100) * pen3);
  let penal = 0;
  if (vpen > 0) {
    penal = vpen > pen3 ? pen3 : vpen;
  }

  return {
    datorie_id: row.id ?? row.datorie_id ?? null,
    an,
    luna,
    categorie,
    restanta: pen3,
    data_scadenta: formatIsoDate(dueMs),
    data_start_penalizare: formatIsoDate(incpMs),
    zile_intarziere: nrz,
    procent: procPenal,
    valoare_bruta: vpen,
    valoare_penalizare: round2(penal),
    plafonat: vpen > pen3 && pen3 > 0
  };
}

/**
 * Computes on-demand penalties for an apartment or an array of ledger rows.
 * Supports calling signatures:
 *   calculatePenalties(rowsArray, targetDate, options)
 *   calculatePenalties(db, apartamentId, targetDate, options)
 *   calculatePenalties(apartamentId, targetDate, options)
 */
function calculatePenalties(arg1, arg2, arg3, arg4) {
  // Signature 1: Pure array of rows
  if (Array.isArray(arg1)) {
    const rows = arg1;
    const targetDate = arg2 || new Date().toISOString().slice(0, 10);
    const opts = arg3 || {};

    let hjkg = 0;
    for (const r of rows) {
      if (r.restanta !== undefined || r.RESTANTA !== undefined) {
        hjkg = round2(hjkg + Number(r.restanta ?? r.RESTANTA ?? 0));
      } else {
        const val = Number(r.valoare ?? r.VALOARE ?? 0);
        const ch1 = Number(r.chitanta1 ?? r.CHITANTA1 ?? 0);
        const ch2 = Number(r.chitanta2 ?? r.CHITANTA2 ?? 0);
        const p1 = ch1 !== 0 ? Number(r.plata1 ?? r.PLATA1 ?? 0) : 0;
        const p2 = ch2 !== 0 ? Number(r.plata2 ?? r.PLATA2 ?? 0) : 0;
        const ach = Number(r.achitat ?? (p1 + p2));
        hjkg = round2(hjkg + (val - ach));
      }
    }

    const procPenal = Number(opts.proc_penal ?? opts.procPenal ?? opts.PROC_PENAL ?? 0.2);
    const zilePenal = Number(opts.zile_penal ?? opts.zilePenal ?? opts.ZILE_PENAL ?? 45);
    const items = [];
    let totalPen = 0;

    for (const r of rows) {
      const cat = String(r.categorie ?? r.CEE ?? r.cee ?? 'R').trim().toUpperCase();
      if (cat === 'P') continue;
      const item = calculateRowPenalty(r, targetDate, { procPenal, zilePenal, hjkg });
      if (item.restanta > 0 || opts.includeZero) {
        items.push(item);
        totalPen = round2(totalPen + item.valoare_penalizare);
      }
    }

    const res = [...items];
    Object.assign(res, {
      target_date: parseCalendarDate(targetDate) || String(targetDate),
      proc_penal: procPenal,
      zile_penal: zilePenal,
      hjkg,
      credit_suppressed: hjkg < 0,
      total_penalizare: totalPen,
      rows: items,
      items
    });
    return res;
  }

  // Signature 2 & 3: SQLite DB + apartamentId
  let d;
  let apartamentId;
  let targetDate;
  let opts;

  if (arg1 && typeof arg1.prepare === 'function') {
    d = arg1;
    apartamentId = Number(arg2);
    targetDate = arg3 || new Date().toISOString().slice(0, 10);
    opts = arg4 || {};
  } else {
    d = getDb();
    apartamentId = Number(arg1);
    targetDate = arg2 || new Date().toISOString().slice(0, 10);
    opts = arg3 || {};
  }

  const ledger = getApartmentLedger(d, apartamentId, { includePaid: true });
  if (!ledger) {
    const empty = [];
    Object.assign(empty, {
      apartament_id: apartamentId,
      target_date: parseCalendarDate(targetDate),
      hjkg: 0,
      credit_suppressed: false,
      total_penalizare: 0,
      rows: [],
      items: []
    });
    return empty;
  }

  const asocId = ledger.apartament.asociatie_id || 1;
  const asoc =
    d.prepare('SELECT * FROM asociatie WHERE id = ?').get(asocId) ||
    d.prepare('SELECT * FROM asociatie ORDER BY id LIMIT 1').get() ||
    {};

  const procPenal = Number(opts.proc_penal ?? opts.procPenal ?? asoc.proc_penalizare ?? 0.2);
  const zilePenal = Number(opts.zile_penal ?? opts.zilePenal ?? asoc.zile_penalizare ?? 45);
  const hjkg = ledger.hjkg;

  const items = [];
  let totalPen = 0;

  for (const r of ledger.allRows) {
    const cat = String(r.categorie || 'R').toUpperCase();
    if (cat === 'P') continue;
    if (r.restanta <= 0 && !opts.includeZero) continue;

    const item = calculateRowPenalty(r, targetDate, { procPenal, zilePenal, hjkg });
    items.push(item);
    totalPen = round2(totalPen + item.valoare_penalizare);
  }

  const res = [...items];
  Object.assign(res, {
    apartament_id: apartamentId,
    target_date: parseCalendarDate(targetDate) || String(targetDate),
    proc_penal: procPenal,
    zile_penal: zilePenal,
    hjkg,
    credit_suppressed: hjkg < 0,
    total_penalizare: totalPen,
    rows: items,
    items
  });
  return res;
}

/**
 * Idempotently books calculated on-demand penalties as 'P' rows in `datorii`.
 */
function bookPenalties(arg1, arg2, arg3, arg4) {
  let d;
  let apartamentId;
  let targetDate;
  let opts;

  if (arg1 && typeof arg1.prepare === 'function') {
    d = arg1;
    apartamentId = Number(arg2);
    targetDate = arg3 || new Date().toISOString().slice(0, 10);
    opts = arg4 || {};
  } else {
    d = getDb();
    apartamentId = Number(arg1);
    targetDate = arg2 || new Date().toISOString().slice(0, 10);
    opts = arg3 || {};
  }

  const calc = calculatePenalties(d, apartamentId, targetDate, opts);
  const apt = d.prepare('SELECT id, bloc_id FROM apartamente WHERE id = ?').get(apartamentId);
  if (!apt) {
    throw new Error(`Apartamentul ${apartamentId} nu există.`);
  }

  const isoTarget = parseCalendarDate(targetDate) || new Date().toISOString().slice(0, 10);
  const bookedRows = [];

  const findExistingP = d.prepare(`
    SELECT d.id, d.valoare,
           ROUND(COALESCE(SUM(CASE WHEN c.anulata = 1 THEN 0 ELSE p.suma END), 0), 2) AS achitat
    FROM datorii d
    LEFT JOIN plati p ON p.datorie_id = d.id
    LEFT JOIN chitante c ON c.id = p.chitanta_id
    WHERE d.apartament_id = ? AND d.an = ? AND d.luna = ? AND d.categorie = 'P' AND d.sursa = 'PENALTY'
      AND d.explicatie = ?
    GROUP BY d.id
    HAVING achitat = 0
    LIMIT 1
  `);

  const updP = d.prepare(`
    UPDATE datorii SET valoare = ?, penalizat_pana_la = ? WHERE id = ?
  `);

  const insP = d.prepare(`
    INSERT INTO datorii (
      apartament_id, bloc_id, an, luna, luna_text, categorie, valoare, sursa, explicatie, penalizat_pana_la
    ) VALUES (?, ?, ?, ?, ?, 'P', ?, 'PENALTY', ?, ?)
  `);

  const updSourceRow = d.prepare(`
    UPDATE datorii SET penalizat_pana_la = ? WHERE id = ?
  `);

  const tx = d.transaction(() => {
    for (const item of calc.rows) {
      if (item.valoare_penalizare <= 0) continue;
      if (opts.datorie_id && item.datorie_id !== Number(opts.datorie_id)) continue;

      const expKey = `PEN:${item.datorie_id || `${item.an}-${item.luna}-${item.categorie}`}`;
      const existing = findExistingP.get(apartamentId, item.an, item.luna, expKey);
      const lunaText = LUNI_RO[item.luna] || String(item.luna);

      if (existing) {
        updP.run(item.valoare_penalizare, isoTarget, existing.id);
        bookedRows.push({ id: existing.id, ...item, updated: true });
      } else {
        const info = insP.run(
          apartamentId,
          apt.bloc_id,
          item.an,
          item.luna,
          lunaText,
          item.valoare_penalizare,
          expKey,
          isoTarget
        );
        bookedRows.push({ id: Number(info.lastInsertRowid), ...item, updated: false });
      }

      if (item.datorie_id) {
        updSourceRow.run(isoTarget, item.datorie_id);
      }
    }

    // Sync legacy apartamente.penalizari scalar
    const penSum = d
      .prepare(`
        SELECT ROUND(COALESCE(SUM(d.valoare - COALESCE(p.ach, 0)), 0), 2) AS total_p
        FROM datorii d
        LEFT JOIN (
          SELECT pl.datorie_id, SUM(CASE WHEN ch.anulata = 1 THEN 0 ELSE pl.suma END) AS ach
          FROM plati pl
          LEFT JOIN chitante ch ON ch.id = pl.chitanta_id
          GROUP BY pl.datorie_id
        ) p ON p.datorie_id = d.id
        WHERE d.apartament_id = ? AND d.categorie = 'P'
      `)
      .get(apartamentId);

    d.prepare('UPDATE apartamente SET penalizari = ? WHERE id = ?').run(
      Number(penSum?.total_p || 0),
      apartamentId
    );
  });

  tx();

  return {
    apartament_id: apartamentId,
    target_date: isoTarget,
    booked_count: bookedRows.length,
    total_booked: round2(bookedRows.reduce((s, r) => s + r.valoare_penalizare, 0)),
    booked: bookedRows
  };
}

module.exports = {
  calculateRowPenalty,
  calculatePenalties,
  bookPenalties
};
