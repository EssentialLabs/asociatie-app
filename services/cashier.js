/**
 * services/cashier.js
 *
 * Cashier & Receipt Processing Service matching FoxPro CHI.PRG, CHO.FXP, and ACA.PRG.
 * Features:
 * - Lump-sum allocation: Oldest month first; within each month P -> A -> F -> R.
 * - Manual row-by-row payment selection.
 * - Exact 15-branch CEX explanation builder from CHI.PRG lines 458-491.
 * - Collective receipts / repair fund discharges (CHO.FXP), including negative values.
 * - Daily cash journal aggregation ("INCASARILE ZILEI DE ...") in `casa`.
 * - Receipt voiding with full ledger balance restoration.
 */

const { getDb } = require('../db');
const { round2 } = require('../engine/round');
const { numarInLitere } = require('../numar-in-litere');
const { getApartmentLedger, LUNI_RO } = require('./ledger');

const CATEGORY_PRIORITY = { P: 1, A: 2, F: 3, R: 4 };

function resolveDb(dbOrNull) {
  if (dbOrNull && typeof dbOrNull.prepare === 'function') return dbOrNull;
  return getDb();
}

/**
 * Exact 15-branch FoxPro CHI.PRG CEX explanation builder (lines 458-491).
 * @param {{ R?: number, A?: number, F?: number, P?: number }} paidByCategory
 */
function buildExplanationCex(paidByCategory = {}) {
  const bgh1 = round2(paidByCategory.R || 0) !== 0; // Regie
  const bgh2 = round2(paidByCategory.A || 0) !== 0; // Fond Reparatii
  const bgh3 = round2(paidByCategory.F || 0) !== 0; // Fond Rulment
  const bgh4 = round2(paidByCategory.P || 0) !== 0; // Penalitati

  if (bgh1 && bgh2 && bgh3 && bgh4) return 'REGIE, FOND REPARATII, FOND RULMENT SI PENALITATI';
  if (bgh1 && bgh2 && bgh3 && !bgh4) return 'REGIE, FOND REPARATII SI FOND RULMENT';
  if (bgh1 && bgh2 && !bgh3 && bgh4) return 'REGIE, FOND REPARATII SI PENALITATI';
  if (bgh1 && !bgh2 && bgh3 && bgh4) return 'REGIE, FOND RULMENT SI PENALITATI';
  if (!bgh1 && bgh2 && bgh3 && bgh4) return 'FOND REPARATII, FOND RULMENT SI PENALITATI';
  if (bgh1 && bgh2 && !bgh3 && !bgh4) return 'REGIE SI FOND REPARATII';
  if (bgh1 && !bgh2 && bgh3 && !bgh4) return 'REGIE SI FOND RULMENT';
  if (bgh1 && !bgh2 && !bgh3 && bgh4) return 'REGIE, SI PENALITATI';
  if (!bgh1 && bgh2 && bgh3 && !bgh4) return 'FOND REPARATII SI FOND RULMENT';
  if (!bgh1 && bgh2 && !bgh3 && bgh4) return 'FOND REPARATII SI PENALITATI';
  if (!bgh1 && !bgh2 && bgh3 && bgh4) return 'FOND RULMENT SI PENALITATI';
  if (bgh1 && !bgh2 && !bgh3 && !bgh4) return 'REGIE';
  if (!bgh1 && bgh2 && !bgh3 && !bgh4) return 'FOND REPARATII';
  if (!bgh1 && !bgh2 && bgh3 && !bgh4) return 'FOND RULMENT';
  if (!bgh1 && !bgh2 && !bgh3 && bgh4) return 'PENALITATI';
  return 'REGIE, FOND REPARATII, FOND RULMENT SI PENALITATI';
}

/**
 * Pure function allocating a lump-sum payment across debt rows:
 * 1. Oldest period first (an ASC, luna ASC)
 * 2. Within each period: P -> A -> F -> R
 */
function allocateLumpSum(rows, totalAmount) {
  let remaining = round2(totalAmount);
  if (remaining <= 0) return { allocations: [], unallocated: 0, paidByCategory: { R: 0, A: 0, F: 0, P: 0 } };

  const sorted = [...rows]
    .map(r => {
      const cat = String(r.categorie ?? r.CEE ?? 'R').trim().toUpperCase();
      const restanta = round2(
        r.restanta !== undefined
          ? r.restanta
          : Number(r.valoare ?? r.VALOARE ?? 0) - Number(r.achitat ?? 0)
      );
      return {
        ...r,
        categorie: cat,
        restanta
      };
    })
    .filter(r => r.restanta > 0)
    .sort((a, b) => {
      if (a.an !== b.an) return a.an - b.an;
      if (a.luna !== b.luna) return a.luna - b.luna;
      const pa = CATEGORY_PRIORITY[a.categorie] ?? 99;
      const pb = CATEGORY_PRIORITY[b.categorie] ?? 99;
      if (pa !== pb) return pa - pb;
      return (a.id || 0) - (b.id || 0);
    });

  const allocations = [];
  const paidByCategory = { R: 0, A: 0, F: 0, P: 0 };

  for (const row of sorted) {
    if (remaining <= 0) break;
    const pay = round2(Math.min(remaining, row.restanta));
    if (pay > 0) {
      allocations.push({
        datorie_id: row.id ?? row.datorie_id,
        an: row.an,
        luna: row.luna,
        categorie: row.categorie,
        suma: pay,
        restanta_initiala: row.restanta,
        restanta_ramasa: round2(row.restanta - pay)
      });
      if (row.categorie in paidByCategory) {
        paidByCategory[row.categorie] = round2(paidByCategory[row.categorie] + pay);
      }
      remaining = round2(remaining - pay);
    }
  }

  return {
    allocations,
    unallocated: remaining,
    paidByCategory,
    cex: buildExplanationCex(paidByCategory)
  };
}

/**
 * Syncs the legacy scalar columns (restante, penalizari) on apartamente from the cumulative ledger.
 */
function syncApartmentScalars(d, apartamentId) {
  const sums = d
    .prepare(`
      SELECT
        ROUND(COALESCE(SUM(CASE WHEN d.categorie != 'P' THEN d.valoare - COALESCE(p.ach, 0) ELSE 0 END), 0), 2) AS rest_non_p,
        ROUND(COALESCE(SUM(CASE WHEN d.categorie = 'P' THEN d.valoare - COALESCE(p.ach, 0) ELSE 0 END), 0), 2) AS rest_p
      FROM datorii d
      LEFT JOIN (
        SELECT pl.datorie_id, SUM(CASE WHEN ch.anulata = 1 THEN 0 ELSE pl.suma END) AS ach
        FROM plati pl
        LEFT JOIN chitante ch ON ch.id = pl.chitanta_id
        GROUP BY pl.datorie_id
      ) p ON p.datorie_id = d.id
      WHERE d.apartament_id = ?
    `)
    .get(apartamentId);

  d.prepare('UPDATE apartamente SET restante = ?, penalizari = ? WHERE id = ?').run(
    round2(sums?.rest_non_p || 0),
    round2(sums?.rest_p || 0),
    apartamentId
  );
}

/**
 * Synchronizes daily cash collection entry in `casa` ("INCASARILE ZILEI DE <data>").
 */
function syncDailyCashSummary(dbOrNull, dateStr, asociatieId = 1, periodeId = null) {
  const d = resolveDb(dbOrNull);
  const isoDate = String(dateStr || new Date().toISOString().slice(0, 10)).slice(0, 10);

  const asoc =
    d.prepare('SELECT * FROM asociatie WHERE id = ?').get(asociatieId) ||
    d.prepare('SELECT * FROM asociatie ORDER BY id LIMIT 1').get() ||
    { nume: 'ORHIDEEA' };

  const activePer =
    (periodeId && d.prepare('SELECT * FROM perioade WHERE id = ?').get(periodeId)) ||
    d.prepare('SELECT * FROM perioade WHERE an = ? AND luna = ?').get(
      asoc.an_lucru || 2026,
      asoc.luna_lucru || 9
    ) ||
    d.prepare('SELECT * FROM perioade ORDER BY an DESC, luna DESC LIMIT 1').get();

  const cashRow = d
    .prepare(`
      SELECT ROUND(COALESCE(SUM(p.suma), 0), 2) AS total_zi
      FROM plati p
      LEFT JOIN chitante c ON c.id = p.chitanta_id
      WHERE p.data = ? AND p.sursa = 'CASA' AND COALESCE(c.anulata, 0) = 0
    `)
    .get(isoDate);

  const totalZi = round2(cashRow?.total_zi || 0);
  const explicatie = `INCASARILE ZILEI DE ${isoDate}`;

  const existing = d
    .prepare(`SELECT id FROM casa WHERE data = ? AND explicatie LIKE 'INCASARILE ZILEI DE%' LIMIT 1`)
    .get(isoDate);

  if (totalZi > 0) {
    if (existing) {
      d.prepare('UPDATE casa SET suma = ?, explicatie = ? WHERE id = ?').run(totalZi, explicatie, existing.id);
    } else {
      d.prepare(`
        INSERT INTO casa (perioada_id, asoc, document, data, suma, tip, act_pas, explicatie)
        VALUES (?, ?, 'CHIT', ?, ?, 'I', 'A', ?)
      `).run(activePer?.id || null, asoc.nume || 'ORHIDEEA', isoDate, totalZi, explicatie);
    }
  } else if (existing) {
    d.prepare('DELETE FROM casa WHERE id = ?').run(existing.id);
  }

  return { data: isoDate, total_zi: totalZi, explicatie };
}

/**
 * Issues an individual receipt (CHI.PRG).
 * Supports either lump-sum (`suma`) or explicit per-row `allocations: [{ datorie_id, suma }]`.
 */
function issueReceipt(arg1, arg2) {
  let d;
  let payload;
  if (arg1 && typeof arg1.prepare === 'function') {
    d = arg1;
    payload = arg2 || {};
  } else {
    d = getDb();
    payload = arg1 || {};
  }

  const apartamentId = Number(payload.apartament_id || payload.apartamentId);
  if (!apartamentId) {
    throw new Error('apartament_id este obligatoriu pentru emiterea chitanței.');
  }

  const ledger = getApartmentLedger(d, apartamentId, { includePaid: true });
  if (!ledger) {
    throw new Error(`Apartamentul cu ID ${apartamentId} nu a fost găsit.`);
  }

  const apt = ledger.apartament;
  const asocId = apt.asociatie_id || 1;
  const asoc =
    d.prepare('SELECT * FROM asociatie WHERE id = ?').get(asocId) ||
    d.prepare('SELECT * FROM asociatie ORDER BY id LIMIT 1').get();

  const dataEmiterii = String(payload.data_emiterii || payload.data || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const sursa = String(payload.sursa || (payload.tip_plata === 'BANCA' || payload.tip_plata === 'ORDIN_PLATA' ? 'BANCA' : 'CASA')).toUpperCase() === 'BANCA'
    ? 'BANCA'
    : 'CASA';
  const tipPlata = payload.tip_plata || (sursa === 'BANCA' ? 'BANCA' : 'NUMERAR');

  let allocations = [];
  const paidByCategory = { R: 0, A: 0, F: 0, P: 0 };

  if (Array.isArray(payload.allocations) && payload.allocations.length > 0) {
    for (const item of payload.allocations) {
      const datId = Number(item.datorie_id || item.id);
      const suma = round2(item.suma);
      if (!datId || suma === 0) continue;
      const row = ledger.allRows.find(r => r.id === datId);
      if (!row) {
        throw new Error(`Rândul de datorie #${datId} nu aparține apartamentului ${apartamentId}.`);
      }
      const cat = String(row.categorie || 'R').toUpperCase();
      allocations.push({
        datorie_id: datId,
        an: row.an,
        luna: row.luna,
        categorie: cat,
        suma
      });
      if (cat in paidByCategory) {
        paidByCategory[cat] = round2(paidByCategory[cat] + suma);
      }
    }
  } else {
    const requestedSum = round2(payload.suma ?? payload.suma_globala ?? 0);
    if (requestedSum <= 0) {
      throw new Error('Suma chitanței trebuie să fie strict pozitivă.');
    }
    const lump = allocateLumpSum(ledger.rows, requestedSum);
    allocations = lump.allocations;
    Object.assign(paidByCategory, lump.paidByCategory);

    // If overpayment exceeds all existing debt rows, attach remainder to newest R row or create an advance R row
    if (lump.unallocated > 0) {
      const newestR = [...ledger.allRows].reverse().find(r => r.categorie === 'R');
      if (newestR) {
        allocations.push({
          datorie_id: newestR.id,
          an: newestR.an,
          luna: newestR.luna,
          categorie: 'R',
          suma: lump.unallocated
        });
        paidByCategory.R = round2(paidByCategory.R + lump.unallocated);
      } else {
        // Create current-period R row so payment can attach
        const anLucru = asoc?.an_lucru || 2026;
        const lunaLucru = asoc?.luna_lucru || 9;
        const info = d
          .prepare(`
            INSERT INTO datorii (apartament_id, bloc_id, an, luna, luna_text, categorie, valoare, sursa, explicatie)
            VALUES (?, ?, ?, ?, ?, 'R', 0, 'MANUAL', 'Avans intretinere')
          `)
          .run(apartamentId, apt.bloc_id, anLucru, lunaLucru, LUNI_RO[lunaLucru] || String(lunaLucru));
        const newDatId = Number(info.lastInsertRowid);
        allocations.push({
          datorie_id: newDatId,
          an: anLucru,
          luna: lunaLucru,
          categorie: 'R',
          suma: lump.unallocated
        });
        paidByCategory.R = round2(paidByCategory.R + lump.unallocated);
      }
    }
  }

  const totalSuma = round2(allocations.reduce((s, a) => s + a.suma, 0));
  if (totalSuma === 0) {
    throw new Error('Nu există sume alocate pentru această chitanță.');
  }

  const cex = payload.explicatie || buildExplanationCex(paidByCategory);
  const sumaLitere = numarInLitere(Math.abs(totalSuma));
  const serie = payload.serie || asoc?.serie_chitante || 'ORH';
  const activePer = d
    .prepare('SELECT id FROM perioade WHERE an = ? AND luna = ?')
    .get(asoc?.an_lucru || 2026, asoc?.luna_lucru || 9);

  let createdReceipt;

  const tx = d.transaction(() => {
    const currentAsoc = d.prepare('SELECT urmatorul_numar_chitanta FROM asociatie WHERE id = ?').get(asoc.id);
    const numar = Number(payload.numar || currentAsoc?.urmatorul_numar_chitanta || 1);

    const insChit = d.prepare(`
      INSERT INTO chitante (
        serie, numar, data_emiterii, apartament_id, bloc_id, perioada_id,
        tip_chitanta, nume_platitor, numar_apart, cod_bloc,
        suma, suma_litere, explicatie, tip_plata, anulata
      ) VALUES (?, ?, ?, ?, ?, ?, 'INDIVIDUAL', ?, ?, ?, ?, ?, ?, ?, 0)
    `);

    const info = insChit.run(
      serie,
      numar,
      dataEmiterii,
      apartamentId,
      apt.bloc_id,
      activePer?.id || null,
      payload.nume_platitor || apt.nume_proprietar || '',
      String(apt.numar_apart),
      String(apt.bloc_cod || ''),
      totalSuma,
      sumaLitere,
      cex,
      tipPlata
    );

    const chitantaId = Number(info.lastInsertRowid);

    const insPlata = d.prepare(`
      INSERT INTO plati (datorie_id, chitanta_id, suma, data, sursa)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const alloc of allocations) {
      insPlata.run(alloc.datorie_id, chitantaId, alloc.suma, dataEmiterii, sursa);
    }

    if (numar >= (currentAsoc?.urmatorul_numar_chitanta || 1)) {
      d.prepare('UPDATE asociatie SET urmatorul_numar_chitanta = ? WHERE id = ?').run(numar + 1, asoc.id);
    }

    syncApartmentScalars(d, apartamentId);

    if (sursa === 'CASA') {
      syncDailyCashSummary(d, dataEmiterii, asoc.id, activePer?.id || null);
    }

    createdReceipt = {
      id: chitantaId,
      serie,
      numar,
      data_emiterii: dataEmiterii,
      apartament_id: apartamentId,
      bloc_id: apt.bloc_id,
      cod_bloc: apt.bloc_cod,
      numar_apart: apt.numar_apart,
      nume_platitor: payload.nume_platitor || apt.nume_proprietar || '',
      suma: totalSuma,
      suma_litere: sumaLitere,
      explicatie: cex,
      cex,
      sursa,
      tip_plata: tipPlata,
      allocations,
      paidByCategory
    };
  });

  tx();
  return createdReceipt;
}

/**
 * Issues a collective receipt or repair fund deduction across a block (CHO.FXP parity).
 * Supports:
 * - mode: 'TOTAL_BLOC' (divides total_suma equally across apartments in the block)
 *   or 'PER_APARTAMENT' (applies suma_per_apartament to each apartment).
 * - Negative amounts (e.g. -32.00 RON) for discharging repair fund / working fund for a block work item.
 */
function issueCollectiveReceipt(arg1, arg2) {
  let d;
  let payload;
  if (arg1 && typeof arg1.prepare === 'function') {
    d = arg1;
    payload = arg2 || {};
  } else {
    d = getDb();
    payload = arg1 || {};
  }

  const blocId = Number(payload.bloc_id || payload.blocId);
  const blocRow = blocId
    ? d.prepare('SELECT * FROM blocuri WHERE id = ?').get(blocId)
    : d.prepare('SELECT * FROM blocuri WHERE bloc = ?').get(String(payload.bloc || '').trim());

  if (!blocRow) {
    throw new Error('Blocul specificat pentru chitanța colectivă nu există.');
  }

  let apts = d
    .prepare('SELECT * FROM apartamente WHERE bloc_id = ? ORDER BY CAST(numar_apart AS INTEGER), numar_apart')
    .all(blocRow.id);

  if (Array.isArray(payload.apartament_ids) && payload.apartament_ids.length > 0) {
    const idSet = new Set(payload.apartament_ids.map(Number));
    apts = apts.filter(a => idSet.has(a.id));
  }

  if (apts.length === 0) {
    throw new Error('Nu există apartamente selectate în acest bloc.');
  }

  const mode = String(payload.mod || payload.mode || 'PER_APARTAMENT').toUpperCase();
  const categorie = String(payload.categorie || payload.cee || 'A').toUpperCase();
  const dataEmiterii = String(payload.data_emiterii || payload.data || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const sursa = String(payload.sursa || 'CASA').toUpperCase() === 'BANCA' ? 'BANCA' : 'CASA';
  const lucrare = String(payload.lucrare || payload.explicatie || 'Chitanta colectiva / Descarcare fond').trim();

  const asocId = blocRow.asociatie_id || 1;
  const asoc =
    d.prepare('SELECT * FROM asociatie WHERE id = ?').get(asocId) ||
    d.prepare('SELECT * FROM asociatie ORDER BY id LIMIT 1').get();

  const an = Number(payload.an || asoc?.an_lucru || 2026);
  const luna = Number(payload.luna || asoc?.luna_lucru || 9);
  const lunaText = LUNI_RO[luna] || String(luna);
  const activePer = d.prepare('SELECT id FROM perioade WHERE an = ? AND luna = ?').get(an, luna);

  let perAptAmount;
  if (mode === 'TOTAL_BLOC') {
    const totalBloc = Number(payload.suma_totala ?? payload.suma ?? 0);
    perAptAmount = round2(totalBloc / apts.length);
  } else {
    perAptAmount = round2(payload.suma_per_apartament ?? payload.suma ?? 0);
  }

  if (perAptAmount === 0) {
    throw new Error('Suma pe apartament în chitanța colectivă nu poate fi 0.');
  }

  const serie = payload.serie || asoc?.serie_chitante || 'ORH';
  let result;

  const tx = d.transaction(() => {
    const currentAsoc = d.prepare('SELECT urmatorul_numar_chitanta FROM asociatie WHERE id = ?').get(asoc.id);
    const numar = Number(payload.numar || currentAsoc?.urmatorul_numar_chitanta || 1);
    const totalReceiptSum = round2(perAptAmount * apts.length);

    const insChit = d.prepare(`
      INSERT INTO chitante (
        serie, numar, data_emiterii, apartament_id, bloc_id, perioada_id,
        tip_chitanta, nume_platitor, numar_apart, cod_bloc,
        suma, suma_litere, explicatie, tip_plata, anulata
      ) VALUES (?, ?, ?, NULL, ?, ?, 'COLECTIV', ?, 'COLECTIV', ?, ?, ?, ?, ?, 0)
    `);

    const chitInfo = insChit.run(
      serie,
      numar,
      dataEmiterii,
      blocRow.id,
      activePer?.id || null,
      `BLOC ${blocRow.bloc} (${apts.length} ap.)`,
      blocRow.bloc,
      totalReceiptSum,
      numarInLitere(Math.abs(totalReceiptSum)),
      lucrare,
      sursa === 'BANCA' ? 'BANCA' : 'NUMERAR'
    );
    const chitantaId = Number(chitInfo.lastInsertRowid);

    const insDatorie = d.prepare(`
      INSERT INTO datorii (
        apartament_id, bloc_id, an, luna, luna_text, categorie, valoare, sursa, perioada_id, explicatie
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'MANUAL', ?, ?)
    `);

    const insPlata = d.prepare(`
      INSERT INTO plati (datorie_id, chitanta_id, suma, data, sursa)
      VALUES (?, ?, ?, ?, ?)
    `);

    const affected = [];

    for (const apt of apts) {
      // In CHO.FXP, if discharging repair fund (negative value) or collective cashing where row doesn't exist,
      // book a matching row with VALOARE = perAptAmount and PLATA1 = perAptAmount (net unpaid change = 0, or discharge).
      let targetDatorieId = null;

      if (perAptAmount > 0 && !payload.create_rows) {
        // Check if there is an unpaid row in this category
        const existingRow = d
          .prepare(`
            SELECT d.id, ROUND(d.valoare - COALESCE(SUM(CASE WHEN c.anulata = 1 THEN 0 ELSE p.suma END), 0), 2) AS rest
            FROM datorii d
            LEFT JOIN plati p ON p.datorie_id = d.id
            LEFT JOIN chitante c ON c.id = p.chitanta_id
            WHERE d.apartament_id = ? AND d.categorie = ?
            GROUP BY d.id
            HAVING rest > 0
            ORDER BY d.an ASC, d.luna ASC, d.id ASC
            LIMIT 1
          `)
          .get(apt.id, categorie);

        if (existingRow) {
          targetDatorieId = existingRow.id;
        }
      }

      if (!targetDatorieId) {
        const dInfo = insDatorie.run(
          apt.id,
          blocRow.id,
          an,
          luna,
          lunaText,
          categorie,
          perAptAmount,
          activePer?.id || null,
          lucrare
        );
        targetDatorieId = Number(dInfo.lastInsertRowid);
      }

      insPlata.run(targetDatorieId, chitantaId, perAptAmount, dataEmiterii, sursa);
      syncApartmentScalars(d, apt.id);

      affected.push({
        apartament_id: apt.id,
        numar_apart: apt.numar_apart,
        datorie_id: targetDatorieId,
        suma: perAptAmount
      });
    }

    if (numar >= (currentAsoc?.urmatorul_numar_chitanta || 1)) {
      d.prepare('UPDATE asociatie SET urmatorul_numar_chitanta = ? WHERE id = ?').run(numar + 1, asoc.id);
    }

    if (sursa === 'CASA' && totalReceiptSum > 0) {
      syncDailyCashSummary(d, dataEmiterii, asoc.id, activePer?.id || null);
    }

    result = {
      id: chitantaId,
      tip_chitanta: 'COLECTIV',
      serie,
      numar,
      data_emiterii: dataEmiterii,
      bloc_id: blocRow.id,
      bloc: blocRow.bloc,
      categorie,
      suma_per_apartament: perAptAmount,
      suma_totala: totalReceiptSum,
      apartamente_afectate: affected.length,
      explicatie: lucrare,
      affected
    };
  });

  tx();
  return result;
}

/**
 * Voids a receipt and restores unpaid ledger balances.
 */
function voidReceipt(arg1, arg2, arg3) {
  let d;
  let chitantaId;
  let opts;
  if (arg1 && typeof arg1.prepare === 'function') {
    d = arg1;
    chitantaId = Number(arg2);
    opts = arg3 || {};
  } else {
    d = getDb();
    chitantaId = Number(arg1);
    opts = arg2 || {};
  }

  const chit = d.prepare('SELECT * FROM chitante WHERE id = ?').get(chitantaId);
  if (!chit) {
    throw new Error(`Chitanța #${chitantaId} nu există.`);
  }
  if (chit.anulata === 1) {
    return { id: chitantaId, alreadyVoided: true };
  }

  const platiRows = d
    .prepare(`
      SELECT p.*, d.apartament_id
      FROM plati p
      JOIN datorii d ON d.id = p.datorie_id
      WHERE p.chitanta_id = ?
    `)
    .all(chitantaId);

  const tx = d.transaction(() => {
    d.prepare(`
      UPDATE chitante
      SET anulata = 1, anulat_la = CURRENT_TIMESTAMP, anulat_de = ?, motiv_anulare = ?
      WHERE id = ?
    `).run(opts.anulat_de || 'Administrator', opts.motiv || 'Anulare chitanță', chitantaId);

    // Remove plati allocations so SQL queries summing plati.suma immediately reflect restored debt
    d.prepare('DELETE FROM plati WHERE chitanta_id = ?').run(chitantaId);

    const aptIds = new Set(platiRows.map(r => r.apartament_id));
    if (chit.apartament_id) aptIds.add(chit.apartament_id);
    for (const aId of aptIds) {
      if (aId) syncApartmentScalars(d, aId);
    }

    syncDailyCashSummary(d, chit.data_emiterii, 1, chit.perioada_id);
  });

  tx();

  return {
    id: chitantaId,
    anulata: true,
    restored_payments: platiRows.length,
    suma_restaurata: round2(chit.suma)
  };
}

module.exports = {
  buildExplanationCex,
  allocateLumpSum,
  issueReceipt,
  issueCollectiveReceipt,
  voidReceipt,
  syncDailyCashSummary,
  syncApartmentScalars
};
