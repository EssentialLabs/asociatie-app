/**
 * routes/operatiuni.js
 *
 * Express router for FoxPro Actualizare (A-R) operations & multi-tenant workspace management:
 * - ADG: GET/POST /perioade, PUT /perioade/:id/generale
 * - Feature 24: GET/POST /asociatii (clean multi-tenant workspace provisioning)
 * - ADA: PUT /asociatie/facturi (association-level invoices & settings)
 * - ADB & ADR: PUT /blocuri/:id/extins (block modes, percentages, thermal params, meters, invoices, address)
 * - APS, AIA, ARA, ADC: PUT /apartamente/:id/extins (reductions, 16%, 6 water meters + serials + metrology, heat meter, modes, 7 allocators, working fund, manual charges)
 * - ACA: GET/POST/DELETE /casa
 * - ABA: GET/POST/DELETE /banca
 * - APA: GET/POST/PUT/DELETE /patrimoniu
 * - ORD: GET/POST/DELETE /ordine-plata
 * - AVS, AVB, AVA: GET /audit/raw/:table
 * - REF: GET /admin/integrity
 */

const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { LUNI_RO, getAssociationLedgerSummary } = require('../services/ledger');
const { getLastDayOfMonthIso } = require('../services/lifecycle');
const { createAssociationWorkspace, logAudit } = require('../services/auth');
const { calculatePenalties } = require('../services/penalties');
const { round2 } = require('../engine/round');

function resolveDb(req) {
  return req.app?.locals?.db || getDb();
}

function resolveAsociatie(db, req) {
  const targetId = Number(req.body?.asociatie_id || req.query?.asociatie_id || req.asociatieId || 1);
  return (
    db.prepare('SELECT * FROM asociatie WHERE id = ?').get(targetId) ||
    db.prepare('SELECT * FROM asociatie ORDER BY id LIMIT 1').get() ||
    { id: 1, nume: 'ASOCIATIA TEST', luna_lucru: 9, an_lucru: 2026 }
  );
}

function resolveActivePeriod(db, req, explicitId = null) {
  if (explicitId && !Number.isNaN(Number(explicitId))) {
    const byId = db.prepare('SELECT * FROM perioade WHERE id = ?').get(Number(explicitId));
    if (byId) return byId;
  }
  const an = Number(req.body?.an || req.query?.an || 0);
  const luna = Number(req.body?.luna || req.query?.luna || 0);
  if (an && luna) {
    const byAnLuna = db.prepare('SELECT * FROM perioade WHERE an = ? AND luna = ?').get(an, luna);
    if (byAnLuna) return byAnLuna;
  }
  const asoc = resolveAsociatie(db, req);
  return (
    db.prepare('SELECT * FROM perioade WHERE an = ? AND luna = ?').get(asoc.an_lucru || 2026, asoc.luna_lucru || 9) ||
    db.prepare('SELECT * FROM perioade ORDER BY an DESC, luna DESC LIMIT 1').get()
  );
}

function normalizeBodyKeys(body = {}) {
  const out = {};
  for (const [k, v] of Object.entries(body || {})) {
    out[k.toLowerCase()] = v;
  }
  return out;
}

function hasTableColumn(db, table, col) {
  try {
    const cols = db.prepare(`PRAGMA table_info("${table}")`).all();
    return cols.some(c => c.name.toLowerCase() === col.toLowerCase());
  } catch (_) {
    return false;
  }
}

function isoToDdMmYyyy(isoStr) {
  const s = String(isoStr || '').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}.${m[2]}.${m[1]}`;
  return s;
}

function parseDateFormats(rawDate) {
  const s = String(rawDate || new Date().toISOString().slice(0, 10)).trim();
  const mRo = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (mRo) {
    return {
      isoDate: `${mRo[3]}-${mRo[2]}-${mRo[1]}`,
      ddMmYyyy: s
    };
  }
  const mIso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (mIso) {
    return {
      isoDate: `${mIso[1]}-${mIso[2]}-${mIso[3]}`,
      ddMmYyyy: `${mIso[3]}.${mIso[2]}.${mIso[1]}`
    };
  }
  const fallbackIso = new Date().toISOString().slice(0, 10);
  return {
    isoDate: fallbackIso,
    ddMmYyyy: isoToDdMmYyyy(fallbackIso)
  };
}

function computeApartmentMaxFr(r = {}) {
  return round2(
    Number(r.apa_rece || 0) +
    Number(r.can_mnj || 0) +
    Number(r.can_met || 0) +
    Number(r.apa_calda || 0) +
    Number(r.incalzire || 0) +
    Number(r.gaz || 0) +
    Number(r.gunoi || 0) +
    Number(r.curent || 0) +
    Number(r.ascensor || 0) +
    Number(r.sal_feme || 0) +
    Number(r.sal_tesa || 0) +
    Number(r.chelt_inc || 0) +
    Number(r.ch_admin || 0) +
    Number(r.ch_sediu || 0) +
    Number(r.prest_serv || 0) +
    Number(r.difarar || 0) +
    Number(r.altele || 0) +
    Number(r.difarac || 0) +
    Number(r.difcanar || 0) +
    Number(r.difcanac || 0) +
    Number(r.difetac || 0) +
    Number(r.difetin || 0) +
    Number(r.abonament || 0) +
    Number(r.ch_box || 0) +
    Number(r.ch_hav || 0) +
    Number(r.i || 0)
  );
}

// ============================================================
//  1. PERIOADE & DATE GENERALE (ADG.PRG)
// ============================================================
router.get('/perioade', (req, res) => {
  try {
    const db = resolveDb(req);
    const rows = db
      .prepare(`
        SELECT
          p.*,
          COALESCE(g.ultima_zi, p.ultima_zi) AS ultima_zi,
          COALESCE(g.tarif_ar, p.tarif_ar) AS tarif_ar,
          COALESCE(g.tarif_ca, p.tarif_ca) AS tarif_ca,
          COALESCE(g.proc_ca, p.proc_ca) AS proc_ca
        FROM perioade p
        LEFT JOIN general g ON g.an = p.an AND g.luna = p.luna
        ORDER BY p.an DESC, p.luna DESC, p.id DESC
      `)
      .all()
      .map(r => ({
        ...r,
        luna_nume: LUNI_RO[r.luna] || String(r.luna)
      }));
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/perioade', (req, res) => {
  try {
    const db = resolveDb(req);
    const b = normalizeBodyKeys(req.body);
    const asoc = resolveAsociatie(db, req);
    const an = Number(b.an || asoc.an_lucru || 2026);
    const luna = Number(b.luna || asoc.luna_lucru || 9);
    const ultimaZi = String(b.ultima_zi || getLastDayOfMonthIso(an, luna));
    const tarifAr = Number(b.tarif_ar ?? 9.48);
    const tarifCa = Number(b.tarif_ca ?? 9.67);
    const procCa = Number(b.proc_ca ?? 100);
    const tarifEt = Number(b.tarif_et ?? 0);
    const status = String(b.status || 'DESCHISA').toUpperCase();

    let period;
    const tx = db.transaction(() => {
      const existing = db.prepare('SELECT * FROM perioade WHERE an = ? AND luna = ?').get(an, luna);
      if (existing) {
        db.prepare(`
          UPDATE perioade
          SET ultima_zi = ?, tarif_ar = ?, tarif_ca = ?, proc_ca = ?, tarif_et = ?
          WHERE id = ?
        `).run(ultimaZi, tarifAr, tarifCa, procCa, tarifEt, existing.id);
        period = db.prepare('SELECT * FROM perioade WHERE id = ?').get(existing.id);
      } else {
        const info = db
          .prepare(`
            INSERT INTO perioade (asociatie_id, an, luna, status, ultima_zi, tarif_ar, tarif_ca, proc_ca, tarif_et)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(asoc.id, an, luna, status, ultimaZi, tarifAr, tarifCa, procCa, tarifEt);
        period = db.prepare('SELECT * FROM perioade WHERE id = ?').get(info.lastInsertRowid);
      }

      const existingGen = db.prepare('SELECT id FROM general WHERE an = ? AND luna = ?').get(an, luna);
      if (existingGen) {
        db.prepare(`
          UPDATE general
          SET perioada_id = ?, ultima_zi = ?, tarif_ar = ?, tarif_ca = ?, proc_ca = ?
          WHERE id = ?
        `).run(period.id, ultimaZi, tarifAr, tarifCa, procCa, existingGen.id);
      } else {
        db.prepare(`
          INSERT INTO general (perioada_id, an, luna, ultima_zi, tarif_ar, tarif_ca, proc_ca)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(period.id, an, luna, ultimaZi, tarifAr, tarifCa, procCa);
      }
    });

    tx();
    res.json({ success: true, id: period.id, period });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/perioade/:id/generale', (req, res) => {
  try {
    const db = resolveDb(req);
    const period = resolveActivePeriod(db, req, req.params.id);
    if (!period) {
      return res.status(404).json({ error: 'Perioada nu a fost găsită.' });
    }
    if (period.status === 'INCHISA' && !req.body?.force) {
      return res.status(400).json({ error: `Perioada ${period.luna}/${period.an} este ÎNCHISĂ și nu poate fi modificată.` });
    }

    const b = normalizeBodyKeys(req.body);
    const existingGen = db.prepare('SELECT * FROM general WHERE an = ? AND luna = ?').get(period.an, period.luna) || {};

    const ultimaZi = String(b.ultima_zi ?? existingGen.ultima_zi ?? period.ultima_zi ?? getLastDayOfMonthIso(period.an, period.luna));
    const tarifAr = Number(b.tarif_ar ?? existingGen.tarif_ar ?? period.tarif_ar ?? 0);
    const tarifCa = Number(b.tarif_ca ?? existingGen.tarif_ca ?? period.tarif_ca ?? 0);
    const procCa = Number(b.proc_ca ?? existingGen.proc_ca ?? period.proc_ca ?? 100);
    const tarifEt = Number(b.tarif_et ?? period.tarif_et ?? 0);

    const tx = db.transaction(() => {
      db.prepare(`
        UPDATE perioade
        SET ultima_zi = ?, tarif_ar = ?, tarif_ca = ?, proc_ca = ?, tarif_et = ?
        WHERE id = ?
      `).run(ultimaZi, tarifAr, tarifCa, procCa, tarifEt, period.id);

      if (existingGen.id) {
        db.prepare(`
          UPDATE general
          SET perioada_id = ?, ultima_zi = ?, tarif_ar = ?, tarif_ca = ?, proc_ca = ?
          WHERE id = ?
        `).run(period.id, ultimaZi, tarifAr, tarifCa, procCa, existingGen.id);
      } else {
        db.prepare(`
          INSERT INTO general (perioada_id, an, luna, ultima_zi, tarif_ar, tarif_ca, proc_ca)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(period.id, period.an, period.luna, ultimaZi, tarifAr, tarifCa, procCa);
      }

      logAudit(db, {
        user_id: req.user?.id,
        username: req.user?.username,
        actiune: 'ADG_UPDATE_GENERALE',
        entitate: 'perioade',
        entitate_id: period.id,
        detalii: { ultima_zi: ultimaZi, tarif_ar: tarifAr, tarif_ca: tarifCa, proc_ca: procCa, tarif_et: tarifEt },
        ip: req.ip
      });
    });

    tx();

    const updatedPeriod = db.prepare('SELECT * FROM perioade WHERE id = ?').get(period.id);
    const updatedGeneral = db.prepare('SELECT * FROM general WHERE an = ? AND luna = ?').get(period.an, period.luna);

    res.json({
      success: true,
      period: updatedPeriod,
      general: updatedGeneral
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================================
//  2. MULTI-TENANT ASOCIAȚII / AGENȚII (FEATURE 24)
// ============================================================
router.get('/asociatii', (req, res) => {
  try {
    const db = resolveDb(req);
    const rows = db
      .prepare(`
        SELECT
          a.*,
          (SELECT COUNT(*) FROM blocuri b WHERE b.asociatie_id = a.id) AS nr_blocuri,
          (SELECT COUNT(*) FROM apartamente ap JOIN blocuri b ON ap.bloc_id = b.id WHERE b.asociatie_id = a.id) AS nr_apartamente
        FROM asociatie a
        ORDER BY a.id ASC
      `)
      .all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/asociatii', (req, res) => {
  try {
    const db = resolveDb(req);
    const result = createAssociationWorkspace(db, {
      ...req.body,
      created_by: req.user?.username || 'superadmin'
    });
    res.status(201).json({
      success: true,
      ...result
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================================
//  3. ACTUALIZARE DATE ASOCIAȚIE & FACTURI (ADA.PRG)
// ============================================================
router.get('/asociatie/facturi', (req, res) => {
  try {
    const db = resolveDb(req);
    const asoc = resolveAsociatie(db, req);
    res.json(asoc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/asociatie/facturi', (req, res) => {
  try {
    const db = resolveDb(req);
    const asoc = resolveAsociatie(db, req);
    const b = normalizeBodyKeys(req.body);

    const allowedFields = [
      'apa_rece', 'can_met', 'apa_calda', 'etac', 'incalzire',
      'gunoi', 'ch_admin', 'sal_tesa', 'sal_feme', 'abonament',
      'ch_sediu', 'rulment', 'cota_fr',
      'nume', 'cod_fiscal', 'n_r_com', 'administrator', 'presedinte',
      'adresa', 'cod_postal', 'judet', 'cont_bancar', 'banca',
      'program', 'telefon', 'proc_penalizare', 'zile_penalizare',
      'serie_chitante', 'urmatorul_numar_chitanta', 'luna_lucru', 'an_lucru'
    ];

    const updates = [];
    const values = [];
    for (const col of allowedFields) {
      if (b[col] !== undefined) {
        updates.push(`${col} = ?`);
        values.push(b[col]);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Niciun câmp valid transmis pentru actualizarea asociației.' });
    }

    values.push(asoc.id);
    db.prepare(`UPDATE asociatie SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    logAudit(db, {
      user_id: req.user?.id,
      username: req.user?.username,
      actiune: 'ADA_UPDATE_ASOCIATIE',
      entitate: 'asociatie',
      entitate_id: asoc.id,
      detalii: req.body,
      ip: req.ip
    });

    const updated = db.prepare('SELECT * FROM asociatie WHERE id = ?').get(asoc.id);
    res.json({ success: true, asociatie: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================================
//  4. ACTUALIZARE DATE BLOCURI & ADRESE (ADB.PRG & ADR.PRG)
// ============================================================
router.post('/blocuri/batch-termic', (req, res) => {
  try {
    const db = resolveDb(req);
    const b = normalizeBodyKeys({ ...(req.query || {}), ...(req.body || {}) });
    const asoc = resolveAsociatie(db, req);

    const updates = [];
    const values = [];
    if (b.ecart_temp !== undefined && b.ecart_temp !== null && b.ecart_temp !== '') {
      updates.push('ecart_temp = ?');
      values.push(Number(b.ecart_temp));
    }
    if (b.rand_tr !== undefined && b.rand_tr !== null && b.rand_tr !== '') {
      updates.push('rand_tr = ?');
      values.push(Number(b.rand_tr));
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Specificați ecart_temp și/sau rand_tr pentru actualizare în masă.' });
    }

    const onlyHotWater =
      b.only_with_hot_water === false || b.only_with_hot_water === 'false' || b.only_with_hot_water === 0
        ? false
        : true;

    let sql = `UPDATE blocuri SET ${updates.join(', ')} WHERE (asociatie_id = ? OR (? = 1 AND asociatie_id IS NULL))`;
    values.push(asoc.id, asoc.id);

    if (onlyHotWater) {
      sql += ' AND COALESCE(proc_av_ac, 0) != 0';
    }

    const info = db.prepare(sql).run(...values);

    logAudit(db, {
      user_id: req.user?.id,
      username: req.user?.username,
      actiune: 'ADB_BATCH_TERMIC',
      entitate: 'blocuri',
      entitate_id: asoc.id,
      detalii: { ecart_temp: b.ecart_temp, rand_tr: b.rand_tr, only_with_hot_water: onlyHotWater, updatedCount: info.changes },
      ip: req.ip
    });

    res.json({
      success: true,
      updatedCount: info.changes,
      only_with_hot_water: onlyHotWater
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/blocuri/:id/extins', (req, res) => {
  try {
    const db = resolveDb(req);
    const idParam = req.params.id;
    const bloc =
      db.prepare('SELECT * FROM blocuri WHERE id = ?').get(idParam) ||
      db.prepare('SELECT * FROM blocuri WHERE bloc = ?').get(String(idParam).trim());
    if (!bloc) return res.status(404).json({ error: 'Bloc negăsit.' });
    res.json(bloc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/blocuri/:id/extins', (req, res) => {
  try {
    const db = resolveDb(req);
    const idParam = req.params.id;
    const existing =
      db.prepare('SELECT * FROM blocuri WHERE id = ?').get(idParam) ||
      db.prepare('SELECT * FROM blocuri WHERE bloc = ?').get(String(idParam).trim());

    if (!existing) {
      return res.status(404).json({ error: 'Bloc negăsit.' });
    }

    const b = normalizeBodyKeys(req.body);

    // Sync paired legacy / modern column names
    if (b.mod_r_dif !== undefined && b.mod_repartizare_dif === undefined) b.mod_repartizare_dif = b.mod_r_dif;
    if (b.mod_repartizare_dif !== undefined && b.mod_r_dif === undefined) b.mod_r_dif = b.mod_repartizare_dif;

    if (b.ivar !== undefined && b.index_vechi_ar === undefined) b.index_vechi_ar = b.ivar;
    if (b.index_vechi_ar !== undefined && b.ivar === undefined) b.ivar = b.index_vechi_ar;
    if (b.inar !== undefined && b.index_nou_ar === undefined) b.index_nou_ar = b.inar;
    if (b.index_nou_ar !== undefined && b.inar === undefined) b.inar = b.index_nou_ar;

    if (b.ivac !== undefined && b.index_vechi_ac === undefined) b.index_vechi_ac = b.ivac;
    if (b.index_vechi_ac !== undefined && b.ivac === undefined) b.ivac = b.index_vechi_ac;
    if (b.inac !== undefined && b.index_nou_ac === undefined) b.index_nou_ac = b.inac;
    if (b.index_nou_ac !== undefined && b.inac === undefined) b.inac = b.index_nou_ac;

    if (b.ivin !== undefined && b.index_vechi_in === undefined) b.index_vechi_in = b.ivin;
    if (b.index_vechi_in !== undefined && b.ivin === undefined) b.ivin = b.index_vechi_in;
    if (b.inin !== undefined && b.index_nou_in === undefined) b.index_nou_in = b.inin;
    if (b.index_nou_in !== undefined && b.inin === undefined) b.inin = b.index_nou_in;

    if (b.constin !== undefined && b.const_incalzire === undefined) b.const_incalzire = b.constin;
    if (b.const_incalzire !== undefined && b.constin === undefined) b.constin = b.const_incalzire;

    if (b.cod !== undefined && b.cod_postal === undefined) b.cod_postal = b.cod;
    if (b.cod_postal !== undefined && b.cod === undefined) b.cod = b.cod_postal;

    if (b.proc_sal_f !== undefined && b.proc_sal_femeie === undefined) b.proc_sal_femeie = b.proc_sal_f;
    if (b.proc_sal_femeie !== undefined && b.proc_sal_f === undefined) b.proc_sal_f = b.proc_sal_femeie;

    if (b.proc_sal_t !== undefined && b.proc_sal_tesa === undefined) b.proc_sal_tesa = b.proc_sal_t;
    if (b.proc_sal_tesa !== undefined && b.proc_sal_t === undefined) b.proc_sal_t = b.proc_sal_tesa;

    if (b.proc_abona !== undefined && b.proc_abonament === undefined) b.proc_abonament = b.proc_abona;
    if (b.proc_abonament !== undefined && b.proc_abona === undefined) b.proc_abona = b.proc_abonament;

    if (b.proc_chadm !== undefined && b.proc_ch_admin === undefined) b.proc_ch_admin = b.proc_chadm;
    if (b.proc_ch_admin !== undefined && b.proc_chadm === undefined) b.proc_chadm = b.proc_ch_admin;

    if (b.procgunoi !== undefined && b.proc_gunoi === undefined) b.proc_gunoi = b.procgunoi;
    if (b.proc_gunoi !== undefined && b.procgunoi === undefined) b.procgunoi = b.proc_gunoi;

    const allowedFields = [
      'bloc', 'strada', 'numar', 'cod', 'cod_postal',
      'total_apartamente', 'suprafata_totala',
      'mod_r_dif', 'mod_repartizare_dif', 'mod_r_inc', 'modr_difin', 'mod_r_asc',
      'procinccom', 'proc_chsed', 'proc_av_ac', 'proc_av_in',
      'proc_sal_f', 'proc_sal_femeie', 'proc_sal_t', 'proc_sal_tesa',
      'proc_abona', 'proc_abonament', 'proc_chadm', 'proc_ch_admin',
      'procgunoi', 'proc_gunoi',
      'cota_fond_reparatii', 'tarif_apa_rece', 'tarif_apa_calda', 'tarif_canal',
      'ivar', 'inar', 'index_vechi_ar', 'index_nou_ar',
      'ivac', 'inac', 'index_vechi_ac', 'index_nou_ac',
      'ivin', 'inin', 'index_vechi_in', 'index_nou_in',
      'constin', 'const_incalzire',
      'cp_ar', 'cp_ac', 'cp_in',
      'ecart_temp', 'rand_tr', 'tarif_et',
      'gaz', 'gunoi', 'curent', 'curent_sc', 'curent_li',
      'ascensor', 'sal_tesa', 'sal_feme', 'ch_admin', 'ch_sediu',
      'cota_fr', 'prest_serv', 'chelt_inc', 'abonament', 'can_met',
      'observatii'
    ];

    const updates = [];
    const values = [];
    for (const col of allowedFields) {
      if (b[col] !== undefined) {
        updates.push(`${col} = ?`);
        values.push(b[col]);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Niciun câmp valid transmis pentru actualizarea blocului.' });
    }

    values.push(existing.id);
    db.prepare(`UPDATE blocuri SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    logAudit(db, {
      user_id: req.user?.id,
      username: req.user?.username,
      actiune: 'ADB_UPDATE_BLOC',
      entitate: 'blocuri',
      entitate_id: existing.id,
      detalii: req.body,
      ip: req.ip
    });

    const updated = db.prepare('SELECT * FROM blocuri WHERE id = ?').get(existing.id);
    res.json({ success: true, bloc: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================================
//  5. ACTUALIZARE EXTINSĂ APARTAMENTE (APS, AIA, ARA, ADC)
// ============================================================
router.post('/apartamente/batch-inlocuire', (req, res) => {
  try {
    const db = resolveDb(req);
    const b = normalizeBodyKeys({ ...(req.query || {}), ...(req.body || {}) });
    const asoc = resolveAsociatie(db, req);

    if (b.fond_repar !== undefined && b.fond_reparatii === undefined) b.fond_reparatii = b.fond_repar;
    if (b.fond_reparatii !== undefined && b.fond_repar === undefined) b.fond_repar = b.fond_reparatii;

    const enabledMap = b.enabled && typeof b.enabled === 'object' ? normalizeBodyKeys(b.enabled) : null;
    const candidateCols = ['repar_crt', 'altele', 'i', 'fond_repar', 'fond_reparatii', 'ch_box', 'ch_hav'];

    const updates = [];
    const values = [];
    for (const col of candidateCols) {
      if (b[col] !== undefined && b[col] !== null && b[col] !== '') {
        if (enabledMap && enabledMap[col] === false) continue;
        if ((col === 'fond_repar' || col === 'fond_reparatii') && enabledMap) {
          if (enabledMap.fond_repar === false || enabledMap.fond_reparatii === false) continue;
        }
        updates.push(`${col} = ?`);
        values.push(Number(b[col]));
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Niciun câmp selectat pentru înlocuire (repar_crt, altele, i, fond_repar).' });
    }

    const scope = String(b.scope || (b.bloc_id || b.bloc ? 'BLOC' : 'TOATE')).toUpperCase();
    let sql = `UPDATE apartamente SET ${updates.join(', ')}`;

    if (scope === 'TOATE' || scope === 'ALL' || scope === 'ASOCIATIE') {
      sql += ' WHERE bloc_id IN (SELECT id FROM blocuri WHERE asociatie_id = ? OR (? = 1 AND asociatie_id IS NULL))';
      values.push(asoc.id, asoc.id);
    } else {
      const blocParam = b.bloc_id ?? b.bloc;
      const blocRow =
        db.prepare('SELECT * FROM blocuri WHERE id = ?').get(blocParam) ||
        db.prepare('SELECT * FROM blocuri WHERE bloc = ?').get(String(blocParam || '').trim());
      if (!blocRow) {
        return res.status(404).json({ error: 'Blocul selectat pentru înlocuire în masă nu a fost găsit.' });
      }
      sql += ' WHERE bloc_id = ?';
      values.push(blocRow.id);
    }

    const info = db.prepare(sql).run(...values);

    logAudit(db, {
      user_id: req.user?.id,
      username: req.user?.username,
      actiune: 'APS_BATCH_INLOCUIRE',
      entitate: 'apartamente',
      entitate_id: asoc.id,
      detalii: { scope, bloc_id: b.bloc_id, updatedCount: info.changes },
      ip: req.ip
    });

    res.json({
      success: true,
      updatedCount: info.changes,
      scope: scope === 'TOATE' ? 'TOATE' : 'BLOC'
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/apartamente/batch-max-fr', (req, res) => {
  try {
    const db = resolveDb(req);
    const b = normalizeBodyKeys({ ...(req.query || {}), ...(req.body || {}) });
    const asoc = resolveAsociatie(db, req);

    const refAn = Number(b.ref_an || b.an || 0);
    const refLuna = Number(b.ref_luna || b.luna || 0);
    if (!refAn || !refLuna) {
      return res.status(400).json({ error: 'Parametrii ref_an și ref_luna sunt obligatorii.' });
    }

    let targetBloc = null;
    const blocParam = b.bloc_id ?? b.bloc;
    if (blocParam !== undefined && blocParam !== null && blocParam !== '' && String(blocParam).toUpperCase() !== 'TOATE') {
      targetBloc =
        db.prepare('SELECT * FROM blocuri WHERE id = ?').get(blocParam) ||
        db.prepare('SELECT * FROM blocuri WHERE bloc = ?').get(String(blocParam).trim());
      if (!targetBloc) {
        return res.status(404).json({ error: 'Blocul specificat nu a fost găsit.' });
      }
    }

    // 1. Look up snapshot rows in apartamente_luna for (ref_an, ref_luna)
    let snapRows = targetBloc
      ? db
          .prepare('SELECT * FROM apartamente_luna WHERE an = ? AND luna = ? AND (bloc_id = ? OR bloc = ?)')
          .all(refAn, refLuna, targetBloc.id, targetBloc.bloc)
      : db
          .prepare(`
            SELECT al.*
            FROM apartamente_luna al
            LEFT JOIN blocuri bl ON bl.id = al.bloc_id
            WHERE al.an = ? AND al.luna = ?
              AND (bl.asociatie_id = ? OR (? = 1 AND (bl.asociatie_id IS NULL OR al.bloc_id IS NULL)))
          `)
          .all(refAn, refLuna, asoc.id, asoc.id);

    // 2. If no snapshot rows exist, check if (refAn, refLuna) matches the current open period AND use_current is explicitly requested or allowed
    const openPeriod = db
      .prepare("SELECT * FROM perioade WHERE an = ? AND luna = ? AND status = 'DESCHISA' AND (asociatie_id = ? OR ? = 1)")
      .get(refAn, refLuna, asoc.id, asoc.id);

    if (snapRows.length === 0) {
      if (openPeriod && b.use_current !== false && b.use_current !== 'false') {
        snapRows = targetBloc
          ? db
              .prepare(`
                SELECT a.*, a.id AS apartament_id, bl.bloc
                FROM apartamente a
                JOIN blocuri bl ON bl.id = a.bloc_id
                WHERE a.bloc_id = ?
              `)
              .all(targetBloc.id)
          : db
              .prepare(`
                SELECT a.*, a.id AS apartament_id, bl.bloc
                FROM apartamente a
                JOIN blocuri bl ON bl.id = a.bloc_id
                WHERE bl.asociatie_id = ? OR (? = 1 AND bl.asociatie_id IS NULL)
              `)
              .all(asoc.id, asoc.id);
      } else {
        return res.status(404).json({
          error: `Nu există date salvate (apartamente_luna) pentru perioada de referință ${refLuna}/${refAn}.`
        });
      }
    }

    const targetApartments = targetBloc
      ? db
          .prepare(`
            SELECT a.*, bl.bloc
            FROM apartamente a
            JOIN blocuri bl ON bl.id = a.bloc_id
            WHERE a.bloc_id = ?
            ORDER BY CAST(a.numar_apart AS INTEGER), a.numar_apart
          `)
          .all(targetBloc.id)
      : db
          .prepare(`
            SELECT a.*, bl.bloc
            FROM apartamente a
            JOIN blocuri bl ON bl.id = a.bloc_id
            WHERE bl.asociatie_id = ? OR (? = 1 AND bl.asociatie_id IS NULL)
            ORDER BY a.bloc_id, CAST(a.numar_apart AS INTEGER), a.numar_apart
          `)
          .all(asoc.id, asoc.id);

    let updatedCount = 0;
    const missingApartments = [];

    const updStmt = db.prepare('UPDATE apartamente SET max_fr = ?, max_fond_rulment = ? WHERE id = ?');

    const tx = db.transaction(() => {
      for (const apt of targetApartments) {
        const snap = snapRows.find(
          s =>
            (s.apartament_id && Number(s.apartament_id) === Number(apt.id)) ||
            (s.bloc_id && Number(s.bloc_id) === Number(apt.bloc_id) && String(s.numar_apart).trim() === String(apt.numar_apart).trim()) ||
            (String(s.bloc || '').trim() === String(apt.bloc || '').trim() && String(s.numar_apart).trim() === String(apt.numar_apart).trim())
        );

        if (snap) {
          const AA = computeApartmentMaxFr(snap);
          updStmt.run(AA, AA, apt.id);
          updatedCount++;
        } else {
          missingApartments.push({
            id: apt.id,
            bloc_id: apt.bloc_id,
            bloc: apt.bloc,
            numar_apart: apt.numar_apart
          });
        }
      }
    });

    tx();

    logAudit(db, {
      user_id: req.user?.id,
      username: req.user?.username,
      actiune: 'APS_BATCH_MAX_FR',
      entitate: 'apartamente',
      entitate_id: targetBloc?.id || asoc.id,
      detalii: { ref_an: refAn, ref_luna: refLuna, bloc_id: targetBloc?.id || null, updatedCount, missingCount: missingApartments.length },
      ip: req.ip
    });

    res.json({
      success: true,
      ref_an: refAn,
      ref_luna: refLuna,
      updatedCount,
      missingApartments
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

const EGALIZARE_INDEXURI_SQL = `
  UPDATE apartamente SET
    in_ar_bu = CASE WHEN COALESCE(iv_ar_bu, 0) != 0 THEN iv_ar_bu ELSE 0 END,
    in_ar_ba1 = CASE WHEN COALESCE(iv_ar_ba1, 0) != 0 THEN iv_ar_ba1 ELSE 0 END,
    in_ar_ba2 = CASE WHEN COALESCE(iv_ar_ba2, 0) != 0 THEN iv_ar_ba2 ELSE 0 END,
    in_ac_bu = CASE WHEN COALESCE(iv_ac_bu, 0) != 0 THEN iv_ac_bu ELSE 0 END,
    in_ac_ba1 = CASE WHEN COALESCE(iv_ac_ba1, 0) != 0 THEN iv_ac_ba1 ELSE 0 END,
    in_ac_ba2 = CASE WHEN COALESCE(iv_ac_ba2, 0) != 0 THEN iv_ac_ba2 ELSE 0 END,
    inin = CASE WHEN COALESCE(ivin, iv_incalzire, 0) != 0 THEN COALESCE(ivin, iv_incalzire, 0) ELSE 0 END,
    in_incalzire = CASE WHEN COALESCE(iv_incalzire, ivin, 0) != 0 THEN COALESCE(iv_incalzire, ivin, 0) ELSE 0 END
`;

router.post('/apartamente/batch-egalizare-indexuri', (req, res) => {
  try {
    const db = resolveDb(req);
    const b = normalizeBodyKeys({ ...(req.query || {}), ...(req.body || {}) });
    const asoc = resolveAsociatie(db, req);

    const blocParam = b.bloc_id ?? b.bloc;
    const scope = String(b.scope || (blocParam ? 'BLOC' : 'TOATE')).toUpperCase();

    let info;
    if (scope === 'TOATE' || scope === 'ALL' || !blocParam) {
      info = db
        .prepare(`${EGALIZARE_INDEXURI_SQL} WHERE bloc_id IN (SELECT id FROM blocuri WHERE asociatie_id = ? OR (? = 1 AND asociatie_id IS NULL))`)
        .run(asoc.id, asoc.id);
    } else {
      const blocRow =
        db.prepare('SELECT * FROM blocuri WHERE id = ?').get(blocParam) ||
        db.prepare('SELECT * FROM blocuri WHERE bloc = ?').get(String(blocParam).trim());
      if (!blocRow) {
        return res.status(404).json({ error: 'Blocul selectat nu a fost găsit.' });
      }
      info = db.prepare(`${EGALIZARE_INDEXURI_SQL} WHERE bloc_id = ?`).run(blocRow.id);
    }

    res.json({
      success: true,
      updatedCount: info.changes
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/apartamente/:id/egalizare-indexuri', (req, res) => {
  try {
    const db = resolveDb(req);
    const aptId = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM apartamente WHERE id = ?').get(aptId);
    if (!existing) {
      return res.status(404).json({ error: 'Apartament negăsit.' });
    }

    const info = db.prepare(`${EGALIZARE_INDEXURI_SQL} WHERE id = ?`).run(aptId);
    const updated = db.prepare('SELECT * FROM apartamente WHERE id = ?').get(aptId);

    res.json({
      success: true,
      updatedCount: info.changes,
      apartament: updated
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/apartamente/:id/extins', (req, res) => {
  try {
    const db = resolveDb(req);
    const apt = db.prepare('SELECT * FROM apartamente WHERE id = ?').get(req.params.id);
    if (!apt) return res.status(404).json({ error: 'Apartament negăsit.' });
    res.json(apt);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/apartamente/:id/extins', (req, res) => {
  try {
    const db = resolveDb(req);
    const existing = db.prepare('SELECT * FROM apartamente WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Apartament negăsit.' });
    }

    const b = normalizeBodyKeys(req.body);

    // ARA.PRG: Automatically calculate gcal_red from gcal_red_lei when tarif_et > 0
    if (b.gcal_red_lei !== undefined && b.gcal_red_lei !== null && b.gcal_red_lei !== '') {
      const blocRow = existing.bloc_id
        ? db.prepare('SELECT tarif_et FROM blocuri WHERE id = ?').get(existing.bloc_id)
        : null;
      const activePer = resolveActivePeriod(db, req, b.perioada_id);
      const tarifEt = Number(b.tarif_et || blocRow?.tarif_et || activePer?.tarif_et || 0);
      if (tarifEt > 0) {
        b.gcal_red = Number((Number(b.gcal_red_lei) / tarifEt).toFixed(4));
      }
    }

    // Map FoxPro meter shorthand names if provided
    const aliasPairs = [
      ['ivarbu', 'iv_ar_bu'], ['inarbu', 'in_ar_bu'],
      ['ivarba1', 'iv_ar_ba1'], ['inarba1', 'in_ar_ba1'],
      ['ivarba2', 'iv_ar_ba2'], ['inarba2', 'in_ar_ba2'],
      ['ivacbu', 'iv_ac_bu'], ['inacbu', 'in_ac_bu'],
      ['ivacba1', 'iv_ac_ba1'], ['inacba1', 'in_ac_ba1'],
      ['ivacba2', 'iv_ac_ba2'], ['inacba2', 'in_ac_ba2'],
      ['ivin', 'iv_incalzire'], ['inin', 'in_incalzire'],
      ['d_v_inin', 'd_v_in'], ['ser_inin', 'ser_in'],
      ['max_fr', 'max_fond_rulment'],
      ['fond_repar', 'fond_reparatii']
    ];
    for (const [k1, k2] of aliasPairs) {
      if (b[k1] !== undefined && b[k2] === undefined) b[k2] = b[k1];
      if (b[k2] !== undefined && b[k1] === undefined) b[k1] = b[k2];
    }

    const allowedFields = [
      'numar_apart', 'nume_proprietar', 'persoane', 'suprafata', 'sup_ec_ter', 'supr_redus',
      // Reductions (APS / TCE)
      'd1', 'd2', 'p1_scaz', 'p2_scaz', 'sl1_scaz', 'sl2_scaz', 'set_scaz',
      // 16 Percentages
      'proc_av_ac', 'proc_av_in', 'procg', 'procgunoi', 'procascens',
      'proc_cu_sc', 'proc_cu_li', 'proc_sal_f', 'proc_sal_t', 'proc_abona',
      'p_saltesa', 'p_presserv', 'proc_chadm', 'proc_difer', 'proc_difin', 'proc_chsed',
      // 6 Water meters + metrology dates + serials
      'iv_ar_bu', 'in_ar_bu', 'd_v_ar_bu', 'ser_ar_bu',
      'iv_ar_ba1', 'in_ar_ba1', 'd_v_ar_ba1', 'ser_ar_ba1',
      'iv_ar_ba2', 'in_ar_ba2', 'd_v_ar_ba2', 'ser_ar_ba2',
      'iv_ac_bu', 'in_ac_bu', 'd_v_ac_bu', 'ser_ac_bu',
      'iv_ac_ba1', 'in_ac_ba1', 'd_v_ac_ba1', 'ser_ac_ba1',
      'iv_ac_ba2', 'in_ac_ba2', 'd_v_ac_ba2', 'ser_ac_ba2',
      // Heat meter
      'ivin', 'inin', 'iv_incalzire', 'in_incalzire', 'constin',
      'd_v_in', 'ser_in', 'd_v_inin', 'ser_inin',
      // Meter modes
      'cp_ar', 'cp_ac', 'cp_in',
      // Allocator summary & correction
      'tot_unit', 'gcal_unit', 'gcal_mp', 'gcal_calc', 'gcal_red', 'gcal_final',
      // Working fund
      'max_fr', 'max_fond_rulment', 'calc_fr', 'plat_fr', 'rulment', 'fond_rulment_constituit',
      // Manual charges
      'fond_repar', 'fond_reparatii', 'fond_reparatii_constituit',
      'ch_box', 'ch_hav', 'repar_crt', 'altele', 'i',
      'restante', 'penalizari', 'observatii'
    ];

    for (let r = 1; r <= 7; r++) {
      allowedFields.push(`serie_r${r}`, `iv_r${r}`, `in_r${r}`, `facttr_r${r}`, `coefsp_r${r}`);
    }

    const updates = [];
    const values = [];
    for (const col of allowedFields) {
      if (b[col] !== undefined) {
        updates.push(`${col} = ?`);
        values.push(b[col]);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Niciun câmp valid transmis pentru actualizarea apartamentului.' });
    }

    values.push(existing.id);
    db.prepare(`UPDATE apartamente SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    logAudit(db, {
      user_id: req.user?.id,
      username: req.user?.username,
      actiune: 'APS_UPDATE_APARTAMENT',
      entitate: 'apartamente',
      entitate_id: existing.id,
      detalii: req.body,
      ip: req.ip
    });

    const updated = db.prepare('SELECT * FROM apartamente WHERE id = ?').get(existing.id);
    res.json({ success: true, apartament: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================================
//  6. REGISTRUL DE CASĂ (ACA.PRG)
// ============================================================
router.get('/casa', (req, res) => {
  try {
    const db = resolveDb(req);
    const { perioada_id, data, tip } = req.query;
    let sql = 'SELECT * FROM casa WHERE 1=1';
    const params = [];
    if (perioada_id) {
      sql += ' AND perioada_id = ?';
      params.push(Number(perioada_id));
    }
    if (data) {
      sql += ' AND data = ?';
      params.push(String(data));
    }
    if (tip) {
      sql += ' AND tip = ?';
      params.push(String(tip).toUpperCase());
    }
    sql += ' ORDER BY data ASC, id ASC';
    const rows = db.prepare(sql).all(...params).map(r => ({
      ...r,
      cheltuiala: r.cheltuiala ?? r.explicatie
    }));
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/casa/preia-incasari-zi', (req, res) => {
  try {
    const db = resolveDb(req);
    const b = normalizeBodyKeys({ ...(req.query || {}), ...(req.body || {}) });
    const asoc = resolveAsociatie(db, req);
    const activePer = resolveActivePeriod(db, req, b.perioada_id);

    const { isoDate, ddMmYyyy } = parseDateFormats(b.data);
    const overwrite =
      b.overwrite === false || b.overwrite === 'false' || b.overwrite === 0
        ? false
        : true;

    // Sum all active (non-cancelled) payments collected on `data`
    const platiRow = db
      .prepare(`
        SELECT ROUND(COALESCE(SUM(p.suma), 0), 2) AS sum_plati
        FROM plati p
        LEFT JOIN chitante c ON c.id = p.chitanta_id
        WHERE (p.data IN (?, ?) OR c.data_emiterii IN (?, ?))
          AND COALESCE(c.anulata, 0) = 0
      `)
      .get(isoDate, ddMmYyyy, isoDate, ddMmYyyy);

    const chitFaraPlatiRow = db
      .prepare(`
        SELECT ROUND(COALESCE(SUM(c.suma), 0), 2) AS sum_chit
        FROM chitante c
        WHERE c.data_emiterii IN (?, ?)
          AND COALESCE(c.anulata, 0) = 0
          AND NOT EXISTS (SELECT 1 FROM plati p WHERE p.chitanta_id = c.id)
      `)
      .get(isoDate, ddMmYyyy);

    const totalZi = round2(Number(platiRow?.sum_plati || 0) + Number(chitFaraPlatiRow?.sum_chit || 0));

    const expRo = `INCASARILE ZILEI DE ${ddMmYyyy}`;
    const expIso = `INCASARILE ZILEI DE ${isoDate}`;
    const hasChelt = hasTableColumn(db, 'casa', 'cheltuiala');

    const matchSql = hasChelt
      ? `SELECT * FROM casa WHERE UPPER(TRIM(COALESCE(explicatie, ''))) IN (?, ?) OR UPPER(TRIM(COALESCE(cheltuiala, ''))) IN (?, ?) ORDER BY id DESC`
      : `SELECT * FROM casa WHERE UPPER(TRIM(COALESCE(explicatie, ''))) IN (?, ?) ORDER BY id DESC`;
    const matchParams = hasChelt
      ? [expRo.toUpperCase(), expIso.toUpperCase(), expRo.toUpperCase(), expIso.toUpperCase()]
      : [expRo.toUpperCase(), expIso.toUpperCase()];

    const existingRows = db.prepare(matchSql).all(...matchParams);

    if (existingRows.length > 0 && overwrite === false) {
      const existingRow = {
        ...existingRows[0],
        cheltuiala: existingRows[0].cheltuiala ?? existingRows[0].explicatie
      };
      return res.json({
        alreadyExists: true,
        existingRow,
        suma: totalZi,
        data: isoDate
      });
    }

    let entry = null;
    const tx = db.transaction(() => {
      if (existingRows.length > 0) {
        const delStmt = db.prepare('DELETE FROM casa WHERE id = ?');
        for (const r of existingRows) {
          delStmt.run(r.id);
        }
      }

      if (hasChelt) {
        const info = db
          .prepare(`
            INSERT INTO casa (perioada_id, asoc, document, data, suma, tip, act_pas, explicatie, cheltuiala)
            VALUES (?, ?, 'INC-ZI', ?, ?, 'I', 'A', ?, ?)
          `)
          .run(activePer?.id || null, asoc.nume || 'ASOCIATIA TEST', isoDate, totalZi, expRo, expRo);
        entry = db.prepare('SELECT * FROM casa WHERE id = ?').get(info.lastInsertRowid);
      } else {
        const info = db
          .prepare(`
            INSERT INTO casa (perioada_id, asoc, document, data, suma, tip, act_pas, explicatie)
            VALUES (?, ?, 'INC-ZI', ?, ?, 'I', 'A', ?)
          `)
          .run(activePer?.id || null, asoc.nume || 'ASOCIATIA TEST', isoDate, totalZi, expRo);
        entry = db.prepare('SELECT * FROM casa WHERE id = ?').get(info.lastInsertRowid);
      }
    });

    tx();

    if (entry && entry.cheltuiala === undefined) {
      entry.cheltuiala = entry.explicatie;
    }

    res.json({
      success: true,
      alreadyExists: false,
      overwritten: existingRows.length > 0,
      data: isoDate,
      data_formatted: ddMmYyyy,
      suma: totalZi,
      id: entry?.id || null,
      entry,
      row: entry,
      ...(totalZi === 0 ? { message: 'Zero incasari in ziua selectata' } : {})
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/casa', (req, res) => {
  try {
    const db = resolveDb(req);
    const b = normalizeBodyKeys(req.body);
    const asoc = resolveAsociatie(db, req);
    const activePer = resolveActivePeriod(db, req, b.perioada_id);

    const suma = Number(b.suma ?? 0);
    if (!Number.isFinite(suma) || suma === 0) {
      return res.status(400).json({ error: 'Suma este obligatorie și trebuie să fie nenulă.' });
    }

    const data = String(b.data || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const rawTip = String(b.tip || b.inc_pla || 'I').toUpperCase();
    const tip = ['I', 'P', 'INCASARE', 'PLATA'].includes(rawTip)
      ? rawTip
      : rawTip.startsWith('P') ? 'P' : 'I';
    const actPas = String(b.act_pas || 'A').toUpperCase() === 'P' ? 'P' : 'A';
    const document = String(b.document || '');
    const explicatie = String(b.explicatie ?? b.cheltuiala ?? '');

    const hasChelt = hasTableColumn(db, 'casa', 'cheltuiala');
    const info = hasChelt
      ? db
          .prepare(`
            INSERT INTO casa (perioada_id, asoc, document, data, suma, tip, act_pas, explicatie, cheltuiala)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(activePer?.id || null, asoc.nume || 'ASOCIATIA TEST', document, data, suma, tip, actPas, explicatie, explicatie)
      : db
          .prepare(`
            INSERT INTO casa (perioada_id, asoc, document, data, suma, tip, act_pas, explicatie)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(activePer?.id || null, asoc.nume || 'ASOCIATIA TEST', document, data, suma, tip, actPas, explicatie);

    const entry = db.prepare('SELECT * FROM casa WHERE id = ?').get(info.lastInsertRowid);
    if (entry && entry.cheltuiala === undefined) entry.cheltuiala = entry.explicatie;
    res.status(201).json({ success: true, id: Number(info.lastInsertRowid), entry });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/casa/:id', (req, res) => {
  try {
    const db = resolveDb(req);
    const existing = db.prepare('SELECT * FROM casa WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Înregistrarea de casă nu a fost găsită.' });
    }

    const b = normalizeBodyKeys(req.body);
    if (b.cheltuiala !== undefined && b.explicatie === undefined) b.explicatie = String(b.cheltuiala);
    if (b.explicatie !== undefined && b.cheltuiala === undefined) b.cheltuiala = String(b.explicatie);
    if (b.inc_pla !== undefined && b.tip === undefined) b.tip = b.inc_pla;

    if (b.tip !== undefined) {
      const rawTip = String(b.tip).toUpperCase();
      b.tip = ['I', 'P', 'INCASARE', 'PLATA'].includes(rawTip)
        ? rawTip
        : rawTip.startsWith('P') ? 'P' : 'I';
    }
    if (b.act_pas !== undefined) {
      b.act_pas = String(b.act_pas).toUpperCase() === 'P' ? 'P' : 'A';
    }
    if (b.suma !== undefined) {
      const parsedSuma = Number(b.suma);
      if (b.suma === null || b.suma === '' || typeof b.suma === 'boolean' || !Number.isFinite(parsedSuma) || parsedSuma === 0) {
        return res.status(400).json({ error: 'Suma este obligatorie și trebuie să fie un număr nenul valid.' });
      }
      b.suma = parsedSuma;
    }
    if (b.data !== undefined) {
      b.data = String(b.data).slice(0, 10);
    }
    if (b.document !== undefined) {
      b.document = String(b.document);
    }

    const allowed = ['document', 'data', 'tip', 'act_pas', 'suma', 'explicatie'];
    if (hasTableColumn(db, 'casa', 'cheltuiala')) {
      allowed.push('cheltuiala');
    }

    const updates = [];
    const values = [];
    for (const col of allowed) {
      if (b[col] !== undefined) {
        updates.push(`${col} = ?`);
        values.push(b[col]);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Niciun câmp valid transmis pentru actualizarea înregistrării de casă.' });
    }

    values.push(existing.id);
    db.prepare(`UPDATE casa SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    const entry = db.prepare('SELECT * FROM casa WHERE id = ?').get(existing.id);
    if (entry && entry.cheltuiala === undefined) entry.cheltuiala = entry.explicatie;
    res.json({ success: true, id: existing.id, entry, row: entry });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/casa/:id', (req, res) => {
  try {
    const db = resolveDb(req);
    db.prepare('DELETE FROM casa WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================================
//  7. JURNAL BANCĂ (ABA.PRG)
// ============================================================
router.get('/banca', (req, res) => {
  try {
    const db = resolveDb(req);
    const { perioada_id, data, tip } = req.query;
    let sql = 'SELECT * FROM banca WHERE 1=1';
    const params = [];
    if (perioada_id) {
      sql += ' AND perioada_id = ?';
      params.push(Number(perioada_id));
    }
    if (data) {
      sql += ' AND data = ?';
      params.push(String(data));
    }
    if (tip) {
      sql += ' AND tip = ?';
      params.push(String(tip).toUpperCase());
    }
    sql += ' ORDER BY data ASC, id ASC';
    const rows = db.prepare(sql).all(...params).map(r => ({
      ...r,
      cheltuiala: r.cheltuiala ?? r.explicatie
    }));
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/banca', (req, res) => {
  try {
    const db = resolveDb(req);
    const b = normalizeBodyKeys(req.body);
    const asoc = resolveAsociatie(db, req);
    const activePer = resolveActivePeriod(db, req, b.perioada_id);

    const suma = Number(b.suma ?? 0);
    if (!Number.isFinite(suma) || suma === 0) {
      return res.status(400).json({ error: 'Suma operațiunii bancare este obligatorie.' });
    }

    const data = String(b.data || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const rawTip = String(b.tip || b.dep_vir || 'D').toUpperCase();
    const tip = ['D', 'V', 'DEPUNERE', 'VIRAMENT'].includes(rawTip)
      ? rawTip
      : rawTip.startsWith('V') ? 'V' : 'D';
    const actPas = String(b.act_pas || 'A').toUpperCase() === 'P' ? 'P' : 'A';
    const document = String(b.document || '');
    const explicatie = String(b.explicatie ?? b.cheltuiala ?? '');

    const hasChelt = hasTableColumn(db, 'banca', 'cheltuiala');
    const info = hasChelt
      ? db
          .prepare(`
            INSERT INTO banca (perioada_id, asoc, document, data, suma, tip, act_pas, explicatie, cheltuiala)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(activePer?.id || null, asoc.nume || 'ASOCIATIA TEST', document, data, suma, tip, actPas, explicatie, explicatie)
      : db
          .prepare(`
            INSERT INTO banca (perioada_id, asoc, document, data, suma, tip, act_pas, explicatie)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(activePer?.id || null, asoc.nume || 'ASOCIATIA TEST', document, data, suma, tip, actPas, explicatie);

    const entry = db.prepare('SELECT * FROM banca WHERE id = ?').get(info.lastInsertRowid);
    if (entry && entry.cheltuiala === undefined) entry.cheltuiala = entry.explicatie;
    res.status(201).json({ success: true, id: Number(info.lastInsertRowid), entry });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/banca/:id', (req, res) => {
  try {
    const db = resolveDb(req);
    const existing = db.prepare('SELECT * FROM banca WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Înregistrarea bancară nu a fost găsită.' });
    }

    const b = normalizeBodyKeys(req.body);
    if (b.cheltuiala !== undefined && b.explicatie === undefined) b.explicatie = String(b.cheltuiala);
    if (b.explicatie !== undefined && b.cheltuiala === undefined) b.cheltuiala = String(b.explicatie);
    if (b.dep_vir !== undefined && b.tip === undefined) b.tip = b.dep_vir;

    if (b.tip !== undefined) {
      const rawTip = String(b.tip).toUpperCase();
      b.tip = ['D', 'V', 'DEPUNERE', 'VIRAMENT'].includes(rawTip)
        ? rawTip
        : rawTip.startsWith('V') ? 'V' : 'D';
    }
    if (b.act_pas !== undefined) {
      b.act_pas = String(b.act_pas).toUpperCase() === 'P' ? 'P' : 'A';
    }
    if (b.suma !== undefined) {
      const parsedSuma = Number(b.suma);
      if (b.suma === null || b.suma === '' || typeof b.suma === 'boolean' || !Number.isFinite(parsedSuma) || parsedSuma === 0) {
        return res.status(400).json({ error: 'Suma operațiunii bancare trebuie să fie un număr nenul valid.' });
      }
      b.suma = parsedSuma;
    }
    if (b.data !== undefined) {
      b.data = String(b.data).slice(0, 10);
    }
    if (b.document !== undefined) {
      b.document = String(b.document);
    }

    const allowed = ['document', 'data', 'tip', 'act_pas', 'suma', 'explicatie'];
    if (hasTableColumn(db, 'banca', 'cheltuiala')) {
      allowed.push('cheltuiala');
    }

    const updates = [];
    const values = [];
    for (const col of allowed) {
      if (b[col] !== undefined) {
        updates.push(`${col} = ?`);
        values.push(b[col]);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Niciun câmp valid transmis pentru actualizarea înregistrării bancare.' });
    }

    values.push(existing.id);
    db.prepare(`UPDATE banca SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    const entry = db.prepare('SELECT * FROM banca WHERE id = ?').get(existing.id);
    if (entry && entry.cheltuiala === undefined) entry.cheltuiala = entry.explicatie;
    res.json({ success: true, id: existing.id, entry, row: entry });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/banca/:id', (req, res) => {
  try {
    const db = resolveDb(req);
    db.prepare('DELETE FROM banca WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================================
//  8. PATRIMONIU ACTIV / PASIV (APA.PRG)
// ============================================================
router.get('/patrimoniu', (req, res) => {
  try {
    const db = resolveDb(req);
    const { perioada_id, act_pas } = req.query;
    let sql = 'SELECT * FROM patrimoniu WHERE 1=1';
    const params = [];
    if (perioada_id) {
      sql += ' AND perioada_id = ?';
      params.push(Number(perioada_id));
    }
    if (act_pas) {
      sql += ' AND act_pas = ?';
      params.push(String(act_pas).toUpperCase());
    }
    sql += ' ORDER BY act_pas ASC, id ASC';
    res.json(db.prepare(sql).all(...params));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/patrimoniu/init-luna', (req, res) => {
  try {
    const db = resolveDb(req);
    const b = normalizeBodyKeys({ ...(req.query || {}), ...(req.body || {}) });
    const asoc = resolveAsociatie(db, req);
    const period0 = resolveActivePeriod(db, req, b.perioada_id);

    if (!period0) {
      return res.status(404).json({ error: 'Perioada țintă nu a fost găsită.' });
    }

    const overwrite =
      b.overwrite === false || b.overwrite === 'false' || b.overwrite === 0
        ? false
        : true;

    const existingCurrent = db
      .prepare('SELECT * FROM patrimoniu WHERE perioada_id = ? ORDER BY act_pas ASC, id ASC')
      .all(period0.id);

    if (existingCurrent.length > 0 && overwrite === false) {
      return res.json({
        alreadyInitialized: true,
        alreadyExists: true,
        count: existingCurrent.length,
        rows: existingCurrent
      });
    }

    const an0 = Number(period0.an);
    const luna0 = Number(period0.luna);
    const luna1 = luna0 === 1 ? 12 : luna0 - 1;
    const an1 = luna0 === 1 ? an0 - 1 : an0;
    const luna2 = luna1 === 1 ? 12 : luna1 - 1;
    const an2 = luna1 === 1 ? an1 - 1 : an1;

    const period1 = db.prepare('SELECT * FROM perioade WHERE an = ? AND luna = ?').get(an1, luna1);
    const period2 = db.prepare('SELECT * FROM perioade WHERE an = ? AND luna = ?').get(an2, luna2);

    const ultZi0Iso = String(period0.ultima_zi || getLastDayOfMonthIso(an0, luna0)).slice(0, 10);
    const ultZi1Iso = String(period1?.ultima_zi || getLastDayOfMonthIso(an1, luna1)).slice(0, 10);
    const ultZi2Iso = String(period2?.ultima_zi || getLastDayOfMonthIso(an2, luna2)).slice(0, 10);

    const ultZi0Ro = isoToDdMmYyyy(ultZi0Iso);
    const ultZi1Ro = isoToDdMmYyyy(ultZi1Iso);
    const ultZi2Ro = isoToDdMmYyyy(ultZi2Iso);

    const name0 = LUNI_RO[luna0] || '';
    const name1 = LUNI_RO[luna1] || '';
    const name2 = LUNI_RO[luna2] || '';

    function rollPerioada(raw) {
      const s = String(raw || '').trim();
      if (!s) return s;
      const up = s.toUpperCase();
      if (up === `${name1} ${an1}`) return `${name0} ${an0}`;
      if (up === name1) return name0;
      if (up === `${name2} ${an2}`) return `${name1} ${an1}`;
      if (up === name2) return name1;
      if (name1 && up.includes(name1)) {
        return up.replace(name1, name0).replace(String(an1), String(an0));
      }
      if (name2 && up.includes(name2)) {
        return up.replace(name2, name1).replace(String(an2), String(an1));
      }
      return s;
    }

    function rollDataPres(raw) {
      const s = String(raw || '').trim();
      if (!s) return s;
      const ym1 = `${an1}-${String(luna1).padStart(2, '0')}`;
      const ym2 = `${an2}-${String(luna2).padStart(2, '0')}`;
      const my1 = `.${String(luna1).padStart(2, '0')}.${an1}`;
      const my2 = `.${String(luna2).padStart(2, '0')}.${an2}`;

      if (s === ultZi1Iso || s.startsWith(ym1)) return ultZi0Iso;
      if (s === ultZi1Ro || s.endsWith(my1)) return ultZi0Ro;
      if (s === ultZi2Iso || s.startsWith(ym2)) return ultZi1Iso;
      if (s === ultZi2Ro || s.endsWith(my2)) return ultZi1Ro;
      return s;
    }

    // Find source rows from previous period (or fallback to existing/unscoped rows)
    let sourceRows = period1
      ? db.prepare('SELECT * FROM patrimoniu WHERE perioada_id = ? ORDER BY act_pas ASC, id ASC').all(period1.id)
      : [];

    if (sourceRows.length === 0) {
      const prevPerWithRows = db
        .prepare('SELECT perioada_id FROM patrimoniu WHERE perioada_id IS NOT NULL AND perioada_id != ? ORDER BY perioada_id DESC LIMIT 1')
        .get(period0.id);
      if (prevPerWithRows?.perioada_id) {
        sourceRows = db
          .prepare('SELECT * FROM patrimoniu WHERE perioada_id = ? ORDER BY act_pas ASC, id ASC')
          .all(prevPerWithRows.perioada_id);
      }
    }

    let copyFromExisting = false;
    if (sourceRows.length === 0) {
      if (existingCurrent.length > 0) {
        sourceRows = existingCurrent;
        copyFromExisting = true;
      } else {
        sourceRows = db
          .prepare('SELECT * FROM patrimoniu WHERE perioada_id IS NULL ORDER BY act_pas ASC, id ASC')
          .all();
      }
    }

    const tx = db.transaction(() => {
      if (existingCurrent.length > 0) {
        db.prepare('DELETE FROM patrimoniu WHERE perioada_id = ?').run(period0.id);
      }

      const insStmt = db.prepare(`
        INSERT INTO patrimoniu (perioada_id, asoc, document, data, suma, act_pas, explicatie, perioada, data_pres)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const r of sourceRows) {
        insStmt.run(
          period0.id,
          r.asoc || asoc.nume || 'ASOCIATIA TEST',
          String(r.document || ''),
          ultZi0Iso,
          Number(r.suma ?? 0),
          r.act_pas === 'P' ? 'P' : 'A',
          String(r.explicatie || ''),
          rollPerioada(r.perioada),
          rollDataPres(r.data_pres)
        );
      }
    });

    tx();

    const rows = db
      .prepare('SELECT * FROM patrimoniu WHERE perioada_id = ? ORDER BY act_pas ASC, id ASC')
      .all(period0.id);

    res.json({
      success: true,
      alreadyInitialized: false,
      overwritten: existingCurrent.length > 0 || copyFromExisting,
      perioada_id: period0.id,
      data: ultZi0Iso,
      count: rows.length,
      updatedCount: rows.length,
      rows
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/patrimoniu/batch-data', (req, res) => {
  try {
    const db = resolveDb(req);
    const b = normalizeBodyKeys({ ...(req.query || {}), ...(req.body || {}) });
    const activePer = resolveActivePeriod(db, req, b.perioada_id);

    if (!b.data) {
      return res.status(400).json({ error: 'Câmpul data este obligatoriu pentru schimbarea datei în masă.' });
    }

    const { isoDate } = parseDateFormats(b.data);

    let info;
    if (activePer?.id) {
      info = db
        .prepare('UPDATE patrimoniu SET data = ? WHERE perioada_id = ? OR perioada_id IS NULL')
        .run(isoDate, activePer.id);
    } else {
      info = db.prepare('UPDATE patrimoniu SET data = ?').run(isoDate);
    }

    const rows = activePer?.id
      ? db.prepare('SELECT * FROM patrimoniu WHERE perioada_id = ? OR perioada_id IS NULL ORDER BY act_pas ASC, id ASC').all(activePer.id)
      : db.prepare('SELECT * FROM patrimoniu ORDER BY act_pas ASC, id ASC').all();

    res.json({
      success: true,
      data: isoDate,
      updatedCount: info.changes,
      rows
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/patrimoniu', (req, res) => {
  try {
    const db = resolveDb(req);
    const b = normalizeBodyKeys(req.body);
    const asoc = resolveAsociatie(db, req);
    const activePer = resolveActivePeriod(db, req, b.perioada_id);

    const actPas = String(b.act_pas || 'A').toUpperCase() === 'P' ? 'P' : 'A';
    const suma = Number(b.suma ?? 0);
    const document = String(b.document || '');
    const data = String(b.data || '');
    const explicatie = String(b.explicatie || '');
    const perioada = String(b.perioada || '');
    const dataPres = String(b.data_pres || '');

    const info = db
      .prepare(`
        INSERT INTO patrimoniu (perioada_id, asoc, document, data, suma, act_pas, explicatie, perioada, data_pres)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(activePer?.id || null, asoc.nume || 'ASOCIATIA TEST', document, data, suma, actPas, explicatie, perioada, dataPres);

    const entry = db.prepare('SELECT * FROM patrimoniu WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json({ success: true, id: Number(info.lastInsertRowid), entry });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/patrimoniu/:id', (req, res) => {
  try {
    const db = resolveDb(req);
    const existing = db.prepare('SELECT * FROM patrimoniu WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Element patrimonial negăsit.' });

    const b = normalizeBodyKeys(req.body);
    const allowed = ['document', 'data', 'suma', 'act_pas', 'explicatie', 'perioada', 'data_pres'];
    const updates = [];
    const values = [];
    for (const col of allowed) {
      if (b[col] !== undefined) {
        updates.push(`${col} = ?`);
        values.push(col === 'act_pas' ? (String(b[col]).toUpperCase() === 'P' ? 'P' : 'A') : b[col]);
      }
    }
    if (updates.length === 0) return res.status(400).json({ error: 'Niciun câmp valid.' });

    values.push(existing.id);
    db.prepare(`UPDATE patrimoniu SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    const entry = db.prepare('SELECT * FROM patrimoniu WHERE id = ?').get(existing.id);
    res.json({ success: true, entry });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/patrimoniu/:id', (req, res) => {
  try {
    const db = resolveDb(req);
    db.prepare('DELETE FROM patrimoniu WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================================
//  9. ORDINE DE PLATĂ (ORD.PRG)
// ============================================================
router.get('/ordine-plata', (req, res) => {
  try {
    const db = resolveDb(req);
    const rows = db.prepare('SELECT * FROM ordine_plata ORDER BY numar DESC, id DESC').all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/ordine-plata', (req, res) => {
  try {
    const db = resolveDb(req);
    const b = normalizeBodyKeys(req.body);
    const asoc = resolveAsociatie(db, req);
    const activePer = resolveActivePeriod(db, req, b.perioada_id);

    const maxRow = db.prepare('SELECT COALESCE(MAX(numar), 0) AS max_nr FROM ordine_plata').get();
    const numar = Number(b.numar || (maxRow.max_nr + 1));
    const data = String(b.data || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const tipOrdin = String(b.tip_ordin || 'A');
    const suma = Number(b.suma ?? 0);

    const info = db
      .prepare(`
        INSERT INTO ordine_plata (
          perioada_id, numar, data, tip_ordin, suma,
          platitor1, platitor2, adrplat, codf_plat, cont_plat, banca_plat, filia_plat, bicp,
          beneficiar, cont_bene, banca_bene, filia_bene, bicb, adrben, codf_bene,
          reprez1, reprez2, reprez3
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        activePer?.id || null,
        numar,
        data,
        tipOrdin,
        suma,
        String(b.platitor1 ?? asoc.nume ?? ''),
        String(b.platitor2 ?? ''),
        String(b.adrplat ?? asoc.adresa ?? ''),
        String(b.codf_plat ?? asoc.cod_fiscal ?? ''),
        String(b.cont_plat ?? asoc.cont_bancar ?? ''),
        String(b.banca_plat ?? asoc.banca ?? ''),
        String(b.filia_plat ?? ''),
        String(b.bicp ?? ''),
        String(b.beneficiar ?? ''),
        String(b.cont_bene ?? ''),
        String(b.banca_bene ?? ''),
        String(b.filia_bene ?? ''),
        String(b.bicb ?? ''),
        String(b.adrben ?? ''),
        String(b.codf_bene ?? ''),
        String(b.reprez1 ?? b.explicatie ?? ''),
        String(b.reprez2 ?? ''),
        String(b.reprez3 ?? '')
      );

    const ordin = db.prepare('SELECT * FROM ordine_plata WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json({ success: true, id: Number(info.lastInsertRowid), ordin, entry: ordin });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/ordine-plata/:id', (req, res) => {
  try {
    const db = resolveDb(req);
    db.prepare('DELETE FROM ordine_plata WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================================
//  10. AUDIT DATE BRUTE (AVS / AVB / AVA)
// ============================================================
const ALLOWED_RAW_TABLES = {
  asociatie: 'asociatie',
  asoc: 'asociatie',
  avs: 'asociatie',
  blocuri: 'blocuri',
  avb: 'blocuri',
  apartamente: 'apartamente',
  apart: 'apartamente',
  ava: 'apartamente',
  datorii: 'datorii',
  plati: 'plati',
  chitante: 'chitante',
  perioade: 'perioade',
  general: 'general',
  apartamente_luna: 'apartamente_luna',
  blocuri_luna: 'blocuri_luna',
  asociatie_luna: 'asociatie_luna',
  casa: 'casa',
  banca: 'banca',
  patrimoniu: 'patrimoniu',
  ordine_plata: 'ordine_plata'
};

router.get('/audit/raw/:table', (req, res) => {
  try {
    const db = resolveDb(req);
    const key = String(req.params.table || '').toLowerCase();
    const tableName = ALLOWED_RAW_TABLES[key];
    if (!tableName) {
      return res.status(400).json({ error: `Tabelul "${req.params.table}" nu este permis pentru inspecție brută.` });
    }

    const limit = Math.min(5000, Math.max(1, Number(req.query.limit || 500)));
    const offset = Math.max(0, Number(req.query.offset || 0));
    const rows = db.prepare(`SELECT * FROM "${tableName}" LIMIT ? OFFSET ?`).all(limit, offset);
    const total = db.prepare(`SELECT COUNT(*) AS cnt FROM "${tableName}"`).get().cnt;

    res.json({
      table: tableName,
      total,
      count: rows.length,
      rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
//  11. VERIFICARE INTEGRITATE BAZĂ DE DATE (REF / REF_IND)
// ============================================================
router.get('/admin/integrity', (req, res) => {
  try {
    const db = resolveDb(req);
    const pragmaRes = db.pragma('integrity_check');
    const isOk = Array.isArray(pragmaRes) && pragmaRes.length === 1 && pragmaRes[0].integrity_check === 'ok';

    const orphanPayments = db
      .prepare(`
        SELECT COUNT(*) AS cnt
        FROM plati p
        LEFT JOIN datorii d ON d.id = p.datorie_id
        WHERE d.id IS NULL
      `)
      .get().cnt;

    const ledgerSummary = getAssociationLedgerSummary(db, req.asociatieId || 1);

    res.json({
      success: true,
      integrity_ok: isOk && orphanPayments === 0,
      pragma_integrity_check: pragmaRes,
      orphan_payments: orphanPayments,
      ledger_summary: ledgerSummary
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
//  12. ADEVERINȚĂ PLATĂ LA ZI / VÂNZARE APARTAMENT (ADE.PRG)
// ============================================================
router.get('/apartamente/:id/adeverinta', (req, res) => {
  try {
    const db = resolveDb(req);
    const aptId = Number(req.params.id);
    const apt = db
      .prepare(`
        SELECT a.*, b.bloc, b.strada, b.numar, b.asociatie_id
        FROM apartamente a
        JOIN blocuri b ON b.id = a.bloc_id
        WHERE a.id = ?
      `)
      .get(aptId);

    if (!apt) {
      return res.status(404).json({ error: 'Apartamentul nu a fost găsit.' });
    }

    const asoc = db.prepare('SELECT * FROM asociatie WHERE id = ?').get(apt.asociatie_id || 1) || {};
    const dataInr = String(req.query.data_inr || new Date().toISOString().slice(0, 10));
    const nrInr = Number(req.query.nr_inr || (apt.numar_apart * 10 + 1));
    const serv = String(req.query.serv || 'NOTAR PUBLIC, VANZARE APARTAMENT');

    // Calculate all unpaid principal
    const debtRows = db
      .prepare(`
        SELECT d.*,
               COALESCE((SELECT SUM(suma) FROM plati WHERE datorie_id = d.id), 0) AS achitat
        FROM datorii d
        WHERE d.apartament_id = ?
      `)
      .all(aptId);

    let restantaCurenta = 0;
    let restantaR = 0;
    let restantaF = 0;
    let restantaA = 0;
    let restantaP = 0;

    for (const d of debtRows) {
      const rest = round2(Number(d.valoare || 0) - Number(d.achitat || 0));
      if (rest > 0) {
        restantaCurenta = round2(restantaCurenta + rest);
        if (d.categorie === 'R') restantaR = round2(restantaR + rest);
        else if (d.categorie === 'F') restantaF = round2(restantaF + rest);
        else if (d.categorie === 'A') restantaA = round2(restantaA + rest);
        else if (d.categorie === 'P') restantaP = round2(restantaP + rest);
      }
    }

    // On-demand calculated penalties up to dataInr
    const penCalc = calculatePenalties(db, aptId, dataInr);
    const penalitatiCalculate = round2(penCalc.total_penalizare || 0);
    const totalDatorat = round2(restantaCurenta + penalitatiCalculate);
    const areDatorii = totalDatorat > 0;

    const adeverinta = {
      asociatie: {
        nume: asoc.nume || 'ASOCIATIA DE PROPRIETARI',
        cod_fiscal: asoc.cod_fiscal || '',
        adresa: asoc.adresa || '',
        oras: 'Alba Iulia',
        banca: asoc.banca || '',
        cont_bancar: asoc.cont_bancar || '',
        presedinte: asoc.presedinte || 'PRESEDINTE ASOCIATIE',
        administrator: asoc.administrator || 'ADMINISTRATOR'
      },
      apartament: {
        id: apt.id,
        numar: apt.numar_apart,
        proprietar: apt.nume_proprietar,
        bloc: apt.bloc,
        strada: apt.strada || 'Strada Principală',
        numar_imobil: apt.numar || ''
      },
      numar_inregistrare: nrInr,
      data_inregistrarii: dataInr,
      serviciu: serv,
      are_datorii: areDatorii,
      defalcare_datorii: {
        intretinere_regie: restantaR,
        fond_rulment: restantaF,
        fond_reparatii: restantaA,
        penalitati_inregistrate: restantaP,
        penalitati_calculate: penalitatiCalculate,
        total_datorat: totalDatorat
      },
      text_adeverinta: areDatorii
        ? `Prin prezenta se adeverește că domnul/doamna ${apt.nume_proprietar}, domiciliat(ă) în ${apt.strada || ''} nr. ${apt.numar || ''}, bl. ${apt.bloc}, ap. ${apt.numar_apart}, înregistrează către Asociația de Proprietari ${asoc.nume || ''} debite restante în sumă totală de ${totalDatorat.toFixed(2)} RON (din care regie/întreținere: ${restantaR.toFixed(2)} RON, fond rulment: ${restantaF.toFixed(2)} RON, fond reparații: ${restantaA.toFixed(2)} RON, penalități: ${(restantaP + penalitatiCalculate).toFixed(2)} RON).`
        : `Prin prezenta se adeverește că domnul/doamna ${apt.nume_proprietar}, domiciliat(ă) în ${apt.strada || ''} nr. ${apt.numar || ''}, bl. ${apt.bloc}, ap. ${apt.numar_apart}, nu are datorii la plata cheltuielilor de întreținere și a fondurilor către Asociația de Proprietari ${asoc.nume || ''} din care face parte imobilul. Menționăm că apa rece potabilă și gunoiul menajer pentru acest apartament se plătesc prin Asociația de Proprietari și nu sunt restanțe la plata acestor utilități.`,
      scop: `Se eliberează prezenta pentru a-i servi proprietarului la: ${serv}.`
    };

    res.json({ success: true, adeverinta });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
