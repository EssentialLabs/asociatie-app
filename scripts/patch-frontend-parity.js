/**
 * scripts/patch-frontend-parity.js
 *
 * Implements full parity for:
 * 1. Registre (ACA, ABA, APA, ORD) form binding and active loaders
 * 2. Adeverinta Plata la Zi (ADE.PRG) modal and printing
 * 3. Interactive options for Convocator (ADU), Somatii (LSC), Comparatie (COM)
 * 4. Meter inversion warning (AIA/ARA FoxPro F2 Verificare)
 */

const fs = require('fs');
const path = require('path');

const appJsPath = path.join(__dirname, '../public/app.js');
let appJs = fs.readFileSync(appJsPath, 'utf8');

// 1. Update populateIndecsiApartamente to add meter inversion detection
const oldPopulateIdx = appJs.indexOf('function populateIndecsiApartamente() {');
const oldPopulateEnd = appJs.indexOf('async function saveIndecsiApartamente() {');

if (oldPopulateIdx !== -1 && oldPopulateEnd !== -1) {
  const newPopulate = `function populateIndecsiApartamente() {
  const tbody = document.getElementById('tbl-indecsi-apart');
  if (!tbody) return;
  tbody.innerHTML = apartamenteCache.map(ap => {
    const cArBu = Math.max(0, (ap.in_ar_bu || 0) - (ap.iv_ar_bu || 0));
    const cArBa = Math.max(0, (ap.in_ar_ba1 || 0) - (ap.iv_ar_ba1 || 0));
    const cAcBu = Math.max(0, (ap.in_ac_bu || 0) - (ap.iv_ac_bu || 0));
    const cAcBa = Math.max(0, (ap.in_ac_ba1 || 0) - (ap.iv_ac_ba1 || 0));

    const isArBuInv = (ap.in_ar_bu || 0) > 0 && (ap.in_ar_bu || 0) < (ap.iv_ar_bu || 0);
    const isArBaInv = (ap.in_ar_ba1 || 0) > 0 && (ap.in_ar_ba1 || 0) < (ap.iv_ar_ba1 || 0);
    const isAcBuInv = (ap.in_ac_bu || 0) > 0 && (ap.in_ac_bu || 0) < (ap.iv_ac_bu || 0);
    const isAcBaInv = (ap.in_ac_ba1 || 0) > 0 && (ap.in_ac_ba1 || 0) < (ap.iv_ac_ba1 || 0);
    const hasInversion = isArBuInv || isArBaInv || isAcBuInv || isAcBaInv;

    const rowStyle = hasInversion ? 'style="background-color: #fee2e2;" title="Atentie: Index nou mai mic decat index vechi (FoxPro F2 Verificare)"' : '';
    const warnBadge = hasInversion ? '<br><span class="badge badge-danger" style="font-size:0.68rem;">⚠️ Index &lt; Vechi</span>' : '';

    return \`
      <tr data-ap-id="\${ap.id}" \${rowStyle}>
        <td><strong>\${ap.numar_apart}</strong>\${warnBadge}</td>
        <td>\${ap.nume_proprietar || '-'}</td>
        <td><input type="number" class="table-input" value="\${ap.iv_ar_bu || 0}" step="0.1" data-f="iv_ar_bu"></td>
        <td><input type="number" class="table-input \${isArBuInv ? 'input-error' : ''}" value="\${ap.in_ar_bu || 0}" step="0.1" data-f="in_ar_bu"></td>
        <td><strong>\${cArBu.toFixed(1)}</strong></td>
        <td><input type="number" class="table-input" value="\${ap.iv_ar_ba1 || 0}" step="0.1" data-f="iv_ar_ba1"></td>
        <td><input type="number" class="table-input \${isArBaInv ? 'input-error' : ''}" value="\${ap.in_ar_ba1 || 0}" step="0.1" data-f="in_ar_ba1"></td>
        <td><strong>\${cArBa.toFixed(1)}</strong></td>
        <td><input type="number" class="table-input" value="\${ap.iv_ac_bu || 0}" step="0.1" data-f="iv_ac_bu"></td>
        <td><input type="number" class="table-input \${isAcBuInv ? 'input-error' : ''}" value="\${ap.in_ac_bu || 0}" step="0.1" data-f="in_ac_bu"></td>
        <td><strong>\${cAcBu.toFixed(1)}</strong></td>
        <td><input type="number" class="table-input" value="\${ap.iv_ac_ba1 || 0}" step="0.1" data-f="iv_ac_ba1"></td>
        <td><input type="number" class="table-input \${isAcBaInv ? 'input-error' : ''}" value="\${ap.in_ac_ba1 || 0}" step="0.1" data-f="in_ac_ba1"></td>
        <td><strong>\${cAcBa.toFixed(1)}</strong></td>
      </tr>
    \`;
  }).join('');
}\n\n`;

  appJs = appJs.slice(0, oldPopulateIdx) + newPopulate + appJs.slice(oldPopulateEnd);
  console.log('✔ Updated populateIndecsiApartamente with inversion checks');
}

// 2. Enhance selectReport & reloadCurrentReport for ADU, LSC, COM custom options
const oldSelectReportIdx = appJs.indexOf('async function selectReport(code, updateHistory = true) {');
const oldSelectReportEnd = appJs.indexOf('async function reloadCurrentReport() {');

if (oldSelectReportIdx !== -1 && oldSelectReportEnd !== -1) {
  const newSelectReport = `async function selectReport(code, updateHistory = true) {
  currentReportCode = String(code || 'LAF').toUpperCase();

  if (updateHistory && activeSection === 'rapoarte') {
    const targetHash = \`#rapoarte/\${currentReportCode}\`;
    if (window.location.hash !== targetHash) {
      history.pushState({ section: 'rapoarte', report: currentReportCode }, '', targetHash);
    }
  }

  document.querySelectorAll('.report-catalog-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-report-code') === currentReportCode);
  });

  // Strict GDPR Privacy Rule: Notice-board lists default to unchecked (anonymous)
  const gdprToggle = document.getElementById('rapoarte-gdpr-toggle');
  const gdprBox = document.getElementById('rapoarte-gdpr-label-box');
  if (gdprToggle) {
    if (GDPR_NOTICE_BOARD_CODES.has(currentReportCode)) {
      gdprToggle.checked = false;
      if (gdprBox) gdprBox.style.background = '#fef3c7';
    } else {
      if (gdprBox) gdprBox.style.background = '#f8fafc';
    }
  }

  // Render custom options panel for ADU, LSC, COM
  renderReportCustomOptions(currentReportCode);

  await reloadCurrentReport();
}\n\n`;

  appJs = appJs.slice(0, oldSelectReportIdx) + newSelectReport + appJs.slice(oldSelectReportEnd);
  console.log('✔ Updated selectReport with renderReportCustomOptions');
}

// 3. Update reloadCurrentReport to send parameters for ADU, LSC, COM
const oldReloadIdx = appJs.indexOf('async function reloadCurrentReport() {');
const oldReloadEnd = appJs.indexOf('  const report = await apiGet(`/api/rapoarte/${currentReportCode}?${params.toString()}`);');

if (oldReloadIdx !== -1 && oldReloadEnd !== -1) {
  const newReloadPrefix = `async function reloadCurrentReport() {
  const blocVal = document.getElementById('rapoarte-bloc-select')?.value || '';
  const apVal = document.getElementById('rapoarte-apart-select')?.value || '';
  const showNames = document.getElementById('rapoarte-gdpr-toggle')?.checked ? 'true' : 'false';
  const targetDateVal = document.getElementById('rapoarte-data-calcul')?.value || '';
  const activePer = perioadeCache.find(p => Number(p.id) === Number(currentPerioadaId));

  const params = new URLSearchParams();
  if (blocVal) params.set('bloc', blocVal);
  if (apVal) params.set('apartament_id', apVal);
  if (activePer) {
    params.set('an', activePer.an);
    params.set('luna', activePer.luna);
  }
  if (targetDateVal) params.set('data_calcul', targetDateVal);
  params.set('showNames', showNames);

  // Custom interactive parameters (ADU, LSC, COM)
  if (currentReportCode === 'ADU') {
    const ceconv = document.getElementById('adu-ceconv')?.value;
    const cand = document.getElementById('adu-cand')?.value;
    const unde = document.getElementById('adu-unde')?.value;
    const ord1 = document.getElementById('adu-ord1')?.value;
    const ord2 = document.getElementById('adu-ord2')?.value;
    const ord3 = document.getElementById('adu-ord3')?.value;
    const ord4 = document.getElementById('adu-ord4')?.value;
    const ord5 = document.getElementById('adu-ord5')?.value;
    if (ceconv) params.set('ceconv', ceconv);
    if (cand) params.set('cand', cand);
    if (unde) params.set('unde', unde);
    if (ord1) params.set('ord1', ord1);
    if (ord2) params.set('ord2', ord2);
    if (ord3) params.set('ord3', ord3);
    if (ord4) params.set('ord4', ord4);
    if (ord5) params.set('ord5', ord5);
  } else if (currentReportCode === 'LSC') {
    const datas = document.getElementById('lsc-datas')?.value;
    if (datas) params.set('datas', datas);
  } else if (currentReportCode === 'COM') {
    const refAn = document.getElementById('com-ref-an')?.value;
    const refLuna = document.getElementById('com-ref-luna')?.value;
    if (refAn) params.set('ref_an', refAn);
    if (refLuna) params.set('ref_luna', refLuna);
  }\n\n`;

  appJs = appJs.slice(0, oldReloadIdx) + newReloadPrefix + appJs.slice(oldReloadEnd);
  console.log('✔ Updated reloadCurrentReport parameter serialization');
}

// 4. Replace Registre section with fully working form handlers & ID bindings
const oldRegistreIdx = appJs.indexOf('function switchRegistreTab(tabName) {');
const oldRegistreEnd = appJs.indexOf('async function loadRawAuditTable() {');

if (oldRegistreIdx !== -1 && oldRegistreEnd !== -1) {
  const newRegistre = `function switchRegistreTab(tabName) {
  ['casa', 'banca', 'patrimoniu', 'ordine', 'raw'].forEach(t => {
    const div = document.getElementById(\`reg-subtab-\${t}\`);
    const btn = document.getElementById(\`reg-tab-btn-\${t}\`);
    if (div) div.style.display = (t === tabName) ? 'block' : 'none';
    if (btn) btn.className = (t === tabName) ? 'tab active' : 'tab';
  });
  if (tabName === 'casa') loadRegistruCasa();
  else if (tabName === 'banca') loadRegistruBanca();
  else if (tabName === 'patrimoniu') loadRegistruPatrimoniu();
  else if (tabName === 'ordine') loadRegistruOrdinePlata();
  else if (tabName === 'raw') loadRawAuditTable();
}

async function loadAllRegistre() {
  await Promise.all([
    loadRegistruCasa(),
    loadRegistruBanca(),
    loadRegistruPatrimoniu(),
    loadRegistruOrdinePlata()
  ]);
}

// --- 1. REGISTRU DE CASA (ACA.PRG / CCA.PRG) ---
async function loadRegistruCasa() {
  const rows = await apiGet('/api/operatiuni/casa');
  const tbody = document.getElementById('tbl-reg-casa') || document.getElementById('tbl-registru-casa');
  if (!tbody || !Array.isArray(rows)) return;

  let inc = 0, pla = 0;
  tbody.innerHTML = rows.map(r => {
    const isInc = (r.tip === 'I' || r.tip === 'INCASARE');
    if (isInc) inc += Number(r.suma || 0);
    else pla += Number(r.suma || 0);
    return \`
      <tr>
        <td>#\${r.id}</td>
        <td><strong>\${r.document || '-'}</strong></td>
        <td>\${r.data || '-'}</td>
        <td><span class="badge \${isInc ? 'badge-success' : 'badge-danger'}">\${isInc ? 'I • Încasare' : 'P • Plată'}</span></td>
        <td>\${r.act_pas || 'A'}</td>
        <td>\${r.explicatie || '-'}</td>
        <td style="text-align:right; font-weight:700; color:\${isInc ? '#15803d' : '#dc2626'};">\${formatMoney(r.suma)}</td>
        <td><button class="btn btn-small btn-danger" onclick="deleteCasaEntry(\${r.id})">🗑️</button></td>
      </tr>
    \`;
  }).join('');

  const badge = document.getElementById('casa-sold-badge');
  if (badge) {
    const sold = inc - pla;
    badge.textContent = \`Sold Casă: \${formatMoney(sold)} RON\`;
    badge.className = \`badge \${sold >= 0 ? 'badge-success' : 'badge-danger'}\`;
  }
}

async function addActCasa() {
  const payload = {
    document: document.getElementById('casa-doc')?.value.trim() || document.getElementById('reg-casa-doc')?.value.trim() || 'CHIT',
    data: document.getElementById('casa-data')?.value || document.getElementById('reg-casa-data')?.value || new Date().toISOString().slice(0, 10),
    tip: document.getElementById('casa-tip')?.value || document.getElementById('reg-casa-tip')?.value || 'I',
    act_pas: document.getElementById('casa-act-pas')?.value || document.getElementById('reg-casa-actpas')?.value || 'A',
    suma: parseFloat(document.getElementById('casa-suma')?.value || document.getElementById('reg-casa-suma')?.value) || 0,
    explicatie: document.getElementById('casa-explicatie')?.value.trim() || document.getElementById('reg-casa-expl')?.value.trim() || 'Operațiune numerar casă'
  };
  if (!payload.suma) return showAlert('Introduceți suma operațiunii de casă!', 'warning');
  const res = await apiPost('/api/operatiuni/casa', payload);
  if (res.error) return showAlert(res.error, 'danger');
  const s1 = document.getElementById('casa-suma'); if (s1) s1.value = '';
  const s2 = document.getElementById('reg-casa-suma'); if (s2) s2.value = '';
  showAlert('Operațiune înregistrată în Registrul de Casă (ACA)!', 'success');
  loadRegistruCasa();
}
const addCasaEntry = addActCasa;

async function deleteCasaEntry(id) {
  await apiDelete(\`/api/operatiuni/casa/\${id}\`);
  loadRegistruCasa();
}

// --- 2. JURNAL DE BANCA (ABA.PRG / CBA.PRG) ---
async function loadRegistruBanca() {
  const rows = await apiGet('/api/operatiuni/banca');
  const tbody = document.getElementById('tbl-reg-banca') || document.getElementById('tbl-registru-banca');
  if (!tbody || !Array.isArray(rows)) return;

  let dep = 0, vir = 0;
  tbody.innerHTML = rows.map(r => {
    const isDep = (r.tip === 'D' || r.tip === 'DEPUNERE');
    if (isDep) dep += Number(r.suma || 0);
    else vir += Number(r.suma || 0);
    return \`
      <tr>
        <td>#\${r.id}</td>
        <td><strong>\${r.document || '-'}</strong></td>
        <td>\${r.data || '-'}</td>
        <td><span class="badge \${isDep ? 'badge-success' : 'badge-warning'}">\${isDep ? 'D • Depunere' : 'V • Virament'}</span></td>
        <td>\${r.act_pas || 'A'}</td>
        <td>\${r.explicatie || '-'}</td>
        <td style="text-align:right; font-weight:700;">\${formatMoney(r.suma)}</td>
        <td><button class="btn btn-small btn-danger" onclick="deleteBancaEntry(\${r.id})">🗑️</button></td>
      </tr>
    \`;
  }).join('');

  const badge = document.getElementById('banca-sold-badge');
  if (badge) {
    const sold = dep - vir;
    badge.textContent = \`Sold Bancă: \${formatMoney(sold)} RON\`;
    badge.className = \`badge \${sold >= 0 ? 'badge-success' : 'badge-danger'}\`;
  }
}

async function addActBanca() {
  const payload = {
    document: document.getElementById('banca-doc')?.value.trim() || document.getElementById('reg-banca-doc')?.value.trim() || 'EXTRAS',
    data: document.getElementById('banca-data')?.value || document.getElementById('reg-banca-data')?.value || new Date().toISOString().slice(0, 10),
    tip: document.getElementById('banca-tip')?.value || document.getElementById('reg-banca-tip')?.value || 'D',
    act_pas: document.getElementById('banca-act-pas')?.value || document.getElementById('reg-banca-actpas')?.value || 'A',
    suma: parseFloat(document.getElementById('banca-suma')?.value || document.getElementById('reg-banca-suma')?.value) || 0,
    explicatie: document.getElementById('banca-explicatie')?.value.trim() || document.getElementById('reg-banca-expl')?.value.trim() || 'Operațiune bancă'
  };
  if (!payload.suma) return showAlert('Introduceți suma operațiunii bancare!', 'warning');
  const res = await apiPost('/api/operatiuni/banca', payload);
  if (res.error) return showAlert(res.error, 'danger');
  const s1 = document.getElementById('banca-suma'); if (s1) s1.value = '';
  const s2 = document.getElementById('reg-banca-suma'); if (s2) s2.value = '';
  showAlert('Operațiune înregistrată în Jurnalul de Bancă (ABA)!', 'success');
  loadRegistruBanca();
}
const addBancaEntry = addActBanca;

async function deleteBancaEntry(id) {
  await apiDelete(\`/api/operatiuni/banca/\${id}\`);
  loadRegistruBanca();
}

// --- 3. PATRIMONIU ACTIV / PASIV (APA.PRG / CP1.PRG) ---
async function loadRegistruPatrimoniu() {
  const rows = await apiGet('/api/operatiuni/patrimoniu');
  const tbody = document.getElementById('tbl-reg-patrimoniu') || document.getElementById('tbl-registru-patrimoniu');
  if (!tbody || !Array.isArray(rows)) return;

  tbody.innerHTML = rows.map(r => {
    const isAct = (r.act_pas !== 'P');
    return \`
      <tr>
        <td>#\${r.id}</td>
        <td><span class="badge \${isAct ? 'badge-info' : 'badge-warning'}">\${isAct ? 'ACTIV (A)' : 'PASIV (P)'}</span></td>
        <td><strong>\${r.document || '-'}</strong></td>
        <td>\${r.data || '-'}</td>
        <td>\${r.explicatie || '-'}</td>
        <td>\${r.perioada || '-'}</td>
        <td style="text-align:right; font-weight:700;">\${formatMoney(r.suma)}</td>
        <td><button class="btn btn-small btn-danger" onclick="deletePatrimoniuEntry(\${r.id})">🗑️</button></td>
      </tr>
    \`;
  }).join('');
}

async function addActPatrimoniu() {
  const payload = {
    document: document.getElementById('patrim-doc')?.value.trim() || document.getElementById('reg-pat-doc')?.value.trim() || 'DOC-PATRIM',
    data: document.getElementById('patrim-data')?.value || document.getElementById('reg-pat-data')?.value || new Date().toISOString().slice(0, 10),
    act_pas: document.getElementById('patrim-act-pas')?.value || document.getElementById('reg-pat-actpas')?.value || 'A',
    suma: parseFloat(document.getElementById('patrim-suma')?.value || document.getElementById('reg-pat-suma')?.value) || 0,
    explicatie: document.getElementById('patrim-explicatie')?.value.trim() || document.getElementById('reg-pat-expl')?.value.trim() || 'Element patrimoniu',
    perioada: document.getElementById('patrim-perioada')?.value.trim() || document.getElementById('reg-pat-per')?.value.trim() || '',
    data_pres: document.getElementById('patrim-datapres')?.value || ''
  };
  const res = await apiPost('/api/operatiuni/patrimoniu', payload);
  if (res.error) return showAlert(res.error, 'danger');
  const s1 = document.getElementById('patrim-suma'); if (s1) s1.value = '';
  const s2 = document.getElementById('reg-pat-suma'); if (s2) s2.value = '';
  showAlert('Element patrimonial salvat (APA)!', 'success');
  loadRegistruPatrimoniu();
}
const addPatrimoniuEntry = addActPatrimoniu;

async function deletePatrimoniuEntry(id) {
  await apiDelete(\`/api/operatiuni/patrimoniu/\${id}\`);
  loadRegistruPatrimoniu();
}

// --- 4. ORDINE DE PLATA (ORD.PRG) ---
async function loadRegistruOrdinePlata() {
  const rows = await apiGet('/api/operatiuni/ordine-plata');
  const tbody = document.getElementById('tbl-reg-ordine') || document.getElementById('tbl-registru-ordine');
  if (!tbody || !Array.isArray(rows)) return;

  tbody.innerHTML = rows.map(o => \`
    <tr>
      <td><strong>OP #\${o.numar}</strong></td>
      <td>\${o.data || '-'}</td>
      <td>\${o.platitor1 || 'ASOCIATIE'}</td>
      <td><strong>\${o.beneficiar || '-'}</strong><br><small>\${o.codf_bene || ''}</small></td>
      <td>\${o.cont_bene || '-'}<br><small>\${o.banca_bene || ''}</small></td>
      <td>\${o.reprez1 || '-'}</td>
      <td style="text-align:right; font-weight:700;">\${formatMoney(o.suma)} RON</td>
      <td>
        <button class="btn btn-small btn-danger" onclick="deleteOrdinPlata(\${o.id})">🗑️</button>
      </td>
    </tr>
  \`).join('');
}

async function addOrdinPlata() {
  const payload = {
    numar: parseInt(document.getElementById('ord-numar')?.value || document.getElementById('reg-ord-nr')?.value, 10) || undefined,
    data: document.getElementById('ord-data')?.value || document.getElementById('reg-ord-data')?.value || new Date().toISOString().slice(0, 10),
    suma: parseFloat(document.getElementById('ord-suma')?.value || document.getElementById('reg-ord-suma')?.value) || 0,
    beneficiar: (document.getElementById('ord-beneficiar')?.value || document.getElementById('reg-ord-beneficiar')?.value || '').trim(),
    codf_bene: (document.getElementById('ord-codf-bene')?.value || document.getElementById('reg-ord-cui-bene')?.value || '').trim(),
    cont_bene: (document.getElementById('ord-cont-bene')?.value || document.getElementById('reg-ord-iban-bene')?.value || '').trim(),
    banca_bene: (document.getElementById('ord-banca-bene')?.value || document.getElementById('reg-ord-banca-bene')?.value || '').trim(),
    reprez1: (document.getElementById('ord-reprez1')?.value || document.getElementById('reg-ord-reprez')?.value || '').trim()
  };
  if (!payload.suma || !payload.beneficiar) {
    return showAlert('Introduceți beneficiarul și suma ordinului de plată!', 'warning');
  }
  const res = await apiPost('/api/operatiuni/ordine-plata', payload);
  if (res.error) return showAlert(res.error, 'danger');
  const s1 = document.getElementById('ord-suma'); if (s1) s1.value = '';
  const s2 = document.getElementById('reg-ord-suma'); if (s2) s2.value = '';
  showAlert(\`Ordinul de Plată #\${res.entry?.numar || res.ordin?.numar || payload.numar || ''} a fost emis!\`, 'success');
  loadRegistruOrdinePlata();
}

async function deleteOrdinPlata(id) {
  await apiDelete(\`/api/operatiuni/ordine-plata/\${id}\`);
  loadRegistruOrdinePlata();
}\n\n`;

  appJs = appJs.slice(0, oldRegistreIdx) + newRegistre + appJs.slice(oldRegistreEnd);
  console.log('✔ Replaced Registre handlers with unified bindings');
}

// 5. Add custom options renderer & Adeverinta functions to end of appJs
const helperFunctions = `

// ============================================================
//  RAPOARTE: OPTIUNI INTERACTIVE PENTRU ADU, LSC, COM
// ============================================================
function renderReportCustomOptions(code) {
  const box = document.getElementById('rapoarte-custom-options');
  if (!box) return;

  if (code === 'ADU') {
    box.style.display = 'block';
    box.innerHTML = \`
      <div style="font-weight:700; margin-bottom:0.5rem; color:#1e293b;">
        📋 Parametri Convocator Adunare Generală (FoxPro: ADU.PRG)
      </div>
      <div class="form-row">
        <div class="form-group" style="flex:2;">
          <label class="form-label">Ce se convoacă? (CECONV)</label>
          <input type="text" class="form-input" id="adu-ceconv" value="ADUNAREA GENERALA A ASOCIATIEI DE PROPRIETARI">
        </div>
        <div class="form-group" style="flex:1;">
          <label class="form-label">Când? (CAND)</label>
          <input type="text" class="form-input" id="adu-cand" value="25 Noiembrie 2026, ora 18:00">
        </div>
        <div class="form-group" style="flex:1.5;">
          <label class="form-label">Unde? (UNDE)</label>
          <input type="text" class="form-input" id="adu-unde" value="Holul blocului / Sediul Asociației">
        </div>
      </div>
      <div style="font-size:0.82rem; font-weight:600; margin:0.4rem 0 0.2rem 0; color:#475569;">Ordinea de zi (5 Puncte):</div>
      <div class="form-row">
        <div class="form-group" style="flex:1;"><input type="text" class="form-input" id="adu-ord1" value="1. Prezentarea și aprobarea raportului financiar-contabil."></div>
        <div class="form-group" style="flex:1;"><input type="text" class="form-input" id="adu-ord2" value="2. Aprobarea bugetului de venituri și a fondului de reparații."></div>
      </div>
      <div class="form-row">
        <div class="form-group" style="flex:1;"><input type="text" class="form-input" id="adu-ord3" value="3. Analiza situației restanțierilor și măsuri de recuperare."></div>
        <div class="form-group" style="flex:1;"><input type="text" class="form-input" id="adu-ord4" value="4. Lucrări prioritare de întreținere și reparații spații comune."></div>
      </div>
      <div class="form-row" style="align-items:flex-end;">
        <div class="form-group" style="flex:2;"><input type="text" class="form-input" id="adu-ord5" value="5. Diverse și propuneri ale proprietarilor."></div>
        <div class="form-group">
          <button class="btn btn-primary" onclick="reloadCurrentReport()">🔄 Actualizează Convocator</button>
        </div>
      </div>
    \`;
  } else if (code === 'LSC') {
    box.style.display = 'block';
    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + 15);
    const dateStr = nextDate.toISOString().slice(0, 10);
    box.innerHTML = \`
      <div style="font-weight:700; margin-bottom:0.5rem; color:#1e293b;">
        ⚖️ Parametri Scrisori Somație Restanțieri (FoxPro: LSC.PRG)
      </div>
      <div class="form-row" style="align-items:flex-end;">
        <div class="form-group" style="min-width:200px;">
          <label class="form-label">Termen Limită de Plată / Data Sistării (DATAS)</label>
          <input type="date" class="form-input" id="lsc-datas" value="\${dateStr}">
        </div>
        <div class="form-group">
          <button class="btn btn-primary" onclick="reloadCurrentReport()">🔄 Actualizează Somațiile</button>
        </div>
      </div>
    \`;
  } else if (code === 'COM') {
    box.style.display = 'block';
    box.innerHTML = \`
      <div style="font-weight:700; margin-bottom:0.5rem; color:#1e293b;">
        📊 Parametri Comparație cu Lună de Referință (FoxPro: COM.PRG)
      </div>
      <div class="form-row" style="align-items:flex-end;">
        <div class="form-group" style="min-width:140px;">
          <label class="form-label">An Referință</label>
          <input type="number" class="form-input" id="com-ref-an" value="2026">
        </div>
        <div class="form-group" style="min-width:160px;">
          <label class="form-label">Lună Referință</label>
          <select class="form-select" id="com-ref-luna">
            <option value="1">1 - Ianuarie</option>
            <option value="2">2 - Februarie</option>
            <option value="3">3 - Martie</option>
            <option value="4">4 - Aprilie</option>
            <option value="5">5 - Mai</option>
            <option value="6">6 - Iunie</option>
            <option value="7">7 - Iulie</option>
            <option value="8" selected>8 - August</option>
            <option value="9">9 - Septembrie</option>
            <option value="10">10 - Octombrie</option>
            <option value="11">11 - Noiembrie</option>
            <option value="12">12 - Decembrie</option>
          </select>
        </div>
        <div class="form-group">
          <button class="btn btn-primary" onclick="reloadCurrentReport()">🔄 Compară Valorile</button>
        </div>
      </div>
    \`;
  } else {
    box.style.display = 'none';
  }
}

// ============================================================
//  ADEVERINȚĂ PLATĂ LA ZI / VÂNZARE APARTAMENT (ADE.PRG)
// ============================================================
let currentAdeverintaData = null;

function openAdeverintaFromCasierie() {
  const selApt = document.getElementById('cas-apart-select')?.value;
  if (!selApt) {
    return showAlert('Vă rugăm să selectați mai întâi un apartament din lista de mai sus!', 'warning');
  }
  openAdeverintaModal(selApt);
}

async function openAdeverintaModal(apartamentId) {
  const aptId = apartamentId || document.getElementById('cas-apart-select')?.value || 1;
  const dataInr = new Date().toISOString().slice(0, 10);
  const adeDateInput = document.getElementById('ade-data-inr');
  if (adeDateInput) adeDateInput.value = dataInr;

  const res = await apiGet(\`/api/operatiuni/apartamente/\${aptId}/adeverinta?data_inr=\${dataInr}\`);
  if (!res || !res.adeverinta) {
    return showAlert('Nu s-au putut încărca datele pentru adeverință.', 'danger');
  }

  currentAdeverintaData = res.adeverinta;
  const nrInput = document.getElementById('ade-nr-inr');
  if (nrInput) nrInput.value = currentAdeverintaData.numar_inregistrare || 1;
  const servInput = document.getElementById('ade-serv');
  if (servInput) servInput.value = currentAdeverintaData.serviciu || 'NOTAR PUBLIC, VANZARE APARTAMENT';

  renderAdeverintaContent(currentAdeverintaData);
  showModal('modal-adeverinta');
}

async function regenerareAdeverintaCuParametri() {
  if (!currentAdeverintaData?.apartament?.id) return;
  const aptId = currentAdeverintaData.apartament.id;
  const nrInr = document.getElementById('ade-nr-inr')?.value || 1;
  const dataInr = document.getElementById('ade-data-inr')?.value || new Date().toISOString().slice(0, 10);
  const serv = document.getElementById('ade-serv')?.value || 'NOTAR PUBLIC, VANZARE APARTAMENT';

  const res = await apiGet(\`/api/operatiuni/apartamente/\${aptId}/adeverinta?nr_inr=\${nrInr}&data_inr=\${dataInr}&serv=\${encodeURIComponent(serv)}\`);
  if (!res || !res.adeverinta) return showAlert('Eroare la reîncărcarea adeverinței.', 'danger');

  currentAdeverintaData = res.adeverinta;
  renderAdeverintaContent(currentAdeverintaData);
  showAlert('Adeverința a fost actualizată!', 'success');
}

function renderAdeverintaContent(adv) {
  const container = document.getElementById('adeverinta-preview-content');
  if (!container || !adv) return;

  const a = adv.asociatie;
  const ap = adv.apartament;
  const d = adv.defalcare_datorii;

  container.innerHTML = \`
    <div style="font-family:'Times New Roman', Times, serif; color:#0f172a; padding:2rem 2.5rem; line-height:1.6; font-size:1.05rem;">
      <div style="display:flex; justify-content:space-between; border-bottom:2px solid #0f172a; padding-bottom:0.75rem; margin-bottom:1.5rem;">
        <div>
          <strong style="font-size:1.15rem;">ASOCIAȚIA DE PROPRIETARI "\${a.nume}"</strong><br>
          <span>Cod Fiscal / C.I.F.: \${a.cod_fiscal || '-'}</span><br>
          <span>Sediul: \${a.adresa || '-'}, \${a.oras || 'Alba Iulia'}</span><br>
          <span>Banca: \${a.banca || '-'} | Cont IBAN: \${a.cont_bancar || '-'}</span>
        </div>
        <div style="text-align:right;">
          <span style="font-size:0.9rem;">Evidență Financiară / Notar</span><br>
          <strong style="font-size:1.1rem;">Nr. \${adv.numar_inregistrare} / \${adv.data_inregistrarii}</strong>
        </div>
      </div>

      <div style="text-align:center; margin:2.5rem 0 1.5rem 0;">
        <h2 style="margin:0; letter-spacing:2px; font-size:1.65rem; text-decoration:underline;">A D E V E R I N Ț Ă</h2>
        <span style="font-size:0.9rem; font-style:italic;">(privind situația debitelor la cotele de întreținere și fonduri)</span>
      </div>

      <p style="text-indent:2.5rem; text-align:justify; margin-bottom:1.2rem;">
        \${adv.text_adeverinta}
      </p>

      \${adv.are_datorii ? \`
        <div style="margin:1rem 0; border:1px solid #cbd5e1; background:#f8fafc; padding:0.85rem; border-radius:4px;">
          <strong>Situația debitelor defalcate la data de \${adv.data_inregistrarii}:</strong>
          <table style="width:100%; border-collapse:collapse; margin-top:0.5rem; font-size:0.95rem;">
            <tr><td style="padding:4px;">1. Întreținere / Regie (R):</td><td style="text-align:right; font-weight:700;">\${formatMoney(d.intretinere_regie)} RON</td></tr>
            <tr><td style="padding:4px;">2. Fond de Rulment (F):</td><td style="text-align:right; font-weight:700;">\${formatMoney(d.fond_rulment)} RON</td></tr>
            <tr><td style="padding:4px;">3. Fond de Reparații (A):</td><td style="text-align:right; font-weight:700;">\${formatMoney(d.fond_reparatii)} RON</td></tr>
            <tr><td style="padding:4px;">4. Penalități de întârziere:</td><td style="text-align:right; font-weight:700;">\${formatMoney(d.penalitati_inregistrate + d.penalitati_calculate)} RON</td></tr>
            <tr style="border-top:1px solid #94a3b8; font-weight:700;"><td style="padding:4px;">TOTAL GENERAL DATORAT:</td><td style="text-align:right; color:#dc2626;">\${formatMoney(d.total_datorat)} RON</td></tr>
          </table>
        </div>
      \` : ''}

      <p style="text-indent:2.5rem; text-align:justify; margin-top:1.5rem;">
        \${adv.scop}
      </p>

      <div style="display:flex; justify-content:space-between; margin-top:4rem; padding:0 2rem;">
        <div style="text-align:center;">
          <strong>PREȘEDINTE,</strong><br><br><br>
          <span>\${a.presedinte}</span><br>
          <small>(semnătura și ștampila)</small>
        </div>
        <div style="text-align:center;">
          <strong>ADMINISTRATOR,</strong><br><br><br>
          <span>\${a.administrator}</span><br>
          <small>(semnătura)</small>
        </div>
      </div>
    </div>
  \`;
}

function printAdeverinta() {
  const printContent = document.getElementById('adeverinta-preview-content')?.innerHTML;
  if (!printContent) return;
  const printWindow = window.open('', '_blank', 'width=850,height=900');
  if (printWindow) {
    printWindow.document.write(\`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Adeverinta Plata la Zi - \${currentAdeverintaData?.apartament?.proprietar || ''}</title>
        <style>
          body { font-family: 'Times New Roman', Times, serif; margin: 2cm; color: #000; }
          @media print { body { margin: 1.5cm; } }
        </style>
      </head>
      <body>
        \${printContent}
        <script>window.onload = function() { window.print(); window.close(); }<\\/script>
      </body>
      </html>
    \`);
    printWindow.document.close();
  } else {
    window.print();
  }
}
`;

appJs += helperFunctions;

fs.writeFileSync(appJsPath, appJs, 'utf8');
console.log('✔ Successfully patched public/app.js with all parity features!');

// Add ADE to command palette
let updatedAppJs = fs.readFileSync(appJsPath, 'utf8');
const choIdx = updatedAppJs.indexOf("code: 'CHO', cat: 'Casierie (D)'");
if (choIdx !== -1) {
  const lineEnd = updatedAppJs.indexOf('\n', choIdx);
  const adeEntry = "\n  { code: 'ADE', cat: 'Casierie (E)', title: 'Adeverință Plată la Zi / Notar Vânzare (ADE.PRG)', action: () => openAdeverintaFromCasierie() },";
  if (!updatedAppJs.includes("code: 'ADE'")) {
    updatedAppJs = updatedAppJs.slice(0, lineEnd) + adeEntry + updatedAppJs.slice(lineEnd);
    fs.writeFileSync(appJsPath, updatedAppJs, 'utf8');
    console.log('✔ Added ADE to command palette');
  }
}
