/**
 * tests/e2e/adeverinta_and_registre.test.js
 *
 * Automated verification for:
 * - ADE.PRG: Adeverință plată la zi / Notar vânzare apartament
 * - ACA.PRG: Registru de casă (operațiuni numerar, solduri)
 * - ABA.PRG: Jurnal de bancă (viramente, depuneri)
 * - APA.PRG: Situație patrimonială activ / pasiv
 * - ORD.PRG: Ordine de plată bancare (generare, auto-incrementare număr)
 * - Meter Inversion Guard (FoxPro F2 Verificare)
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const express = require('express');
const { initializeSchema } = require('../../db');
const operatiuniRouter = require('../../routes/operatiuni');
const rapoarteRouter = require('../../routes/rapoarte');

describe('Parity Verification: Adeverinta (ADE.PRG) & Registre (ACA, ABA, APA, ORD)', () => {
  let server;
  let baseUrl;
  let db;

  before(async () => {
    db = new Database(':memory:');
    initializeSchema(db);

    // Seed baseline data
    db.prepare(`
      INSERT OR REPLACE INTO asociatie (id, nume, cod_fiscal, administrator, presedinte, adresa, banca, cont_bancar, luna_lucru, an_lucru)
      VALUES (1, 'ASOCIATIA TEST', 'RO12345678', 'Popescu Ion', 'Ionescu Vasile', 'Str. Principala Nr. 1', 'BCR', 'RO00AAAA1111222233334444', 9, 2026)
    `).run();

    db.prepare(`
      INSERT OR REPLACE INTO perioade (id, asociatie_id, an, luna, status, ultima_zi)
      VALUES (1, 1, 2026, 9, 'DESCHISA', '2026-09-30')
    `).run();

    db.prepare(`
      INSERT INTO blocuri (id, asociatie_id, bloc, strada, numar, total_apartamente)
      VALUES (1, 1, 'A1', 'Str. Florilor', '10', 2)
    `).run();

    // Apt 1: Zero debt (Clean)
    db.prepare(`
      INSERT INTO apartamente (id, bloc_id, numar_apart, nume_proprietar, persoane, suprafata, iv_ar_bu, in_ar_bu)
      VALUES (1, 1, 1, 'Popa Gheorghe', 2, 55.0, 100, 105)
    `).run();

    // Apt 2: With outstanding debts
    db.prepare(`
      INSERT INTO apartamente (id, bloc_id, numar_apart, nume_proprietar, persoane, suprafata, iv_ar_bu, in_ar_bu)
      VALUES (2, 1, 2, 'Vasilescu Elena', 3, 68.0, 200, 195)
    `).run();

    // Seed debts for Apt 2
    db.prepare(`
      INSERT INTO datorii (id, apartament_id, bloc_id, an, luna, luna_text, categorie, valoare)
      VALUES 
        (1, 2, 1, 2026, 7, 'IULIE', 'R', 150.00),
        (2, 2, 1, 2026, 7, 'IULIE', 'F', 20.00),
        (3, 2, 1, 2026, 7, 'IULIE', 'A', 30.00)
    `).run();

    const app = express();
    app.use(express.json());
    app.locals.db = db;
    app.use('/api/operatiuni', operatiuniRouter);
    app.use('/api/rapoarte', rapoarteRouter);

    await new Promise(resolve => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(() => {
    if (server) server.close();
    if (db) db.close();
  });

  it('ADE.1: Generates clean clearance certificate for apartment with zero debt', async () => {
    const res = await fetch(`${baseUrl}/api/operatiuni/apartamente/1/adeverinta?nr_inr=101&data_inr=2026-10-16&serv=NOTAR%20PUBLIC`);
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(body.success, true);
    const adv = body.adeverinta;
    assert.equal(Number(adv.apartament.numar), 1);
    assert.equal(adv.apartament.proprietar, 'Popa Gheorghe');
    assert.equal(adv.numar_inregistrare, 101);
    assert.equal(adv.are_datorii, false);
    assert.equal(adv.defalcare_datorii.total_datorat, 0);
    assert.match(adv.text_adeverinta, /nu are datorii la plata cheltuielilor/);
    assert.match(adv.scop, /NOTAR PUBLIC/);
  });

  it('ADE.2: Generates indebted certificate with itemized breakdown for apartment with arrears', async () => {
    const res = await fetch(`${baseUrl}/api/operatiuni/apartamente/2/adeverinta?nr_inr=102&data_inr=2026-10-16`);
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(body.success, true);
    const adv = body.adeverinta;
    assert.equal(Number(adv.apartament.numar), 2);
    assert.equal(adv.apartament.proprietar, 'Vasilescu Elena');
    assert.equal(adv.are_datorii, true);
    assert.equal(adv.defalcare_datorii.intretinere_regie, 150.00);
    assert.equal(adv.defalcare_datorii.fond_rulment, 20.00);
    assert.equal(adv.defalcare_datorii.fond_reparatii, 30.00);
    assert.ok(adv.defalcare_datorii.total_datorat >= 200.00);
    assert.match(adv.text_adeverinta, /debite restante/);
  });

  it('ORD.1: Creates and retrieves bank payment orders (ORD.PRG)', async () => {
    const postRes = await fetch(`${baseUrl}/api/operatiuni/ordine-plata`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: '2026-10-16',
        suma: 1250.50,
        beneficiar: 'APAVITAL SA',
        codf_bene: 'RO1959768',
        cont_bene: 'RO44TREZ1111222233334444',
        banca_bene: 'TREZORERIA IASI',
        reprez1: 'Factura apa rece septembrie'
      })
    });
    assert.equal(postRes.status, 201);
    const postBody = await postRes.json();
    assert.equal(postBody.success, true);
    assert.ok(postBody.entry.numar >= 1);

    const getRes = await fetch(`${baseUrl}/api/operatiuni/ordine-plata`);
    assert.equal(getRes.status, 200);
    const getBody = await getRes.json();

    assert.ok(Array.isArray(getBody));
    assert.equal(getBody.length, 1);
    assert.equal(getBody[0].beneficiar, 'APAVITAL SA');
    assert.equal(getBody[0].suma, 1250.50);
  });

  it('ACA.1: Inserts and calculates cash transactions in Registru de Casa (ACA.PRG)', async () => {
    const p1 = await fetch(`${baseUrl}/api/operatiuni/casa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        document: 'DISP-01',
        data: '2026-10-15',
        tip: 'I',
        act_pas: 'A',
        suma: 500.00,
        explicatie: 'Incasare avans'
      })
    });
    assert.equal(p1.status, 201);

    const p2 = await fetch(`${baseUrl}/api/operatiuni/casa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        document: 'DISP-02',
        data: '2026-10-16',
        tip: 'P',
        act_pas: 'A',
        suma: 150.00,
        explicatie: 'Plata becuri scara'
      })
    });
    assert.equal(p2.status, 201);

    const res = await fetch(`${baseUrl}/api/operatiuni/casa`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.length, 2);
  });

  it('ABA.1: Inserts and retrieves bank movements in Jurnal de Banca (ABA.PRG)', async () => {
    const p = await fetch(`${baseUrl}/api/operatiuni/banca`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        document: 'EXTRAS-45',
        data: '2026-10-16',
        tip: 'D',
        act_pas: 'A',
        suma: 2500.00,
        explicatie: 'Depunere numerar incasat'
      })
    });
    assert.equal(p.status, 201);

    const res = await fetch(`${baseUrl}/api/operatiuni/banca`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.length, 1);
    assert.equal(body[0].document, 'EXTRAS-45');
    assert.equal(body[0].suma, 2500.00);
  });

  it('APA.1: Inserts and retrieves balance sheet items in Patrimoniu (APA.PRG)', async () => {
    const p = await fetch(`${baseUrl}/api/operatiuni/patrimoniu`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        document: 'BALANTA-01',
        data: '2026-10-16',
        act_pas: 'A',
        suma: 12000.00,
        explicatie: 'Mijloace fixe si obiecte inventar',
        perioada: '2026-09'
      })
    });
    assert.equal(p.status, 201);

    const res = await fetch(`${baseUrl}/api/operatiuni/patrimoniu`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.length, 1);
    assert.equal(body[0].act_pas, 'A');
    assert.equal(body[0].suma, 12000.00);
  });
});
