/**
 * routes/calcul.js
 *
 * Express router for FoxPro Calcul & Monthly Lifecycle operations:
 * - POST /tce (TCE.PRG: expire temporary reductions where D2 < ULTIMA_ZI and persist)
 * - POST /cre (CRE.PRG: compute heat cost allocators and persist)
 * - POST /sum (SUM.PRG: run 8-step monthly calculation via getPeriodCalculationData + savePeriodCalculationData)
 * - POST /publica (TRE.PRG: publishMonth)
 * - POST /anuleaza-publicarea (GOL.PRG: unpublishMonth)
 * - POST /inchide (SLU.PRG: closeMonth)
 * - POST /redeschide (reopenMonth)
 */

const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { expireReductions } = require('../engine/tce');
const { computeAllocators } = require('../engine/cre');
const { calculatePeriod } = require('../engine/calcul');
const { getPeriodCalculationData, savePeriodCalculationData } = require('../services/ledger');
const { publishMonth, unpublishMonth, closeMonth, reopenMonth } = require('../services/lifecycle');
const { logAudit } = require('../services/auth');

function resolveDb(req) {
  return req.app?.locals?.db || getDb();
}

function buildOptions(req) {
  return {
    ...(req.query || {}),
    ...(req.body || {}),
    asociatie_id: req.body?.asociatie_id || req.query?.asociatie_id || req.asociatieId || 1
  };
}

// ============================================================
//  1. TCE — TRECERE CERERI EXPIRATE (TCE.PRG)
// ============================================================
router.post('/tce', (req, res) => {
  try {
    const db = resolveDb(req);
    const options = buildOptions(req);
    const data = getPeriodCalculationData(db, options);
    const tceResult = expireReductions(data, options);

    if (!tceResult.aborted) {
      const updApt = db.prepare(`
        UPDATE apartamente
        SET d1 = ?, d2 = ?, p1_scaz = ?, p2_scaz = ?, sl1_scaz = ?, sl2_scaz = ?, set_scaz = ?, observatii = ?
        WHERE id = ?
      `);
      const tx = db.transaction(() => {
        for (const c of tceResult.apartamente) {
          if (!c.id) continue;
          updApt.run(
            c.d1 ?? null,
            c.d2 ?? null,
            Number(c.p1_scaz ?? 0),
            Number(c.p2_scaz ?? 0),
            Number(c.sl1_scaz ?? 0),
            Number(c.sl2_scaz ?? 0),
            Number(c.set_scaz ?? 0),
            String(c.observatii ?? ''),
            c.id
          );
        }
      });
      tx();

      logAudit(db, {
        user_id: req.user?.id,
        username: req.user?.username,
        actiune: 'TCE_EXPIRE_REDUCTIONS',
        entitate: 'perioade',
        entitate_id: data.period?.id,
        detalii: { expiredCount: tceResult.expiredCount, ultima_zi: data.general?.ultima_zi },
        ip: req.ip
      });
    }

    res.json({
      success: true,
      ultima_zi: data.general?.ultima_zi,
      expiredCount: tceResult.expiredCount,
      expiredApartments: tceResult.expiredApartments,
      aborted: tceResult.aborted,
      apartamente: tceResult.apartamente
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================================
//  2. CRE — CALCUL REPARTITOARE CĂLDURĂ (CRE.PRG)
// ============================================================
router.post('/cre', (req, res) => {
  try {
    const db = resolveDb(req);
    const options = buildOptions(req);
    const data = getPeriodCalculationData(db, options);
    const creResult = computeAllocators({ blocuri: data.blocuri, apartamente: data.apartamente }, options);

    const updApt = db.prepare(`
      UPDATE apartamente
      SET tot_unit = ?, gcal_unit = ?, gcal_mp = ?, gcal_final = ?,
          ivin = ?, inin = ?, iv_incalzire = ?, in_incalzire = ?, constin = ?
      WHERE id = ?
    `);

    const tx = db.transaction(() => {
      for (const c of creResult.apartamente) {
        if (!c.id) continue;
        updApt.run(
          Number(c.tot_unit ?? 0),
          Number(c.gcal_unit ?? 0),
          Number(c.gcal_mp ?? 0),
          Number(c.gcal_final ?? 0),
          Number(c.ivin ?? 0),
          Number(c.inin ?? 0),
          Number(c.ivin ?? 0),
          Number(c.inin ?? 0),
          Number(c.constin ?? 1),
          c.id
        );
      }
    });
    tx();

    logAudit(db, {
      user_id: req.user?.id,
      username: req.user?.username,
      actiune: 'CRE_COMPUTE_ALLOCATORS',
      entitate: 'perioade',
      entitate_id: data.period?.id,
      detalii: creResult.diagnostics,
      ip: req.ip
    });

    res.json({
      success: true,
      diagnostics: creResult.diagnostics,
      blocuri: creResult.blocuri,
      apartamente: creResult.apartamente
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================================
//  3. SUM — ÎNSUMARE ȘI CALCUL LUNAR (SUM.PRG)
// ============================================================
router.post('/sum', (req, res) => {
  try {
    const db = resolveDb(req);
    const options = buildOptions(req);
    const data = getPeriodCalculationData(db, options);
    const calcOutput = calculatePeriod(data, options);
    savePeriodCalculationData(db, calcOutput);

    logAudit(db, {
      user_id: req.user?.id,
      username: req.user?.username,
      actiune: 'SUM_CALCULATE_PERIOD',
      entitate: 'perioade',
      entitate_id: data.period?.id,
      detalii: { an: data.period?.an, luna: data.period?.luna, apartamente: calcOutput.apartamente?.length || 0 },
      ip: req.ip
    });

    res.json({
      success: true,
      ...calcOutput
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================================
//  4. TRE — PUBLICĂ LUNA ÎN REGISTRUL DATORII (TRE.PRG)
// ============================================================
router.post('/publica', (req, res) => {
  try {
    const db = resolveDb(req);
    const options = buildOptions(req);
    const result = publishMonth(db, options);

    logAudit(db, {
      user_id: req.user?.id,
      username: req.user?.username,
      actiune: 'TRE_PUBLISH_MONTH',
      entitate: 'perioade',
      entitate_id: result.perioada_id,
      detalii: result,
      ip: req.ip
    });

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================================
//  5. GOL — ANULEAZĂ PUBLICAREA LUNII (GOL.PRG)
// ============================================================
router.post('/anuleaza-publicarea', (req, res) => {
  try {
    const db = resolveDb(req);
    const options = buildOptions(req);
    const result = unpublishMonth(db, options);

    logAudit(db, {
      user_id: req.user?.id,
      username: req.user?.username,
      actiune: 'GOL_UNPUBLISH_MONTH',
      entitate: 'perioade',
      entitate_id: result.perioada_id,
      detalii: result,
      ip: req.ip
    });

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================================
//  6. SLU — ÎNCHIDE LUNA ȘI TRECI LA URMĂTOAREA (SLU.PRG)
// ============================================================
router.post('/inchide', (req, res) => {
  try {
    const db = resolveDb(req);
    const options = {
      ...buildOptions(req),
      inchis_de: req.body?.inchis_de || req.user?.username || 'Administrator'
    };
    const result = closeMonth(db, options);

    logAudit(db, {
      user_id: req.user?.id,
      username: req.user?.username,
      actiune: 'SLU_CLOSE_MONTH',
      entitate: 'perioade',
      entitate_id: result.closed_period?.id,
      detalii: result,
      ip: req.ip
    });

    res.json({
      success: true,
      ...result,
      lunaVeche: result.closed_period.luna,
      anVechi: result.closed_period.an,
      nouaLuna: result.next_period.luna,
      noulAn: result.next_period.an,
      totalCheltuieli: result.publish_result?.totals?.total || 0,
      totalIncasat: 0
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================================
//  7. REDESCHIDE LUNA (RESTAURARE SNAPSHOT AUDITATĂ)
// ============================================================
router.post('/redeschide', (req, res) => {
  try {
    const db = resolveDb(req);
    const options = {
      ...buildOptions(req),
      username: req.body?.username || req.user?.username || 'Administrator'
    };
    const result = reopenMonth(db, options);

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
