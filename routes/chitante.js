/**
 * routes/chitante.js
 *
 * Express router for FoxPro Centralizare & Casierie operations (CHI.PRG, CHO.FXP):
 * - GET /ledger/apartament/:id (getApartmentLedger + calculatePenalties preview)
 * - GET /ledger/sumar (getAssociationLedgerSummary)
 * - GET /fonduri-sumar/:apartamentId (getApartmentFundSummary: FNDRU, FNDRE, FNDPE, Regie)
 * - GET /penalitati/:apartamentId (calculatePenalties)
 * - POST /penalitati/:apartamentId/inregistreaza (bookPenalties)
 * - POST /individual & POST / (CHI: issueReceipt)
 * - POST /colectiv (CHO: issueCollectiveReceipt with mod_valoare & mod_numar)
 * - POST /:id/anuleaza (voidReceipt)
 * - POST /datorii (CHI: manual debt entry)
 * - PUT /datorii/:id (CHI: inline debt row edit)
 * - DELETE /datorii/:id (CHI: F5=Sterg debt row deletion)
 * - POST /datorii/:id/punnr (CHI: F1=PUNNR one-key stamp receipt on debt row)
 */

const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { getApartmentLedger, getAssociationLedgerSummary, LUNI_RO } = require('../services/ledger');
const { calculatePenalties, bookPenalties } = require('../services/penalties');
const {
  issueReceipt,
  issueCollectiveReceipt,
  updateDebtRow,
  deleteDebtRow,
  stampReceiptOnDebtRow,
  getApartmentFundSummary,
  voidReceipt,
  syncApartmentScalars
} = require('../services/cashier');
const { logAudit } = require('../services/auth');

function resolveDb(req) {
  return req.app?.locals?.db || getDb();
}

// ============================================================
//  0. LISTĂ CHITANȚE EMISE (GET /api/chitante)
// ============================================================
router.get('/', (req, res) => {
  try {
    const db = resolveDb(req);
    const { bloc_id, apartament_id, limit } = req.query;
    let sql = `
      SELECT
        c.*,
        COALESCE(a.nume_proprietar, c.nume_platitor) AS nume_proprietar,
        COALESCE(a.numar_apart, c.numar_apart) AS numar_apart,
        COALESCE(b.bloc, c.cod_bloc) AS cod_bloc
      FROM chitante c
      LEFT JOIN apartamente a ON c.apartament_id = a.id
      LEFT JOIN blocuri b ON c.bloc_id = b.id
      WHERE 1=1
    `;
    const params = [];
    if (bloc_id) {
      sql += ' AND c.bloc_id = ?';
      params.push(Number(bloc_id));
    }
    if (apartament_id) {
      sql += ' AND c.apartament_id = ?';
      params.push(Number(apartament_id));
    }
    sql += ' ORDER BY c.id DESC';
    if (limit) {
      sql += ' LIMIT ?';
      params.push(parseInt(limit, 10));
    } else {
      sql += ' LIMIT 100';
    }

    res.json(db.prepare(sql).all(...params));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
//  1. REGISTRUL DE DEBITE PE APARTAMENT + PREVIEW PENALITĂȚI
// ============================================================
router.get('/ledger/apartament/:id', (req, res) => {
  try {
    const db = resolveDb(req);
    const apartamentId = Number(req.params.id);
    const includePaid = req.query.includePaid === 'true' || req.query.include_paid === 'true';

    const ledger = getApartmentLedger(db, apartamentId, { includePaid });
    if (!ledger) {
      return res.status(404).json({ error: `Apartamentul #${apartamentId} nu a fost găsit.` });
    }

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

// ============================================================
//  2. SUMAR REGISTRU DATORII PE ASOCIAȚIE / BLOC
// ============================================================
router.get('/ledger/sumar', (req, res) => {
  try {
    const db = resolveDb(req);
    const asociatieId = Number(req.query.asociatie_id || req.asociatieId || 1);
    const blocId = req.query.bloc_id ? Number(req.query.bloc_id) : null;

    const summary = getAssociationLedgerSummary(db, asociatieId, blocId);
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
//  2b. SUMAR CUMULATIV FONDURI PE APARTAMENT (FNDRU, FNDRE, FNDPE)
// ============================================================
router.get('/fonduri-sumar/:apartamentId', (req, res) => {
  try {
    const db = resolveDb(req);
    const apartamentId = Number(req.params.apartamentId);
    const summary = getApartmentFundSummary(db, apartamentId);
    res.json(summary);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// ============================================================
//  3. CALCUL PENALITĂȚI LA ZI (CHI.PRG pen & Lpenal)
// ============================================================
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

// ============================================================
//  4. ÎNREGISTRARE IDEMPOTENTĂ PENALITĂȚI ÎN DATORII (CATEG. P)
// ============================================================
router.post('/penalitati/:apartamentId/inregistreaza', (req, res) => {
  try {
    const db = resolveDb(req);
    const apartamentId = Number(req.params.apartamentId);
    const targetDate =
      req.body?.target_date ||
      req.body?.data ||
      req.query?.target_date ||
      new Date().toISOString().slice(0, 10);

    const result = bookPenalties(db, apartamentId, targetDate, { ...(req.query || {}), ...(req.body || {}) });

    logAudit(db, {
      user_id: req.user?.id,
      username: req.user?.username,
      actiune: 'BOOK_PENALTIES',
      entitate: 'apartamente',
      entitate_id: apartamentId,
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
//  5. EMITERE CHITANȚĂ INDIVIDUALĂ (CHI.PRG)
// ============================================================
function handleIssueIndividual(req, res) {
  try {
    const db = resolveDb(req);
    const receipt = issueReceipt(db, req.body);

    logAudit(db, {
      user_id: req.user?.id,
      username: req.user?.username,
      actiune: 'CHI_ISSUE_RECEIPT',
      entitate: 'chitante',
      entitate_id: receipt.id,
      detalii: { serie: receipt.serie, numar: receipt.numar, suma: receipt.suma, apartament_id: receipt.apartament_id },
      ip: req.ip
    });

    res.json({
      success: true,
      chitanta: receipt,
      ...receipt
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

router.post('/individual', handleIssueIndividual);
router.post('/', handleIssueIndividual);

// ============================================================
//  6. EMITERE CHITANȚĂ COLECTIVĂ / DESCĂRCARE FOND (CHO.FXP)
// ============================================================
router.post('/colectiv', (req, res) => {
  try {
    const db = resolveDb(req);
    const result = issueCollectiveReceipt(db, req.body);

    logAudit(db, {
      user_id: req.user?.id,
      username: req.user?.username,
      actiune: 'CHO_ISSUE_COLLECTIVE_RECEIPT',
      entitate: 'chitante',
      entitate_id: result.id,
      detalii: result,
      ip: req.ip
    });

    res.json({
      success: true,
      chitanta: result,
      ...result
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================================
//  7. ANULARE CHITANȚĂ ȘI RESTAURARE SOLDURI
// ============================================================
router.post('/:id/anuleaza', (req, res) => {
  try {
    const db = resolveDb(req);
    const chitantaId = Number(req.params.id);
    const result = voidReceipt(db, chitantaId, {
      anulat_de: req.body?.anulat_de || req.user?.username || 'Administrator',
      motiv: req.body?.motiv || req.body?.motiv_anulare || 'Anulare chitanță'
    });

    logAudit(db, {
      user_id: req.user?.id,
      username: req.user?.username,
      actiune: 'VOID_RECEIPT',
      entitate: 'chitante',
      entitate_id: chitantaId,
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
//  8. ADĂUGARE / CORECTARE MANUALĂ DEBIT ÎN REGISTRU (CHI ADAUG)
// ============================================================
router.post('/datorii', (req, res) => {
  try {
    const db = resolveDb(req);
    const apartamentId = Number(req.body?.apartament_id || req.body?.apartamentId);
    const apt = db.prepare('SELECT * FROM apartamente WHERE id = ?').get(apartamentId);
    if (!apt) {
      return res.status(404).json({ error: 'Apartamentul nu a fost găsit.' });
    }

    const categorie = String(req.body?.categorie || 'R').toUpperCase();
    if (!['R', 'F', 'A', 'P'].includes(categorie)) {
      return res.status(400).json({ error: 'Categorie invalidă (trebuie să fie R, F, A sau P).' });
    }

    const valoare = Number(req.body?.valoare ?? req.body?.suma ?? 0);
    const an = Number(req.body?.an || 2026);
    const luna = Number(req.body?.luna || 9);
    const lunaText = LUNI_RO[luna] || String(luna);
    const explicatie = String(req.body?.explicatie || 'Ajustare manuală debit').trim();

    const info = db
      .prepare(`
        INSERT INTO datorii (apartament_id, bloc_id, an, luna, luna_text, categorie, valoare, sursa, explicatie)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'MANUAL', ?)
      `)
      .run(apt.id, apt.bloc_id, an, luna, lunaText, categorie, valoare, explicatie);

    syncApartmentScalars(db, apt.id);

    logAudit(db, {
      user_id: req.user?.id,
      username: req.user?.username,
      actiune: 'MANUAL_DEBT_ENTRY',
      entitate: 'datorii',
      entitate_id: Number(info.lastInsertRowid),
      detalii: { apartament_id: apt.id, an, luna, categorie, valoare, explicatie },
      ip: req.ip
    });

    const row = db.prepare('SELECT * FROM datorii WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json({ success: true, id: Number(info.lastInsertRowid), datorie: row });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================================
//  9. EDITARE INLINE RÂND DATORIE (CHI BROWSE EDIT)
// ============================================================
router.put('/datorii/:id', (req, res) => {
  try {
    const db = resolveDb(req);
    const datorieId = Number(req.params.id);
    const result = updateDebtRow(db, datorieId, req.body || {});

    logAudit(db, {
      user_id: req.user?.id,
      username: req.user?.username,
      actiune: 'UPDATE_DEBT_ROW',
      entitate: 'datorii',
      entitate_id: datorieId,
      detalii: result.datorie,
      ip: req.ip
    });

    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// ============================================================
//  10. ȘTERGERE RÂND DATORIE (CHI.PRG F5 = STERG)
// ============================================================
router.delete('/datorii/:id', (req, res) => {
  try {
    const db = resolveDb(req);
    const datorieId = Number(req.params.id);
    const force = req.query.force === 'true' || req.body?.force === true;
    const result = deleteDebtRow(db, datorieId, { force });

    logAudit(db, {
      user_id: req.user?.id,
      username: req.user?.username,
      actiune: 'DELETE_DEBT_ROW',
      entitate: 'datorii',
      entitate_id: datorieId,
      detalii: result,
      ip: req.ip
    });

    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// ============================================================
//  11. ȘTAMPILARE CHITANȚĂ PE RÂND DATORIE (CHI.PRG F1 = PUNNR)
// ============================================================
router.post('/datorii/:id/punnr', (req, res) => {
  try {
    const db = resolveDb(req);
    const datorieId = Number(req.params.id);
    const result = stampReceiptOnDebtRow(db, datorieId, req.body || {});

    logAudit(db, {
      user_id: req.user?.id,
      username: req.user?.username,
      actiune: 'CHI_PUNNR_STAMP',
      entitate: 'datorii',
      entitate_id: datorieId,
      detalii: {
        datorie_id: datorieId,
        chitanta_id: result.chitanta?.id,
        numar_chitanta: result.numar_chitanta,
        suma_achitata: result.suma_achitata,
        slot: result.slot
      },
      ip: req.ip
    });

    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

module.exports = router;
