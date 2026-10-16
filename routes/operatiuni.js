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

function resolveDb(req) {
  return req.app?.locals?.db || getDb();
}

function resolveAsociatie(db, req) {
  const targetId = Number(req.body?.asociatie_id || req.query?.asociatie_id || req.asociatieId || 1);
  return (
    db.prepare('SELECT * FROM asociatie WHERE id = ?').get(targetId) ||
    db.prepare('SELECT * FROM asociatie ORDER BY id LIMIT 1').get() ||
    { id: 1, nume: 'ORHIDEEA', luna_lucru: 9, an_lucru: 2026 }
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
  for (const [k, v] of Object.entries(body)) {
    out[k.toLowerCase()] = v;
  }
  return out;
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
    res.json(db.prepare(sql).all(...params));
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    const explicatie = String(b.explicatie || '');

    const info = db
      .prepare(`
        INSERT INTO casa (perioada_id, asoc, document, data, suma, tip, act_pas, explicatie)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(activePer?.id || null, asoc.nume || 'ORHIDEEA', document, data, suma, tip, actPas, explicatie);

    const entry = db.prepare('SELECT * FROM casa WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json({ success: true, id: Number(info.lastInsertRowid), entry });
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
    res.json(db.prepare(sql).all(...params));
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
    const explicatie = String(b.explicatie || '');

    const info = db
      .prepare(`
        INSERT INTO banca (perioada_id, asoc, document, data, suma, tip, act_pas, explicatie)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(activePer?.id || null, asoc.nume || 'ORHIDEEA', document, data, suma, tip, actPas, explicatie);

    const entry = db.prepare('SELECT * FROM banca WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json({ success: true, id: Number(info.lastInsertRowid), entry });
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
      .run(activePer?.id || null, asoc.nume || 'ORHIDEEA', document, data, suma, actPas, explicatie, perioada, dataPres);

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
    res.status(201).json({ success: true, id: Number(info.lastInsertRowid), ordin });
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

module.exports = router;
