/**
 * routes/api.js
 *
 * Main API Router mounting:
 * - /auth (POST /login, POST /impersonate, GET /audit-logs, GET /me)
 * - /operatiuni (Actualizare A-R, multi-tenant workspaces, journals, audit, integrity)
 * - /calcul (TCE, CRE, SUM, TRE publica, GOL anuleaza-publicarea, SLU inchide, redeschide)
 * - /chitante (Ledger, Penalties, CHI individual, CHO colectiv, void)
 * - /rapoarte (Catalog + 35 FoxPro reports in JSON & CSV)
 * - Top-level convenience aliases (/luna/publica, /luna/anuleaza-publicarea, /luna/inchide, /luna/redeschide, /perioade, etc.)
 */

const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { loginUser, impersonateAssociation, logAudit } = require('../services/auth');
const { publishMonth, unpublishMonth, closeMonth, reopenMonth } = require('../services/lifecycle');
const { getApartmentLedger, getAssociationLedgerSummary } = require('../services/ledger');
const { calculatePenalties, bookPenalties } = require('../services/penalties');

const operatiuniRouter = require('./operatiuni');
const calculRouter = require('./calcul');
const chitanteRouter = require('./chitante');
const rapoarteRouter = require('./rapoarte');

function resolveDb(req) {
  return req.app?.locals?.db || getDb();
}

// ============================================================
//  AUTH ROUTES (/api/auth/*)
// ============================================================
router.post('/auth/login', (req, res) => {
  try {
    const db = resolveDb(req);
    const { username, password, role } = req.body || {};

    const rawUser = String(username || (role === 'admin' ? 'admin' : role) || '').trim();
    if (!rawUser) {
      return res.status(400).json({ error: 'Utilizatorul este obligatoriu.' });
    }

    // Support UI quickLogin({ role }) when no password is provided, or legacy demo passwords ('admin2026', 'admin123')
    let effectivePassword = password;
    if ((effectivePassword === undefined || effectivePassword === null || effectivePassword === '') && role) {
      effectivePassword = 'admin';
    }

    let authResult;
    try {
      authResult = loginUser(db, rawUser === 'administrator' ? 'admin' : rawUser, effectivePassword, req.ip);
    } catch (err) {
      // Allow legacy demo UI passwords 'admin2026' and 'admin123' for seeded accounts
      if (password === 'admin2026' || password === 'admin123') {
        authResult = loginUser(db, rawUser === 'administrator' ? 'admin' : rawUser, 'admin', req.ip);
      } else {
        throw err;
      }
    }

    res.json({
      success: true,
      token: authResult.token,
      user: {
        ...authResult.user,
        role: authResult.user.rol === 'administrator' ? 'admin' : authResult.user.rol,
        name: authResult.user.nume,
        canImpersonate: authResult.user.rol === 'superadmin'
      }
    });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

router.post('/auth/impersonate', (req, res) => {
  try {
    const db = resolveDb(req);
    const targetAsociatieId = Number(req.body?.asociatie_id || req.body?.asociatieId || 1);
    const result = impersonateAssociation(db, req.user, targetAsociatieId, req.ip);
    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/auth/audit-logs', (req, res) => {
  try {
    const db = resolveDb(req);
    const limit = Math.min(1000, Math.max(1, Number(req.query.limit || 100)));
    const rows = db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?').all(limit);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/auth/me', (req, res) => {
  res.json({
    user: req.user,
    asociatie_id: req.asociatieId
  });
});

// ============================================================
//  MODULAR SUB-ROUTERS
// ============================================================
router.use('/operatiuni', operatiuniRouter);
router.use('/calcul', calculRouter);
router.use('/chitante', chitanteRouter);
router.use('/rapoarte', rapoarteRouter);

// ============================================================
//  TOP-LEVEL CONVENIENCE ALIASES
// ============================================================

// Lifecycle aliases under /api/luna/*
router.post('/luna/publica', (req, res) => {
  try {
    const db = resolveDb(req);
    const options = {
      ...(req.query || {}),
      ...(req.body || {}),
      asociatie_id: req.body?.asociatie_id || req.query?.asociatie_id || req.asociatieId || 1
    };
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
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/luna/anuleaza-publicarea', (req, res) => {
  try {
    const db = resolveDb(req);
    const options = {
      ...(req.query || {}),
      ...(req.body || {}),
      asociatie_id: req.body?.asociatie_id || req.query?.asociatie_id || req.asociatieId || 1
    };
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
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/luna/inchide', (req, res) => {
  try {
    const db = resolveDb(req);
    const options = {
      ...(req.query || {}),
      ...(req.body || {}),
      asociatie_id: req.body?.asociatie_id || req.query?.asociatie_id || req.asociatieId || 1,
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

router.post('/luna/redeschide', (req, res) => {
  try {
    const db = resolveDb(req);
    const options = {
      ...(req.query || {}),
      ...(req.body || {}),
      asociatie_id: req.body?.asociatie_id || req.query?.asociatie_id || req.asociatieId || 1,
      username: req.body?.username || req.user?.username || 'Administrator'
    };
    const result = reopenMonth(db, options);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Top-level ledger & penalty aliases (/api/ledger/*, /api/penalitati/*)
router.get('/ledger/apartament/:id', (req, res) => {
  try {
    const db = resolveDb(req);
    const apartamentId = Number(req.params.id);
    const includePaid = req.query.includePaid === 'true' || req.query.include_paid === 'true';
    const ledger = getApartmentLedger(db, apartamentId, { includePaid });
    if (!ledger) return res.status(404).json({ error: 'Apartament negăsit.' });
    const targetDate = req.query.target_date || req.query.data || new Date().toISOString().slice(0, 10);
    const pen = calculatePenalties(db, apartamentId, targetDate, req.query);
    res.json({
      ...ledger,
      penalties_preview: {
        target_date: pen.target_date,
        proc_penal: pen.proc_penal,
        zile_penal: pen.zile_penal,
        hjkg: pen.hjkg,
        credit_suppressed: pen.credit_suppressed,
        total_penalizare: pen.total_penalizare,
        rows: pen.rows
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/ledger/sumar', (req, res) => {
  try {
    const db = resolveDb(req);
    const asociatieId = Number(req.query.asociatie_id || req.asociatieId || 1);
    const blocId = req.query.bloc_id ? Number(req.query.bloc_id) : null;
    res.json(getAssociationLedgerSummary(db, asociatieId, blocId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/penalitati/:apartamentId', (req, res) => {
  try {
    const db = resolveDb(req);
    const apartamentId = Number(req.params.apartamentId);
    const targetDate = req.query.target_date || req.query.data || new Date().toISOString().slice(0, 10);
    const pen = calculatePenalties(db, apartamentId, targetDate, req.query);
    res.json({
      apartament_id: pen.apartament_id ?? apartamentId,
      target_date: pen.target_date,
      proc_penal: pen.proc_penal,
      zile_penal: pen.zile_penal,
      hjkg: pen.hjkg,
      credit_suppressed: pen.credit_suppressed,
      total_penalizare: pen.total_penalizare,
      rows: pen.rows,
      items: pen.items
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/penalitati/:apartamentId/inregistreaza', (req, res) => {
  try {
    const db = resolveDb(req);
    const apartamentId = Number(req.params.apartamentId);
    const targetDate = req.body?.target_date || req.body?.data || req.query?.target_date || new Date().toISOString().slice(0, 10);
    const result = bookPenalties(db, apartamentId, targetDate, { ...(req.query || {}), ...(req.body || {}) });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Top-level aliases for operatiuni (/perioade, /asociatii, /casa, /banca, /patrimoniu, /ordine-plata, /blocuri/:id/extins, /apartamente/:id/extins, /asociatie/facturi)
router.use('/', operatiuniRouter);

module.exports = router;
