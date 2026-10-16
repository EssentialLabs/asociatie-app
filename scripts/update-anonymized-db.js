/**
 * scripts/update-anonymized-db.js
 * Applies clean anonymization and multi-tenant setup to asociatie.db
 */

const { getDb } = require('../db');

function run() {
  const db = getDb();

  console.log('[1/4] Updating asociatie id = 1...');
  db.prepare(`
    UPDATE asociatie 
    SET nume = 'ASOCIATIA DE PROPRIETARI TEST',
        cod_fiscal = 'RO00000000',
        administrator = 'Administrator Test',
        presedinte = 'Presedinte Test',
        adresa = 'Strada Test nr. 1'
    WHERE id = 1
  `).run();

  console.log('[2/4] Inserting asociatie id = 2 if not exists...');
  db.prepare(`
    INSERT OR IGNORE INTO asociatie (
      id, nume, cod_fiscal, n_r_com, administrator, presedinte, adresa, cod_postal, judet, cont_bancar, banca,
      program, telefon, proc_penalizare, zile_penalizare, luna_lucru, an_lucru, serie_chitante, urmatorul_numar_chitanta
    ) VALUES (
      2, 'ASOCIATIA DEMO CURATA (Workspace Nou)', 'RO11111111', 'J40/100/2026', 'Administrator Nou', 'Presedinte Nou',
      'Strada Noua nr. 2', '010101', 'BUCURESTI', 'RO49AAAA1B31007593840000', 'Banca Transilvania',
      'Luni - Vineri: 09:00 - 17:00', '0722 000 000', 0.2, 45, 9, 2026, 'AGN', 1
    )
  `).run();

  console.log('[3/4] Inserting initial period for asociatie_id = 2...');
  db.prepare(`
    INSERT OR IGNORE INTO perioade (asociatie_id, an, luna, status, ultima_zi, tarif_ar, tarif_ca, proc_ca)
    VALUES (2, 2026, 9, 'DESCHISA', '2026-09-30', 9.48, 9.67, 100.0)
  `).run();

  console.log('[4/4] Updating users and cleaning references...');
  db.prepare(`UPDATE users SET asociatie_id = 2 WHERE username = 'agentie_noua'`).run();
  db.prepare(`UPDATE users SET nume = 'Administrator Agenția TEST' WHERE username = 'orhideea'`).run();
  db.prepare(`UPDATE asociatie_luna SET asoc = 'ASOCIATIA TEST' WHERE asoc LIKE '%ORHIDEEA%'`).run();

  const asocRows = db.prepare('SELECT id, nume, cod_fiscal, administrator, presedinte, adresa FROM asociatie').all();
  console.log('Asociatii in asociatie.db:');
  console.table(asocRows);

  const perioade2 = db.prepare('SELECT * FROM perioade WHERE asociatie_id = 2').all();
  console.log('Perioade asociatie_id = 2:', perioade2);

  const userAgentieNoua = db.prepare("SELECT id, username, rol, asociatie_id FROM users WHERE username = 'agentie_noua'").get();
  console.log('User agentie_noua:', userAgentieNoua);

  console.log('Total asociatii:', asocRows.length);
}

run();
