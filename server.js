const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { getDb } = require('./db');
const { numarInLitere } = require('./numar-in-litere');
const { authMiddleware } = require('./services/auth');
const {
  JSONL_LOG_PATH,
  TEXT_LOG_PATH,
  ensureLogFiles,
  recordTelemetryError,
  apiErrorTelemetryMiddleware,
  readJsonlErrors
} = require('./services/telemetry');
const apiRouter = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

ensureLogFiles();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function resolveServerDb(req) {
  return req?.app?.locals?.db || getDb();
}

// Apply authentication & multi-tenant association scoping on all /api routes
app.use('/api', authMiddleware);

// Automatically log all >=400 API responses to logs/telemetry-errors.jsonl, .log, and SQLite
app.use('/api', apiErrorTelemetryMiddleware(resolveServerDb));

// Mount ORHIDEEA 2005 Parity modular API routes (/auth, /operatiuni, /calcul, /chitante, /rapoarte & aliases)
app.use('/api', apiRouter);

function resolveTargetAsociatie(db, req) {
  const targetId = Number(req.asociatieId || 1);
  return (
    db.prepare('SELECT * FROM asociatie WHERE id = ?').get(targetId) ||
    db.prepare('SELECT * FROM asociatie ORDER BY id LIMIT 1').get() ||
    {}
  );
}

// ============================================================
//  ASOCIATIE
// ============================================================
app.get('/api/asociatie', (req, res) => {
  const db = resolveServerDb(req);
  const row = resolveTargetAsociatie(db, req);
  res.json(row || {});
});

app.put('/api/asociatie', (req, res) => {
  const db = resolveServerDb(req);
  const currentAsoc = resolveTargetAsociatie(db, req);
  const targetId = currentAsoc.id || 1;
  const {
    nume, cod_fiscal, n_r_com, administrator, presedinte, adresa, cod_postal, judet,
    cont_bancar, banca, program, telefon,
    proc_penalizare, zile_penalizare, luna_lucru, an_lucru, serie_chitante, urmatorul_numar_chitanta, cota_fr,
    apa_rece, can_met, apa_calda, etac, incalzire, gunoi, ch_admin, sal_tesa, sal_feme, abonament, ch_sediu, rulment
  } = req.body;

  db.prepare(`
    UPDATE asociatie SET 
      nume = COALESCE(?, nume), 
      cod_fiscal = COALESCE(?, cod_fiscal),
      n_r_com = COALESCE(?, n_r_com),
      administrator = COALESCE(?, administrator), 
      presedinte = COALESCE(?, presedinte),
      adresa = COALESCE(?, adresa),
      cod_postal = COALESCE(?, cod_postal),
      judet = COALESCE(?, judet),
      cont_bancar = COALESCE(?, cont_bancar), 
      banca = COALESCE(?, banca),
      program = COALESCE(?, program),
      telefon = COALESCE(?, telefon),
      proc_penalizare = COALESCE(?, proc_penalizare), 
      zile_penalizare = COALESCE(?, zile_penalizare),
      luna_lucru = COALESCE(?, luna_lucru),
      an_lucru = COALESCE(?, an_lucru),
      serie_chitante = COALESCE(?, serie_chitante),
      urmatorul_numar_chitanta = COALESCE(?, urmatorul_numar_chitanta),
      cota_fr = COALESCE(?, cota_fr),
      apa_rece = COALESCE(?, apa_rece),
      can_met = COALESCE(?, can_met),
      apa_calda = COALESCE(?, apa_calda),
      etac = COALESCE(?, etac),
      incalzire = COALESCE(?, incalzire),
      gunoi = COALESCE(?, gunoi),
      ch_admin = COALESCE(?, ch_admin),
      sal_tesa = COALESCE(?, sal_tesa),
      sal_feme = COALESCE(?, sal_feme),
      abonament = COALESCE(?, abonament),
      ch_sediu = COALESCE(?, ch_sediu),
      rulment = COALESCE(?, rulment)
    WHERE id = ?
  `).run(
    nume ?? null, cod_fiscal ?? null, n_r_com ?? null, administrator ?? null, presedinte ?? null,
    adresa ?? null, cod_postal ?? null, judet ?? null, cont_bancar ?? null, banca ?? null,
    program ?? null, telefon ?? null, proc_penalizare ?? null, zile_penalizare ?? null,
    luna_lucru ?? null, an_lucru ?? null, serie_chitante ?? null, urmatorul_numar_chitanta ?? null, cota_fr ?? null,
    apa_rece ?? null, can_met ?? null, apa_calda ?? null, etac ?? null, incalzire ?? null,
    gunoi ?? null, ch_admin ?? null, sal_tesa ?? null, sal_feme ?? null, abonament ?? null, ch_sediu ?? null, rulment ?? null,
    targetId
  );
  res.json({ success: true, asociatie: db.prepare('SELECT * FROM asociatie WHERE id = ?').get(targetId) });
});

// ============================================================
//  BLOCURI
// ============================================================
app.get('/api/blocuri', (req, res) => {
  const db = resolveServerDb(req);
  const asocId = Number(req.asociatieId || 1);
  const rows = db.prepare(`
    SELECT b.*, 
      (SELECT COUNT(*) FROM apartamente a WHERE a.bloc_id = b.id) as nr_apartamente_actual,
      (SELECT COALESCE(SUM(a.persoane),0) FROM apartamente a WHERE a.bloc_id = b.id) as nr_persoane
    FROM blocuri b
    WHERE b.asociatie_id = ? OR (? = 1 AND b.asociatie_id IS NULL)
    ORDER BY b.bloc
  `).all(asocId, asocId);
  res.json(rows);
});

app.get('/api/blocuri/:id', (req, res) => {
  const db = resolveServerDb(req);
  const row = db.prepare(`
    SELECT b.*,
      (SELECT COUNT(*) FROM apartamente a WHERE a.bloc_id = b.id) as nr_apartamente_actual,
      (SELECT COALESCE(SUM(a.persoane),0) FROM apartamente a WHERE a.bloc_id = b.id) as nr_persoane
    FROM blocuri b WHERE b.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Bloc negăsit' });
  res.json(row);
});

app.post('/api/blocuri', (req, res) => {
  const db = resolveServerDb(req);
  const asocId = Number(req.asociatieId || 1);
  const { bloc, strada, numar, total_apartamente, suprafata_totala, cod, cod_postal } = req.body;
  if (!bloc) return res.status(400).json({ error: 'Numărul blocului este obligatoriu' });
  
  const existing = db.prepare('SELECT id FROM blocuri WHERE bloc = ?').get(bloc);
  if (existing) return res.status(400).json({ error: 'Blocul există deja' });

  const result = db.prepare(`
    INSERT INTO blocuri (asociatie_id, bloc, strada, numar, cod, cod_postal, total_apartamente, suprafata_totala)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(asocId, bloc, strada || '', numar || '', cod || cod_postal || '', cod_postal || cod || '', total_apartamente || 0, suprafata_totala || 0);
  
  res.json({ id: result.lastInsertRowid, success: true });
});

app.put('/api/blocuri/:id', (req, res) => {
  const db = resolveServerDb(req);
  const b = { ...req.body };
  const id = req.params.id;

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
  if (b.mod_r_dif !== undefined && b.mod_repartizare_dif === undefined) b.mod_repartizare_dif = b.mod_r_dif;
  if (b.mod_repartizare_dif !== undefined && b.mod_r_dif === undefined) b.mod_r_dif = b.mod_repartizare_dif;
  
  const allowedFields = [
    'bloc', 'strada', 'numar', 'cod', 'cod_postal', 'total_apartamente', 'suprafata_totala',
    'index_vechi_ar', 'index_nou_ar', 'ivar', 'inar',
    'index_vechi_ac', 'index_nou_ac', 'ivac', 'inac',
    'index_vechi_in', 'index_nou_in', 'ivin', 'inin',
    'const_incalzire', 'constin',
    'cp_ar', 'cp_ac', 'cp_in',
    'mod_repartizare_dif', 'mod_r_dif', 'mod_r_inc', 'modr_difin', 'mod_r_asc',
    'procinccom', 'proc_chsed', 'proc_av_ac', 'proc_av_in',
    'proc_sal_f', 'proc_sal_femeie', 'proc_sal_t', 'proc_sal_tesa',
    'proc_abona', 'proc_abonament', 'proc_chadm', 'proc_ch_admin',
    'procgunoi', 'proc_gunoi', 'cota_fond_reparatii',
    'tarif_apa_rece', 'tarif_apa_calda', 'tarif_canal',
    'ecart_temp', 'rand_tr', 'tarif_et',
    'gaz', 'gunoi', 'curent', 'curent_sc', 'curent_li',
    'ascensor', 'sal_tesa', 'sal_feme', 'ch_admin', 'ch_sediu',
    'cota_fr', 'prest_serv', 'chelt_inc', 'abonament', 'can_met', 'observatii'
  ];
  
  const updates = [];
  const values = [];
  for (const [key, val] of Object.entries(b)) {
    if (allowedFields.includes(key)) {
      updates.push(`${key} = ?`);
      values.push(val);
    }
  }
  
  if (updates.length === 0) return res.status(400).json({ error: 'Niciun câmp valid' });
  
  values.push(id);
  db.prepare(`UPDATE blocuri SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  res.json({ success: true, bloc: db.prepare('SELECT * FROM blocuri WHERE id = ?').get(id) });
});

app.delete('/api/blocuri/:id', (req, res) => {
  const db = resolveServerDb(req);
  db.prepare('DELETE FROM blocuri WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ============================================================
//  APARTAMENTE
// ============================================================
app.get('/api/blocuri/:blocId/apartamente', (req, res) => {
  const db = resolveServerDb(req);
  const rows = db.prepare(`
    SELECT * FROM apartamente 
    WHERE bloc_id = ? 
    ORDER BY CAST(numar_apart AS INTEGER), numar_apart
  `).all(req.params.blocId);
  res.json(rows);
});

app.post('/api/blocuri/:blocId/apartamente', (req, res) => {
  const db = resolveServerDb(req);
  const { numar_apart, nume_proprietar, persoane, suprafata, sup_ec_ter } = req.body;
  if (!numar_apart) return res.status(400).json({ error: 'Numărul apartamentului este obligatoriu' });

  const nrPersoane = persoane !== undefined && persoane !== null && persoane !== '' ? Number(persoane) : 0;

  const result = db.prepare(`
    INSERT INTO apartamente (bloc_id, numar_apart, nume_proprietar, persoane, suprafata, sup_ec_ter)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(req.params.blocId, numar_apart, nume_proprietar || '', nrPersoane, suprafata || 0, sup_ec_ter || 0);

  res.json({ id: result.lastInsertRowid, success: true });
});

app.put('/api/apartamente/:id', (req, res) => {
  const db = resolveServerDb(req);
  const fields = { ...req.body };
  const id = req.params.id;

  if (fields.ivin !== undefined && fields.iv_incalzire === undefined) fields.iv_incalzire = fields.ivin;
  if (fields.iv_incalzire !== undefined && fields.ivin === undefined) fields.ivin = fields.iv_incalzire;
  if (fields.inin !== undefined && fields.in_incalzire === undefined) fields.in_incalzire = fields.inin;
  if (fields.in_incalzire !== undefined && fields.inin === undefined) fields.inin = fields.in_incalzire;
  if (fields.max_fr !== undefined && fields.max_fond_rulment === undefined) fields.max_fond_rulment = fields.max_fr;
  if (fields.max_fond_rulment !== undefined && fields.max_fr === undefined) fields.max_fr = fields.max_fond_rulment;
  if (fields.fond_repar !== undefined && fields.fond_reparatii === undefined) fields.fond_reparatii = fields.fond_repar;
  if (fields.fond_reparatii !== undefined && fields.fond_repar === undefined) fields.fond_repar = fields.fond_reparatii;

  const allowedFields = [
    'numar_apart', 'nume_proprietar', 'persoane', 'suprafata', 'sup_ec_ter', 'supr_redus',
    'd1', 'd2', 'p1_scaz', 'p2_scaz', 'sl1_scaz', 'sl2_scaz', 'set_scaz',
    'proc_av_ac', 'proc_av_in', 'procg', 'procgunoi', 'procascens',
    'proc_cu_sc', 'proc_cu_li', 'proc_sal_f', 'proc_sal_t', 'proc_abona',
    'p_saltesa', 'p_presserv', 'proc_chadm', 'proc_difer', 'proc_difin', 'proc_chsed',
    'iv_ar_bu', 'in_ar_bu', 'd_v_ar_bu', 'ser_ar_bu',
    'iv_ar_ba1', 'in_ar_ba1', 'd_v_ar_ba1', 'ser_ar_ba1',
    'iv_ar_ba2', 'in_ar_ba2', 'd_v_ar_ba2', 'ser_ar_ba2',
    'iv_ac_bu', 'in_ac_bu', 'd_v_ac_bu', 'ser_ac_bu',
    'iv_ac_ba1', 'in_ac_ba1', 'd_v_ac_ba1', 'ser_ac_ba1',
    'iv_ac_ba2', 'in_ac_ba2', 'd_v_ac_ba2', 'ser_ac_ba2',
    'in_incalzire', 'iv_incalzire', 'inin', 'ivin', 'constin',
    'd_v_in', 'ser_in', 'd_v_inin', 'ser_inin',
    'cp_ar', 'cp_ac', 'cp_in',
    'serie_r1', 'iv_r1', 'in_r1', 'facttr_r1', 'coefsp_r1',
    'serie_r2', 'iv_r2', 'in_r2', 'facttr_r2', 'coefsp_r2',
    'serie_r3', 'iv_r3', 'in_r3', 'facttr_r3', 'coefsp_r3',
    'serie_r4', 'iv_r4', 'in_r4', 'facttr_r4', 'coefsp_r4',
    'serie_r5', 'iv_r5', 'in_r5', 'facttr_r5', 'coefsp_r5',
    'serie_r6', 'iv_r6', 'in_r6', 'facttr_r6', 'coefsp_r6',
    'serie_r7', 'iv_r7', 'in_r7', 'facttr_r7', 'coefsp_r7',
    'tot_unit', 'gcal_unit', 'gcal_mp', 'gcal_calc', 'gcal_red', 'gcal_final',
    'max_fond_rulment', 'max_fr', 'calc_fr', 'plat_fr', 'rulment',
    'fond_reparatii', 'fond_repar', 'restante', 'penalizari',
    'fond_rulment_constituit', 'fond_reparatii_constituit',
    'ch_box', 'ch_hav', 'repar_crt', 'altele', 'i', 'observatii'
  ];

  const updates = [];
  const values = [];
  for (const [key, val] of Object.entries(fields)) {
    if (allowedFields.includes(key)) {
      updates.push(`${key} = ?`);
      values.push(val);
    }
  }

  if (updates.length === 0) return res.status(400).json({ error: 'Niciun câmp valid' });

  values.push(id);
  db.prepare(`UPDATE apartamente SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  res.json({ success: true, apartament: db.prepare('SELECT * FROM apartamente WHERE id = ?').get(id) });
});

app.delete('/api/apartamente/:id', (req, res) => {
  const db = resolveServerDb(req);
  db.prepare('DELETE FROM apartamente WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ============================================================
//  FACTURI
// ============================================================
app.get('/api/facturi', (req, res) => {
  const db = getDb();
  const { bloc_id, luna, an } = req.query;
  let sql = `
    SELECT f.*, b.bloc as bloc_nume,
      (SELECT COUNT(*) FROM cheltuieli_apartament ca WHERE ca.factura_id = f.id) as nr_repartizari
    FROM facturi f 
    LEFT JOIN blocuri b ON f.bloc_id = b.id 
    WHERE 1=1
  `;
  const params = [];
  if (bloc_id) {
    sql += ' AND (f.bloc_id = ? OR f.bloc_id IS NULL)';
    params.push(bloc_id);
  }
  if (luna) {
    sql += ' AND f.luna = ?';
    params.push(luna);
  }
  if (an) {
    sql += ' AND f.an = ?';
    params.push(an);
  }
  sql += ' ORDER BY f.id DESC';
  
  res.json(db.prepare(sql).all(...params));
});

app.post('/api/facturi', (req, res) => {
  const db = getDb();
  const { bloc_id, luna, an, tip_factura, denumire, suma, mod_repartizare, data_factura, numar_factura, furnizor } = req.body;
  if (!tip_factura) return res.status(400).json({ error: 'Tipul facturii este obligatoriu' });
  if (!suma || suma <= 0) return res.status(400).json({ error: 'Suma trebuie să fie mai mare ca 0' });
  
  const result = db.prepare(`
    INSERT INTO facturi (bloc_id, luna, an, tip_factura, denumire, suma, mod_repartizare, data_factura, numar_factura, furnizor)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(bloc_id || null, luna || null, an || null, tip_factura, denumire || '', suma, mod_repartizare || 'PERSOANE', data_factura || null, numar_factura || '', furnizor || '');
  
  res.json({ id: result.lastInsertRowid, success: true });
});

app.delete('/api/facturi/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM cheltuieli_apartament WHERE factura_id = ?').run(req.params.id);
  db.prepare('DELETE FROM facturi WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ============================================================
//  REPARTIZARE FACTURI
// ============================================================
app.post('/api/facturi/:id/repartizeaza', (req, res) => {
  const db = getDb();
  const factura = db.prepare('SELECT * FROM facturi WHERE id = ?').get(req.params.id);
  if (!factura) return res.status(404).json({ error: 'Factură negăsită' });
  
  let apartamente;
  if (factura.bloc_id) {
    apartamente = db.prepare('SELECT * FROM apartamente WHERE bloc_id = ?').all(factura.bloc_id);
  } else {
    apartamente = db.prepare('SELECT * FROM apartamente').all();
  }
  
  if (apartamente.length === 0) {
    return res.status(400).json({ error: 'Nu există apartamente pentru repartizare' });
  }
  
  db.prepare('DELETE FROM cheltuieli_apartament WHERE factura_id = ?').run(factura.id);
  
  const repartizari = [];
  if (factura.mod_repartizare === 'PERSOANE') {
    const totalPersoane = apartamente.reduce((sum, a) => sum + (a.persoane || 1), 0);
    if (totalPersoane === 0) return res.status(400).json({ error: 'Totalul persoanelor este 0' });
    
    const costPerPersoana = factura.suma / totalPersoane;
    for (const ap of apartamente) {
      repartizari.push({
        factura_id: factura.id,
        apartament_id: ap.id,
        suma_repartizata: Math.round(costPerPersoana * (ap.persoane || 1) * 100) / 100
      });
    }
  } else {
    const totalSuprafata = apartamente.reduce((sum, a) => sum + (a.suprafata || 0), 0);
    if (totalSuprafata === 0) return res.status(400).json({ error: 'Suprafața totală este 0' });
    
    const costPerMp = factura.suma / totalSuprafata;
    for (const ap of apartamente) {
      repartizari.push({
        factura_id: factura.id,
        apartament_id: ap.id,
        suma_repartizata: Math.round(costPerMp * (ap.suprafata || 0) * 100) / 100
      });
    }
  }
  
  // Ajustare rotunjire
  const totalRepartizat = repartizari.reduce((s, r) => s + r.suma_repartizata, 0);
  const diferenta = Math.round((factura.suma - totalRepartizat) * 100) / 100;
  if (diferenta !== 0 && repartizari.length > 0) {
    repartizari[repartizari.length - 1].suma_repartizata += diferenta;
  }
  
  const insertStmt = db.prepare(`
    INSERT INTO cheltuieli_apartament (factura_id, apartament_id, suma_repartizata)
    VALUES (?, ?, ?)
  `);
  
  const insertMany = db.transaction((items) => {
    for (const item of items) {
      insertStmt.run(item.factura_id, item.apartament_id, item.suma_repartizata);
    }
  });
  
  insertMany(repartizari);
  res.json({ success: true, repartizari: repartizari.length });
});

app.get('/api/facturi/:id/repartizare', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT ca.*, a.numar_apart, a.nume_proprietar, a.persoane, a.suprafata, b.bloc
    FROM cheltuieli_apartament ca
    JOIN apartamente a ON ca.apartament_id = a.id
    JOIN blocuri b ON a.bloc_id = b.id
    WHERE ca.factura_id = ?
    ORDER BY b.bloc, CAST(a.numar_apart AS INTEGER)
  `).all(req.params.id);
  res.json(rows);
});

// ============================================================
//  REPARTIZARE DIFERENȚE DE APĂ (ECHIVALENT FOXPRO DIFARAR)
// ============================================================
app.post('/api/blocuri/:id/repartizeaza-diferente-apa', (req, res) => {
  const db = getDb();
  const bloc = db.prepare('SELECT * FROM blocuri WHERE id = ?').get(req.params.id);
  if (!bloc) return res.status(404).json({ error: 'Bloc negăsit' });

  const apartamente = db.prepare('SELECT * FROM apartamente WHERE bloc_id = ?').all(bloc.id);
  if (apartamente.length === 0) return res.status(400).json({ error: 'Blocul nu are apartamente' });

  const consumBloc = Math.max(0, (bloc.index_nou_ar || 0) - (bloc.index_vechi_ar || 0));
  
  let consumApartamente = 0;
  for (const ap of apartamente) {
    const cAp = Math.max(0, (ap.in_ar_bu - ap.iv_ar_bu) + (ap.in_ar_ba1 - ap.iv_ar_ba1) + (ap.in_ar_ba2 - ap.iv_ar_ba2));
    consumApartamente += cAp;
  }

  const difMc = Math.round((consumBloc - consumApartamente) * 100) / 100;
  const tarif = (bloc.tarif_apa_rece || 8.5) + (bloc.tarif_canal || 4.0);
  const valoareTotala = Math.max(0, Math.round(difMc * tarif * 100) / 100);

  const asoc = db.prepare('SELECT luna_lucru, an_lucru FROM asociatie LIMIT 1').get();
  const luna = asoc ? asoc.luna_lucru : 9;
  const an = asoc ? asoc.an_lucru : 2026;

  // Caută sau creează factura de diferențe
  let factura = db.prepare(`
    SELECT * FROM facturi 
    WHERE bloc_id = ? AND tip_factura = 'DIFERENTE_APA' AND luna = ? AND an = ?
  `).get(bloc.id, luna, an);

  const modRep = (bloc.cp_ar === 'P' || bloc.mod_repartizare_dif === 'PER') ? 'PERSOANE' : 'COTA_INDIVIZA';

  if (!factura) {
    const ins = db.prepare(`
      INSERT INTO facturi (bloc_id, luna, an, tip_factura, denumire, suma, mod_repartizare, data_factura)
      VALUES (?, ?, ?, 'DIFERENTE_APA', 'Diferențe contor general apă rece', ?, ?, date('now'))
    `).run(bloc.id, luna, an, valoareTotala, modRep);
    factura = { id: ins.lastInsertRowid, suma: valoareTotala, mod_repartizare: modRep };
  } else {
    db.prepare('UPDATE facturi SET suma = ?, mod_repartizare = ? WHERE id = ?').run(valoareTotala, modRep, factura.id);
    factura.suma = valoareTotala;
    factura.mod_repartizare = modRep;
  }

  // Șterge vechea repartizare
  db.prepare('DELETE FROM cheltuieli_apartament WHERE factura_id = ?').run(factura.id);

  // Repartizare pe apartamente
  const repartizari = [];
  if (modRep === 'PERSOANE') {
    const totPers = apartamente.reduce((s, a) => s + (a.persoane || 1), 0);
    const perPers = totPers > 0 ? valoareTotala / totPers : 0;
    apartamente.forEach(a => {
      repartizari.push({
        factura_id: factura.id,
        apartament_id: a.id,
        suma: Math.round(perPers * (a.persoane || 1) * 100) / 100
      });
    });
  } else {
    const totSup = apartamente.reduce((s, a) => s + (a.suprafata || 0), 0);
    const perMp = totSup > 0 ? valoareTotala / totSup : 0;
    apartamente.forEach(a => {
      repartizari.push({
        factura_id: factura.id,
        apartament_id: a.id,
        suma: Math.round(perMp * (a.suprafata || 0) * 100) / 100
      });
    });
  }

  // Rotunjire
  const totalRep = repartizari.reduce((s, r) => s + r.suma, 0);
  const dif = Math.round((valoareTotala - totalRep) * 100) / 100;
  if (dif !== 0 && repartizari.length > 0) {
    repartizari[repartizari.length - 1].suma += dif;
  }

  const insStmt = db.prepare('INSERT INTO cheltuieli_apartament (factura_id, apartament_id, suma_repartizata) VALUES (?, ?, ?)');
  const tx = db.transaction(items => {
    for (const it of items) insStmt.run(it.factura_id, it.apartament_id, it.suma);
  });
  tx(repartizari);

  res.json({
    success: true,
    consumBloc,
    consumApartamente: Math.round(consumApartamente * 100) / 100,
    diferentaMc: difMc,
    valoareTotala,
    modRepartizare: modRep
  });
});

// ============================================================
//  LISTA DE PLATĂ LUNARĂ (AVIZIER DE SCARĂ / ECHIVALENT LAR.PRG)
// ============================================================
app.get('/api/blocuri/:id/lista-plata', (req, res) => {
  const db = getDb();
  const bloc = db.prepare('SELECT * FROM blocuri WHERE id = ?').get(req.params.id);
  if (!bloc) return res.status(404).json({ error: 'Bloc negăsit' });

  const asoc = db.prepare('SELECT * FROM asociatie LIMIT 1').get() || {};
  const luna = req.query.luna ? parseInt(req.query.luna) : (asoc.luna_lucru || 9);
  const an = req.query.an ? parseInt(req.query.an) : (asoc.an_lucru || 2026);

  const NUME_LUNI = [
    '', 'IANUARIE', 'FEBRUARIE', 'MARTIE', 'APRILIE', 'MAI', 'IUNIE',
    'IULIE', 'AUGUST', 'SEPTEMBRIE', 'OCTOMBRIE', 'NOIEMBRIE', 'DECEMBRIE'
  ];

  const apartamente = db.prepare(`
    SELECT * FROM apartamente 
    WHERE bloc_id = ? 
    ORDER BY CAST(numar_apart AS INTEGER), numar_apart
  `).all(bloc.id);

  // Extrage repartizările de cheltuieli pentru acest bloc sau asociație
  const cheltuieliRows = db.prepare(`
    SELECT ca.apartament_id, ca.suma_repartizata, f.tip_factura, f.denumire
    FROM cheltuieli_apartament ca
    JOIN facturi f ON ca.factura_id = f.id
    WHERE (f.bloc_id = ? OR f.bloc_id IS NULL)
      AND (f.luna = ? OR f.luna IS NULL)
      AND (f.an = ? OR f.an IS NULL)
  `).all(bloc.id, luna, an);

  const cheltuieliMap = {};
  for (const ch of cheltuieliRows) {
    if (!cheltuieliMap[ch.apartament_id]) {
      cheltuieliMap[ch.apartament_id] = {
        gunoi: 0,
        lift: 0,
        curent_comun: 0,
        salarii_admin: 0,
        fond_reparatii: 0,
        diferente_apa: 0,
        incalzire: 0,
        altele: 0
      };
    }
    const tip = ch.tip_factura;
    const s = ch.suma_repartizata || 0;
    if (tip === 'GUNOI') cheltuieliMap[ch.apartament_id].gunoi += s;
    else if (tip === 'LIFT' || tip === 'CURENT_LIFT' || tip === 'ASCENSOR') cheltuieliMap[ch.apartament_id].lift += s;
    else if (tip === 'CURENT' || tip === 'CURENT_SCARA') cheltuieliMap[ch.apartament_id].curent_comun += s;
    else if (tip.includes('SALAR') || tip.includes('ADMIN') || tip === 'CH_SEDIU' || tip === 'ABONAMENT') cheltuieliMap[ch.apartament_id].salarii_admin += s;
    else if (tip === 'FOND_REPARATII' || tip === 'REPARATII') cheltuieliMap[ch.apartament_id].fond_reparatii += s;
    else if (tip === 'DIFERENTE_APA') cheltuieliMap[ch.apartament_id].diferente_apa += s;
    else if (tip === 'INCALZIRE' || tip === 'GAZ') cheltuieliMap[ch.apartament_id].incalzire += s;
    else cheltuieliMap[ch.apartament_id].altele += s;
  }

  const tarifAr = (bloc.tarif_apa_rece || 8.5) + (bloc.tarif_canal || 4.0);
  const tarifAc = (bloc.tarif_apa_calda || 18.0);

  const listaApartamente = [];
  const totaluri = {
    persoane: 0,
    suprafata: 0,
    consum_ar_mc: 0,
    valoare_ar: 0,
    diferente_apa: 0,
    valoare_ac: 0,
    incalzire: 0,
    gunoi: 0,
    lift: 0,
    curent_comun: 0,
    salarii_admin: 0,
    fond_reparatii: 0,
    altele: 0,
    total_luna: 0,
    restante: 0,
    penalizari: 0,
    total_general: 0
  };

  for (const ap of apartamente) {
    const ch = cheltuieliMap[ap.id] || {
      gunoi: 0, lift: 0, curent_comun: 0, salarii_admin: 0, fond_reparatii: 0, diferente_apa: 0, incalzire: 0, altele: 0
    };

    const cAr = Math.max(0, (ap.in_ar_bu - ap.iv_ar_bu) + (ap.in_ar_ba1 - ap.iv_ar_ba1) + (ap.in_ar_ba2 - ap.iv_ar_ba2));
    const cAc = Math.max(0, (ap.in_ac_bu - ap.iv_ac_bu) + (ap.in_ac_ba1 - ap.iv_ac_ba1) + (ap.in_ac_ba2 - ap.iv_ac_ba2));
    
    const valAr = Math.round(cAr * tarifAr * 100) / 100;
    const valAc = Math.round(cAc * tarifAc * 100) / 100;

    // Fond reparații din cota blocului dacă nu a fost introdusă factură
    let fondRep = ch.fond_reparatii;
    if (fondRep === 0 && bloc.cota_fond_reparatii > 0) {
      fondRep = Math.round((bloc.cota_fond_reparatii || 10) * 100) / 100;
    }

    const totalLuna = Math.round((
      valAr + ch.diferente_apa + valAc + ch.incalzire +
      ch.gunoi + ch.lift + ch.curent_comun + ch.salarii_admin + fondRep + ch.altele
    ) * 100) / 100;

    const restante = Math.round((ap.restante || 0) * 100) / 100;
    const penalizari = Math.round((ap.penalizari || 0) * 100) / 100;
    const totalGeneral = Math.round((totalLuna + restante + penalizari) * 100) / 100;

    const row = {
      id: ap.id,
      numar_apart: ap.numar_apart,
      nume_proprietar: ap.nume_proprietar,
      persoane: ap.persoane || 1,
      suprafata: ap.suprafata || 0,
      consum_ar_mc: Math.round(cAr * 100) / 100,
      valoare_ar: valAr,
      diferente_apa: ch.diferente_apa,
      valoare_ac: valAc,
      incalzire: ch.incalzire,
      gunoi: ch.gunoi,
      lift: ch.lift,
      curent_comun: ch.curent_comun,
      salarii_admin: ch.salarii_admin,
      fond_reparatii: fondRep,
      altele: ch.altele,
      total_luna: totalLuna,
      restante,
      penalizari,
      total_general: totalGeneral
    };

    listaApartamente.push(row);

    totaluri.persoane += row.persoane;
    totaluri.suprafata = Math.round((totaluri.suprafata + row.suprafata) * 100) / 100;
    totaluri.consum_ar_mc = Math.round((totaluri.consum_ar_mc + row.consum_ar_mc) * 100) / 100;
    totaluri.valoare_ar = Math.round((totaluri.valoare_ar + row.valoare_ar) * 100) / 100;
    totaluri.diferente_apa = Math.round((totaluri.diferente_apa + row.diferente_apa) * 100) / 100;
    totaluri.valoare_ac = Math.round((totaluri.valoare_ac + row.valoare_ac) * 100) / 100;
    totaluri.incalzire = Math.round((totaluri.incalzire + row.incalzire) * 100) / 100;
    totaluri.gunoi = Math.round((totaluri.gunoi + row.gunoi) * 100) / 100;
    totaluri.lift = Math.round((totaluri.lift + row.lift) * 100) / 100;
    totaluri.curent_comun = Math.round((totaluri.curent_comun + row.curent_comun) * 100) / 100;
    totaluri.salarii_admin = Math.round((totaluri.salarii_admin + row.salarii_admin) * 100) / 100;
    totaluri.fond_reparatii = Math.round((totaluri.fond_reparatii + row.fond_reparatii) * 100) / 100;
    totaluri.altele = Math.round((totaluri.altele + row.altele) * 100) / 100;
    totaluri.total_luna = Math.round((totaluri.total_luna + row.total_luna) * 100) / 100;
    totaluri.restante = Math.round((totaluri.restante + row.restante) * 100) / 100;
    totaluri.penalizari = Math.round((totaluri.penalizari + row.penalizari) * 100) / 100;
    totaluri.total_general = Math.round((totaluri.total_general + row.total_general) * 100) / 100;
  }

  res.json({
    asociatie: asoc,
    bloc,
    luna,
    lunaNume: NUME_LUNI[luna] || 'LUNA ' + luna,
    an,
    apartamente: listaApartamente,
    totaluri,
    tarife: { apa_rece: tarifAr, apa_calda: tarifAc }
  });
});

// ============================================================
//  CASIERIE & CHITANȚE (ECHIVALENT FOXPRO CHI.PRG)
// ============================================================
app.get('/api/chitante', (req, res) => {
  const db = getDb();
  const { bloc_id, limit } = req.query;
  let sql = `
    SELECT c.*, a.nume_proprietar, a.numar_apart, b.bloc as cod_bloc
    FROM chitante c
    JOIN apartamente a ON c.apartament_id = a.id
    JOIN blocuri b ON c.bloc_id = b.id
    WHERE 1=1
  `;
  const params = [];
  if (bloc_id) {
    sql += ' AND c.bloc_id = ?';
    params.push(bloc_id);
  }
  sql += ' ORDER BY c.id DESC';
  if (limit) {
    sql += ' LIMIT ?';
    params.push(parseInt(limit));
  } else {
    sql += ' LIMIT 100';
  }

  res.json(db.prepare(sql).all(...params));
});

app.post('/api/chitante', (req, res) => {
  const db = getDb();
  const { apartament_id, suma, explicatie, tip_plata, data_emiterii } = req.body;
  if (!apartament_id) return res.status(400).json({ error: 'Apartamentul este obligatoriu' });
  const sumaVal = parseFloat(suma);
  if (!sumaVal || sumaVal <= 0) return res.status(400).json({ error: 'Suma trebuie să fie pozitivă' });

  const ap = db.prepare(`
    SELECT a.*, b.bloc 
    FROM apartamente a 
    JOIN blocuri b ON a.bloc_id = b.id 
    WHERE a.id = ?
  `).get(apartament_id);
  if (!ap) return res.status(404).json({ error: 'Apartament negăsit' });

  const asoc = db.prepare('SELECT * FROM asociatie LIMIT 1').get() || {};
  const serie = asoc.serie_chitante || 'ORH';
  const numar = asoc.urmatorul_numar_chitanta || 1;
  const dataDoc = data_emiterii || new Date().toISOString().split('T')[0];
  const sumaInLitereText = numarInLitere(sumaVal);

  const ins = db.prepare(`
    INSERT INTO chitante (
      serie, numar, data_emiterii, apartament_id, bloc_id, 
      nume_platitor, numar_apart, cod_bloc, suma, suma_litere, 
      explicatie, tip_plata
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    serie, numar, dataDoc, ap.id, ap.bloc_id,
    ap.nume_proprietar, ap.numar_apart, ap.bloc,
    sumaVal, sumaInLitereText,
    explicatie || 'Cote întreținere', tip_plata || 'NUMERAR'
  );

  // Scade din datoriile apartamentului conform legii (penalizări -> restanțe)
  let restDeScazut = sumaVal;
  let noiPenalizari = ap.penalizari || 0;
  let noiRestante = ap.restante || 0;

  if (noiPenalizari > 0) {
    if (restDeScazut >= noiPenalizari) {
      restDeScazut -= noiPenalizari;
      noiPenalizari = 0;
    } else {
      noiPenalizari -= restDeScazut;
      restDeScazut = 0;
    }
  }

  if (restDeScazut > 0 && noiRestante > 0) {
    if (restDeScazut >= noiRestante) {
      restDeScazut -= noiRestante;
      noiRestante = 0;
    } else {
      noiRestante -= restDeScazut;
      restDeScazut = 0;
    }
  }

  db.prepare('UPDATE apartamente SET penalizari = ?, restante = ? WHERE id = ?')
    .run(Math.round(noiPenalizari * 100) / 100, Math.round(noiRestante * 100) / 100, ap.id);

  // Incrementează următorul număr chitanță
  db.prepare('UPDATE asociatie SET urmatorul_numar_chitanta = ? WHERE id = 1').run(numar + 1);

  const chitantaCreata = db.prepare('SELECT * FROM chitante WHERE id = ?').get(ins.lastInsertRowid);
  res.json({ success: true, chitanta: chitantaCreata });
});

app.post('/api/chitante/:id/anuleaza', (req, res) => {
  const db = getDb();
  const ch = db.prepare('SELECT * FROM chitante WHERE id = ?').get(req.params.id);
  if (!ch) return res.status(404).json({ error: 'Chitanță negăsită' });
  if (ch.anulata) return res.status(400).json({ error: 'Chitanța este deja anulată' });

  // Re-adaugă suma la restanțele apartamentului
  db.prepare('UPDATE apartamente SET restante = restante + ? WHERE id = ?').run(ch.suma, ch.apartament_id);
  db.prepare('UPDATE chitante SET anulata = 1 WHERE id = ?').run(ch.id);

  res.json({ success: true });
});

// ============================================================
//  SFÂRȘIT DE LUNĂ / TRECERE LUNA URMATOARE (ECHIVALENT SLU.PRG)
// ============================================================
app.post('/api/luna/inchide', (req, res) => {
  const db = getDb();
  const asoc = db.prepare('SELECT * FROM asociatie LIMIT 1').get() || {};
  const lunaCurenta = asoc.luna_lucru || 9;
  const anCurent = asoc.an_lucru || 2026;

  // Calculează totaluri lunare pentru istoric
  const totalCheltuieli = db.prepare('SELECT COALESCE(SUM(suma), 0) as tot FROM facturi WHERE luna = ? AND an = ?').get(lunaCurenta, anCurent).tot;
  const totalIncasat = db.prepare("SELECT COALESCE(SUM(suma), 0) as tot FROM chitante WHERE anulata = 0 AND strftime('%m', data_emiterii) = ?").get(String(lunaCurenta).padStart(2, '0')).tot;

  // Tranzacție de trecere la luna următoare (inspirată din SLU.PRG)
  const executeMonthEnd = db.transaction(() => {
    // 1. Rotește indecșii pe blocuri (index vechi devine index nou)
    db.prepare(`
      UPDATE blocuri SET
        index_vechi_ar = index_nou_ar,
        index_vechi_ac = index_nou_ac,
        index_vechi_in = index_nou_in
    `).run();

    // 2. Rotește indecșii pe apartamente
    db.prepare(`
      UPDATE apartamente SET
        iv_ar_bu = in_ar_bu,
        iv_ar_ba1 = in_ar_ba1,
        iv_ar_ba2 = in_ar_ba2,
        iv_ac_bu = in_ac_bu,
        iv_ac_ba1 = in_ac_ba1,
        iv_ac_ba2 = in_ac_ba2,
        iv_incalzire = in_incalzire,
        iv_r1 = in_r1,
        iv_r2 = in_r2,
        iv_r3 = in_r3,
        iv_r4 = in_r4,
        iv_r5 = in_r5,
        iv_r6 = in_r6,
        iv_r7 = in_r7
    `).run();

    // 3. Înregistrează în istoric_luni
    db.prepare(`
      INSERT INTO istoric_luni (luna, an, data_inchidere, total_calculat, total_incasat, observatii)
      VALUES (?, ?, date('now'), ?, ?, ?)
    `).run(lunaCurenta, anCurent, totalCheltuieli, totalIncasat, `Încheiată cu succes`);

    // 4. Avansare lună de lucru în asociație
    let nouaLuna = lunaCurenta + 1;
    let noulAn = anCurent;
    if (nouaLuna > 12) {
      nouaLuna = 1;
      noulAn += 1;
    }

    db.prepare('UPDATE asociatie SET luna_lucru = ?, an_lucru = ? WHERE id = 1').run(nouaLuna, noulAn);
    return { nouaLuna, noulAn };
  });

  const rez = executeMonthEnd();
  res.json({
    success: true,
    lunaVeche: lunaCurenta,
    anVechi: anCurent,
    nouaLuna: rez.nouaLuna,
    noulAn: rez.noulAn,
    totalCheltuieli,
    totalIncasat
  });
});

app.get('/api/luna/istoric', (req, res) => {
  const db = getDb();
  res.json(db.prepare('SELECT * FROM istoric_luni ORDER BY id DESC').all());
});

// ============================================================
//  GHID TRANZIȚIE FOXPRO
// ============================================================
app.get('/api/ghid', (req, res) => {
  res.json({
    titlu: 'Ghid de Utilizare și Tranziție de la FoxPro DOS la Aplicația Web',
    pasi: [
      {
        pas: 1,
        titlu: 'Introducerea Indecșilor Lunari',
        foxpro: 'Actualizare -> E) INDEXURI CONTOARE',
        web: 'Selectează blocul din stânga -> Tabul „💧 Indecși” -> introduci indecșii noi pentru bloc și apartamente -> apeși „Salvează Toți Indecșii”. Consumurile se calculează instant.'
      },
      {
        pas: 2,
        titlu: 'Repartizarea Diferențelor de Contor (Pierderi Apă)',
        foxpro: 'Calcul -> C) INSUMARE SI CALCUL (DIFARAR/DIFARAC)',
        web: 'În tabul „💧 Indecși”, apeși butonul „⚡ Calculează & Repartizează Diferențe Apă”. Sistemul compară contorul de bloc cu apometrele și repartizează diferența conform modului stabilit.'
      },
      {
        pas: 3,
        titlu: 'Introducerea Facturilor de Utilități',
        foxpro: 'Actualizare -> B/C) ACTUALIZARE DATE ASOCIATII / BLOCURI (Facturi)',
        web: 'Mergi în tabul „📑 Facturi & Cheltuieli” -> apeși „+ Adaugă Factură”. Alegi tipul (gunoi, lift, curent scară, etc.), suma și modul de repartizare (pe persoane sau suprafață), apoi apeși „Repartizează”.'
      },
      {
        pas: 4,
        titlu: 'Generarea și Tipărirea Listelor de Afișat (Avizier Scară)',
        foxpro: 'Listare -> D) LISTE DE AFISAT CU RESTANTE (LAR.PRG)',
        web: 'Dai click în meniul de sus pe „📋 Avizier / Listă Plată” -> alegi blocul -> vezi tabelul complet cu toate coloanele de cheltuieli -> apeși „🖨️ Tipărește Tabel Avizier (PDF)”. Formatul este optimizat pentru afișierul de scară.'
      },
      {
        pas: 5,
        titlu: 'Încasarea Banilor și Tăierea Chitanțelor',
        foxpro: 'Centralizare -> A) TAIE CHITANTE (CHI.PRG)',
        web: 'Dai click în meniul de sus pe „🧾 Încasări & Chitanțe” -> selectezi apartamentul -> vezi exact datoria totală (restanțe + penalități + întreținere) -> introduci suma primită -> apeși „Emite Chitanță”. Chitanța se numerotează automat, suma se scrie în litere și o poți tipări direct.'
      },
      {
        pas: 6,
        titlu: 'Sfârșit de Lună și Trecerea la Luna Următoare',
        foxpro: 'Actualizare -> L) SFARSIT DE LUNA (SLU.PRG)',
        web: 'Dai click în meniul de sus pe „📅 Sfârșit de Lună” -> verifici sumarul lunii -> apeși „Închide Luna și Treci la Următoarea”. Sistemul rotește automat indecșii (cei noi devin vechi), reportează sumele neachitate ca restanțe și trece la luna viitoare.'
      }
    ]
  });
});

// ============================================================
//  CONTROL TOWER (SUPERADMIN) & TELEMETRIE
// ============================================================
app.get('/api/control-tower/summary', (req, res) => {
  const db = resolveServerDb(req);
  const asoc = resolveTargetAsociatie(db, req);
  const asocId = asoc.id || 1;
  const blocuriCount = db.prepare('SELECT COUNT(*) as cnt FROM blocuri WHERE asociatie_id = ? OR (? = 1 AND asociatie_id IS NULL)').get(asocId, asocId).cnt;
  const apartamenteCount = db.prepare(`
    SELECT COUNT(*) as cnt FROM apartamente a
    JOIN blocuri b ON a.bloc_id = b.id
    WHERE b.asociatie_id = ? OR (? = 1 AND b.asociatie_id IS NULL)
  `).get(asocId, asocId).cnt;
  const errors = db.prepare('SELECT * FROM system_error_logs ORDER BY creat_la DESC LIMIT 20').all();

  res.json({
    platform: 'TEST ADMINISTRATORI',
    version: '2.5.0-Enterprise',
    environment: 'production-ready',
    uptime: process.uptime(),
    asociatie: asoc,
    stats: {
      total_blocuri: blocuriCount,
      total_apartamente: apartamenteCount,
      total_erori: errors.length
    },
    errors
  });
});

app.get('/api/telemetry/errors', (req, res) => {
  const db = resolveServerDb(req);
  const rows = db.prepare('SELECT * FROM system_error_logs ORDER BY creat_la DESC LIMIT 100').all();
  res.json(rows);
});

app.post('/api/telemetry/errors', (req, res) => {
  const db = resolveServerDb(req);
  const { platforma, mesaj, stack, url, method, status, context, severity } = req.body || {};
  const recorded = recordTelemetryError(db, {
    platforma: platforma || 'frontend-web',
    severity: severity || 'ERROR',
    method: method || null,
    url: url || null,
    status: status || null,
    asociatie_id: req.asociatieId || 1,
    user: req.user?.username || 'operator',
    mesaj: mesaj || 'Eroare raportată din interfață',
    stack: stack || '',
    context: context || null
  });
  res.json({ id: recorded.id, success: true, entry: recorded.entry });
});

app.post('/api/telemetry/errors/test', (req, res) => {
  const db = resolveServerDb(req);
  const recorded = recordTelemetryError(db, {
    platforma: 'telemetry-self-test',
    severity: 'TEST',
    method: 'POST',
    url: '/api/telemetry/errors/test',
    status: 500,
    asociatie_id: req.asociatieId || 1,
    user: req.user?.username || 'tester',
    mesaj: req.body?.mesaj || 'Eroare de test generată intenționat pentru verificarea fișierului de telemetrie (.jsonl / .log)',
    stack: new Error('SimulatedTelemetryTestError: Verificare salvare în logs/telemetry-errors.jsonl').stack,
    context: { note: 'Generat din butonul de test Telemetrie pentru audit AI' }
  });
  res.json({ success: true, id: recorded.id, entry: recorded.entry, logFile: 'logs/telemetry-errors.jsonl' });
});

app.get('/api/telemetry/errors/download', (req, res) => {
  ensureLogFiles();
  const format = String(req.query.format || 'jsonl').toLowerCase();
  if (format === 'log' || format === 'txt') {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="telemetry-errors.log"');
    return res.send(fs.existsSync(TEXT_LOG_PATH) ? fs.readFileSync(TEXT_LOG_PATH, 'utf8') : '');
  }
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="telemetry-errors.jsonl"');
  return res.send(fs.existsSync(JSONL_LOG_PATH) ? fs.readFileSync(JSONL_LOG_PATH, 'utf8') : '');
});

app.post('/api/telemetry/errors/:id/resolve', (req, res) => {
  const db = resolveServerDb(req);
  db.prepare('UPDATE system_error_logs SET rezolvat = 1 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ============================================================
//  SALVARE / BACKUP DATE (ECHIVALENT SAL.PRG)
// ============================================================
app.get('/api/operatiuni/backup/download', (req, res) => {
  const db = resolveServerDb(req);
  const asocId = Number(req.asociatieId || 1);
  const backup = {
    exported_at: new Date().toISOString(),
    asociatie_id: asocId,
    asociatie: db.prepare('SELECT * FROM asociatie WHERE id = ?').get(asocId),
    perioade: db.prepare('SELECT * FROM perioade WHERE asociatie_id = ? OR (? = 1 AND asociatie_id IS NULL)').all(asocId, asocId),
    blocuri: db.prepare('SELECT * FROM blocuri WHERE asociatie_id = ? OR (? = 1 AND asociatie_id IS NULL)').all(asocId, asocId),
    apartamente: db.prepare(`
      SELECT a.* FROM apartamente a
      JOIN blocuri b ON a.bloc_id = b.id
      WHERE b.asociatie_id = ? OR (? = 1 AND b.asociatie_id IS NULL)
    `).all(asocId, asocId),
    chitante: db.prepare('SELECT * FROM chitante ORDER BY id DESC LIMIT 500').all(),
    telemetry_errors: readJsonlErrors(100)
  };
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="backup-asociatie-${asocId}-${new Date().toISOString().slice(0,10)}.json"`);
  res.send(JSON.stringify(backup, null, 2));
});

// ============================================================
//  STATISTICI
// ============================================================
app.get('/api/statistici', (req, res) => {
  const db = resolveServerDb(req);
  const asoc = resolveTargetAsociatie(db, req);
  const asocId = asoc.id || 1;
  const blocuri = db.prepare('SELECT COUNT(*) as cnt FROM blocuri WHERE asociatie_id = ? OR (? = 1 AND asociatie_id IS NULL)').get(asocId, asocId).cnt;
  const apartamente = db.prepare(`
    SELECT COUNT(*) as cnt FROM apartamente a
    JOIN blocuri b ON a.bloc_id = b.id
    WHERE b.asociatie_id = ? OR (? = 1 AND b.asociatie_id IS NULL)
  `).get(asocId, asocId).cnt;
  const persoane = db.prepare(`
    SELECT COALESCE(SUM(a.persoane), 0) as cnt FROM apartamente a
    JOIN blocuri b ON a.bloc_id = b.id
    WHERE b.asociatie_id = ? OR (? = 1 AND b.asociatie_id IS NULL)
  `).get(asocId, asocId).cnt;
  const facturi = db.prepare('SELECT COUNT(*) as cnt FROM facturi').get().cnt;
  const totalFacturi = db.prepare('SELECT COALESCE(SUM(suma), 0) as total FROM facturi').get().total;
  const chitante = db.prepare('SELECT COUNT(*) as cnt FROM chitante WHERE anulata = 0').get().cnt;
  const totalIncasat = db.prepare('SELECT COALESCE(SUM(suma), 0) as total FROM chitante WHERE anulata = 0').get().total;

  res.json({ 
    blocuri, 
    apartamente, 
    persoane, 
    facturi, 
    totalFacturi, 
    chitante, 
    totalIncasat,
    luna_lucru: asoc.luna_lucru || 9,
    an_lucru: asoc.an_lucru || 2026
  });
});

// Global Express Error Handler (captures uncaught route errors into logs/telemetry-errors.jsonl)
app.use((err, req, res, next) => {
  try {
    const db = resolveServerDb(req);
    recordTelemetryError(db, {
      platforma: 'express-unhandled-exception',
      severity: 'CRITICAL',
      method: req.method,
      url: req.originalUrl,
      status: 500,
      asociatie_id: req.asociatieId || 1,
      user: req.user?.username || 'system',
      mesaj: err.message || 'Eroare internă de server',
      stack: err.stack || ''
    });
  } catch (_) {}
  if (!res.headersSent) {
    res.status(500).json({ error: err.message || 'Eroare internă de server' });
  }
});

// Process-level uncaught error telemetry
if (!process.__orhideeaTelemetryHooked) {
  process.__orhideeaTelemetryHooked = true;
  process.on('uncaughtException', (err) => {
    try {
      recordTelemetryError(getDb(), {
        platforma: 'node-uncaughtException',
        severity: 'FATAL',
        mesaj: err.message || String(err),
        stack: err.stack || ''
      });
    } catch (_) {}
  });
  process.on('unhandledRejection', (reason) => {
    try {
      recordTelemetryError(getDb(), {
        platforma: 'node-unhandledRejection',
        severity: 'CRITICAL',
        mesaj: reason?.message || String(reason),
        stack: reason?.stack || ''
      });
    } catch (_) {}
  });
}

// ============================================================
//  START SERVER
// ============================================================
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n  ╔══════════════════════════════════════════════════╗`);
    console.log(`  ║  Aplicație Asociație de Proprietari              ║`);
    console.log(`  ║  Server pornit pe http://localhost:${PORT}          ║`);
    console.log(`  ╚══════════════════════════════════════════════════╝\n`);
  });
}

module.exports = app;
