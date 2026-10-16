/**
 * routes/rapoarte.js
 *
 * Express router for FoxPro Listare (16), Situații (17) & Centralizare (2) reports:
 * - GET /catalog (returns REPORT_CATALOG)
 * - GET /:code (generates report JSON or UTF-8 BOM CSV when ?format=csv)
 */

const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { REPORT_CATALOG, generateReport, reportToCsv } = require('../services/reports');

function resolveDb(req) {
  return req.app?.locals?.db || getDb();
}

function parseBoolParam(val) {
  if (val === undefined) return undefined;
  if (typeof val === 'boolean') return val;
  const s = String(val).trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'da' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'nu' || s === 'no') return false;
  return undefined;
}

router.get('/catalog', (_req, res) => {
  res.json(REPORT_CATALOG);
});

router.get('/:code', (req, res) => {
  try {
    const db = resolveDb(req);
    const options = {
      ...req.query,
      asociatie_id: req.query.asociatie_id || req.asociatieId || 1
    };

    const boolKeys = ['showNames', 'show_names', 'gdpr', 'includeZero', 'includeValid'];
    for (const k of boolKeys) {
      if (req.query[k] !== undefined) {
        options[k] = parseBoolParam(req.query[k]);
      }
    }

    const report = generateReport(db, req.params.code, options);

    if (String(req.query.format || '').toLowerCase() === 'csv') {
      const csv = reportToCsv(report);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="raport_${report.code}_${report.period?.an || 2026}_${report.period?.luna || 9}.csv"`
      );
      return res.send(csv);
    }

    res.json(report);
  } catch (err) {
    const status = /necunoscut/i.test(err.message) ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

module.exports = router;
