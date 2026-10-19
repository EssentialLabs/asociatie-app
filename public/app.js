// ============================================================
//  Aplicație Asociație de Proprietari — Sistem Administrare
//  58 Operațiuni FoxPro • 35 Rapoarte • Registru Datorii • Multi-Tenant
// ============================================================

const API = '';
let currentBlocId = null;
let currentBloc = null;
let apartamenteCache = [];
let allBlocuriCache = [];
let activeSection = 'blocuri';
let chitantaCurentaData = null;
let currentUser = null;
let isImpersonating = false;
let blocToDelete = null;

// Multi-tenant & Period State
let currentAsociatieId = parseInt(localStorage.getItem('asoc_workspace_id') || '1', 10) || 1;
let currentPerioadaId = null;
let perioadeCache = [];
let asociatiiCache = [];
let activeWorkflowStage = 1;

// Reports & Ledger State
let reportCatalogCache = null;
let currentReportCode = 'LAF';
let currentReportData = null;
let currentCasierieLedger = null;
let rawAuditDataCache = null;
let cmdPaletteSelectedIndex = 0;
let cmdPaletteFilteredItems = [];

const GDPR_NOTICE_BOARD_CODES = new Set(['LAF', 'LAR', 'LP1', 'LP2', 'LPP', 'MAX']);
const NUME_LUNI_RO = [
  '', 'Ianuarie', 'Februarie', 'Martie', 'Aprilie', 'Mai', 'Iunie',
  'Iulie', 'August', 'Septembrie', 'Octombrie', 'Noiembrie', 'Decembrie'
];

// ============================================================
//  NUMĂR ÎN LITERE (CLIENT-SIDE PENTRU PREVIEW INSTANT)
// ============================================================
const UNITATI = ['', 'un', 'doi', 'trei', 'patru', 'cinci', 'șase', 'șapte', 'opt', 'nouă'];
const ZECI_SPECIAL = [
  'zece', 'unsprezece', 'doisprezece', 'treisprezece', 'paisprezece',
  'cincisprezece', 'șaisprezece', 'șaptesprezece', 'optsprezece', 'nouăsprezece'
];
const ZECI = ['', 'zece', 'douăzeci', 'treizeci', 'patruzeci', 'cincizeci', 'șaizeci', 'șaptezeci', 'optzeci', 'nouăzeci'];

function suteInLitere(n, genFeminin = false) {
  if (n === 0) return '';
  const sute = Math.floor(n / 100);
  const restZeci = n % 100;
  let text = '';
  if (sute === 1) text += 'o sută ';
  else if (sute === 2) text += 'două sute ';
  else if (sute > 2) text += UNITATI[sute] + ' sute ';

  if (restZeci >= 10 && restZeci < 20) {
    text += ZECI_SPECIAL[restZeci - 10] + ' ';
  } else {
    const z = Math.floor(restZeci / 10);
    const u = restZeci % 10;
    if (z > 0) {
      text += ZECI[z] + ' ';
      if (u > 0) text += 'și ';
    }
    if (u > 0) {
      if (u === 1) text += genFeminin ? 'o ' : 'un ';
      else if (u === 2) text += genFeminin ? 'două ' : 'doi ';
      else text += UNITATI[u] + ' ';
    }
  }
  return text.trim();
}

function numarInLitereClient(suma) {
  if (!suma || isNaN(suma)) return 'zero lei';
  const val = Math.abs(parseFloat(suma));
  const intPart = Math.floor(val);
  const bani = Math.round((val - intPart) * 100);
  if (intPart === 0 && bani === 0) return 'zero lei';

  let textLei = '';
  if (intPart === 0) textLei = 'zero lei';
  else if (intPart === 1) textLei = 'un leu';
  else {
    const mii = Math.floor(intPart / 1000);
    const rest = intPart % 1000;
    let partMii = '';
    if (mii > 0) {
      if (mii === 1) partMii = 'o mie ';
      else if (mii === 2) partMii = 'două mii ';
      else partMii = suteInLitere(mii, true) + ' mii ';
    }
    let partRest = '';
    if (rest > 0) partRest = suteInLitere(rest, false) + ' ';
    textLei = (partMii + partRest).trim() + ' lei';
  }

  let textBani = '';
  if (bani > 0) {
    let bStr = '';
    if (bani === 1) bStr = 'un ban';
    else if (bani === 2) bStr = 'doi bani';
    else if (bani < 10) bStr = UNITATI[bani] + ' bani';
    else if (bani < 20) bStr = ZECI_SPECIAL[bani - 10] + ' bani';
    else {
      const bz = Math.floor(bani / 10);
      const bu = bani % 10;
      bStr = ZECI[bz];
      if (bu > 0) bStr += ' și ' + (bu === 1 ? 'un' : bu === 2 ? 'doi' : UNITATI[bu]);
      bStr += ' bani';
    }
    textBani = ' și ' + bStr;
  }
  return (textLei + textBani).trim();
}

function syncSidebarViewportHeight() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar || window.innerWidth <= 768) return;
  const topNav = document.querySelector('.top-nav');
  const topNavBottom = topNav ? Math.max(0, topNav.getBoundingClientRect().bottom) : 65;
  const rect = sidebar.getBoundingClientRect();
  const offsetTop = Math.max(topNavBottom, rect.top > 0 ? rect.top : topNavBottom);
  document.documentElement.style.setProperty('--sidebar-sticky-top', `${Math.round(topNavBottom)}px`);
  document.documentElement.style.setProperty('--sidebar-top-offset', `${Math.round(offsetTop)}px`);
}
window.syncSidebarViewportHeight = syncSidebarViewportHeight;

// ============================================================
//  INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  initAuth();
  loadAsociatiiWorkspaces();
  loadPerioadeGlobal();
  loadBlocuri();
  loadDashboard();
  syncSidebarViewportHeight();

  window.addEventListener('resize', syncSidebarViewportHeight);
  window.addEventListener('scroll', syncSidebarViewportHeight, { passive: true });

  // Initializare Routing URL Hash (#blocuri, #avizier, #rapoarte/LAF, etc.)
  window.addEventListener('hashchange', () => navigateFromHash());
  window.addEventListener('popstate', () => navigateFromHash());
  navigateFromHash();

  // Auto-calculate consum pe contoare generale
  ['ar', 'ac', 'in'].forEach(type => {
    const vechi = document.getElementById(`idx-${type}-vechi`);
    const nou = document.getElementById(`idx-${type}-nou`);
    if (vechi && nou) {
      vechi.addEventListener('input', () => calcConsum(type));
      nou.addEventListener('input', () => calcConsum(type));
    }
  });

  // Implicit luna curenta
  const now = new Date();
  const todayIso = now.toISOString().split('T')[0];
  const lunaSelect = document.getElementById('new-fact-luna');
  if (lunaSelect) lunaSelect.value = now.getMonth() + 1;
  const anInput = document.getElementById('new-fact-an');
  if (anInput) anInput.value = now.getFullYear();

  ['cas-data', 'cho-data', 'reg-casa-data', 'reg-banca-data', 'reg-pat-data', 'reg-ord-data', 'casa-data', 'banca-data', 'patr-data', 'ord-data'].forEach(id => {
    const el = document.getElementById(id);
    if (el && !el.value) el.value = todayIso;
  });

  // Auto-set mod repartizare la selectare tip factura
  const tipFactura = document.getElementById('new-fact-tip');
  if (tipFactura) {
    tipFactura.addEventListener('change', () => {
      const tip = tipFactura.value;
      const modRepEl = document.getElementById('new-fact-repartizare');
      const nivelEl = document.getElementById('new-fact-nivel');
      const perCota = ['SALAR_ADMIN', 'SALAR_FEMEIE', 'CH_ADMIN', 'CH_SEDIU', 'FOND_REPARATII', 'FOND_RULMENT', 'INCALZIRE', 'REPARATII'];
      if (modRepEl) modRepEl.value = perCota.includes(tip) ? 'COTA_INDIVIZA' : 'PERSOANE';
      if (nivelEl) nivelEl.value = tip === 'APA_POTABILA' ? 'asociatie' : 'bloc';
    });
  }

  // Global Keyboard Shortcut: Ctrl+K / Cmd+K for 58-Operation Command Palette
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openCommandPalette();
    } else if (e.key === 'Escape') {
      const cmdModal = document.getElementById('modal-command-palette');
      if (cmdModal && cmdModal.style.display === 'flex') {
        closeModal('modal-command-palette');
      }
    }
  });
});

// ============================================================
//  API HELPERS (CU SUPORT MULTI-TENANT X-Asociatie-Id)
// ============================================================
function getApiHeaders(extra = {}) {
  const headers = {
    'X-Asociatie-Id': String(currentAsociatieId || 1),
    ...extra
  };
  const token = localStorage.getItem('asoc_token');
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

async function apiGet(url) {
  const res = await fetch(API + url, {
    headers: getApiHeaders()
  });
  return res.json();
}

async function apiPost(url, data) {
  const res = await fetch(API + url, {
    method: 'POST',
    headers: getApiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data || {})
  });
  return res.json();
}

async function apiPut(url, data) {
  const res = await fetch(API + url, {
    method: 'PUT',
    headers: getApiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data || {})
  });
  return res.json();
}

async function apiDelete(url) {
  const res = await fetch(API + url, {
    method: 'DELETE',
    headers: getApiHeaders()
  });
  return res.json();
}

// ============================================================
//  MULTI-TENANT WORKSPACE & PERIOADE GLOBALE
// ============================================================
async function loadAsociatiiWorkspaces() {
  try {
    const rows = await apiGet('/api/operatiuni/asociatii');
    if (Array.isArray(rows) && rows.length > 0) {
      asociatiiCache = rows;
      const sel = document.getElementById('global-asociatie-select');
      if (sel) {
        sel.innerHTML = rows.map(a => `
          <option value="${a.id}" ${Number(a.id) === Number(currentAsociatieId) ? 'selected' : ''}>
            🏛️ #${a.id} — ${a.nume || 'Asociație'} (${a.nr_blocuri || 0} bl. / ${a.nr_apartamente || 0} ap.)
          </option>
        `).join('');
      }
      renderControlTowerAsociatiiTable(rows);
    }
  } catch (e) {
    // Fallback silent
  }
}

async function switchAsociatieWorkspace(asocId) {
  currentAsociatieId = parseInt(asocId, 10) || 1;
  localStorage.setItem('asoc_workspace_id', String(currentAsociatieId));
  localStorage.setItem('activeAsociatieId', String(currentAsociatieId));
  const sel = document.getElementById('global-asociatie-select');
  if (sel && sel.value !== String(currentAsociatieId)) {
    sel.value = String(currentAsociatieId);
  }
  currentBlocId = null;
  currentBloc = null;
  showDashboard();
  await Promise.all([
    loadAsociatiiWorkspaces(),
    loadPerioadeGlobal(),
    loadBlocuri(),
    loadDashboard()
  ]);

  const listEl = document.getElementById('bloc-list');
  if (allBlocuriCache.length === 0) {
    if (listEl) {
      listEl.innerHTML = `<div style="padding:1.5rem; color:#94a3b8; text-align:center;">✨ Workspace curat (0 blocuri).<br>Apăsați pe <strong>+ Adaugă Bloc</strong> de mai jos pentru a începe!</div>`;
    }
  } else {
    if (listEl) {
      listEl.innerHTML = allBlocuriCache.map(b => `
        <div class="bloc-item ${b.id === allBlocuriCache[0].id ? 'active' : ''}" onclick="selectBloc(${b.id})">
          <div class="bloc-item-name">🏢 Bloc ${b.bloc}</div>
          <div class="bloc-item-info">${b.nr_apartamente_actual || 0} ap. • ${b.nr_persoane || 0} pers.</div>
        </div>
      `).join('');
    }
    await selectBloc(allBlocuriCache[0].id);
  }

  if (activeSection === 'rapoarte') reloadCurrentReport();
  if (activeSection === 'registre') loadAllRegistre();
  if (activeSection === 'casierie') {
    populateCasierieBlocSelect();
    loadChitante();
  }
  syncSidebarViewportHeight();
  showAlert(`Spațiul de lucru a fost comutat pe Asociația #${currentAsociatieId}!`, 'info');
}
window.switchAsociatieWorkspace = switchAsociatieWorkspace;

async function loadPerioadeGlobal() {
  try {
    const rows = await apiGet('/api/operatiuni/perioade');
    if (!Array.isArray(rows)) return;
    perioadeCache = rows;

    const sel = document.getElementById('global-perioada-select');
    if (sel && rows.length > 0) {
      if (!currentPerioadaId || !rows.some(r => Number(r.id) === Number(currentPerioadaId))) {
        currentPerioadaId = rows[0].id;
      }
      sel.innerHTML = rows.map(p => `
        <option value="${p.id}" ${Number(p.id) === Number(currentPerioadaId) ? 'selected' : ''}>
          ${p.luna_nume || NUME_LUNI_RO[p.luna] || p.luna} ${p.an} [${p.status || 'DESCHISA'}]
        </option>
      `).join('');
    }
    updateGlobalPeriodStatusUI();
  } catch (e) {
    // Fallback silent
  }
}

function updateGlobalPeriodStatusUI() {
  const activePer = perioadeCache.find(p => Number(p.id) === Number(currentPerioadaId)) || perioadeCache[0];
  const status = (activePer?.status || 'DESCHISA').toUpperCase();
  const badge = document.getElementById('global-perioada-status-badge');
  const lunaBadge = document.getElementById('luna-curenta-status-badge');
  const lunaPageBadge = document.getElementById('luna-page-status-badge');
  const lunaText = document.getElementById('luna-curenta-status-text');

  const badgeClass = status === 'INCHISA'
    ? 'badge-secondary'
    : status === 'PUBLICATA'
      ? 'badge-success'
      : 'badge-info';

  if (badge) {
    badge.className = `badge ${badgeClass}`;
    badge.textContent = status;
  }
  if (lunaBadge) {
    lunaBadge.className = `badge ${badgeClass}`;
    lunaBadge.textContent = status;
  }
  if (lunaPageBadge) {
    lunaPageBadge.className = `badge ${badgeClass}`;
    lunaPageBadge.textContent = `Stare Perioadă: ${status}`;
  }
  if (lunaText && activePer) {
    const numeLuna = activePer.luna_nume || NUME_LUNI_RO[activePer.luna] || activePer.luna;
    lunaText.innerHTML = `Perioada selectată: <strong>${numeLuna} ${activePer.an}</strong> • Ultima zi (ADG): <strong>${activePer.ultima_zi || '-'}</strong> • Tarif AR: <strong>${activePer.tarif_ar ?? '-'}</strong> lei/m³ • Tarif CA: <strong>${activePer.tarif_ca ?? '-'}</strong> lei/m³`;
  }
  if (activePer) {
    const dashAr = document.getElementById('dash-tarif-ar');
    const dashCa = document.getElementById('dash-tarif-ca');
    const dashProc = document.getElementById('dash-proc-ca');
    const dashZi = document.getElementById('dash-ultima-zi');
    if (dashAr) dashAr.textContent = activePer.tarif_ar ?? 9.48;
    if (dashCa) dashCa.textContent = activePer.tarif_ca ?? 9.67;
    if (dashProc) dashProc.textContent = activePer.proc_ca ?? 100;
    if (dashZi) dashZi.textContent = (activePer.ultima_zi || '2026-09-30').slice(0, 10);
  }
}

function switchPerioadaGlobal(perioadaId) {
  currentPerioadaId = parseInt(perioadaId, 10) || null;
  updateGlobalPeriodStatusUI();
  if (activeSection === 'rapoarte') {
    reloadCurrentReport();
  } else if (activeSection === 'registre') {
    loadAllRegistre();
  }
}

// ============================================================
//  FOXPRO 6-STAGE WORKFLOW STEPPER BAR
// ============================================================
function updateWorkflowStepperUI(stage) {
  activeWorkflowStage = stage;
  document.querySelectorAll('#workflow-stepper-bar .workflow-step, #workflow-stepper-bar .stepper-stage').forEach(btn => {
    const dataStage = parseInt(btn.getAttribute('data-stage'), 10);
    const idStage = btn.id && btn.id.startsWith('stepper-stage-') ? parseInt(btn.id.replace('stepper-stage-', ''), 10) : NaN;
    const s = !isNaN(dataStage) ? dataStage : idStage;
    btn.classList.toggle('active', s === stage);
  });
}

async function goToWorkflowStage(stage) {
  updateWorkflowStepperUI(stage);
  if (stage === 1) {
    switchMainSection('blocuri');
  } else if (stage === 2) {
    switchMainSection('blocuri');
    if (!currentBlocId && allBlocuriCache.length > 0) {
      await selectBloc(allBlocuriCache[0].id);
    }
    const tabBtn = document.getElementById('tab-btn-repartitoare');
    if (tabBtn) switchTab('repartitoare', tabBtn);
  } else if (stage === 3) {
    switchMainSection('luna');
  } else if (stage === 4) {
    switchMainSection('casierie');
  } else if (stage === 5) {
    switchMainSection('rapoarte');
  } else if (stage === 6) {
    switchMainSection('luna');
  }
}

// ============================================================
//  NAVIGARE PRINCIPALĂ (TOP NAVIGATION) & ROUTING URL (#blocuri, #avizier, #rapoarte/LAF, etc.)
// ============================================================
function navigateFromHash() {
  let raw = (window.location.hash || '').replace(/^#\/?/, '').trim();
  if (!raw) {
    const cleanPath = window.location.pathname.replace(/^\/asociatie-app\/?/, '').replace(/^\/?/, '').trim();
    if (cleanPath && cleanPath !== 'index.html' && cleanPath !== '200.html') {
      raw = cleanPath;
    }
  }
  if (!raw) {
    switchMainSection('blocuri', false);
    return;
  }

  const [pathPart, queryPart] = raw.split('?');
  const parts = pathPart.split('/');
  let section = parts[0];
  const subParam = parts[1];

  if (section === 'chitante') section = 'casierie';

  const validSections = ['blocuri', 'avizier', 'rapoarte', 'casierie', 'registre', 'luna', 'ghid', 'control-tower'];
  if (!validSections.includes(section)) {
    section = 'blocuri';
  }

  switchMainSection(section, false);

  if (section === 'rapoarte' && subParam) {
    selectReport(subParam.toUpperCase(), false);
  } else if (queryPart) {
    const q = new URLSearchParams(queryPart);
    const cod = q.get('cod') || q.get('code');
    if (section === 'rapoarte' && cod) {
      selectReport(cod.toUpperCase(), false);
    }
  }
}

function switchMainSection(section, updateHistory = true) {
  if (section === 'chitante') section = 'casierie';
  activeSection = section;

  // Actualizare URL în bara de adrese a browserului pentru suport "Back / Forward" și link-uri unice per pagină
  if (updateHistory) {
    let targetHash = '#' + section;
    if (section === 'rapoarte' && currentReportCode) {
      targetHash = '#' + section + '/' + currentReportCode;
    }
    if (window.location.hash !== targetHash) {
      history.pushState({ section, currentReportCode }, '', targetHash);
    }
  }

  // Actualizare butoane meniu
  document.querySelectorAll('.top-nav-btn').forEach(btn => btn.classList.remove('active'));
  const btn = document.getElementById(`nav-btn-${section}`);
  if (btn) btn.classList.add('active');

  // Sincronizare stepper
  const stageMap = {
    'blocuri': 1,
    'avizier': 5,
    'rapoarte': 5,
    'casierie': 4,
    'registre': 1,
    'luna': 6
  };
  if (stageMap[section]) updateWorkflowStepperUI(stageMap[section]);

  // Comutare vizibilitate secțiuni
  ['blocuri', 'avizier', 'rapoarte', 'casierie', 'registre', 'luna', 'ghid', 'control-tower'].forEach(sec => {
    const el = document.getElementById(`sec-${sec}`);
    if (el) {
      if (sec === section) {
        el.style.display = (sec === 'blocuri') ? 'flex' : 'block';
      } else {
        el.style.display = 'none';
      }
    }
  });

  // Acțiuni specifice fiecărei secțiuni
  if (section === 'avizier') {
    populateAvizierBlocSelect();
  } else if (section === 'rapoarte') {
    initRapoarteCatalog();
  } else if (section === 'casierie') {
    populateCasierieBlocSelect();
    loadChitante();
  } else if (section === 'registre') {
    loadAllRegistre();
  } else if (section === 'luna') {
    loadPerioadeGlobal();
    loadIstoricLuni();
  } else if (section === 'control-tower') {
    loadControlTowerSummary();
    loadAsociatiiWorkspaces();
  }
  syncSidebarViewportHeight();
}

// ============================================================
//  AUTENTIFICARE & TURN DE CONTROL (SUPERADMIN / IMPERSONATE)
// ============================================================
function initAuth() {
  const savedUser = localStorage.getItem('asoc_user');
  if (savedUser) {
    try {
      currentUser = JSON.parse(savedUser);
    } catch (e) {
      currentUser = null;
    }
  }
  if (!currentUser) {
    currentUser = {
      username: 'superadmin',
      role: 'superadmin',
      name: 'Superadmin Turn de Control',
      canImpersonate: true
    };
    localStorage.setItem('asoc_user', JSON.stringify(currentUser));
  }

  isImpersonating = localStorage.getItem('asoc_impersonation') === 'true';
  renderAuthUI();
}

function renderAuthUI() {
  const userArea = document.getElementById('top-nav-user-area');
  const ctBtn = document.getElementById('nav-btn-control-tower');
  const impBanner = document.getElementById('impersonation-banner');

  if (!currentUser) {
    if (userArea) userArea.innerHTML = `<button class="btn btn-small btn-primary" onclick="showModal('modal-login')">🔑 Autentificare</button>`;
    if (ctBtn) ctBtn.style.display = 'none';
    if (impBanner) impBanner.style.display = 'none';
    return;
  }

  const isSuper = (currentUser.role === 'superadmin');
  if (ctBtn) ctBtn.style.display = (isSuper || isImpersonating) ? 'flex' : 'none';

  if (isImpersonating) {
    if (impBanner) impBanner.style.display = 'block';
  } else {
    if (impBanner) impBanner.style.display = 'none';
  }

  const roleTagClass = isImpersonating ? 'tag-admin' : (isSuper ? 'tag-superadmin' : 'tag-admin');
  const roleLabel = isImpersonating ? 'ADMIN (IMPERSONAT)' : (isSuper ? 'SUPERADMIN' : 'ADMINISTRATOR');
  const displayName = isImpersonating ? 'Administrator Asociație' : currentUser.name;

  if (userArea) {
    userArea.innerHTML = `
      <div class="user-profile-badge">
        <span>👤 <strong>${displayName}</strong></span>
        <span class="user-role-tag ${roleTagClass}">${roleLabel}</span>
      </div>
      <button class="btn btn-small btn-outline" style="color:#e2e8f0; border-color:rgba(255,255,255,0.25);" onclick="showModal('modal-login')" title="Schimbă contul">🔄 Schimbă</button>
      <button class="btn btn-small btn-secondary" onclick="logout()" title="Deconectare">🚪 Ieșire</button>
    `;
  }
}

window.setRole = function(role) {
  const normalizedRole = role === 'superadmin' ? 'superadmin' : 'admin';
  currentUser = {
    username: normalizedRole,
    role: normalizedRole,
    name: normalizedRole === 'superadmin' ? 'Superadmin Turn de Control' : 'Administrator Asociație',
    canImpersonate: normalizedRole === 'superadmin'
  };
  isImpersonating = false;
  localStorage.setItem('asoc_user', JSON.stringify(currentUser));
  localStorage.removeItem('asoc_impersonation');
  renderAuthUI();
};

async function quickLogin(role) {
  const res = await apiPost('/api/auth/login', { role });
  if (res.success && res.user) {
    currentUser = res.user;
    isImpersonating = false;
    if (res.token) localStorage.setItem('asoc_token', res.token);
    localStorage.setItem('asoc_user', JSON.stringify(currentUser));
    localStorage.removeItem('asoc_impersonation');
    closeModal('modal-login');
    renderAuthUI();
    showAlert(`Conectat ca ${currentUser.name}!`, 'success');
    if (role === 'superadmin') {
      switchMainSection('control-tower');
    } else {
      switchMainSection('blocuri');
    }
  }
}

async function handleManualLogin(e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value.trim();
  const res = await apiPost('/api/auth/login', { username, password });
  if (res.error) return showAlert(res.error, 'danger');
  if (res.success && res.user) {
    currentUser = res.user;
    isImpersonating = false;
    if (res.token) localStorage.setItem('asoc_token', res.token);
    localStorage.setItem('asoc_user', JSON.stringify(currentUser));
    localStorage.removeItem('asoc_impersonation');
    closeModal('modal-login');
    renderAuthUI();
    showAlert(`Bun venit, ${currentUser.name}!`, 'success');
    switchMainSection(currentUser.role === 'superadmin' ? 'control-tower' : 'blocuri');
  }
}

function startImpersonating() {
  isImpersonating = true;
  localStorage.setItem('asoc_impersonation', 'true');
  renderAuthUI();
  showAlert('Modul Impersonare a fost activat! Acționați acum în numele Administratorului.', 'warning');
  switchMainSection('blocuri');
}

function stopImpersonating() {
  isImpersonating = false;
  localStorage.removeItem('asoc_impersonation');
  renderAuthUI();
  showAlert('Ați oprit modul impersonare și ați revenit la Superadmin.', 'info');
  switchMainSection('control-tower');
}

function logout() {
  localStorage.removeItem('asoc_user');
  localStorage.removeItem('asoc_token');
  localStorage.removeItem('asoc_impersonation');
  currentUser = null;
  isImpersonating = false;
  renderAuthUI();
  showModal('modal-login');
}

async function loadControlTowerSummary() {
  const data = await apiGet('/api/control-tower/summary');
  if (!data) return;
  const elBloc = document.getElementById('ct-total-blocuri');
  const elAp = document.getElementById('ct-total-apartamente');
  const elErr = document.getElementById('ct-total-erori');
  if (elBloc) elBloc.textContent = data.stats?.total_blocuri || 10;
  if (elAp) elAp.textContent = data.stats?.total_apartamente || 78;
  if (elErr) elErr.textContent = data.stats?.total_erori || 0;

  const tbody = document.getElementById('tbl-telemetrie-erori');
  if (!tbody) return;
  if (data.errors && data.errors.length > 0) {
    tbody.innerHTML = data.errors.map(err => `
      <tr>
        <td>#${err.id}</td>
        <td>${new Date(err.creat_la).toLocaleString('ro-RO')}</td>
        <td><span class="badge badge-info">${err.platforma}</span></td>
        <td><strong>${err.mesaj}</strong></td>
        <td>${err.rezolvat ? '<span class="badge badge-success">Rezolvat</span>' : '<span class="badge badge-danger">Activ</span>'}</td>
        <td>
          ${!err.rezolvat ? `<button class="btn btn-small btn-success" onclick="resolveTelemetryError(${err.id})">✅ Rezolvă</button>` : '-'}
        </td>
      </tr>
    `).join('');
  } else {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#64748b; padding:1.5rem;">Nicio eroare înregistrată. Sistemul funcționează optim.</td></tr>`;
  }
}

async function resolveTelemetryError(id) {
  await apiPost(`/api/telemetry/errors/${id}/resolve`, {});
  loadControlTowerSummary();
  showAlert('Eroarea a fost marcată ca rezolvată!', 'success');
}

// Feature 24: Multi-Tenant Clean Association Provisioning
function renderControlTowerAsociatiiTable(rows) {
  const tbody = document.getElementById('tbl-ct-asociatii');
  if (!tbody) return;
  tbody.innerHTML = rows.map(a => `
    <tr style="${Number(a.id) === Number(currentAsociatieId) ? 'background:#eff6ff;' : ''}">
      <td><strong>#${a.id}</strong></td>
      <td><strong>${a.nume || '-'}</strong></td>
      <td>${a.cod_fiscal || '-'}</td>
      <td>${a.administrator || '-'} / ${a.presedinte || '-'}</td>
      <td><span class="badge badge-info">${NUME_LUNI_RO[a.luna_lucru] || a.luna_lucru}/${a.an_lucru}</span></td>
      <td>${a.nr_blocuri || 0} bl. / ${a.nr_apartamente || 0} ap.</td>
      <td>
        ${Number(a.id) === Number(currentAsociatieId)
          ? '<span class="badge badge-success">Activă</span>'
          : `<button class="btn btn-small btn-primary" onclick="switchAsociatieWorkspace(${a.id})">🔄 Comută</button>`}
      </td>
    </tr>
  `).join('');
}

async function createNewCleanAsociatie() {
  const numeEl = document.getElementById('new-asoc-nume') || document.getElementById('ct-new-asoc-nume');
  const nume = numeEl?.value.trim();
  if (!nume) return showAlert('Introduceți denumirea noii asociații!', 'warning');

  const payload = {
    nume,
    cod_fiscal: (document.getElementById('new-asoc-cui')?.value || document.getElementById('ct-new-asoc-cui')?.value || '').trim(),
    administrator: (document.getElementById('new-asoc-admin')?.value || document.getElementById('ct-new-asoc-admin')?.value || '').trim(),
    presedinte: (document.getElementById('new-asoc-pres')?.value || document.getElementById('ct-new-asoc-pres')?.value || '').trim(),
    adresa: (document.getElementById('new-asoc-adresa')?.value || document.getElementById('ct-new-asoc-adresa')?.value || '').trim(),
    serie_chitante: (document.getElementById('new-asoc-serie')?.value || document.getElementById('ct-new-asoc-serie')?.value || 'ASOC').trim(),
    luna_lucru: parseInt(document.getElementById('new-asoc-luna')?.value || document.getElementById('ct-new-asoc-luna')?.value, 10) || 10,
    an_lucru: parseInt(document.getElementById('new-asoc-an')?.value || document.getElementById('ct-new-asoc-an')?.value, 10) || 2026,
    proc_penalizare: parseFloat(document.getElementById('new-asoc-penal')?.value || document.getElementById('ct-new-asoc-penal')?.value) || 0.2
  };

  const res = await apiPost('/api/operatiuni/asociatii', payload);
  if (res.error) return showAlert(res.error, 'danger');

  showAlert(`Asociația „${nume}” (#${res.asociatie?.id || res.id}) a fost creată cu un spațiu de lucru curat!`, 'success');
  if (numeEl) numeEl.value = '';
  await loadAsociatiiWorkspaces();
  const newId = res.asociatie?.id || res.id;
  if (newId) {
    await switchAsociatieWorkspace(newId);
  }
}

// ============================================================
//  DASHBOARD & ASOCIATIE (ADG / ADA)
// ============================================================
async function loadDashboard() {
  const stats = await apiGet('/api/statistici');
  const asociatie = await apiGet('/api/asociatie');

  const lunaLucruNume = NUME_LUNI_RO[asociatie.luna_lucru || 9] || '';

  const sideName = document.getElementById('sidebar-asociatie-name');
  if (sideName) sideName.textContent = asociatie.nume || 'TEST ADMINISTRATORI';
  const topSub = document.getElementById('top-nav-subtitle');
  if (topSub) topSub.textContent = `Asociație de Proprietari • Luna activă de lucru: ${lunaLucruNume} ${asociatie.an_lucru || 2026}`;

  const statCards = document.getElementById('stat-cards');
  if (statCards) {
    statCards.innerHTML = `
      <div class="stat-card">
        <div class="stat-value">${stats.blocuri ?? 0}</div>
        <div class="stat-label">Blocuri Gestionate</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.apartamente ?? 0}</div>
        <div class="stat-label">Apartamente Înregistrate</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.persoane ?? 0}</div>
        <div class="stat-label">Locatari / Persoane</div>
      </div>
      <div class="stat-card stat-success">
        <div class="stat-value">${stats.chitante || 0}</div>
        <div class="stat-label">Chitanțe Emise (${formatMoney(stats.totalIncasat || 0)} RON)</div>
      </div>
    `;
  }

  const asocInfo = document.getElementById('asociatie-info');
  if (asocInfo) {
    asocInfo.innerHTML = `
      <div class="form-row">
        <div><strong>Nume:</strong> ${asociatie.nume || '-'}</div>
        <div><strong>Cod Fiscal (CUI):</strong> ${asociatie.cod_fiscal || '-'}</div>
        <div><strong>Administrator:</strong> ${asociatie.administrator || '-'}</div>
        <div><strong>Președinte:</strong> ${asociatie.presedinte || '-'}</div>
      </div>
      <div class="form-row" style="margin-top: 0.75rem;">
        <div><strong>Adresă Sediu:</strong> ${asociatie.adresa || '-'}</div>
        <div><strong>Cont Bancar (IBAN):</strong> ${asociatie.cont_bancar || '-'}</div>
        <div><strong>Banca:</strong> ${asociatie.banca || '-'}</div>
      </div>
      <div class="form-row" style="margin-top: 0.75rem;">
        <div><strong>Penalizare:</strong> ${asociatie.proc_penalizare || 0.2}% / zi (după ${asociatie.zile_penalizare || 45} zile)</div>
        <div><strong>Chitanțier Activ:</strong> Seria ${asociatie.serie_chitante || 'ORH'} (Următorul nr: #${asociatie.urmatorul_numar_chitanta || 1})</div>
        <div><strong>Luna de Lucru Activă:</strong> <span class="badge badge-info">${lunaLucruNume} ${asociatie.an_lucru || 2026}</span></div>
      </div>
      <div class="form-row" style="margin-top: 0.75rem; padding-top:0.5rem; border-top:1px dashed #e2e8f0; font-size:0.85rem;">
        <div><strong>Facturi Asociație (ADA):</strong> AR: <strong>${formatMoney(asociatie.apa_rece || 0)}</strong> | Canal: <strong>${formatMoney(asociatie.can_met || 0)}</strong> | AC: <strong>${formatMoney(asociatie.apa_calda || 0)}</strong> | Încălzire: <strong>${formatMoney(asociatie.incalzire || 0)}</strong> | Gunoi: <strong>${formatMoney(asociatie.gunoi || 0)}</strong> | Salarii/Adm: <strong>${formatMoney((asociatie.sal_tesa || 0) + (asociatie.sal_feme || 0) + (asociatie.ch_admin || 0))}</strong> RON</div>
      </div>
    `;
  }
}

// ADG.PRG — Actualizare Date Generale Perioadă
async function showDateGeneraleModal() {
  await loadPerioadeGlobal();
  const activePer = perioadeCache.find(p => Number(p.id) === Number(currentPerioadaId)) || perioadeCache[0] || {
    an: 2026, luna: 9, ultima_zi: '2026-09-30', tarif_ar: 9.48, tarif_ca: 9.67, proc_ca: 100, tarif_et: 0, status: 'DESCHISA'
  };

  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  setVal('adg-perioada-id', activePer.id || '');
  setVal('adg-an', activePer.an || 2026);
  setVal('adg-luna', activePer.luna || 9);
  setVal('adg-ultima-zi', (activePer.ultima_zi || '2026-09-30').slice(0, 10));
  setVal('adg-tarif-ar', activePer.tarif_ar ?? 9.48);
  setVal('adg-tarif-ca', activePer.tarif_ca ?? 9.67);
  setVal('adg-proc-ca', activePer.proc_ca ?? 100);
  setVal('adg-tarif-et', activePer.tarif_et ?? 0);
  setVal('adg-status', activePer.status || 'DESCHISA');

  showModal('modal-date-generale');
}

async function saveDateGeneraleADG() {
  const activePer = perioadeCache.find(p => Number(p.id) === Number(currentPerioadaId)) || perioadeCache[0] || {};
  const payload = {
    an: parseInt(document.getElementById('adg-an')?.value, 10) || activePer.an || 2026,
    luna: parseInt(document.getElementById('adg-luna')?.value, 10) || activePer.luna || 9,
    ultima_zi: document.getElementById('adg-ultima-zi')?.value || activePer.ultima_zi || '2026-09-30',
    tarif_ar: parseFloat(document.getElementById('adg-tarif-ar')?.value) || 0,
    tarif_ca: parseFloat(document.getElementById('adg-tarif-ca')?.value) || 0,
    proc_ca: parseFloat(document.getElementById('adg-proc-ca')?.value) || 100,
    tarif_et: parseFloat(document.getElementById('adg-tarif-et')?.value) || 0
  };

  const res = await apiPost('/api/operatiuni/perioade', payload);
  if (res.error) return showAlert(res.error, 'danger');

  const dashAr = document.getElementById('dash-tarif-ar');
  const dashCa = document.getElementById('dash-tarif-ca');
  const dashProc = document.getElementById('dash-proc-ca');
  const dashZi = document.getElementById('dash-ultima-zi');
  if (dashAr) dashAr.textContent = payload.tarif_ar;
  if (dashCa) dashCa.textContent = payload.tarif_ca;
  if (dashProc) dashProc.textContent = payload.proc_ca;
  if (dashZi) dashZi.textContent = payload.ultima_zi;

  closeModal('modal-date-generale');
  showAlert('Datele generale ale perioadei (ADG) au fost salvate!', 'success');
  await loadPerioadeGlobal();
  loadDashboard();
}

// ADA.PRG — Actualizare Facturi Asociație
async function showFacturiAsociatieModal() {
  const asoc = await apiGet('/api/operatiuni/asociatie/facturi') || {};
  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  setVal('ada-apa-rece', asoc.apa_rece ?? 0);
  setVal('ada-can-met', asoc.can_met ?? 0);
  setVal('ada-apa-calda', asoc.apa_calda ?? 0);
  setVal('ada-etac', asoc.etac ?? 0);
  setVal('ada-incalzire', asoc.incalzire ?? 0);
  setVal('ada-gunoi', asoc.gunoi ?? 0);
  setVal('ada-ch-admin', asoc.ch_admin ?? 0);
  setVal('ada-sal-tesa', asoc.sal_tesa ?? 0);
  setVal('ada-sal-feme', asoc.sal_feme ?? 0);
  setVal('ada-abonament', asoc.abonament ?? 0);
  setVal('ada-ch-sediu', asoc.ch_sediu ?? 0);
  setVal('ada-rulment', asoc.rulment ?? 0);
  setVal('ada-cota-fr', asoc.cota_fr ?? 0);

  showModal('modal-facturi-asociatie');
}

async function saveFacturiAsociatieADA() {
  const getVal = (id) => parseFloat(document.getElementById(id)?.value) || 0;
  const payload = {
    apa_rece: getVal('ada-apa-rece'),
    can_met: getVal('ada-can-met'),
    apa_calda: getVal('ada-apa-calda'),
    etac: getVal('ada-etac'),
    incalzire: getVal('ada-incalzire'),
    gunoi: getVal('ada-gunoi'),
    ch_admin: getVal('ada-ch-admin'),
    sal_tesa: getVal('ada-sal-tesa'),
    sal_feme: getVal('ada-sal-feme'),
    abonament: getVal('ada-abonament'),
    ch_sediu: getVal('ada-ch-sediu'),
    rulment: getVal('ada-rulment'),
    cota_fr: getVal('ada-cota-fr')
  };

  const res = await apiPut('/api/operatiuni/asociatie/facturi', payload);
  if (res.error) return showAlert(res.error, 'danger');

  closeModal('modal-facturi-asociatie');
  showAlert('Facturile la nivel de Asociație (ADA) au fost salvate!', 'success');
  loadDashboard();
}

async function showEditAsociatieModal() {
  const asoc = await apiGet('/api/asociatie');
  document.getElementById('edit-asoc-nume').value = asoc.nume || '';
  document.getElementById('edit-asoc-cui').value = asoc.cod_fiscal || '';
  document.getElementById('edit-asoc-adresa').value = asoc.adresa || '';
  document.getElementById('edit-asoc-admin').value = asoc.administrator || '';
  document.getElementById('edit-asoc-pres').value = asoc.presedinte || '';
  document.getElementById('edit-asoc-iban').value = asoc.cont_bancar || '';
  document.getElementById('edit-asoc-banca').value = asoc.banca || '';
  document.getElementById('edit-asoc-proc-penal').value = asoc.proc_penalizare || 0.2;
  document.getElementById('edit-asoc-zile-penal').value = asoc.zile_penalizare || 45;
  document.getElementById('edit-asoc-serie-ch').value = asoc.serie_chitante || 'ORH';
  document.getElementById('edit-asoc-nr-ch').value = asoc.urmatorul_numar_chitanta || 1;
  showModal('modal-edit-asociatie');
}

async function saveEditAsociatie() {
  const data = {
    nume: document.getElementById('edit-asoc-nume').value.trim(),
    cod_fiscal: document.getElementById('edit-asoc-cui').value.trim(),
    adresa: document.getElementById('edit-asoc-adresa').value.trim(),
    administrator: document.getElementById('edit-asoc-admin').value.trim(),
    presedinte: document.getElementById('edit-asoc-pres').value.trim(),
    cont_bancar: document.getElementById('edit-asoc-iban').value.trim(),
    banca: document.getElementById('edit-asoc-banca').value.trim(),
    proc_penalizare: parseFloat(document.getElementById('edit-asoc-proc-penal').value) || 0.2,
    zile_penalizare: parseInt(document.getElementById('edit-asoc-zile-penal').value) || 45,
    serie_chitante: document.getElementById('edit-asoc-serie-ch').value.trim() || 'ORH',
    urmatorul_numar_chitanta: parseInt(document.getElementById('edit-asoc-nr-ch').value) || 1
  };
  await apiPut('/api/asociatie', data);
  closeModal('modal-edit-asociatie');
  showAlert('Datele asociației au fost actualizate!', 'success');
  loadDashboard();
  loadAsociatiiWorkspaces();
}

// ============================================================
//  BLOCURI (CRUD & SELECTIE)
// ============================================================
async function loadBlocuri() {
  const blocuri = await apiGet('/api/blocuri');
  allBlocuriCache = Array.isArray(blocuri) ? blocuri : [];
  const listEl = document.getElementById('bloc-list');
  if (!listEl) return;

  if (allBlocuriCache.length === 0) {
    listEl.innerHTML = `<div style="padding:1.5rem; color:#94a3b8; text-align:center;">✨ Workspace curat (0 blocuri).<br>Apăsați pe <strong>+ Adaugă Bloc</strong> de mai jos pentru a începe!</div>`;
  } else {
    listEl.innerHTML = allBlocuriCache.map(b => `
      <div class="bloc-item ${b.id === currentBlocId ? 'active' : ''}" onclick="selectBloc(${b.id})">
        <div class="bloc-item-name">🏢 Bloc ${b.bloc}</div>
        <div class="bloc-item-info">${b.nr_apartamente_actual || 0} ap. • ${b.nr_persoane || 0} pers.</div>
      </div>
    `).join('');
  }
}

function showDashboard() {
  currentBlocId = null;
  currentBloc = null;
  const dash = document.getElementById('dashboard-page');
  const blocP = document.getElementById('bloc-page');
  if (dash) dash.style.display = 'block';
  if (blocP) blocP.style.display = 'none';
  document.querySelectorAll('.bloc-item').forEach(el => el.classList.remove('active'));
}

async function selectBloc(id) {
  currentBlocId = id;
  currentBloc = await apiGet(`/api/blocuri/${id}`);
  apartamenteCache = await apiGet(`/api/blocuri/${id}/apartamente`);

  document.querySelectorAll('.bloc-item').forEach(el => el.classList.remove('active'));
  const activeEl = document.querySelector(`.bloc-item[onclick*="${id}"]`);
  if (activeEl) activeEl.classList.add('active');

  document.getElementById('dashboard-page').style.display = 'none';
  document.getElementById('bloc-page').style.display = 'block';

  document.getElementById('bloc-title').textContent = `Bloc ${currentBloc.bloc}`;
  document.getElementById('bloc-subtitle').textContent =
    `${currentBloc.strada ? currentBloc.strada + ', ' : ''}Nr. ${currentBloc.numar || '-'} • ${currentBloc.total_apartamente || apartamenteCache.length || 0} apartamente • ${currentBloc.suprafata_totala || 0} mp`;

  populateIndecsiBloc();
  populateIndecsiApartamente();
  populateRepartitoareTab();
  populateApartamente();
  loadFacturiBloc();
  populateSetariBloc();
  actualizeazaStatsDiferenteApa();
}

function showAddBlocModal() {
  document.getElementById('new-bloc-nr').value = '';
  document.getElementById('new-bloc-strada').value = '';
  document.getElementById('new-bloc-numar').value = '';
  document.getElementById('new-bloc-apart').value = '';
  document.getElementById('new-bloc-sup').value = '';
  showModal('modal-add-bloc');
}

async function addBloc() {
  const bloc = document.getElementById('new-bloc-nr').value.trim();
  if (!bloc) return showAlert('Introduceți numărul/codul blocului!', 'warning');

  const result = await apiPost('/api/blocuri', {
    bloc,
    strada: document.getElementById('new-bloc-strada').value.trim(),
    numar: document.getElementById('new-bloc-numar').value.trim(),
    total_apartamente: parseInt(document.getElementById('new-bloc-apart').value) || 0,
    suprafata_totala: parseFloat(document.getElementById('new-bloc-sup').value) || 0
  });

  if (result.error) return showAlert(result.error, 'warning');

  closeModal('modal-add-bloc');
  showAlert('Bloc adăugat cu succes!', 'success');
  await loadBlocuri();
  if (result.id) selectBloc(result.id);
}

function deleteBlocConfirm() {
  if (!currentBloc) return;
  blocToDelete = currentBloc;
  const expected = `sterge bloc ${currentBloc.bloc}`;
  document.getElementById('delete-bloc-instruction-text').textContent = expected;
  const input = document.getElementById('input-confirm-delete-bloc');
  input.value = '';
  const btn = document.getElementById('btn-confirm-delete-bloc');
  btn.disabled = true;
  btn.style.opacity = '0.5';
  btn.style.cursor = 'not-allowed';
  showModal('modal-delete-bloc');
  setTimeout(() => input.focus(), 150);
}

function onDeleteBlocInputChange() {
  if (!blocToDelete) return;
  const expected = `sterge bloc ${blocToDelete.bloc}`.toLowerCase().trim();
  const typed = document.getElementById('input-confirm-delete-bloc').value.toLowerCase().trim();
  const btn = document.getElementById('btn-confirm-delete-bloc');
  if (typed === expected) {
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.style.cursor = 'pointer';
  } else {
    btn.disabled = true;
    btn.style.opacity = '0.5';
    btn.style.cursor = 'not-allowed';
  }
}

async function executaStergereBloc() {
  if (!blocToDelete) return;
  const expected = `sterge bloc ${blocToDelete.bloc}`.toLowerCase().trim();
  const typed = document.getElementById('input-confirm-delete-bloc').value.toLowerCase().trim();
  if (typed !== expected) return showAlert('Textul de confirmare nu corespunde exact!', 'warning');

  const res = await apiDelete(`/api/blocuri/${blocToDelete.id}`);
  if (res && res.error) return showAlert(res.error, 'danger');

  closeModal('modal-delete-bloc');
  showAlert(`Blocul ${blocToDelete.bloc} a fost șters definitiv!`, 'info');
  blocToDelete = null;
  currentBloc = null;
  currentBlocId = null;
  showDashboard();
  await loadBlocuri();
}

// ============================================================
//  INDECȘI & PIERDERI APĂ (AIA.PRG)
// ============================================================
function populateIndecsiBloc() {
  if (!currentBloc) return;
  document.getElementById('idx-ar-vechi').value = currentBloc.index_vechi_ar ?? currentBloc.ivar ?? 0;
  document.getElementById('idx-ar-nou').value = currentBloc.index_nou_ar ?? currentBloc.inar ?? 0;
  calcConsum('ar');

  document.getElementById('idx-ac-vechi').value = currentBloc.index_vechi_ac ?? currentBloc.ivac ?? 0;
  document.getElementById('idx-ac-nou').value = currentBloc.index_nou_ac ?? currentBloc.inac ?? 0;
  calcConsum('ac');

  document.getElementById('idx-in-vechi').value = currentBloc.index_vechi_in ?? currentBloc.ivin ?? 0;
  document.getElementById('idx-in-nou').value = currentBloc.index_nou_in ?? currentBloc.inin ?? 0;
  calcConsum('in');
}

function calcConsum(type) {
  const vechi = parseFloat(document.getElementById(`idx-${type}-vechi`)?.value) || 0;
  const nou = parseFloat(document.getElementById(`idx-${type}-nou`)?.value) || 0;
  const consum = Math.max(0, nou - vechi);
  const el = document.getElementById(`idx-${type}-consum`);
  if (!el) return;
  if (type === 'in') {
    el.value = (consum * (currentBloc ? (currentBloc.const_incalzire || currentBloc.constin || 1) : 1)).toFixed(3);
  } else {
    el.value = consum.toFixed(1) + ' m³';
  }
}

async function saveIndecsiBloc() {
  if (!currentBloc) return;
  await apiPut(`/api/operatiuni/blocuri/${currentBloc.id}/extins`, {
    index_vechi_ar: parseFloat(document.getElementById('idx-ar-vechi').value) || 0,
    index_nou_ar: parseFloat(document.getElementById('idx-ar-nou').value) || 0,
    index_vechi_ac: parseFloat(document.getElementById('idx-ac-vechi').value) || 0,
    index_nou_ac: parseFloat(document.getElementById('idx-ac-nou').value) || 0,
    index_vechi_in: parseFloat(document.getElementById('idx-in-vechi').value) || 0,
    index_nou_in: parseFloat(document.getElementById('idx-in-nou').value) || 0
  });
  showAlert('Indecșii blocului au fost salvați!', 'success');
  currentBloc = await apiGet(`/api/blocuri/${currentBloc.id}`);
  actualizeazaStatsDiferenteApa();
}

function populateIndecsiApartamente() {
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

    return `
      <tr data-ap-id="${ap.id}" ${rowStyle}>
        <td><strong>${ap.numar_apart}</strong>${warnBadge}</td>
        <td>${ap.nume_proprietar || '-'}</td>
        <td><input type="number" class="table-input" value="${ap.iv_ar_bu || 0}" step="0.1" data-f="iv_ar_bu"></td>
        <td><input type="number" class="table-input ${isArBuInv ? 'input-error' : ''}" value="${ap.in_ar_bu || 0}" step="0.1" data-f="in_ar_bu"></td>
        <td><strong>${cArBu.toFixed(1)}</strong></td>
        <td><input type="number" class="table-input" value="${ap.iv_ar_ba1 || 0}" step="0.1" data-f="iv_ar_ba1"></td>
        <td><input type="number" class="table-input ${isArBaInv ? 'input-error' : ''}" value="${ap.in_ar_ba1 || 0}" step="0.1" data-f="in_ar_ba1"></td>
        <td><strong>${cArBa.toFixed(1)}</strong></td>
        <td><input type="number" class="table-input" value="${ap.iv_ac_bu || 0}" step="0.1" data-f="iv_ac_bu"></td>
        <td><input type="number" class="table-input ${isAcBuInv ? 'input-error' : ''}" value="${ap.in_ac_bu || 0}" step="0.1" data-f="in_ac_bu"></td>
        <td><strong>${cAcBu.toFixed(1)}</strong></td>
        <td><input type="number" class="table-input" value="${ap.iv_ac_ba1 || 0}" step="0.1" data-f="iv_ac_ba1"></td>
        <td><input type="number" class="table-input ${isAcBaInv ? 'input-error' : ''}" value="${ap.in_ac_ba1 || 0}" step="0.1" data-f="in_ac_ba1"></td>
        <td><strong>${cAcBa.toFixed(1)}</strong></td>
        <td><button class="btn btn-small btn-secondary" onclick="window.egalizareIndexuriApartament(${ap.id})" title="AIA.PRG tasta +=EGAL: Setează Index Nou = Index Vechi (Consum=0)">➕</button></td>
      </tr>
    `;
  }).join('');
}

async function saveIndecsiApartamente() {
  const rows = document.querySelectorAll('#tbl-indecsi-apart tr[data-ap-id]');
  for (const row of rows) {
    const id = row.getAttribute('data-ap-id');
    const inputs = row.querySelectorAll('input[data-f]');
    const data = {};
    inputs.forEach(input => {
      data[input.getAttribute('data-f')] = parseFloat(input.value) || 0;
    });
    await apiPut(`/api/operatiuni/apartamente/${id}/extins`, data);
  }
  showAlert('Toți indecșii apartamentelor au fost salvați!', 'success');
  apartamenteCache = await apiGet(`/api/blocuri/${currentBlocId}/apartamente`);
  populateIndecsiApartamente();
  actualizeazaStatsDiferenteApa();
}

// AIA.PRG tasta +=EGAL — Egalizare Indexuri (Index Nou = Index Vechi, Consum = 0)
window.egalizareIndexuriApartament = async function(apartamentId) {
  const apId = apartamentId || apartamenteCache[0]?.id;
  if (!apId) return showAlert('Selectați un apartament!', 'warning');
  const res = await apiPost(`/api/operatiuni/apartamente/${apId}/egalizare-indexuri`, {});
  if (res.error) return showAlert(res.error, 'danger');
  showAlert(`Indecșii apartamentului au fost egalizați (Index Nou = Index Vechi, Consum = 0)!`, 'success');
  if (currentBlocId) {
    apartamenteCache = await apiGet(`/api/blocuri/${currentBlocId}/apartamente`);
    populateIndecsiApartamente();
    actualizeazaStatsDiferenteApa();
  }
  return res;
};

window.batchEgalizareIndexuri = async function(opts = {}) {
  const scope = opts.scope || document.getElementById('egal-scope')?.value || (currentBlocId ? 'BLOC' : 'TOATE');
  const blocId = opts.bloc_id || currentBlocId || allBlocuriCache[0]?.id || 1;
  const res = await apiPost('/api/operatiuni/apartamente/batch-egalizare-indexuri', {
    scope,
    bloc_id: blocId
  });
  if (res.error) return showAlert(res.error, 'danger');
  showAlert(`Indecșii au fost egalizați (Consum = 0) pentru ${res.updated_count ?? 0} apartamente (${scope})!`, 'success');
  if (currentBlocId) {
    apartamenteCache = await apiGet(`/api/blocuri/${currentBlocId}/apartamente`);
    populateIndecsiApartamente();
    actualizeazaStatsDiferenteApa();
  }
  return res;
};

function actualizeazaStatsDiferenteApa() {
  if (!currentBloc) return;
  const consumBloc = Math.max(0, (currentBloc.index_nou_ar || 0) - (currentBloc.index_vechi_ar || 0));

  let consumAp = 0;
  apartamenteCache.forEach(ap => {
    consumAp += Math.max(0, ((ap.in_ar_bu || 0) - (ap.iv_ar_bu || 0)) + ((ap.in_ar_ba1 || 0) - (ap.iv_ar_ba1 || 0)) + ((ap.in_ar_ba2 || 0) - (ap.iv_ar_ba2 || 0)));
  });

  const dif = Math.round((consumBloc - consumAp) * 100) / 100;
  const tarif = (currentBloc.tarif_apa_rece || 8.5) + (currentBloc.tarif_canal || 4.0);
  const cost = Math.max(0, Math.round(dif * tarif * 100) / 100);

  const statsEl = document.getElementById('diferenta-apa-stats');
  if (statsEl) {
    statsEl.innerHTML = `
      <div style="display:flex; gap:1.5rem; flex-wrap:wrap; font-size:0.95rem;">
        <div><strong>Contor General Bloc:</strong> <span class="badge badge-info">${consumBloc.toFixed(1)} m³</span></div>
        <div><strong>Suma Apometre Locatari:</strong> <span class="badge badge-info">${consumAp.toFixed(1)} m³</span></div>
        <div><strong>Diferență / Pierdere:</strong> <span class="badge ${dif > 0 ? 'badge-warning' : 'badge-success'}">${dif.toFixed(1)} m³</span></div>
        <div><strong>Valoare Totală Pierdere:</strong> <strong>${cost.toFixed(2)} RON</strong> (la tarif ${tarif.toFixed(2)} lei/m³)</div>
      </div>
    `;
  }
}

async function repartizeazaDiferenteApa() {
  if (!currentBloc) return;
  const res = await apiPost(`/api/blocuri/${currentBloc.id}/repartizeaza-diferente-apa`, {});
  if (res.error) return showAlert(res.error, 'warning');

  showAlert(`Diferența de ${res.diferentaMc} m³ (${res.valoareTotala} RON) a fost repartizată pe ${res.modRepartizare}!`, 'success');
  loadFacturiBloc();
  actualizeazaStatsDiferenteApa();
}

// ============================================================
//  🔥 REPARTITOARE CĂLDURĂ, REDUCERI & PROCENTE (#tab-repartitoare)
//  (ARA.PRG / TCE.PRG / CRE.PRG / SUM.PRG / APS.PRG / ADC.PRG)
// ============================================================
function switchRepartitoareSubView(viewName) {
  ['ara', 'tce', 'proc'].forEach(v => {
    const div = document.getElementById(`subview-${v}`);
    const btn = document.getElementById(`subbtn-${v}`);
    if (div) div.style.display = (v === viewName) ? 'block' : 'none';
    if (btn) {
      btn.className = (v === viewName) ? 'btn btn-small btn-primary' : 'btn btn-small btn-outline';
    }
  });
}

function populateRepartitoareTab() {
  populateRepartitoareARA();
  populateReduceriTCE();
  populateProcenteMetrologie();
}

function populateRepartitoareARA() {
  const tbody = document.getElementById('tbl-repartitoare-ara');
  if (!tbody) return;

  const activePer = perioadeCache.find(p => Number(p.id) === Number(currentPerioadaId)) || {};
  const tarifEt = Number(currentBloc?.tarif_et || activePer.tarif_et || 0);

  tbody.innerHTML = apartamenteCache.map(ap => {
    const rInputs = [1, 2, 3, 4, 5].map(r => `
      <td><input type="number" class="table-input" style="width:58px;" step="0.01" value="${ap[`iv_r${r}`] || 0}" data-f="iv_r${r}" title="Serie R${r}: ${ap[`serie_r${r}`] || '-'} | Coef: ${(ap[`facttr_r${r}`] || 1) * (ap[`coefsp_r${r}`] || 1)}"></td>
      <td><input type="number" class="table-input" style="width:58px;" step="0.01" value="${ap[`in_r${r}`] || 0}" data-f="in_r${r}" title="Index Nou R${r}"></td>
    `).join('');

    const gcalRed = Number(ap.gcal_red || 0);
    const gcalRedLei = tarifEt > 0 && gcalRed > 0 ? Math.round(gcalRed * tarifEt * 100) / 100 : 0;

    return `
      <tr data-ap-id="${ap.id}">
        <td><strong>${ap.numar_apart}</strong></td>
        <td>${ap.nume_proprietar || '-'}</td>
        <td><input type="number" class="table-input" style="width:65px;" step="0.01" value="${ap.sup_ec_ter || 0}" data-f="sup_ec_ter"></td>
        <td>
          <select class="table-input" style="width:55px;" data-f="cp_in">
            <option value="C" ${(ap.cp_in || 'C') === 'C' ? 'selected' : ''}>C</option>
            <option value="P" ${ap.cp_in === 'P' ? 'selected' : ''}>P</option>
            <option value="D" ${ap.cp_in === 'D' ? 'selected' : ''}>D</option>
          </select>
        </td>
        ${rInputs}
        <td>
          <input type="number" class="table-input" style="width:72px;" step="0.01" value="${gcalRedLei}" data-f="gcal_red_lei" title="ARA.PRG: Valoare reducere în Lei (GCAL_RED = ${gcalRed.toFixed(4)} Gcal)">
        </td>
        <td style="text-align:right; font-weight:600; color:#1e40af;">${Number(ap.tot_unit || 0).toFixed(2)}</td>
        <td style="text-align:right; font-weight:700; color:#15803d;">${Number(ap.gcal_final || 0).toFixed(4)}</td>
        <td>
          <button class="btn btn-small btn-secondary" onclick="openApartamentExtinsModal(${ap.id})" title="Editează R1..R7, coeficienți, serii, fond rulment și metrologie">⚙️ R1-R7</button>
        </td>
      </tr>
    `;
  }).join('');
}

function populateReduceriTCE() {
  const tbody = document.getElementById('tbl-reduceri-tce');
  if (!tbody) return;

  tbody.innerHTML = apartamenteCache.map(ap => `
    <tr data-ap-id="${ap.id}">
      <td><strong>${ap.numar_apart}</strong></td>
      <td>${ap.nume_proprietar || '-'}</td>
      <td>${ap.suprafata || 0}</td>
      <td><input type="number" class="table-input" style="width:70px;" step="0.01" value="${ap.supr_redus || 0}" data-f="supr_redus"></td>
      <td><input type="date" class="table-input" style="width:130px;" value="${(ap.d1 || '').slice(0, 10)}" data-f="d1"></td>
      <td><input type="date" class="table-input" style="width:130px;" value="${(ap.d2 || '').slice(0, 10)}" data-f="d2"></td>
      <td><input type="number" class="table-input" style="width:65px;" step="1" value="${ap.p1_scaz || 0}" data-f="p1_scaz"></td>
      <td><input type="number" class="table-input" style="width:75px;" step="0.01" value="${ap.sl1_scaz || 0}" data-f="sl1_scaz"></td>
      <td><input type="number" class="table-input" style="width:65px;" step="1" value="${ap.p2_scaz || 0}" data-f="p2_scaz"></td>
      <td><input type="number" class="table-input" style="width:75px;" step="0.01" value="${ap.sl2_scaz || 0}" data-f="sl2_scaz"></td>
      <td><input type="number" class="table-input" style="width:75px;" step="0.01" value="${ap.set_scaz || 0}" data-f="set_scaz"></td>
      <td><input type="text" class="table-input" style="width:130px;" value="${ap.observatii || ''}" data-f="observatii"></td>
    </tr>
  `).join('');
}

function populateProcenteMetrologie() {
  const tbody = document.getElementById('tbl-procente-metrologie');
  if (!tbody) return;

  tbody.innerHTML = apartamenteCache.map(ap => `
    <tr data-ap-id="${ap.id}">
      <td><strong>${ap.numar_apart}</strong></td>
      <td>${ap.nume_proprietar || '-'}</td>
      <td><input type="number" class="table-input" style="width:55px;" value="${ap.procg ?? 100}" data-f="procg"></td>
      <td><input type="number" class="table-input" style="width:55px;" value="${ap.procascens ?? 100}" data-f="procascens"></td>
      <td><input type="number" class="table-input" style="width:55px;" value="${ap.proc_cu_sc ?? 100}" data-f="proc_cu_sc"></td>
      <td><input type="number" class="table-input" style="width:55px;" value="${ap.proc_cu_li ?? 100}" data-f="proc_cu_li"></td>
      <td><input type="number" class="table-input" style="width:55px;" value="${ap.proc_sal_f ?? 100}" data-f="proc_sal_f"></td>
      <td><input type="number" class="table-input" style="width:55px;" value="${ap.proc_sal_t ?? 100}" data-f="proc_sal_t"></td>
      <td><input type="number" class="table-input" style="width:55px;" value="${ap.proc_chadm ?? 100}" data-f="proc_chadm"></td>
      <td><input type="number" class="table-input" style="width:55px;" value="${ap.proc_chsed ?? 100}" data-f="proc_chsed"></td>
      <td><input type="number" class="table-input" style="width:55px;" value="${ap.proc_difer ?? 100}" data-f="proc_difer"></td>
      <td><input type="number" class="table-input" style="width:55px;" value="${ap.proc_difin ?? 100}" data-f="proc_difin"></td>
      <td><input type="number" class="table-input" style="width:55px;" value="${ap.proc_av_ac ?? 0}" data-f="proc_av_ac"></td>
      <td><input type="number" class="table-input" style="width:55px;" value="${ap.proc_av_in ?? 0}" data-f="proc_av_in"></td>
      <td><input type="date" class="table-input" style="width:120px;" value="${(ap.d_v_ar_bu || '').slice(0, 10)}" data-f="d_v_ar_bu"></td>
      <td><input type="date" class="table-input" style="width:120px;" value="${(ap.d_v_ar_ba1 || '').slice(0, 10)}" data-f="d_v_ar_ba1"></td>
      <td><input type="date" class="table-input" style="width:120px;" value="${(ap.d_v_ac_bu || '').slice(0, 10)}" data-f="d_v_ac_bu"></td>
      <td><input type="date" class="table-input" style="width:120px;" value="${(ap.d_v_ac_ba1 || '').slice(0, 10)}" data-f="d_v_ac_ba1"></td>
      <td><input type="date" class="table-input" style="width:120px;" value="${(ap.d_v_in || '').slice(0, 10)}" data-f="d_v_in"></td>
    </tr>
  `).join('');
}

async function saveAllRepartitoareARA() {
  const rows = document.querySelectorAll('#tbl-repartitoare-ara tr[data-ap-id]');
  for (const row of rows) {
    const id = row.getAttribute('data-ap-id');
    const data = {};
    row.querySelectorAll('[data-f]').forEach(el => {
      const f = el.getAttribute('data-f');
      data[f] = el.tagName === 'SELECT' ? el.value : (parseFloat(el.value) || 0);
    });
    await apiPut(`/api/operatiuni/apartamente/${id}/extins`, data);
  }
  showAlert('Repartitoarele (ARA) au fost salvate! Puteți rula acum 2. Calcul CRE.', 'success');
  apartamenteCache = await apiGet(`/api/blocuri/${currentBlocId}/apartamente`);
  populateRepartitoareTab();
}

async function saveAllReduceriTCE() {
  const rows = document.querySelectorAll('#tbl-reduceri-tce tr[data-ap-id]');
  for (const row of rows) {
    const id = row.getAttribute('data-ap-id');
    const data = {};
    row.querySelectorAll('[data-f]').forEach(el => {
      const f = el.getAttribute('data-f');
      if (el.type === 'date' || el.type === 'text') {
        data[f] = el.value.trim();
      } else {
        data[f] = parseFloat(el.value) || 0;
      }
    });
    await apiPut(`/api/operatiuni/apartamente/${id}/extins`, data);
  }
  showAlert('Scăderile și cererile temporare (APS/TCE) au fost salvate!', 'success');
  apartamenteCache = await apiGet(`/api/blocuri/${currentBlocId}/apartamente`);
  populateRepartitoareTab();
}

async function saveAllProcenteMetrologie() {
  const rows = document.querySelectorAll('#tbl-procente-metrologie tr[data-ap-id]');
  for (const row of rows) {
    const id = row.getAttribute('data-ap-id');
    const data = {};
    row.querySelectorAll('[data-f]').forEach(el => {
      const f = el.getAttribute('data-f');
      data[f] = el.type === 'date' ? el.value.trim() : (parseFloat(el.value) || 0);
    });
    await apiPut(`/api/operatiuni/apartamente/${id}/extins`, data);
  }
  showAlert('Procentele de participare și datele metrologice au fost salvate!', 'success');
  apartamenteCache = await apiGet(`/api/blocuri/${currentBlocId}/apartamente`);
  populateRepartitoareTab();
}

window.onExtGcalRedLeiInput = function() {
  const leiVal = parseFloat(document.getElementById('ext-gcal-red-lei')?.value);
  const gcalEl = document.getElementById('ext-gcal-red');
  if (!gcalEl || isNaN(leiVal)) return;
  const activePer = perioadeCache.find(p => Number(p.id) === Number(currentPerioadaId)) || {};
  const tarifEt = Number(currentBloc?.tarif_et || activePer.tarif_et || 0);
  if (tarifEt > 0) {
    gcalEl.value = (Math.round((leiVal / tarifEt) * 10000) / 10000).toFixed(4);
  }
};

function openApartamentExtinsModal(apId) {
  const ap = apartamenteCache.find(a => Number(a.id) === Number(apId));
  if (!ap) return;

  document.getElementById('ext-ap-id').value = ap.id;
  document.getElementById('ext-ap-title').textContent = `Bl. ${currentBloc?.bloc || '-'} / Ap. ${ap.numar_apart} (${ap.nume_proprietar || '-'})`;

  const tbody = document.getElementById('tbody-modal-r1-r7');
  if (tbody) {
    tbody.innerHTML = [1, 2, 3, 4, 5, 6, 7].map(r => {
      const iv = ap[`iv_r${r}`] || 0;
      const inVal = ap[`in_r${r}`] || 0;
      const ft = ap[`facttr_r${r}`] ?? 1;
      const cs = ap[`coefsp_r${r}`] ?? 1;
      const unit = Math.max(0, inVal - iv) * ft * cs;
      return `
        <tr>
          <td><strong>R${r}</strong></td>
          <td><input type="text" class="table-input" id="ext-serie-r${r}" value="${ap[`serie_r${r}`] || ''}"></td>
          <td><input type="number" class="table-input" id="ext-iv-r${r}" step="0.01" value="${iv}"></td>
          <td><input type="number" class="table-input" id="ext-in-r${r}" step="0.01" value="${inVal}"></td>
          <td><input type="number" class="table-input" id="ext-facttr-r${r}" step="0.001" value="${ft}"></td>
          <td><input type="number" class="table-input" id="ext-coefsp-r${r}" step="0.001" value="${cs}"></td>
          <td><strong>${unit.toFixed(2)}</strong></td>
        </tr>
      `;
    }).join('');
  }

  const activePer = perioadeCache.find(p => Number(p.id) === Number(currentPerioadaId)) || {};
  const tarifEt = Number(currentBloc?.tarif_et || activePer.tarif_et || 0);
  const gcalRed = Number(ap.gcal_red || 0);
  const gcalRedEl = document.getElementById('ext-gcal-red');
  const gcalRedLeiEl = document.getElementById('ext-gcal-red-lei');
  if (gcalRedEl) gcalRedEl.value = gcalRed;
  if (gcalRedLeiEl) gcalRedLeiEl.value = (tarifEt > 0 && gcalRed > 0) ? (Math.round(gcalRed * tarifEt * 100) / 100) : '';

  document.getElementById('ext-ser-ar-bu').value = ap.ser_ar_bu || '';
  document.getElementById('ext-dv-ar-bu').value = (ap.d_v_ar_bu || '').slice(0, 10);
  document.getElementById('ext-ser-ar-ba1').value = ap.ser_ar_ba1 || '';
  document.getElementById('ext-dv-ar-ba1').value = (ap.d_v_ar_ba1 || '').slice(0, 10);
  document.getElementById('ext-ser-ar-ba2').value = ap.ser_ar_ba2 || '';
  document.getElementById('ext-dv-ar-ba2').value = (ap.d_v_ar_ba2 || '').slice(0, 10);

  document.getElementById('ext-ser-ac-bu').value = ap.ser_ac_bu || '';
  document.getElementById('ext-dv-ac-bu').value = (ap.d_v_ac_bu || '').slice(0, 10);
  document.getElementById('ext-ser-ac-ba1').value = ap.ser_ac_ba1 || '';
  document.getElementById('ext-dv-ac-ba1').value = (ap.d_v_ac_ba1 || '').slice(0, 10);
  document.getElementById('ext-ser-ac-ba2').value = ap.ser_ac_ba2 || '';
  document.getElementById('ext-dv-ac-ba2').value = (ap.d_v_ac_ba2 || '').slice(0, 10);

  document.getElementById('ext-max-fr').value = ap.max_fond_rulment ?? ap.max_fr ?? 0;
  document.getElementById('ext-calc-fr').value = ap.calc_fr ?? 0;
  document.getElementById('ext-plat-fr').value = ap.plat_fr ?? 0;
  document.getElementById('ext-rulment').value = ap.rulment ?? 0;
  document.getElementById('ext-fond-repar').value = ap.fond_reparatii ?? ap.fond_repar ?? 0;
  document.getElementById('ext-repar-crt').value = ap.repar_crt ?? 0;
  document.getElementById('ext-ch-box').value = ap.ch_box ?? 0;
  document.getElementById('ext-ch-hav').value = ap.ch_hav ?? 0;
  document.getElementById('ext-altele').value = ap.altele ?? 0;
  document.getElementById('ext-i-ajust').value = ap.i ?? 0;

  showModal('modal-apartament-extins');
}

async function saveModalApartamentExtins() {
  const id = document.getElementById('ext-ap-id').value;
  if (!id) return;

  const payload = {
    ser_ar_bu: document.getElementById('ext-ser-ar-bu').value.trim(),
    d_v_ar_bu: document.getElementById('ext-dv-ar-bu').value,
    ser_ar_ba1: document.getElementById('ext-ser-ar-ba1').value.trim(),
    d_v_ar_ba1: document.getElementById('ext-dv-ar-ba1').value,
    ser_ar_ba2: document.getElementById('ext-ser-ar-ba2').value.trim(),
    d_v_ar_ba2: document.getElementById('ext-dv-ar-ba2').value,
    ser_ac_bu: document.getElementById('ext-ser-ac-bu').value.trim(),
    d_v_ac_bu: document.getElementById('ext-dv-ac-bu').value,
    ser_ac_ba1: document.getElementById('ext-ser-ac-ba1').value.trim(),
    d_v_ac_ba1: document.getElementById('ext-dv-ac-ba1').value,
    ser_ac_ba2: document.getElementById('ext-ser-ac-ba2').value.trim(),
    d_v_ac_ba2: document.getElementById('ext-dv-ac-ba2').value,
    max_fr: parseFloat(document.getElementById('ext-max-fr').value) || 0,
    calc_fr: parseFloat(document.getElementById('ext-calc-fr').value) || 0,
    plat_fr: parseFloat(document.getElementById('ext-plat-fr').value) || 0,
    rulment: parseFloat(document.getElementById('ext-rulment').value) || 0,
    fond_repar: parseFloat(document.getElementById('ext-fond-repar').value) || 0,
    repar_crt: parseFloat(document.getElementById('ext-repar-crt').value) || 0,
    ch_box: parseFloat(document.getElementById('ext-ch-box').value) || 0,
    ch_hav: parseFloat(document.getElementById('ext-ch-hav').value) || 0,
    altele: parseFloat(document.getElementById('ext-altele').value) || 0,
    i: parseFloat(document.getElementById('ext-i-ajust').value) || 0,
    gcal_red: parseFloat(document.getElementById('ext-gcal-red')?.value) || 0
  };

  const gcalRedLeiRaw = document.getElementById('ext-gcal-red-lei')?.value;
  if (gcalRedLeiRaw !== undefined && String(gcalRedLeiRaw).trim() !== '') {
    payload.gcal_red_lei = parseFloat(gcalRedLeiRaw) || 0;
  }

  for (let r = 1; r <= 7; r++) {
    payload[`serie_r${r}`] = document.getElementById(`ext-serie-r${r}`).value.trim();
    payload[`iv_r${r}`] = parseFloat(document.getElementById(`ext-iv-r${r}`).value) || 0;
    payload[`in_r${r}`] = parseFloat(document.getElementById(`ext-in-r${r}`).value) || 0;
    payload[`facttr_r${r}`] = parseFloat(document.getElementById(`ext-facttr-r${r}`).value) || 1;
    payload[`coefsp_r${r}`] = parseFloat(document.getElementById(`ext-coefsp-r${r}`).value) || 1;
  }

  const res = await apiPut(`/api/operatiuni/apartamente/${id}/extins`, payload);
  if (res.error) return showAlert(res.error, 'danger');

  closeModal('modal-apartament-extins');
  showAlert('Datele extinse ale apartamentului (R1..R7, ADC, Metrologie) au fost salvate!', 'success');
  apartamenteCache = await apiGet(`/api/blocuri/${currentBlocId}/apartamente`);
  populateRepartitoareTab();
  populateApartamente();
}

// ============================================================
//  MOTORUL DE CALCUL FOXPRO: 1. TCE -> 2. CRE -> 3. SUM
// ============================================================
function setCalculFeedback(html, isError = false) {
  const fb = document.getElementById('calcul-lunar-feedback');
  if (!fb) return;
  fb.style.display = 'block';
  fb.style.borderColor = isError ? '#fca5a5' : '#86efac';
  fb.style.background = isError ? '#fef2f2' : '#f0fdf4';
  fb.style.color = isError ? '#991b1b' : '#166534';
  fb.innerHTML = html;
}

async function runCalculTCE() {
  const res = await apiPost('/api/calcul/tce', {});
  if (res.error) {
    setCalculFeedback(`❌ <strong>Eroare TCE:</strong> ${res.error}`, true);
    return showAlert(res.error, 'danger');
  }
  const msg = `✅ <strong>1. TCE (Trecere Cereri Expirate) finalizat:</strong> ${res.expiredCount || 0} cereri expirate înainte de ${res.ultima_zi || 'sfârșitul lunii'} au fost actualizate.`;
  setCalculFeedback(msg);
  showAlert(`TCE executat cu succes (${res.expiredCount || 0} cereri expirate)!`, 'success');
  if (currentBlocId) {
    apartamenteCache = await apiGet(`/api/blocuri/${currentBlocId}/apartamente`);
    populateRepartitoareTab();
  }
}

async function runCalculCRE() {
  const res = await apiPost('/api/calcul/cre', {});
  if (res.error) {
    setCalculFeedback(`❌ <strong>Eroare CRE:</strong> ${res.error}`, true);
    return showAlert(res.error, 'danger');
  }
  const msg = `✅ <strong>2. CRE (Calcul Repartitoare Căldură) finalizat:</strong> Unitățile R1..R7, Gcal/mp și Gcal_final au fost calculate pentru toate blocurile și apartamentele.`;
  setCalculFeedback(msg);
  showAlert('CRE (Calcul Repartitoare Căldură) executat cu succes!', 'success');
  if (currentBlocId) {
    apartamenteCache = await apiGet(`/api/blocuri/${currentBlocId}/apartamente`);
    populateRepartitoareTab();
  }
}

async function runCalculSUM() {
  const res = await apiPost('/api/calcul/sum', {});
  if (res.error) {
    setCalculFeedback(`❌ <strong>Eroare SUM:</strong> ${res.error}`, true);
    return showAlert(res.error, 'danger');
  }
  const nrAp = res.apartamente?.length || 0;
  const msg = `✅ <strong>3. SUM (Însumare și Calcul Lunar 8 Pași) finalizat:</strong> S-au calculat cotele de întreținere pentru <strong>${nrAp} apartamente</strong> în snapshot-ul perioadei curente.`;
  setCalculFeedback(msg);
  showAlert(`SUM executat cu succes pentru ${nrAp} apartamente!`, 'success');
  if (currentBlocId) {
    apartamenteCache = await apiGet(`/api/blocuri/${currentBlocId}/apartamente`);
    populateRepartitoareTab();
    populateApartamente();
  }
}

// ============================================================
//  APARTAMENTE & OPERAȚIUNI ÎN MASĂ (APS.PRG F4=INLO / F5=CMFR, ADB.PRG F5=ACEL)
// ============================================================
window.batchInlocuireApartamente = async function(opts = {}) {
  const scope = opts.scope || document.getElementById('inlo-scope')?.value || (currentBlocId ? 'BLOC' : 'TOATE');
  const getOptNum = (val, elId) => {
    if (val !== undefined && val !== null && val !== '') return parseFloat(val);
    const raw = document.getElementById(elId)?.value;
    if (raw !== undefined && raw !== null && String(raw).trim() !== '') return parseFloat(raw);
    return undefined;
  };
  const payload = {
    scope,
    bloc_id: opts.bloc_id || currentBlocId || allBlocuriCache[0]?.id || 1,
    repar_crt: getOptNum(opts.repar_crt, 'inlo-repar-crt'),
    altele: getOptNum(opts.altele, 'inlo-altele'),
    i: getOptNum(opts.i, 'inlo-i'),
    fond_repar: getOptNum(opts.fond_repar, 'inlo-fond-repar')
  };
  if (payload.repar_crt === undefined && payload.altele === undefined && payload.i === undefined && payload.fond_repar === undefined) {
    payload.repar_crt = 0;
  }
  const res = await apiPost('/api/operatiuni/apartamente/batch-inlocuire', payload);
  if (res.error) return showAlert(res.error, 'danger');
  showAlert(`Înlocuire în masă (APS.PRG F4=INLO) aplicată pe ${res.updated_count ?? 0} apartamente!`, 'success');
  if (currentBlocId) {
    apartamenteCache = await apiGet(`/api/blocuri/${currentBlocId}/apartamente`);
    populateApartamente();
    populateRepartitoareTab();
  }
  return res;
};

window.batchMaxFrApartamente = async function(opts = {}) {
  const activePer = perioadeCache.find(p => Number(p.id) === Number(currentPerioadaId)) || { an: 2026, luna: 9 };
  const scope = opts.scope || document.getElementById('inlo-scope')?.value || 'BLOC';
  const refLuna = parseInt(opts.ref_luna ?? document.getElementById('cmfr-ref-luna')?.value, 10) || activePer.luna || 9;
  const refAn = parseInt(opts.ref_an ?? document.getElementById('cmfr-ref-an')?.value, 10) || activePer.an || 2026;
  const payload = {
    ref_an: refAn,
    ref_luna: refLuna,
    bloc_id: scope === 'BLOC' ? (opts.bloc_id || currentBlocId || undefined) : undefined,
    use_current: true
  };
  const res = await apiPost('/api/operatiuni/apartamente/batch-max-fr', payload);
  if (res.error) return showAlert(res.error, 'danger');
  showAlert(`Maxim Fond Rulment (APS.PRG F5=CMFR) actualizat pe ${res.updated_count ?? 0} apartamente din luna ${refLuna}/${refAn}!`, 'success');
  if (currentBlocId) {
    apartamenteCache = await apiGet(`/api/blocuri/${currentBlocId}/apartamente`);
    populateApartamente();
    populateRepartitoareTab();
  }
  return res;
};

window.batchTermicBlocuri = async function(opts = {}) {
  const ecartEl = document.getElementById('set-ecart-temp');
  const randEl = document.getElementById('set-rand-tr');
  const onlyHwEl = document.getElementById('acel-only-hw');
  const ecartTemp = opts.ecart_temp !== undefined
    ? parseFloat(opts.ecart_temp)
    : (ecartEl && ecartEl.value !== '' ? parseFloat(ecartEl.value) : (currentBloc?.ecart_temp ?? 50));
  const randTr = opts.rand_tr !== undefined
    ? parseFloat(opts.rand_tr)
    : (randEl && randEl.value !== '' ? parseFloat(randEl.value) : (currentBloc?.rand_tr ?? 95));
  const onlyWithHotWater = opts.only_with_hot_water !== undefined
    ? Boolean(opts.only_with_hot_water)
    : (onlyHwEl ? Boolean(onlyHwEl.checked) : true);

  const res = await apiPost('/api/operatiuni/blocuri/batch-termic', {
    ecart_temp: ecartTemp,
    rand_tr: randTr,
    only_with_hot_water: onlyWithHotWater
  });
  if (res.error) return showAlert(res.error, 'danger');
  showAlert(`Parametrii termici (ADB.PRG F5=ACEL: Ecart=${ecartTemp}°C, Randament=${randTr}%) au fost aplicați pe ${res.updated_count ?? 0} blocuri!`, 'success');
  if (currentBlocId) {
    currentBloc = await apiGet(`/api/blocuri/${currentBlocId}`);
    populateSetariBloc();
  }
  await loadBlocuri();
  return res;
};

function populateApartamente() {
  const tbody = document.getElementById('tbl-apartamente');
  if (!tbody) return;
  tbody.innerHTML = apartamenteCache.map(ap => `
    <tr>
      <td><strong>${ap.numar_apart}</strong></td>
      <td>${ap.nume_proprietar || '-'}</td>
      <td>${ap.persoane ?? 1}</td>
      <td>${ap.suprafata ? ap.suprafata + ' mp' : '-'}</td>
      <td>${formatMoney(ap.restante || 0)} RON</td>
      <td>${formatMoney(ap.penalizari || 0)} RON</td>
      <td>${formatMoney(ap.fond_reparatii || 0)} RON</td>
      <td>
        <button class="btn btn-secondary btn-small" onclick="editApartament(${ap.id})" title="Editează date de bază">✏️</button>
        <button class="btn btn-primary btn-small" onclick="openApartamentExtinsModal(${ap.id})" title="Editează R1..R7, Fond Rulment, Metrologie">⚙️ Extins</button>
        <button class="btn btn-danger btn-small" onclick="deleteApartament(${ap.id})" title="Șterge">🗑️</button>
      </td>
    </tr>
  `).join('');
}

function showAddApartamentModal() {
  document.getElementById('new-apart-nr').value = '';
  document.getElementById('new-apart-nume').value = '';
  document.getElementById('new-apart-pers').value = '1';
  document.getElementById('new-apart-sup').value = '';
  showModal('modal-add-apart');
}

async function addApartament() {
  const nr = document.getElementById('new-apart-nr').value.trim();
  if (!nr) return showAlert('Introduceți numărul apartamentului!', 'warning');

  await apiPost(`/api/blocuri/${currentBlocId}/apartamente`, {
    numar_apart: nr,
    nume_proprietar: document.getElementById('new-apart-nume').value.trim(),
    persoane: parseInt(document.getElementById('new-apart-pers').value) || 0,
    suprafata: parseFloat(document.getElementById('new-apart-sup').value) || 0
  });

  closeModal('modal-add-apart');
  showAlert('Apartament adăugat!', 'success');
  apartamenteCache = await apiGet(`/api/blocuri/${currentBlocId}/apartamente`);
  populateApartamente();
  populateIndecsiApartamente();
  populateRepartitoareTab();
}

function editApartament(id) {
  const ap = apartamenteCache.find(a => a.id === id);
  if (!ap) return;
  document.getElementById('edit-apart-id').value = ap.id;
  document.getElementById('edit-apart-nr').value = ap.numar_apart;
  document.getElementById('edit-apart-nume').value = ap.nume_proprietar || '';
  document.getElementById('edit-apart-pers').value = ap.persoane ?? 1;
  document.getElementById('edit-apart-sup').value = ap.suprafata || 0;
  document.getElementById('edit-apart-restante').value = ap.restante || 0;
  document.getElementById('edit-apart-penalizari').value = ap.penalizari || 0;
  showModal('modal-edit-apart');
}

async function saveEditApartament() {
  const id = document.getElementById('edit-apart-id').value;
  await apiPut(`/api/apartamente/${id}`, {
    numar_apart: document.getElementById('edit-apart-nr').value.trim(),
    nume_proprietar: document.getElementById('edit-apart-nume').value.trim(),
    persoane: parseInt(document.getElementById('edit-apart-pers').value) || 0,
    suprafata: parseFloat(document.getElementById('edit-apart-sup').value) || 0,
    restante: parseFloat(document.getElementById('edit-apart-restante').value) || 0,
    penalizari: parseFloat(document.getElementById('edit-apart-penalizari').value) || 0
  });

  closeModal('modal-edit-apart');
  showAlert('Apartament actualizat!', 'success');
  apartamenteCache = await apiGet(`/api/blocuri/${currentBlocId}/apartamente`);
  populateApartamente();
  populateRepartitoareTab();
}

async function deleteApartament(id) {
  if (confirm('Sigur doriți să ștergeți acest apartament?')) {
    await apiDelete(`/api/apartamente/${id}`);
    showAlert('Apartament șters!', 'info');
    apartamenteCache = await apiGet(`/api/blocuri/${currentBlocId}/apartamente`);
    populateApartamente();
    populateIndecsiApartamente();
    populateRepartitoareTab();
  }
}

// ============================================================
//  FACTURI & REPARTIZARE
// ============================================================
async function loadFacturiBloc() {
  if (!currentBlocId) return;
  const facturi = await apiGet(`/api/facturi?bloc_id=${currentBlocId}`);
  const listEl = document.getElementById('facturi-list');
  if (!listEl) return;

  if (!Array.isArray(facturi) || facturi.length === 0) {
    listEl.innerHTML = '<div class="empty-state">Nu există facturi înregistrate pentru acest bloc.</div>';
    return;
  }

  listEl.innerHTML = `
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Tip Factură</th>
            <th>Nivel</th>
            <th>Sumă</th>
            <th>Mod Repartizare</th>
            <th>Furnizor</th>
            <th>Stare</th>
            <th>Acțiuni</th>
          </tr>
        </thead>
        <tbody>
          ${facturi.map(f => `
            <tr>
              <td><strong>${formatTipFactura(f.tip_factura)}</strong></td>
              <td>${f.bloc_id ? `Bloc ${f.bloc_nume || currentBloc.bloc}` : '<span class="badge badge-info">Toată Asociația</span>'}</td>
              <td><strong>${formatMoney(f.suma)} RON</strong></td>
              <td>${f.mod_repartizare === 'PERSOANE' ? 'Pe Persoane' : 'Cotă Parte (mp)'}</td>
              <td>${f.furnizor || '-'}</td>
              <td>
                ${f.nr_repartizari > 0 
                  ? '<span class="badge badge-success">Repartizată</span>' 
                  : '<span class="badge badge-warning">Nerepartizată</span>'}
              </td>
              <td>
                <button class="btn btn-primary btn-small" onclick="repartizeazaFactura(${f.id})">⚡ Repartizează</button>
                <button class="btn btn-secondary btn-small" onclick="veziRepartizare(${f.id})">👁️ Detalii</button>
                <button class="btn btn-danger btn-small" onclick="deleteFactura(${f.id})">🗑️</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function showAddFacturaModal() {
  document.getElementById('new-fact-suma').value = '';
  document.getElementById('new-fact-furnizor').value = '';
  document.getElementById('new-fact-denumire').value = '';
  document.getElementById('new-fact-nr').value = '';
  showModal('modal-add-factura');
}

async function addFactura() {
  const tip = document.getElementById('new-fact-tip').value;
  const suma = parseFloat(document.getElementById('new-fact-suma').value);
  if (!tip) return showAlert('Selectați tipul facturii!', 'warning');
  if (!suma || suma <= 0) return showAlert('Introduceți o sumă validă!', 'warning');

  const nivel = document.getElementById('new-fact-nivel').value;
  await apiPost('/api/facturi', {
    bloc_id: nivel === 'asociatie' ? null : currentBlocId,
    tip_factura: tip,
    suma,
    mod_repartizare: document.getElementById('new-fact-repartizare').value,
    luna: parseInt(document.getElementById('new-fact-luna').value),
    an: parseInt(document.getElementById('new-fact-an').value),
    numar_factura: document.getElementById('new-fact-nr').value.trim(),
    data_factura: document.getElementById('new-fact-data').value,
    furnizor: document.getElementById('new-fact-furnizor').value.trim(),
    denumire: document.getElementById('new-fact-denumire').value.trim()
  });

  closeModal('modal-add-factura');
  showAlert('Factură adăugată!', 'success');
  loadFacturiBloc();
}

async function repartizeazaFactura(facturaId) {
  const result = await apiPost(`/api/facturi/${facturaId}/repartizeaza`, {});
  if (result.error) return showAlert(result.error, 'warning');

  showAlert(`Factura a fost repartizată pe ${result.repartizari} apartamente!`, 'success');
  loadFacturiBloc();
  veziRepartizare(facturaId);
}

async function veziRepartizare(facturaId) {
  const repartizare = await apiGet(`/api/facturi/${facturaId}/repartizare`);
  const container = document.getElementById('repartizare-container');

  if (repartizare.length === 0) {
    container.innerHTML = '<div class="empty-state">Factura nu a fost încă repartizată. Apăsați „Repartizează”.</div>';
    return;
  }

  const total = repartizare.reduce((sum, r) => sum + r.suma_repartizata, 0);

  container.innerHTML = `
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Bloc</th>
            <th>Nr. Ap.</th>
            <th>Proprietar</th>
            <th>Persoane</th>
            <th>Suprafață</th>
            <th>Sumă Repartizată</th>
          </tr>
        </thead>
        <tbody>
          ${repartizare.map(r => `
            <tr>
              <td>Bloc ${r.bloc}</td>
              <td><strong>Ap. ${r.numar_apart}</strong></td>
              <td>${r.nume_proprietar || '-'}</td>
              <td>${r.persoane}</td>
              <td>${r.suprafata} mp</td>
              <td><strong>${formatMoney(r.suma_repartizata)} RON</strong></td>
            </tr>
          `).join('')}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="5"><strong>TOTAL REPARTIZAT:</strong></td>
            <td><strong>${formatMoney(total)} RON</strong></td>
          </tr>
        </tfoot>
      </table>
    </div>
  `;
}

async function deleteFactura(id) {
  if (confirm('Sigur doriți să ștergeți această factură?')) {
    await apiDelete(`/api/facturi/${id}`);
    showAlert('Factură ștearsă!', 'info');
    loadFacturiBloc();
    document.getElementById('repartizare-container').innerHTML = '<div class="empty-state">Selectați o factură.</div>';
  }
}

// ============================================================
//  SETĂRI BLOC & TARIFE EXTINSE (ADB.PRG & ADR.PRG)
// ============================================================
function populateSetariBloc() {
  if (!currentBloc) return;
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el && val !== undefined && val !== null) el.value = val;
  };

  setVal('set-bloc', currentBloc.bloc || '');
  setVal('set-strada', currentBloc.strada || '');
  setVal('set-numar', currentBloc.numar || '');
  setVal('set-cod', currentBloc.cod || currentBloc.cod_postal || '');
  setVal('set-cod-postal', currentBloc.cod || currentBloc.cod_postal || '');

  setVal('set-tarif-ar', currentBloc.tarif_apa_rece ?? 8.5);
  setVal('set-tarif-canal', currentBloc.tarif_canal ?? 4.0);
  setVal('set-tarif-ac', currentBloc.tarif_apa_calda ?? 18.0);
  setVal('set-cota-fr', currentBloc.cota_fond_reparatii ?? currentBloc.cota_fr ?? 10.0);

  setVal('set-cp-ar', currentBloc.cp_ar || 'C');
  setVal('set-cp-ac', currentBloc.cp_ac || 'C');
  setVal('set-cp-in', currentBloc.cp_in || 'P');

  setVal('set-mod-r-dif', currentBloc.mod_r_dif || currentBloc.mod_repartizare_dif || 'SUP');
  setVal('set-mod-r-inc', currentBloc.mod_r_inc || 'SUP');
  setVal('set-modr-difin', currentBloc.modr_difin || 'SUP');
  setVal('set-mod-r-asc', currentBloc.mod_r_asc || 'PER');

  setVal('set-proc-inccom', currentBloc.procinccom ?? 30);
  setVal('set-procinccom', currentBloc.procinccom ?? 30);
  setVal('set-proc-av-ac', currentBloc.proc_av_ac ?? 0);
  setVal('set-proc-av-in', currentBloc.proc_av_in ?? 0);
  setVal('set-proc-sal-f', currentBloc.proc_sal_femeie ?? currentBloc.proc_sal_f ?? 100);
  setVal('set-proc-sal-t', currentBloc.proc_sal_tesa ?? currentBloc.proc_sal_t ?? 100);
  setVal('set-proc-gunoi', currentBloc.proc_gunoi ?? currentBloc.procgunoi ?? 100);
  setVal('set-proc-abona', currentBloc.proc_abona ?? currentBloc.proc_abonament ?? 100);
  setVal('set-proc-chadm', currentBloc.proc_chadm ?? currentBloc.proc_ch_admin ?? 100);
  setVal('set-proc-chsed', currentBloc.proc_chsed ?? 100);

  setVal('set-ecart-temp', currentBloc.ecart_temp ?? 50);
  setVal('set-rand-tr', currentBloc.rand_tr ?? 95);
  setVal('set-tarif-et', currentBloc.tarif_et ?? 0);
  setVal('set-constin', currentBloc.const_incalzire ?? currentBloc.constin ?? 1);

  setVal('set-fact-gaz', currentBloc.gaz ?? 0);
  setVal('set-fact-gunoi', currentBloc.gunoi ?? 0);
  setVal('set-fact-curent', currentBloc.curent ?? 0);
  setVal('set-fact-curent-sc', currentBloc.curent_sc ?? 0);
  setVal('set-fact-curent-li', currentBloc.curent_li ?? 0);
  setVal('set-fact-ascensor', currentBloc.ascensor ?? 0);
  setVal('set-fact-sal-feme', currentBloc.sal_feme ?? 0);
  setVal('set-fact-sal-tesa', currentBloc.sal_tesa ?? 0);
  setVal('set-fact-ch-admin', currentBloc.ch_admin ?? 0);
  setVal('set-fact-ch-sediu', currentBloc.ch_sediu ?? 0);
  setVal('set-fact-prest-serv', currentBloc.prest_serv ?? 0);
  setVal('set-fact-chelt-inc', currentBloc.chelt_inc ?? 0);
  setVal('set-fact-abonament', currentBloc.abonament ?? 0);
  setVal('set-fact-can-met', currentBloc.can_met ?? 0);
}

async function saveSetariBloc() {
  if (!currentBloc) return;
  const getVal = (id, def = 0) => {
    const el = document.getElementById(id);
    if (!el || el.value === '') return def;
    const n = parseFloat(el.value);
    return isNaN(n) ? def : n;
  };
  const getStr = (id, def = '') => {
    const el = document.getElementById(id);
    return el ? el.value.trim() : def;
  };

  const codPostalVal = getStr('set-cod-postal') || getStr('set-cod');
  const payload = {
    bloc: getStr('set-bloc', currentBloc.bloc),
    strada: getStr('set-strada'),
    numar: getStr('set-numar'),
    cod: codPostalVal,
    cod_postal: codPostalVal,
    tarif_apa_rece: getVal('set-tarif-ar', 8.5),
    tarif_canal: getVal('set-tarif-canal', 4.0),
    tarif_apa_calda: getVal('set-tarif-ac', 18.0),
    cota_fond_reparatii: getVal('set-cota-fr', 10.0),
    cota_fr: getVal('set-cota-fr', 10.0),
    cp_ar: getStr('set-cp-ar', 'C'),
    cp_ac: getStr('set-cp-ac', 'C'),
    cp_in: getStr('set-cp-in', 'P'),
    mod_r_dif: getStr('set-mod-r-dif', 'SUP'),
    mod_r_inc: getStr('set-mod-r-inc', 'SUP'),
    modr_difin: getStr('set-modr-difin', 'SUP'),
    mod_r_asc: getStr('set-mod-r-asc', 'PER'),
    procinccom: getVal('set-procinccom', getVal('set-proc-inccom', 30)),
    proc_av_ac: getVal('set-proc-av-ac', 0),
    proc_av_in: getVal('set-proc-av-in', 0),
    proc_sal_femeie: getVal('set-proc-sal-f', 100),
    proc_sal_f: getVal('set-proc-sal-f', 100),
    proc_sal_tesa: getVal('set-proc-sal-t', 100),
    proc_sal_t: getVal('set-proc-sal-t', 100),
    proc_gunoi: getVal('set-proc-gunoi', 100),
    procgunoi: getVal('set-proc-gunoi', 100),
    proc_abona: getVal('set-proc-abona', 100),
    proc_chadm: getVal('set-proc-chadm', 100),
    proc_chsed: getVal('set-proc-chsed', 100),
    ecart_temp: getVal('set-ecart-temp', 50),
    rand_tr: getVal('set-rand-tr', 95),
    tarif_et: getVal('set-tarif-et', 0),
    constin: getVal('set-constin', 1),
    const_incalzire: getVal('set-constin', 1),
    gaz: getVal('set-fact-gaz', 0),
    gunoi: getVal('set-fact-gunoi', currentBloc.gunoi ?? 0),
    curent: getVal('set-fact-curent', 0),
    curent_sc: getVal('set-fact-curent-sc', 0),
    curent_li: getVal('set-fact-curent-li', 0),
    ascensor: getVal('set-fact-ascensor', 0),
    sal_feme: getVal('set-fact-sal-feme', currentBloc.sal_feme ?? 0),
    sal_tesa: getVal('set-fact-sal-tesa', currentBloc.sal_tesa ?? 0),
    ch_admin: getVal('set-fact-ch-admin', currentBloc.ch_admin ?? 0),
    ch_sediu: getVal('set-fact-ch-sediu', currentBloc.ch_sediu ?? 0),
    prest_serv: getVal('set-fact-prest-serv', 0),
    chelt_inc: getVal('set-fact-chelt-inc', 0),
    abonament: getVal('set-fact-abonament', 0),
    can_met: getVal('set-fact-can-met', 0)
  };

  await apiPut(`/api/operatiuni/blocuri/${currentBloc.id}/extins`, payload);

  showAlert('Setările extinse ale blocului (ADB & ADR) au fost salvate!', 'success');
  currentBloc = await apiGet(`/api/blocuri/${currentBloc.id}`);
  document.getElementById('bloc-title').textContent = `Bloc ${currentBloc.bloc}`;
  loadBlocuri();
}

// ============================================================
//  AVIZIER / LISTĂ PLATĂ (ECHIVALENT LAR.PRG FOXPRO)
// ============================================================
async function populateAvizierBlocSelect() {
  const select = document.getElementById('avizier-bloc-select');
  if (!select) return;
  if (allBlocuriCache.length === 0) {
    allBlocuriCache = await apiGet('/api/blocuri');
  }

  select.innerHTML = allBlocuriCache.map(b => `
    <option value="${b.id}" ${b.id === currentBlocId ? 'selected' : ''}>🏢 Bloc ${b.bloc} (${b.strada || 'Strada'} Nr. ${b.numar || '-'})</option>
  `).join('');

  loadListaPlataAvizier();
}

function deschideAvizierBlocCurent() {
  switchMainSection('avizier');
  if (currentBlocId) {
    document.getElementById('avizier-bloc-select').value = currentBlocId;
    loadListaPlataAvizier();
  }
}

async function loadListaPlataAvizier() {
  const blocId = document.getElementById('avizier-bloc-select')?.value;
  if (!blocId) return;

  const luna = document.getElementById('avizier-luna-select').value;
  const an = document.getElementById('avizier-an-select').value;

  const data = await apiGet(`/api/blocuri/${blocId}/lista-plata?luna=${luna}&an=${an}`);
  if (data.error) return showAlert(data.error, 'warning');

  const asoc = data.asociatie || {};
  const bloc = data.bloc || {};
  const termenZile = parseInt(document.getElementById('avizier-termen-zile').value) || 20;

  const azi = new Date();
  const scadenta = new Date();
  scadenta.setDate(azi.getDate() + termenZile);
  const dataScadentaFormat = scadenta.toLocaleDateString('ro-RO');

  document.getElementById('avizier-header-box').innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <div>
        <h2 style="margin:0; font-size:1.3rem;">ASOCIAȚIA DE PROPRIETARI „${asoc.nume || 'TEST ADMINISTRATORI'}”</h2>
        <p style="margin:0.25rem 0; color:#475569; font-size:0.9rem;">
          C.I.F.: ${asoc.cod_fiscal || '00000000'} • Sediul: ${asoc.adresa || 'Str. Test, Nr. 1'}
        </p>
      </div>
      <div style="text-align:right;">
        <h3 style="margin:0; color:#1e40af; font-size:1.15rem;">LISTA DE PLATĂ A COTELOR DE ÎNTREȚINERE</h3>
        <p style="margin:0.25rem 0; font-weight:600;">LUNA: ${data.lunaNume} ${data.an}</p>
        <span class="badge badge-warning">Termen Scadență: ${dataScadentaFormat} (${termenZile} zile)</span>
      </div>
    </div>
    <div style="margin-top:0.75rem; padding-top:0.5rem; border-top:1px dashed #cbd5e1; display:flex; justify-content:space-between; font-size:0.85rem;">
      <div><strong>Imobil:</strong> BLOC ${bloc.bloc}, ${bloc.strada || ''} Nr. ${bloc.numar || ''}</div>
      <div><strong>Tarif Apă Rece + Canal:</strong> ${(data.tarife.apa_rece).toFixed(2)} lei/m³</div>
      <div><strong>Tarif Apă Caldă:</strong> ${(data.tarife.apa_calda).toFixed(2)} lei/m³</div>
      <div><strong>Penalizare:</strong> ${asoc.proc_penalizare || 0.2}% / zi după scadență</div>
    </div>
  `;

  document.getElementById('sig-presedinte').textContent = asoc.presedinte || 'Presedinte Test';
  document.getElementById('sig-administrator').textContent = asoc.administrator || 'Administrator Test';

  const tbody = document.getElementById('tbody-avizier');
  tbody.innerHTML = data.apartamente.map(ap => `
    <tr>
      <td><strong>${ap.numar_apart}</strong></td>
      <td>${ap.persoane}</td>
      <td>${ap.suprafata.toFixed(2)}</td>
      <td>${ap.consum_ar_mc.toFixed(1)}</td>
      <td>${formatMoney(ap.valoare_ar)}</td>
      <td>${formatMoney(ap.diferente_apa)}</td>
      <td>${formatMoney(ap.valoare_ac)}</td>
      <td>${formatMoney(ap.incalzire)}</td>
      <td>${formatMoney(ap.gunoi)}</td>
      <td>${formatMoney(ap.lift)}</td>
      <td>${formatMoney(ap.curent_comun)}</td>
      <td>${formatMoney(ap.salarii_admin)}</td>
      <td>${formatMoney(ap.fond_reparatii)}</td>
      <td>${formatMoney(ap.altele)}</td>
      <td><strong>${formatMoney(ap.total_luna)}</strong></td>
      <td>${formatMoney(ap.restante)}</td>
      <td>${formatMoney(ap.penalizari)}</td>
      <td class="td-total-plata">${formatMoney(ap.total_general)}</td>
    </tr>
  `).join('');

  const t = data.totaluri;
  document.getElementById('tfoot-avizier').innerHTML = `
    <tr>
      <td style="text-align:left;"><strong>TOTAL BLOC:</strong></td>
      <td><strong>${t.persoane}</strong></td>
      <td><strong>${t.suprafata.toFixed(2)}</strong></td>
      <td><strong>${t.consum_ar_mc.toFixed(1)}</strong></td>
      <td><strong>${formatMoney(t.valoare_ar)}</strong></td>
      <td><strong>${formatMoney(t.diferente_apa)}</strong></td>
      <td><strong>${formatMoney(t.valoare_ac)}</strong></td>
      <td><strong>${formatMoney(t.incalzire)}</strong></td>
      <td><strong>${formatMoney(t.gunoi)}</strong></td>
      <td><strong>${formatMoney(t.lift)}</strong></td>
      <td><strong>${formatMoney(t.curent_comun)}</strong></td>
      <td><strong>${formatMoney(t.salarii_admin)}</strong></td>
      <td><strong>${formatMoney(t.fond_reparatii)}</strong></td>
      <td><strong>${formatMoney(t.altele)}</strong></td>
      <td><strong>${formatMoney(t.total_luna)}</strong></td>
      <td><strong>${formatMoney(t.restante)}</strong></td>
      <td><strong>${formatMoney(t.penalizari)}</strong></td>
      <td class="td-total-plata"><strong>${formatMoney(t.total_general)} LEI</strong></td>
    </tr>
  `;
}

function actualizeazaDataScadenta() {
  loadListaPlataAvizier();
}

function printAvizier() {
  document.body.setAttribute('data-print-orientation', 'LANDSCAPE');
  window.print();
}

function exportAvizierCSV() {
  const table = document.getElementById('table-avizier');
  let csv = [];
  for (let r of table.rows) {
    let row = [];
    for (let c of r.cells) {
      row.push('"' + c.innerText.replace(/"/g, '""').trim() + '"');
    }
    csv.push(row.join(','));
  }
  const blob = new Blob(['\uFEFF' + csv.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Lista_Plata_Avizier_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
}

// ============================================================
//  📊 CATALOG 35 RAPOARTE FOXPRO (#sec-rapoarte / #view-rapoarte)
// ============================================================
async function initRapoarteCatalog() {
  if (!reportCatalogCache) {
    try {
      const cat = await apiGet('/api/rapoarte/catalog');
      if (Array.isArray(cat)) {
        reportCatalogCache = {
          LISTARE: cat.filter(r => (r.menu || r.category || '').toUpperCase().includes('LISTARE')),
          SITUATII: cat.filter(r => (r.menu || r.category || '').toUpperCase().includes('SITUAT')),
          CENTRALIZARE: cat.filter(r => (r.menu || r.category || '').toUpperCase().includes('CENTRAL') || ['IN1', 'IN2'].includes(r.code))
        };
      } else if (cat && (cat.LISTARE || cat.SITUATII || cat.CENTRALIZARE)) {
        reportCatalogCache = cat;
      }
    } catch (e) {
      // Fallback
    }
  }

  if (reportCatalogCache) {
    const renderItems = (items = []) => items.map(item => `
      <button class="report-catalog-btn ${item.code === currentReportCode ? 'active' : ''}" data-report-code="${item.code}" onclick="selectReport('${item.code}')">
        <span class="report-code-pill">${item.key ? item.key + ' • ' : ''}${item.code}</span>
        <span class="report-title-text">${item.title}</span>
      </button>
    `).join('');

    const elList = document.getElementById('catalog-listare-items');
    const elSit = document.getElementById('catalog-situatii-items');
    const elCent = document.getElementById('catalog-centralizare-items');
    if (elList) elList.innerHTML = renderItems(reportCatalogCache.LISTARE);
    if (elSit) elSit.innerHTML = renderItems(reportCatalogCache.SITUATII);
    if (elCent) elCent.innerHTML = renderItems(reportCatalogCache.CENTRALIZARE);
  }

  // Populate bloc filter
  if (allBlocuriCache.length === 0) {
    allBlocuriCache = await apiGet('/api/blocuri');
  }
  const blocSel = document.getElementById('rapoarte-bloc-select');
  if (blocSel && blocSel.options.length <= 1) {
    blocSel.innerHTML = `<option value="">Toate Blocurile</option>` + allBlocuriCache.map(b => `
      <option value="${b.bloc}">🏢 Bloc ${b.bloc} (${b.strada || ''} ${b.numar || ''})</option>
    `).join('');
  }

  await selectReport(currentReportCode || 'LAF');
}

function filterReportCatalogSidebar(query = '') {
  const q = String(query || '').trim().toLowerCase();
  document.querySelectorAll('.report-catalog-btn').forEach(btn => {
    const code = (btn.getAttribute('data-report-code') || '').toLowerCase();
    const text = (btn.innerText || '').toLowerCase();
    btn.style.display = (!q || code.includes(q) || text.includes(q)) ? '' : 'none';
  });
}

async function onRapoarteBlocChange() {
  const blocVal = document.getElementById('rapoarte-bloc-select')?.value || '';
  const apSel = document.getElementById('rapoarte-apart-select');
  if (apSel) {
    if (!blocVal) {
      apSel.innerHTML = `<option value="">Toate Apartamentele</option>`;
    } else {
      const blocObj = allBlocuriCache.find(b => String(b.bloc) === String(blocVal) || String(b.id) === String(blocVal));
      if (blocObj) {
        const aps = await apiGet(`/api/blocuri/${blocObj.id}/apartamente`);
        apSel.innerHTML = `<option value="">Toate Apartamentele (Bl. ${blocObj.bloc})</option>` + aps.map(a => `
          <option value="${a.id}">Ap. ${a.numar_apart} — ${a.nume_proprietar || ''}</option>
        `).join('');
      }
    }
  }
  reloadCurrentReport();
}

async function selectReport(code, updateHistory = true) {
  currentReportCode = String(code || 'LAF').toUpperCase();

  if (updateHistory && activeSection === 'rapoarte') {
    const targetHash = `#rapoarte/${currentReportCode}`;
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
}

async function reloadCurrentReport() {
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

  // Collect custom interactive parameters for all 14 parameterized FoxPro reports
  if (typeof collectCustomReportParams === 'function') {
    collectCustomReportParams(currentReportCode, params, false);
  }

  const report = await apiGet(`/api/rapoarte/${currentReportCode}?${params.toString()}`);
  if (report.error) return showAlert(report.error, 'warning');
  currentReportData = report;

  // Update metadata headers
  const elCode = document.getElementById('raport-active-code');
  const elTitle = document.getElementById('raport-active-title');
  const elMeta = document.getElementById('raport-active-meta');
  const elOrient = document.getElementById('raport-orientation-badge');

  if (elCode) elCode.textContent = `${report.code} (${report.frx || report.prg || report.code})`;
  if (elTitle) elTitle.textContent = report.title || report.code;
  if (elMeta) {
    const gdprStatus = report.gdpr_applicable
      ? (report.gdpr_masked ? '🔒 GDPR Activ: Numele proprietarilor sunt anonimizate pentru avizier' : '🔓 Uz Intern: Numele proprietarilor sunt afișate')
      : '📋 Raport tabelar administrativ';
    elMeta.textContent = `Meniu FoxPro: ${report.menu} • Tasta [${report.key || '-'}] • ${report.rows?.length || 0} rânduri • ${gdprStatus}`;
  }
  if (elOrient) {
    elOrient.textContent = `A4 ${report.orientation || 'PORTRAIT'}`;
    elOrient.className = `badge ${report.orientation === 'LANDSCAPE' ? 'badge-warning' : 'badge-info'}`;
  }

  // Print header
  const pTitle = document.getElementById('raport-print-title');
  const pSub = document.getElementById('raport-print-subtitle');
  const pMeta = document.getElementById('raport-print-meta');
  if (pTitle) pTitle.textContent = `${report.code} — ${report.title}`;
  if (pSub) pSub.textContent = `ASOCIAȚIA DE PROPRIETARI „${report.asociatie?.nume || 'TEST'}”`;
  if (pMeta) {
    const lunaNume = report.period?.luna_nume || NUME_LUNI_RO[report.period?.luna] || report.period?.luna || '';
    pMeta.innerHTML = `Perioada: <strong>${lunaNume} ${report.period?.an || ''}</strong><br>${blocVal ? `Filtru Bloc: <strong>${blocVal}</strong>` : 'Toate Blocurile'}`;
  }

  // Set orientation class
  const container = document.getElementById('rapoarte-printable-container');
  if (container) {
    container.classList.toggle('print-landscape', report.orientation === 'LANDSCAPE');
    container.classList.toggle('print-portrait', report.orientation !== 'LANDSCAPE');
  }

  // Render table columns, rows, and totals
  const thead = document.getElementById('thead-raport-dinamic');
  const tbody = document.getElementById('tbody-raport-dinamic');
  const tfoot = document.getElementById('tfoot-raport-dinamic');
  const cols = report.columns || [];

  if (thead) {
    thead.innerHTML = `<tr>${cols.map(c => `<th>${c.label}</th>`).join('')}</tr>`;
  }

  if (tbody) {
    if (!report.rows || report.rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="${Math.max(1, cols.length)}" style="text-align:center; padding:1.5rem; color:#64748b;">Nu există înregistrări pentru criteriile selectate.</td></tr>`;
    } else {
      tbody.innerHTML = report.rows.map(row => `
        <tr>
          ${cols.map(c => {
            const v = row[c.key];
            if (typeof v === 'number') {
              const isIntField = ['persoane', 'nr', 'numar', 'zile', 'an', 'luna'].includes(c.key);
              return `<td style="text-align:right; font-variant-numeric:tabular-nums;">${isIntField ? v : formatMoney(v)}</td>`;
            }
            return `<td>${v !== undefined && v !== null ? v : ''}</td>`;
          }).join('')}
        </tr>
      `).join('');
    }
  }

  if (tfoot) {
    if (report.totals && Object.keys(report.totals).length > 0 && cols.length > 0) {
      tfoot.innerHTML = `
        <tr style="background:#f1f5f9; font-weight:700;">
          ${cols.map((c, idx) => {
            if (idx === 0) return `<td>TOTAL GENERAL</td>`;
            const tv = report.totals[c.key];
            if (typeof tv === 'number') {
              const isIntField = ['persoane', 'nr'].includes(c.key);
              return `<td style="text-align:right;">${isIntField ? tv : formatMoney(tv)}</td>`;
            }
            return `<td>${tv !== undefined ? tv : ''}</td>`;
          }).join('')}
        </tr>
      `;
    } else {
      tfoot.innerHTML = '';
    }
  }
}

function printCurrentReport() {
  const orient = currentReportData?.orientation || 'PORTRAIT';
  document.body.setAttribute('data-print-orientation', orient);
  window.print();
}

async function exportCurrentReportCSV() {
  const blocVal = document.getElementById('rapoarte-bloc-select')?.value || '';
  const apVal = document.getElementById('rapoarte-apart-select')?.value || '';
  const showNames = document.getElementById('rapoarte-gdpr-toggle')?.checked ? 'true' : 'false';
  const activePer = perioadeCache.find(p => Number(p.id) === Number(currentPerioadaId));

  const params = new URLSearchParams({ format: 'csv', showNames });
  if (blocVal) params.set('bloc', blocVal);
  if (apVal) params.set('apartament_id', apVal);
  if (activePer) {
    params.set('an', activePer.an);
    params.set('luna', activePer.luna);
  }
  if (typeof collectCustomReportParams === 'function') {
    collectCustomReportParams(currentReportCode, params, true);
  }

  function downloadFromMemory() {
    if (currentReportData && currentReportData.columns) {
      const cols = currentReportData.columns || [];
      const header = cols.map(c => `"${String(c.label || c.key || '').replace(/"/g, '""')}"`).join(',');
      const rows = (currentReportData.rows || []).map(r => cols.map(c => `"${String(r[c.key] ?? '').replace(/"/g, '""')}"`).join(','));
      const csvContent = '\uFEFF' + [header, ...rows].join('\r\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `raport_${currentReportCode}_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 2000);
      showAlert(`Raportul ${currentReportCode} a fost exportat din datele curente.`, 'success');
      return true;
    }
    return false;
  }

  try {
    const res = await fetch(`/api/rapoarte/${currentReportCode}?${params.toString()}`, {
      headers: getApiHeaders()
    });
    const cType = res.headers.get('content-type') || '';
    if (!res.ok || cType.includes('text/html')) {
      throw new Error(`Răspuns invalid de la server (${res.status}, ${cType})`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `raport_${currentReportCode}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 2000);
    showAlert(`Raportul ${currentReportCode} a fost descărcat în format CSV.`, 'success');
  } catch (err) {
    // If fetch fails or returns HTML, immediately generates the CSV directly from currentReportData in memory and downloads it!
    const ok = downloadFromMemory();
    if (!ok) {
      showAlert('Eroare la descărcarea fișierului CSV: ' + err.message, 'warning');
    }
  }
}

// ============================================================
//  CASIERIE & CHITANȚE (CHI.PRG & CHO.FXP)
// ============================================================
async function populateCasierieBlocSelect() {
  const select = document.getElementById('cas-bloc-select');
  if (!select) return;
  if (allBlocuriCache.length === 0) {
    allBlocuriCache = await apiGet('/api/blocuri');
  }

  select.innerHTML = '<option value="">-- Alege Bloc --</option>' + allBlocuriCache.map(b => `
    <option value="${b.id}" ${b.id === currentBlocId ? 'selected' : ''}>🏢 Bloc ${b.bloc}</option>
  `).join('');

  if (currentBlocId) {
    onCasierieBlocChange();
  }
}

async function onCasierieBlocChange() {
  const blocId = document.getElementById('cas-bloc-select').value;
  const apSelect = document.getElementById('cas-apart-select');
  document.getElementById('cas-debt-box').style.display = 'none';

  if (!blocId) {
    apSelect.innerHTML = '<option value="">-- Alege Apartament --</option>';
    return;
  }

  const apartamente = await apiGet(`/api/blocuri/${blocId}/apartamente`);
  apSelect.innerHTML = '<option value="">-- Alege Apartament --</option>' + apartamente.map(a => `
    <option value="${a.id}">Ap. ${a.numar_apart} — ${a.nume_proprietar || 'Fără Nume'}</option>
  `).join('');
}

async function onCasierieApartChange() {
  const apId = document.getElementById('cas-apart-select')?.value;
  const debtBox = document.getElementById('cas-debt-box');
  if (!apId) {
    if (debtBox) debtBox.style.display = 'none';
    return;
  }

  const [ledger, fonduriSumar] = await Promise.all([
    apiGet(`/api/chitante/ledger/apartament/${apId}`),
    apiGet(`/api/chitante/fonduri-sumar/${apId}`)
  ]);
  if (!ledger || ledger.error) return;
  currentCasierieLedger = ledger;

  const ap = ledger.apartament || {};
  const propEl = document.getElementById('cas-debt-proprietar');
  if (propEl) propEl.textContent = ap.nume_proprietar || 'Proprietar';
  const detEl = document.getElementById('cas-debt-details');
  if (detEl) detEl.textContent = `Bloc ${ap.bloc || '-'} • Ap. ${ap.numar_apart} • ${ap.persoane ?? 1} Pers. • ${ap.suprafata || 0} mp`;

  const totals = ledger.totals || { R: 0, F: 0, A: 0, P: 0, totalRestanta: 0 };
  const setTxt = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  setTxt('cas-debt-regie', formatMoney(totals.R) + ' RON');
  setTxt('cas-debt-rulment', formatMoney(totals.F) + ' RON');
  setTxt('cas-debt-reparatii', formatMoney(totals.A) + ' RON');
  setTxt('cas-debt-restante', formatMoney((totals.R || 0) + (totals.F || 0) + (totals.A || 0)) + ' RON');
  setTxt('cas-debt-fond-rep', formatMoney(totals.F) + ' RON');
  setTxt('cas-debt-fond-rul', formatMoney(totals.A) + ' RON');
  setTxt('cas-debt-penalizari', formatMoney(totals.P) + ' RON');
  setTxt('cas-debt-total', formatMoney(totals.totalRestanta) + ' RON');

  // Populate CHI.PRG CTRL+F9 (Fond Rulment), CTRL+F4 (Fond Reparatii), CTRL+F5 (Penalitati) summary bar
  if (fonduriSumar && !fonduriSumar.error) {
    const fr = fonduriSumar.fond_rulment || {};
    const fa = fonduriSumar.fond_reparatii || {};
    const pen = fonduriSumar.penalitati || {};
    setTxt('sumar-fr-calc', formatMoney(fr.total_calculat || 0));
    setTxt('sumar-fr-achit', formatMoney(fr.total_achitat || 0));
    setTxt('sumar-fr-ramas', formatMoney(fr.sold_neachitat ?? totals.F ?? 0));
    setTxt('sumar-fa-calc', formatMoney(fa.total_calculat || 0));
    setTxt('sumar-fa-achit', formatMoney(fa.total_achitat || 0));
    setTxt('sumar-fa-ramas', formatMoney(fa.sold_neachitat ?? totals.A ?? 0));
    setTxt('sumar-pen-calc', formatMoney(pen.total_calculat || 0));
    setTxt('sumar-pen-achit', formatMoney(pen.total_achitat || 0));
    setTxt('sumar-pen-ramas', formatMoney(pen.sold_neachitat ?? totals.P ?? 0));
  }

  // Penalty preview box
  const penPreview = ledger.penalties_preview || ledger.penaltiesPreview || {};
  const penText = document.getElementById('cas-penalty-preview-text');
  if (penText) {
    const calcPen = Number(penPreview.total_penalizare || 0);
    penText.innerHTML = `Penalități calculate la zi (${penPreview.target_date || 'azi'}, ${penPreview.proc_penal || 0.2}%/zi, grație ${penPreview.zile_penal || 45} zile): <strong>${formatMoney(calcPen)} RON</strong> ${penPreview.credit_suppressed ? '<span class="badge badge-success">Credit avans (hjkg <= 0): Penalizări suprimate</span>' : ''}`;
  }

  // Render cumulative datorii ledger rows
  renderCasierieLedgerRows();

  if (debtBox) debtBox.style.display = 'block';

  const sumaEl = document.getElementById('cas-suma');
  const litEl = document.getElementById('cas-suma-litere');
  if (totals.totalRestanta > 0) {
    if (sumaEl) sumaEl.value = totals.totalRestanta.toFixed(2);
    updateSumaLiterePreview();
  } else {
    if (sumaEl) sumaEl.value = '';
    if (litEl) litEl.textContent = 'Sold 0.00 RON';
  }
}

function renderCasierieLedgerRows() {
  const tbody = document.getElementById('tbl-casierie-ledger');
  if (!tbody || !currentCasierieLedger) return;

  const rawMode = (document.querySelector('input[name="cas-mod-alocare"]:checked')?.value || 'lump').toLowerCase();
  const isManual = rawMode === 'manual';
  const rows = currentCasierieLedger.rows || [];

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#15803d; padding:0.75rem;">✅ Apartamentul nu are debite restante în registrul DATORII.</td></tr>`;
    return;
  }

  const catLabels = {
    'R': '<span class="badge badge-info">R • Întreținere</span>',
    'F': '<span class="badge badge-warning">F • Fond Rulm.</span>',
    'A': '<span class="badge badge-secondary">A • Fond Rep.</span>',
    'P': '<span class="badge badge-danger">P • Penalizări</span>'
  };

  tbody.innerHTML = rows.map(r => `
    <tr data-datorie-row-id="${r.id}">
      <td><strong>${r.luna_text || NUME_LUNI_RO[r.luna] || r.luna} ${r.an}</strong></td>
      <td>${catLabels[r.categorie] || r.categorie}</td>
      <td style="text-align:right;">${formatMoney(r.valoare)}</td>
      <td style="text-align:right; color:#15803d;">${formatMoney(r.achitat)}</td>
      <td style="text-align:right; font-weight:700; color:#dc2626;">${formatMoney(r.restanta)}</td>
      <td style="text-align:right;">
        <input type="number" class="table-input cas-manual-alloc-input" style="width:90px; ${isManual ? '' : 'opacity:0.45;'}"
          step="0.01" min="0" max="${r.restanta}" data-datorie-id="${r.id}"
          placeholder="${r.restanta.toFixed(2)}" ${isManual ? '' : 'disabled'}
          oninput="recalcManualCasierieTotal()">
      </td>
      <td style="white-space:nowrap;">
        <button class="btn btn-small btn-warning" style="padding:0.15rem 0.35rem; font-size:0.74rem;" onclick="window.punnrDebtRow(${r.id})" title="CHI.PRG F1=PUNNR: Pune numărul chitanței și marchează rândul ca achitat">⚡ F1</button>
        <button class="btn btn-small btn-secondary" style="padding:0.15rem 0.35rem; font-size:0.74rem;" onclick="window.editDebtRow(${r.id})" title="Editează rândul de datorie (VAL, VAL_ACHIT, Categ.)">✏️</button>
        <button class="btn btn-small btn-danger" style="padding:0.15rem 0.35rem; font-size:0.74rem;" onclick="window.deleteDebtRow(${r.id})" title="CHI.PRG F5=STERG: Șterge rândul de datorie">🗑️ F5</button>
      </td>
    </tr>
  `).join('');
}

// CHI.PRG F1=PUNNR — Marchează rândul de datorie ca achitat integral cu numărul chitanței
window.punnrDebtRow = async function(datorieId, opts = {}) {
  if (!datorieId) return;
  const dataAchit = opts.data_achitat || document.getElementById('cas-data')?.value || new Date().toISOString().slice(0, 10);
  const res = await apiPost(`/api/chitante/datorii/${datorieId}/punnr`, {
    numar_chitanta: opts.numar_chitanta,
    data_achitat: dataAchit,
    increment_counter: opts.increment_counter !== undefined ? opts.increment_counter : false
  });
  if (res.error) return showAlert(res.error, 'danger');
  showAlert(`Rândul de datorie #${datorieId} a fost marcat achitat (F1=PUNNR, Chit. #${res.numar_chitanta || ''})!`, 'success');
  await onCasierieApartChange();
  return res;
};

// CHI.PRG Editare rând în tabelul datorii
window.editDebtRow = async function(datorieId, directUpdates = null) {
  if (!datorieId) return;
  if (directUpdates && typeof directUpdates === 'object') {
    const res = await apiPut(`/api/chitante/datorii/${datorieId}`, directUpdates);
    if (res.error) return showAlert(res.error, 'danger');
    showAlert(`Rândul de datorie #${datorieId} a fost actualizat!`, 'success');
    await onCasierieApartChange();
    return res;
  }
  const rows = currentCasierieLedger?.rows || [];
  const row = rows.find(r => Number(r.id) === Number(datorieId));
  if (!row) return;
  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v ?? ''; };
  setVal('edit-debt-id', row.id);
  setVal('edit-debt-categorie', row.categorie || 'R');
  setVal('edit-debt-nr-chit', row.numar_chitanta || 0);
  setVal('edit-debt-valoare', row.valoare ?? 0);
  setVal('edit-debt-achitat', row.achitat ?? 0);
  setVal('edit-debt-data-afis', (row.data_afisare || '').slice(0, 10));
  setVal('edit-debt-data-achit', (row.data_achitat || '').slice(0, 10));
  setVal('edit-debt-lucrare', row.lucrare || '');
  showModal('modal-edit-datorie');
};

window.saveEditDebtRow = async function() {
  const id = document.getElementById('edit-debt-id')?.value;
  if (!id) return;
  const payload = {
    categorie: document.getElementById('edit-debt-categorie')?.value || 'R',
    numar_chitanta: parseInt(document.getElementById('edit-debt-nr-chit')?.value, 10) || 0,
    valoare: parseFloat(document.getElementById('edit-debt-valoare')?.value) || 0,
    achitat: parseFloat(document.getElementById('edit-debt-achitat')?.value) || 0,
    data_afisare: document.getElementById('edit-debt-data-afis')?.value || undefined,
    data_achitat: document.getElementById('edit-debt-data-achit')?.value || undefined,
    lucrare: document.getElementById('edit-debt-lucrare')?.value.trim() || ''
  };
  const res = await apiPut(`/api/chitante/datorii/${id}`, payload);
  if (res.error) return showAlert(res.error, 'danger');
  closeModal('modal-edit-datorie');
  showAlert(`Rândul de datorie #${id} a fost actualizat!`, 'success');
  await onCasierieApartChange();
  return res;
};

// CHI.PRG F5=STERG — Șterge un rând din tabelul datorii
window.deleteDebtRow = async function(datorieId) {
  if (!datorieId) return;
  const res = await apiDelete(`/api/chitante/datorii/${datorieId}`);
  if (res.error) return showAlert(res.error, 'danger');
  showAlert(`Rândul de datorie #${datorieId} a fost șters (F5=STERG)!`, 'info');
  await onCasierieApartChange();
  return res;
};

function onChangeModAlocareCasierie() {
  const rawMode = (document.querySelector('input[name="cas-mod-alocare"]:checked')?.value || 'lump').toLowerCase();
  const isManual = rawMode === 'manual';
  const hint = document.getElementById('cas-alocare-hint');
  if (hint) {
    hint.textContent = isManual
      ? 'Mod Manual activ: introduceți sumele dorite pe rândurile din tabelul de debite de mai sus.'
      : 'Ordine automată de stingere: Penalități (P) → Fond Rulment (A) → Fond Reparații (F) → Întreținere (R), începând cu cea mai veche lună.';
  }
  renderCasierieLedgerRows();
}

function recalcManualCasierieTotal() {
  const inputs = document.querySelectorAll('.cas-manual-alloc-input:not([disabled])');
  let sum = 0;
  inputs.forEach(inp => {
    sum += parseFloat(inp.value) || 0;
  });
  if (sum > 0) {
    document.getElementById('cas-suma').value = sum.toFixed(2);
    updateSumaLiterePreview();
  }
}

function achitaIntegralApartament() {
  if (!currentCasierieLedger) return;
  const tot = currentCasierieLedger.totals?.totalRestanta || 0;
  document.getElementById('cas-suma').value = tot.toFixed(2);
  updateSumaLiterePreview();
}

async function inregistreazaPenalitatiApartament() {
  const apId = document.getElementById('cas-apart-select')?.value;
  if (!apId) return showAlert('Selectați mai întâi apartamentul!', 'warning');

  const res = await apiPost(`/api/chitante/penalitati/${apId}/inregistreaza`, {});
  if (res.error) return showAlert(res.error, 'danger');

  showAlert(`Penalitățile la zi (${formatMoney(res.booked_amount || res.total_penalizare || 0)} RON) au fost înregistrate în registrul DATORII (Categ. P)!`, 'success');
  await onCasierieApartChange();
}

function updateSumaLiterePreview() {
  const val = parseFloat(document.getElementById('cas-suma').value);
  const text = numarInLitereClient(val);
  document.getElementById('cas-suma-litere').textContent = text;
}

async function emiteChitantaNoua() {
  const apId = document.getElementById('cas-apart-select').value;
  const suma = parseFloat(document.getElementById('cas-suma').value);
  if (!apId) return showAlert('Selectați apartamentul!', 'warning');
  if (!suma || suma <= 0) return showAlert('Introduceți suma încasată!', 'warning');

  const rawMode = (document.querySelector('input[name="cas-mod-alocare"]:checked')?.value || 'lump').toLowerCase();
  const isManual = rawMode === 'manual';
  const mode = isManual ? 'manual' : 'lump';
  const allocations = [];
  if (isManual) {
    document.querySelectorAll('.cas-manual-alloc-input').forEach(inp => {
      const s = parseFloat(inp.value) || 0;
      if (s > 0) {
        allocations.push({
          datorie_id: parseInt(inp.getAttribute('data-datorie-id'), 10),
          suma: s
        });
      }
    });
  }

  const data = {
    apartament_id: parseInt(apId, 10),
    suma,
    mod_alocare: mode,
    allocations: allocations.length > 0 ? allocations : undefined,
    tip_plata: document.getElementById('cas-tip-plata').value,
    explicatie: document.getElementById('cas-explicatie').value.trim() || 'Cote întreținere',
    data_emiterii: document.getElementById('cas-data').value
  };

  const res = await apiPost('/api/chitante/individual', data);
  if (res.error) return showAlert(res.error, 'warning');

  const ch = res.chitanta || res;
  showAlert(`Chitanța #${ch.serie || 'ORH'} ${ch.numar} a fost emisă cu succes!`, 'success');

  document.getElementById('cas-suma').value = '';
  document.getElementById('cas-suma-litere').textContent = 'Introduceți suma...';
  await onCasierieApartChange();
  await loadChitante();

  arataChitantaModal(ch);
}

// CHO.FXP — Chitanță Colectivă / Descărcare Fond
async function showChitantaColectivaModal() {
  if (allBlocuriCache.length === 0) {
    allBlocuriCache = await apiGet('/api/blocuri');
  }
  const sel = document.getElementById('cho-bloc-select');
  if (sel) {
    sel.innerHTML = allBlocuriCache.map(b => `
      <option value="${b.id}" ${b.id === currentBlocId ? 'selected' : ''}>🏢 Bloc ${b.bloc} (${b.strada || ''})</option>
    `).join('');
  }
  showModal('modal-chitanta-colectiva');
}

async function emiteChitantaColectivaCHO() {
  const blocId = parseInt(document.getElementById('cho-bloc-select')?.value, 10);
  const categorie = document.getElementById('cho-categorie')?.value || 'F';
  const suma = parseFloat(document.getElementById('cho-suma')?.value);
  const modDist = document.getElementById('cho-mod')?.value || document.getElementById('cho-mod-distribuire')?.value || 'PER_APARTAMENT';
  const modNumar = document.getElementById('cho-mod-numar')?.value || 'INCREMENTAL';
  const sursa = document.getElementById('cho-sursa')?.value || 'CASA';
  const doc = document.getElementById('cho-document')?.value.trim() || '';
  const expl = document.getElementById('cho-lucrare')?.value.trim() || document.getElementById('cho-explicatie')?.value.trim() || 'Operațiune colectivă CHO';
  const dataDoc = document.getElementById('cho-data')?.value || new Date().toISOString().slice(0, 10);

  if (!blocId) return showAlert('Selectați blocul!', 'warning');
  if (!suma || isNaN(suma) || suma === 0) return showAlert('Introduceți o sumă nenulă (pozitivă sau negativă)!', 'warning');

  const res = await apiPost('/api/chitante/colectiv', {
    bloc_id: blocId,
    categorie,
    suma,
    mod_valoare: modDist,
    mod_distribuire: modDist,
    mod_numar: modNumar,
    sursa,
    document: doc,
    explicatie: expl,
    data: dataDoc
  });

  if (res.error) return showAlert(res.error, 'danger');

  closeModal('modal-chitanta-colectiva');
  showAlert(`Operațiunea colectivă (CHO) de ${formatMoney(suma)} RON pe categoria ${categorie} (${modDist}, ${modNumar}) a fost înregistrată!`, 'success');
  loadChitante();
  if (document.getElementById('cas-apart-select')?.value) {
    onCasierieApartChange();
  }
}

async function loadChitante() {
  const chitante = await apiGet('/api/chitante');
  const tbody = document.getElementById('tbl-chitante');
  if (!tbody) return;

  if (!Array.isArray(chitante) || chitante.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center">Nu există chitanțe emise încă.</td></tr>';
    return;
  }

  tbody.innerHTML = chitante.map(ch => `
    <tr style="${ch.anulata ? 'opacity:0.5; text-decoration:line-through;' : ''}">
      <td><strong>${ch.serie || 'ORH'} #${ch.numar}</strong></td>
      <td>${ch.data_emiterii || ch.data || '-'}</td>
      <td><strong>Ap. ${ch.numar_apart || '-'}</strong> (Bl. ${ch.cod_bloc || '-'})<br><small>${ch.nume_platitor || ch.nume_proprietar || '-'}</small></td>
      <td><strong>${formatMoney(ch.suma)} RON</strong></td>
      <td><span class="badge badge-info">${ch.tip_plata || 'NUMERAR'}</span></td>
      <td>${ch.anulata ? '<span class="badge badge-danger">Anulată</span>' : '<span class="badge badge-success">Validă</span>'}</td>
      <td>
        <button class="btn btn-primary btn-small" onclick='arataChitantaModal(${JSON.stringify(ch).replace(/'/g, "&#39;")})'>🖨️ Vezi</button>
        ${!ch.anulata ? `<button class="btn btn-danger btn-small" onclick="anuleazaChitanta(${ch.id})">❌</button>` : ''}
      </td>
    </tr>
  `).join('');
}

function arataChitantaModal(ch) {
  chitantaCurentaData = ch;
  const container = document.getElementById('chitanta-print-content');

  container.innerHTML = `
    <div class="chitanta-header">
      <div>
        <strong>ASOCIAȚIA DE PROPRIETARI „${asociatiiCache.find(a => Number(a.id) === Number(currentAsociatieId))?.nume || 'TEST'}”</strong>
      </div>
      <div style="text-align:right;">
        <strong>SERIA: ${ch.serie || 'ORH'} NR: ${ch.numar}</strong><br>
        Data: ${ch.data_emiterii || ch.data || '-'}<br>
        Tip: ${ch.tip_plata || 'NUMERAR'}
      </div>
    </div>

    <div class="chitanta-title">CHITANȚĂ DE ÎNCASARE</div>

    <div class="chitanta-row">
      Am primit de la: <strong>${ch.nume_platitor || ch.nume_proprietar || '-'}</strong>
    </div>
    <div class="chitanta-row">
      Adresa: <strong>Bloc ${ch.cod_bloc || '-'}, Apartament ${ch.numar_apart || '-'}</strong>
    </div>
    <div class="chitanta-row">
      Suma de: <strong>${formatMoney(ch.suma)} LEI</strong>
    </div>
    <div class="chitanta-row" style="font-style:italic;">
      (în litere: <em>${ch.suma_litere || numarInLitereClient(ch.suma)}</em>)
    </div>
    <div class="chitanta-row">
      Reprezentând: <strong>${ch.explicatie || 'Cote cheltuieli întreținere'}</strong>
    </div>

    <div class="chitanta-footer">
      <div>
        Locatar / Depunător:
      </div>
      <div>
        Casier / Administrator:<br>
        <strong>DORNESCU CRINELA</strong>
      </div>
    </div>
  `;

  showModal('modal-print-chitanta');
}

function printChitantaCurenta() {
  window.print();
}

async function anuleazaChitanta(id) {
  if (confirm('Sigur doriți să anulați această chitanță? Suma va fi readăugată la debitul locatarului!')) {
    const res = await apiPost(`/api/chitante/${id}/anuleaza`, {});
    if (res.error) return showAlert(res.error, 'warning');
    showAlert('Chitanța a fost anulată și soldurile au fost restaurate!', 'info');
    loadChitante();
    if (document.getElementById('cas-apart-select')?.value) {
      onCasierieApartChange();
    }
  }
}

// ============================================================
//  📒 REGISTRE FINANCIARE (ACA, ABA, APA, ORD, RAW AUDIT)
// ============================================================
function switchRegistreTab(tabName) {
  ['casa', 'banca', 'patrimoniu', 'ordine', 'raw'].forEach(t => {
    const div = document.getElementById(`reg-subtab-${t}`);
    const btn = document.getElementById(`reg-tab-btn-${t}`);
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
    return `
      <tr>
        <td>#${r.id}</td>
        <td><strong>${r.document || '-'}</strong></td>
        <td>${r.data || '-'}</td>
        <td><span class="badge ${isInc ? 'badge-success' : 'badge-danger'}">${isInc ? 'I • Încasare' : 'P • Plată'}</span></td>
        <td>${r.act_pas || 'A'}</td>
        <td>${r.explicatie || '-'}</td>
        <td style="text-align:right; font-weight:700; color:${isInc ? '#15803d' : '#dc2626'};">${formatMoney(r.suma)}</td>
        <td><button class="btn btn-small btn-danger" onclick="deleteCasaEntry(${r.id})">🗑️</button></td>
      </tr>
    `;
  }).join('');

  const badge = document.getElementById('casa-sold-badge');
  if (badge) {
    const sold = inc - pla;
    badge.textContent = `Sold Casă: ${formatMoney(sold)} RON`;
    badge.className = `badge ${sold >= 0 ? 'badge-success' : 'badge-danger'}`;
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

// ACA.PRG F6=PRINZ — Preia Încasările Zilei din Datorii în Registrul de Casă
window.preiaIncasarileZilei = async function(opts = {}) {
  const dataZi = opts.data || document.getElementById('casa-data')?.value || new Date().toISOString().slice(0, 10);
  const res = await apiPost('/api/operatiuni/casa/preia-incasari-zi', {
    data: dataZi,
    overwrite: opts.overwrite !== undefined ? opts.overwrite : true
  });
  if (res.error) return showAlert(res.error, 'danger');
  showAlert(`Preluare încasări zi (ACA.PRG F6=PRINZ pe ${dataZi}): ${res.inserted_count ?? 0} chitanțe preluate (${formatMoney(res.total_incasat || 0)} RON)!`, 'success');
  await loadRegistruCasa();
  return res;
};

async function deleteCasaEntry(id) {
  await apiDelete(`/api/operatiuni/casa/${id}`);
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
    return `
      <tr>
        <td>#${r.id}</td>
        <td><strong>${r.document || '-'}</strong></td>
        <td>${r.data || '-'}</td>
        <td><span class="badge ${isDep ? 'badge-success' : 'badge-warning'}">${isDep ? 'D • Depunere' : 'V • Virament'}</span></td>
        <td>${r.act_pas || 'A'}</td>
        <td>${r.explicatie || '-'}</td>
        <td style="text-align:right; font-weight:700;">${formatMoney(r.suma)}</td>
        <td><button class="btn btn-small btn-danger" onclick="deleteBancaEntry(${r.id})">🗑️</button></td>
      </tr>
    `;
  }).join('');

  const badge = document.getElementById('banca-sold-badge');
  if (badge) {
    const sold = dep - vir;
    badge.textContent = `Sold Bancă: ${formatMoney(sold)} RON`;
    badge.className = `badge ${sold >= 0 ? 'badge-success' : 'badge-danger'}`;
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
  await apiDelete(`/api/operatiuni/banca/${id}`);
  loadRegistruBanca();
}

// --- 3. PATRIMONIU ACTIV / PASIV (APA.PRG / CP1.PRG) ---
async function loadRegistruPatrimoniu() {
  const rows = await apiGet('/api/operatiuni/patrimoniu');
  const tbody = document.getElementById('tbl-reg-patrimoniu') || document.getElementById('tbl-registru-patrimoniu');
  if (!tbody || !Array.isArray(rows)) return;

  let totalActiv = 0, totalPasiv = 0;
  tbody.innerHTML = rows.map(r => {
    const isAct = (r.act_pas !== 'P');
    if (isAct) totalActiv += Number(r.suma || 0);
    else totalPasiv += Number(r.suma || 0);
    return `
      <tr>
        <td>#${r.id}</td>
        <td><span class="badge ${isAct ? 'badge-info' : 'badge-warning'}">${isAct ? 'ACTIV (A)' : 'PASIV (P)'}</span></td>
        <td><strong>${r.document || '-'}</strong></td>
        <td>${r.data || '-'}</td>
        <td>${r.explicatie || '-'}</td>
        <td>${r.perioada || '-'}</td>
        <td style="text-align:right; font-weight:700;">${formatMoney(r.suma)}</td>
        <td><button class="btn btn-small btn-danger" onclick="deletePatrimoniuEntry(${r.id})">🗑️</button></td>
      </tr>
    `;
  }).join('');

  const badge = document.getElementById('patrimoniu-sold-badge');
  if (badge) {
    badge.textContent = `Activ: ${formatMoney(totalActiv)} RON | Pasiv: ${formatMoney(totalPasiv)} RON`;
  }
}

async function addActPatrimoniu() {
  const payload = {
    document: document.getElementById('patr-doc')?.value.trim() || document.getElementById('patrim-doc')?.value.trim() || document.getElementById('reg-pat-doc')?.value.trim() || 'DOC-PATRIM',
    data: document.getElementById('patr-data')?.value || document.getElementById('patrim-data')?.value || document.getElementById('reg-pat-data')?.value || new Date().toISOString().slice(0, 10),
    act_pas: document.getElementById('patr-act-pas')?.value || document.getElementById('patrim-act-pas')?.value || document.getElementById('reg-pat-actpas')?.value || 'A',
    suma: parseFloat(document.getElementById('patr-suma')?.value || document.getElementById('patrim-suma')?.value || document.getElementById('reg-pat-suma')?.value) || 0,
    explicatie: document.getElementById('patr-explicatie')?.value.trim() || document.getElementById('patrim-explicatie')?.value.trim() || document.getElementById('reg-pat-expl')?.value.trim() || 'Element patrimoniu',
    perioada: document.getElementById('patr-perioada')?.value.trim() || document.getElementById('patrim-perioada')?.value.trim() || document.getElementById('reg-pat-per')?.value.trim() || '',
    data_pres: document.getElementById('patr-data-pres')?.value || document.getElementById('patrim-datapres')?.value || ''
  };
  if (!payload.suma) return showAlert('Introduceți suma elementului patrimonial!', 'warning');
  const res = await apiPost('/api/operatiuni/patrimoniu', payload);
  if (res.error) return showAlert(res.error, 'danger');
  ['patr-suma', 'patrim-suma', 'reg-pat-suma'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  showAlert('Element patrimonial salvat (APA)!', 'success');
  loadRegistruPatrimoniu();
}
const addPatrimoniuEntry = addActPatrimoniu;

// APA.PRG F5=INITL — Inițializează cele 18 posturi patrimoniale standard (9 Activ + 9 Pasiv)
window.initLunaPatrimoniu = async function(opts = {}) {
  const res = await apiPost('/api/operatiuni/patrimoniu/init-luna', {
    perioada_id: opts.perioada_id || currentPerioadaId,
    overwrite: opts.overwrite !== undefined ? opts.overwrite : true
  });
  if (res.error) return showAlert(res.error, 'danger');
  showAlert(`Situația patrimonială (APA.PRG F5=INITL) a fost inițializată cu ${res.inserted_count ?? 18} posturi (Activ: ${formatMoney(res.total_activ || 0)} | Pasiv: ${formatMoney(res.total_pasiv || 0)} RON)!`, 'success');
  await loadRegistruPatrimoniu();
  return res;
};

// APA.PRG F6=SCHD — Pune aceeași dată pe toate posturile patrimoniale
window.batchDataPatrimoniu = async function(opts = {}) {
  const dataVal = opts.data || document.getElementById('patr-data')?.value || new Date().toISOString().slice(0, 10);
  const res = await apiPost('/api/operatiuni/patrimoniu/batch-data', {
    data: dataVal,
    perioada_id: opts.perioada_id || currentPerioadaId
  });
  if (res.error) return showAlert(res.error, 'danger');
  showAlert(`Data ${dataVal} a fost aplicată pe ${res.updated_count ?? 0} înregistrări patrimoniale (APA.PRG F6=SCHD)!`, 'success');
  await loadRegistruPatrimoniu();
  return res;
};

async function deletePatrimoniuEntry(id) {
  await apiDelete(`/api/operatiuni/patrimoniu/${id}`);
  loadRegistruPatrimoniu();
}

function openReportDirect(code) {
  switchMainSection('rapoarte');
  selectReport(code);
}
window.openReportDirect = openReportDirect;

// --- 4. ORDINE DE PLATA (ORD.PRG) ---
async function loadRegistruOrdinePlata() {
  const rows = await apiGet('/api/operatiuni/ordine-plata');
  const tbody = document.getElementById('tbl-reg-ordine') || document.getElementById('tbl-registru-ordine');
  if (!tbody || !Array.isArray(rows)) return;

  tbody.innerHTML = rows.map(o => `
    <tr>
      <td><strong>OP #${o.numar}</strong></td>
      <td>${o.data || '-'}</td>
      <td>${o.platitor1 || 'ASOCIATIE'}</td>
      <td><strong>${o.beneficiar || '-'}</strong><br><small>${o.codf_bene || ''}</small></td>
      <td>${o.cont_bene || '-'}<br><small>${o.banca_bene || ''}</small></td>
      <td>${o.reprez1 || '-'}</td>
      <td style="text-align:right; font-weight:700;">${formatMoney(o.suma)} RON</td>
      <td>
        <button class="btn btn-small btn-danger" onclick="deleteOrdinPlata(${o.id})">🗑️</button>
      </td>
    </tr>
  `).join('');
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
  showAlert(`Ordinul de Plată #${res.entry?.numar || res.ordin?.numar || payload.numar || ''} a fost emis!`, 'success');
  loadRegistruOrdinePlata();
}

async function deleteOrdinPlata(id) {
  await apiDelete(`/api/operatiuni/ordine-plata/${id}`);
  loadRegistruOrdinePlata();
}

async function loadRawAuditTable() {
  const tbl = document.getElementById('raw-table-select')?.value || document.getElementById('raw-audit-table-select')?.value || 'apartamente';
  const res = await apiGet(`/api/operatiuni/audit/raw/${tbl}?limit=250`);
  if (res.error) return showAlert(res.error, 'warning');
  rawAuditDataCache = res;

  const thead = document.getElementById('thead-reg-raw') || document.getElementById('thead-raw-audit');
  const tbody = document.getElementById('tbody-reg-raw') || document.getElementById('tbody-raw-audit');
  const rows = res.rows || [];
  if (rows.length === 0) {
    if (thead) thead.innerHTML = '';
    if (tbody) tbody.innerHTML = '<tr><td style="padding:1rem; text-align:center;">Tabelul este gol.</td></tr>';
    return;
  }

  const keys = Object.keys(rows[0]);
  if (thead) {
    thead.innerHTML = `<tr>${keys.map(k => `<th>${k}</th>`).join('')}</tr>`;
  }
  if (tbody) {
    tbody.innerHTML = rows.map(r => `
      <tr>
        ${keys.map(k => `<td>${r[k] !== null && r[k] !== undefined ? r[k] : ''}</td>`).join('')}
      </tr>
    `).join('');
  }
}

function exportRawTableCSV() {
  if (!rawAuditDataCache || !rawAuditDataCache.rows || rawAuditDataCache.rows.length === 0) {
    return showAlert('Nu există date pentru export!', 'warning');
  }
  const rows = rawAuditDataCache.rows;
  const keys = Object.keys(rows[0]);
  const csv = [
    keys.join(','),
    ...rows.map(r => keys.map(k => `"${String(r[k] ?? '').replace(/"/g, '""')}"`).join(','))
  ].join('\n');

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `raw_${rawAuditDataCache.table}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

async function runDatabaseIntegrityCheck() {
  const res = await apiGet('/api/operatiuni/admin/integrity');
  const banner = document.getElementById('raw-integrity-banner');
  if (banner) {
    banner.style.display = 'block';
    banner.style.background = res.integrity_ok ? '#f0fdf4' : '#fef2f2';
    banner.style.border = `1px solid ${res.integrity_ok ? '#86efac' : '#fca5a5'}`;
    banner.innerHTML = `
      <strong>${res.integrity_ok ? '✅ Integritate Bază de Date OK (REF / PRAGMA integrity_check = ok)' : '⚠️ Atenție la integritatea datelor'}</strong>
      • Plăți orfane: <strong>${res.orphan_payments || 0}</strong>
      • Sold Total Registru Datorii: <strong>${formatMoney(res.ledger_summary?.totals?.totalRestanta || 0)} RON</strong>
    `;
  }
}

// ============================================================
//  SFÂRȘIT DE LUNĂ & CICLU DE VIAȚĂ (TRE, GOL, SLU, AUDIT)
// ============================================================
function setLunaLifecycleFeedback(html, isError = false) {
  const el = document.getElementById('luna-lifecycle-feedback');
  if (!el) return;
  el.style.display = 'block';
  el.style.background = isError ? '#fef2f2' : '#f0fdf4';
  el.style.borderColor = isError ? '#fca5a5' : '#86efac';
  el.style.color = isError ? '#991b1b' : '#166534';
  el.innerHTML = html;
}

async function publicaLunaCurenta() {
  const res = await apiPost('/api/calcul/publica', {});
  if (res.error) {
    setLunaLifecycleFeedback(`❌ <strong>Eroare TRE:</strong> ${res.error}`, true);
    return showAlert(res.error, 'warning');
  }
  setLunaLifecycleFeedback(`✅ <strong>TRE (Publicare Lună) finalizat cu succes!</strong> S-au publicat în registrul <code>datorii</code> obligațiile lunii (${res.insertedRows || 0} rânduri R/F/A). Statusul perioadei este acum <strong>PUBLICATA</strong>.`);
  showAlert('Luna curentă a fost publicată în registrul DATORII (TRE)!', 'success');
  await loadPerioadeGlobal();
}

async function anuleazaPublicareaLunii() {
  if (!confirm('Sigur doriți să anulați publicarea lunii curente (GOL.PRG)? Rândurile din registrul datorii aferente lunii curente (dacă nu au plăți încasate) vor fi retrase.')) {
    return;
  }
  const res = await apiPost('/api/calcul/anuleaza-publicarea', {});
  if (res.error) {
    setLunaLifecycleFeedback(`❌ <strong>Eroare GOL:</strong> ${res.error}`, true);
    return showAlert(res.error, 'warning');
  }
  setLunaLifecycleFeedback(`↩️ <strong>GOL (Anulare Publicare) executat:</strong> Au fost retrase ${res.deletedRows || 0} rânduri din registrul datorii. Perioada a revenit la statusul <strong>DESCHISA</strong>.`);
  showAlert('Publicarea lunii a fost anulată (GOL)!', 'info');
  await loadPerioadeGlobal();
}

async function confirmaInchidereLuna() {
  if (!confirm('CONFIRMARE ÎNCHIDERE DE LUNĂ (SLU.PRG):\n\nAceastă operațiune va:\n1. Publica automat debitele (dacă nu sunt deja publicate)\n2. Salva snapshot-ul de arhivă al lunii\n3. Roti toți indecșii noi (IN_*) în indecși vechi (IV_*) pe blocuri, apometre și repartitoare R1..R7\n4. Avansa luna de lucru la luna următoare\n\nDoriți să continuați?')) {
    return;
  }

  const res = await apiPost('/api/calcul/inchide', {});
  if (res.error) {
    setLunaLifecycleFeedback(`❌ <strong>Eroare SLU:</strong> ${res.error}`, true);
    return showAlert(res.error, 'warning');
  }

  setLunaLifecycleFeedback(`🔒 <strong>SLU (Sfârșit de Lună) finalizat cu succes!</strong> Luna ${res.lunaVeche}/${res.anVechi} a fost închisă și arhivată, indecșii au fost rotiți, iar sistemul a avansat la <strong>${res.nouaLuna}/${res.noulAn}</strong>.`);
  showAlert(`Luna a fost încheiată cu succes! Sistemul a avansat la luna ${res.nouaLuna}/${res.noulAn}.`, 'success');
  await loadPerioadeGlobal();
  loadDashboard();
  loadIstoricLuni();
}

async function redeschideLunaAudit() {
  if (!confirm('Redeschideți ultima lună închisă (Restaurare Snapshot Audit)? Aceasta va restaura indecșii vechi și va redeschide perioada.')) {
    return;
  }
  const res = await apiPost('/api/calcul/redeschide', {});
  if (res.error) {
    setLunaLifecycleFeedback(`❌ <strong>Eroare Redeschidere:</strong> ${res.error}`, true);
    return showAlert(res.error, 'warning');
  }
  setLunaLifecycleFeedback(`🔓 <strong>Redeschidere Lună (Audit) finalizată:</strong> Perioada a fost restaurată din snapshot.`);
  showAlert('Luna a fost redeschisă cu succes!', 'info');
  await loadPerioadeGlobal();
  loadDashboard();
  loadIstoricLuni();
}

async function loadIstoricLuni() {
  const istoric = await apiGet('/api/luna/istoric');
  const tbody = document.getElementById('tbl-istoric-luni');
  if (!tbody) return;

  if (!Array.isArray(istoric) || istoric.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center">Nu există luni încheiate încă în istoric.</td></tr>';
    return;
  }

  tbody.innerHTML = istoric.map(i => `
    <tr>
      <td>#${i.id}</td>
      <td><strong>${NUME_LUNI_RO[i.luna] || 'Luna ' + i.luna} ${i.an}</strong></td>
      <td>${i.data_inchidere}</td>
      <td><strong>${formatMoney(i.total_calculat)} RON</strong></td>
      <td><strong>${formatMoney(i.total_incasat)} RON</strong></td>
      <td><span class="badge badge-success">Încheiată cu succes</span></td>
    </tr>
  `).join('');
}

// ============================================================
//  ⌨️ PALETĂ DE COMENZI FOXPRO 58 OPERAȚIUNI (Ctrl+K)
// ============================================================
const FOXPRO_58_OPERATIONS = [
  // ACTUALIZARE (A-R)
  { code: 'ADG', cat: 'Actualizare (A)', title: 'Actualizare Date Generale Perioadă (ULTIMA_ZI, TARIF_AR, TARIF_CA)', action: () => showDateGeneraleModal() },
  { code: 'ADA', cat: 'Actualizare (B)', title: 'Actualizare Facturi & Date Asociație (APA_RECE, INCALZIRE, SALARII)', action: () => showFacturiAsociatieModal() },
  { code: 'ADB', cat: 'Actualizare (C)', title: 'Actualizare Date Blocuri (Moduri, Procente, Facturi Bloc)', action: () => { switchMainSection('blocuri'); } },
  { code: 'APS', cat: 'Actualizare (D)', title: 'Actualizare Persoane, Suprafețe & Scăderi Temporare (D1, D2)', action: () => { goToWorkflowStage(2); switchRepartitoareSubView('tce'); } },
  { code: 'AIA', cat: 'Actualizare (E)', title: 'Actualizare Indecși Apometre & Contoare Apartamente', action: () => { switchMainSection('blocuri'); } },
  { code: 'ARA', cat: 'Actualizare (F)', title: 'Actualizare Repartitoare Căldură R1..R7 (IV_R, IN_R, FACTTR, COEFSP)', action: () => { goToWorkflowStage(2); switchRepartitoareSubView('ara'); } },
  { code: 'ADC', cat: 'Actualizare (G)', title: 'Actualizare Fond Rulment, Fond Reparații & Cheltuieli Manuale', action: () => { goToWorkflowStage(2); } },
  { code: 'ADR', cat: 'Actualizare (H)', title: 'Actualizare Adrese Blocuri (Strada, Număr, Cod Poștal)', action: () => { switchMainSection('blocuri'); } },
  { code: 'ACA', cat: 'Actualizare (I)', title: 'Registrul de Casă — Încasări și Plăți Numerar', action: () => { switchMainSection('registre'); switchRegistreTab('casa'); } },
  { code: 'ABA', cat: 'Actualizare (J)', title: 'Jurnal de Bancă — Depuneri și Viramente', action: () => { switchMainSection('registre'); switchRegistreTab('banca'); } },
  { code: 'ORD', cat: 'Actualizare (K)', title: 'Emitere Ordine de Plată Furnizori', action: () => { switchMainSection('registre'); switchRegistreTab('ordine'); } },
  { code: 'APA', cat: 'Actualizare (L)', title: 'Situația Elementelor Patrimoniale Activ / Pasiv', action: () => { switchMainSection('registre'); switchRegistreTab('patrimoniu'); } },
  { code: 'AVS', cat: 'Actualizare (M)', title: 'Audit Date Brute Asociație (ASOC.DBF)', action: () => { switchMainSection('registre'); const sel = document.getElementById('raw-table-select'); if (sel) sel.value = 'asociatie'; switchRegistreTab('raw'); } },
  { code: 'AVB', cat: 'Actualizare (N)', title: 'Audit Date Brute Blocuri (BLOC.DBF)', action: () => { switchMainSection('registre'); const sel = document.getElementById('raw-table-select'); if (sel) sel.value = 'blocuri'; switchRegistreTab('raw'); } },
  { code: 'AVA', cat: 'Actualizare (O)', title: 'Audit Date Brute Apartamente (APART.DBF)', action: () => { switchMainSection('registre'); const sel = document.getElementById('raw-table-select'); if (sel) sel.value = 'apartamente'; switchRegistreTab('raw'); } },
  { code: 'SLU', cat: 'Actualizare (P)', title: 'Sfârșit de Lună — Închidere Lună & Rotire Indecși (IN -> IV)', action: () => switchMainSection('luna') },

  // CALCUL (A-E)
  { code: 'TCE', cat: 'Calcul (A)', title: 'Trecere Cereri Expirate (D2 < ULTIMA_ZI)', action: () => { goToWorkflowStage(2); runCalculTCE(); } },
  { code: 'CRE', cat: 'Calcul (B)', title: 'Calcul Repartitoare Căldură (R1..R7 -> TOT_UNIT, GCAL_FINAL)', action: () => { goToWorkflowStage(2); runCalculCRE(); } },
  { code: 'SUM', cat: 'Calcul (C)', title: 'Însumare și Calcul Lunar 8 Pași (SUM.PRG)', action: () => { goToWorkflowStage(2); runCalculSUM(); } },
  { code: 'TRE', cat: 'Calcul (D)', title: 'Trecere Lună în Registrul Datorii (Publicare R, F, A)', action: () => { switchMainSection('luna'); } },
  { code: 'GOL', cat: 'Calcul (E)', title: 'Golire / Anulare Publicare Lună Curentă', action: () => { switchMainSection('luna'); } },

  // CENTRALIZARE & CASIERIE (A-D)
  { code: 'IN1', cat: 'Centralizare (A)', title: 'Tabel Datorii Nume + Semnătură (IN1.FRX)', action: () => { switchMainSection('rapoarte'); selectReport('IN1'); } },
  { code: 'IN2', cat: 'Centralizare (B)', title: 'Tabel Datorii Curent + Restanță pe Categorii (IN2.FRX)', action: () => { switchMainSection('rapoarte'); selectReport('IN2'); } },
  { code: 'CHI', cat: 'Casierie (C)', title: 'Casierie — Încasare Chitanțe Individuale & Penalități', action: () => switchMainSection('casierie') },
  { code: 'CHO', cat: 'Casierie (D)', title: 'Chitanță Colectivă / Descărcare Fond pe Bloc (CHO.FXP)', action: () => { switchMainSection('casierie'); showChitantaColectivaModal(); } },
  { code: 'ADE', cat: 'Casierie (E)', title: 'Adeverință Plată la Zi / Notar Vânzare (ADE.PRG)', action: () => openAdeverintaFromCasierie() },

  // LISTARE (16 RAPOARTE A-P)
  { code: 'LAF', cat: 'Listare (A)', title: 'Listă Plată Avizier A4 Portrait (LAF.FRX — GDPR Anonim)', action: () => { switchMainSection('rapoarte'); selectReport('LAF'); } },
  { code: 'LAR', cat: 'Listare (B)', title: 'Listă Plată Desfășurată A4 Landscape (LAR.FRX — GDPR Anonim)', action: () => { switchMainSection('rapoarte'); selectReport('LAR'); } },
  { code: 'LAI', cat: 'Listare (C)', title: 'Listă Consumuri Apă Rece și Caldă (LAI.FRX)', action: () => { switchMainSection('rapoarte'); selectReport('LAI'); } },
  { code: 'LAP', cat: 'Listare (D)', title: 'Listă Procente Participare Cheltuieli (LAP.FRX)', action: () => { switchMainSection('rapoarte'); selectReport('LAP'); } },
  { code: 'LAC', cat: 'Listare (E)', title: 'Listă Scăderi Temporare Persoane & Suprafețe (LAC.FRX)', action: () => { switchMainSection('rapoarte'); selectReport('LAC'); } },
  { code: 'LAT', cat: 'Listare (F)', title: 'Listă Repartizare Energia Termică (LAT.FRX)', action: () => { switchMainSection('rapoarte'); selectReport('LAT'); } },
  { code: 'LGA', cat: 'Listare (G)', title: 'Listă Consumuri Încălzire Gcal (LGA.FRX)', action: () => { switchMainSection('rapoarte'); selectReport('LGA'); } },
  { code: 'LCR', cat: 'Listare (H)', title: 'Listă Calcul Repartitoare Căldură R1..R7 (LCR.FRX)', action: () => { switchMainSection('rapoarte'); selectReport('LCR'); } },
  { code: 'LFR', cat: 'Listare (I)', title: 'Listă Fond Rulment pe Apartamente (LFR.FRX)', action: () => { switchMainSection('rapoarte'); selectReport('LFR'); } },
  { code: 'LFI', cat: 'Listare (J)', title: 'Centralizator Facturi și Cote Blocuri (LFI.FRX)', action: () => { switchMainSection('rapoarte'); selectReport('LFI'); } },
  { code: 'LCH', cat: 'Listare (K)', title: 'Listă Cheltuieli pe Categorii și Blocuri (LCH.FRX)', action: () => { switchMainSection('rapoarte'); selectReport('LCH'); } },
  { code: 'LPA', cat: 'Listare (L)', title: 'Listă Plăți Încasate pe Apartamente (LPA.FRX)', action: () => { switchMainSection('rapoarte'); selectReport('LPA'); } },
  { code: 'LGI', cat: 'Listare (M)', title: 'Listă Gestiune Încasări pe Zile (LGI.FRX)', action: () => { switchMainSection('rapoarte'); selectReport('LGI'); } },
  { code: 'LP1', cat: 'Listare (N)', title: 'Fluturași / Înștiințări de Plată Locatari (LP1.FRX)', action: () => { switchMainSection('rapoarte'); selectReport('LP1'); } },
  { code: 'LP2', cat: 'Listare (O)', title: 'Tabel Nominal Afișier Semnături (LP2.FRX)', action: () => { switchMainSection('rapoarte'); selectReport('LP2'); } },
  { code: 'LPP', cat: 'Listare (P)', title: 'Listă Restanțe și Penalizări la Zi (LPP.FRX)', action: () => { switchMainSection('rapoarte'); selectReport('LPP'); } },

  // SITUAȚII (17 RAPOARTE A-Q)
  { code: 'MAX', cat: 'Situații (A)', title: 'Total Datorii Restante pe Apartamente (MAX.FRX)', action: () => { switchMainSection('rapoarte'); selectReport('MAX'); } },
  { code: 'MIN', cat: 'Situații (B)', title: 'Datorii Detaliate pe Luni și Categorii (MIN.FRX)', action: () => { switchMainSection('rapoarte'); selectReport('MIN'); } },
  { code: 'SFI', cat: 'Situații (C)', title: 'Fișa sintetică a apartamentului (SFI.FRX)', action: () => { switchMainSection('rapoarte'); selectReport('SFI'); } },
  { code: 'SFA', cat: 'Situații (D)', title: 'Fișa fondului de rulment pe apartament (SFA.FRX)', action: () => { switchMainSection('rapoarte'); selectReport('SFA'); } },
  { code: 'SFR', cat: 'Situații (E)', title: 'Fișa fondului de reparații pe apartament (SFR.FRX)', action: () => { switchMainSection('rapoarte'); selectReport('SFR'); } },
  { code: 'SFC', cat: 'Situații (F)', title: 'Fișa cotelor de întreținere pe apartament (SFC.FRX)', action: () => { switchMainSection('rapoarte'); selectReport('SFC'); } },
  { code: 'SFP', cat: 'Situații (G)', title: 'Fișa penalizărilor pe apartament (SFP.FRX)', action: () => { switchMainSection('rapoarte'); selectReport('SFP'); } },
  { code: 'SBL', cat: 'Situații (H)', title: 'Situația sintetică pe bloc (SBL.FRX)', action: () => { switchMainSection('rapoarte'); selectReport('SBL'); } },
  { code: 'SBA', cat: 'Situații (I)', title: 'Situația fondului de rulment pe bloc (SBA.FRX)', action: () => { switchMainSection('rapoarte'); selectReport('SBA'); } },
  { code: 'SBR', cat: 'Situații (J)', title: 'Situația fondului de reparații pe bloc (SBR.FRX)', action: () => { switchMainSection('rapoarte'); selectReport('SBR'); } },
  { code: 'SBC', cat: 'Situații (K)', title: 'Situația cotelor de întreținere pe bloc (SBC.FRX)', action: () => { switchMainSection('rapoarte'); selectReport('SBC'); } },
  { code: 'SBP', cat: 'Situații (L)', title: 'Situația penalizărilor pe bloc (SBP.FRX)', action: () => { switchMainSection('rapoarte'); selectReport('SBP'); } },
  { code: 'SAS', cat: 'Situații (M)', title: 'Centralizator sintetic pe asociație (SAS.FRX)', action: () => { switchMainSection('rapoarte'); selectReport('SAS'); } },
  { code: 'SAA', cat: 'Situații (N)', title: 'Centralizator fond rulment pe asociație (SAA.FRX)', action: () => { switchMainSection('rapoarte'); selectReport('SAA'); } },
  { code: 'SAR', cat: 'Situații (O)', title: 'Centralizator fond reparații pe asociație (SAR.FRX)', action: () => { switchMainSection('rapoarte'); selectReport('SAR'); } },
  { code: 'SAC', cat: 'Situații (P)', title: 'Centralizator cote întreținere pe asociație (SAC.FRX)', action: () => { switchMainSection('rapoarte'); selectReport('SAC'); } },
  { code: 'SAP', cat: 'Situații (Q)', title: 'Centralizator penalizări pe asociație (SAP.FRX)', action: () => { switchMainSection('rapoarte'); selectReport('SAP'); } },

  // REF / INTEGRITATE
  { code: 'REF', cat: 'Sistem', title: 'Refacere / Verificare Integritate Bază de Date (REF.PRG)', action: () => { switchMainSection('registre'); switchRegistreTab('raw'); runDatabaseIntegrityCheck(); } }
];

function openCommandPalette() {
  showModal('modal-command-palette');
  const inp = document.getElementById('cmd-palette-input');
  if (inp) {
    inp.value = '';
    cmdPaletteSelectedIndex = 0;
    renderCommandPaletteResults('');
    setTimeout(() => inp.focus(), 60);
  }
}

function renderCommandPaletteResults(query = '') {
  const q = String(query || '').trim().toLowerCase();
  cmdPaletteFilteredItems = FOXPRO_58_OPERATIONS.filter(item =>
    !q ||
    item.code.toLowerCase().includes(q) ||
    item.title.toLowerCase().includes(q) ||
    item.cat.toLowerCase().includes(q)
  );
  if (cmdPaletteSelectedIndex >= cmdPaletteFilteredItems.length) {
    cmdPaletteSelectedIndex = 0;
  }

  const container = document.getElementById('cmd-palette-results');
  if (!container) return;

  if (cmdPaletteFilteredItems.length === 0) {
    container.innerHTML = `<div style="padding:1.5rem; text-align:center; color:#64748b;">Nicio operațiune sau raport găsit pentru „${query}”.</div>`;
    return;
  }

  container.innerHTML = cmdPaletteFilteredItems.map((item, idx) => `
    <div class="cmd-palette-item ${idx === cmdPaletteSelectedIndex ? 'active' : ''}" onclick="executeCommandPaletteItem(${idx})">
      <div style="display:flex; align-items:center; gap:0.65rem;">
        <span class="badge badge-info" style="min-width:48px; text-align:center; font-family:monospace; font-size:0.85rem;">${item.code}</span>
        <div>
          <div style="font-weight:600; color:#1e293b; font-size:0.9rem;">${item.title}</div>
          <div style="font-size:0.75rem; color:#64748b;">${item.cat}</div>
        </div>
      </div>
      <span style="font-size:0.75rem; color:#94a3b8;">Enter ↵</span>
    </div>
  `).join('');
}

function handleCommandPaletteKey(e) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (cmdPaletteFilteredItems.length > 0) {
      cmdPaletteSelectedIndex = (cmdPaletteSelectedIndex + 1) % cmdPaletteFilteredItems.length;
      renderCommandPaletteResults(document.getElementById('cmd-palette-input')?.value || '');
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (cmdPaletteFilteredItems.length > 0) {
      cmdPaletteSelectedIndex = (cmdPaletteSelectedIndex - 1 + cmdPaletteFilteredItems.length) % cmdPaletteFilteredItems.length;
      renderCommandPaletteResults(document.getElementById('cmd-palette-input')?.value || '');
    }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    executeCommandPaletteItem(cmdPaletteSelectedIndex);
  }
}
window.onCommandPaletteKeyDown = handleCommandPaletteKey;

function executeCommandPaletteItem(idx) {
  const item = cmdPaletteFilteredItems[idx];
  if (!item) return;
  closeModal('modal-command-palette');
  item.action();
}

// ============================================================
//  UI HELPERS & MODALE
// ============================================================
function switchTab(tabName, tabBtn) {
  document.querySelectorAll('#bloc-page .tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('#bloc-page .tab-content').forEach(c => {
    c.classList.remove('active');
    c.style.display = 'none';
  });

  if (tabBtn) tabBtn.classList.add('active');
  const target = document.getElementById(`tab-${tabName}`);
  if (target) {
    target.classList.add('active');
    target.style.display = 'block';
  }
  if (tabName === 'repartitoare') {
    populateRepartitoareTab();
  }
}

function showModal(id) {
  const m = document.getElementById(id);
  if (m) m.style.display = 'flex';
}

function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.style.display = 'none';
}

function showAlert(message, type = 'info') {
  const alertDiv = document.createElement('div');
  alertDiv.className = `alert alert-${type}`;
  alertDiv.style.position = 'fixed';
  alertDiv.style.top = '1.5rem';
  alertDiv.style.right = '1.5rem';
  alertDiv.style.zIndex = '9999';
  alertDiv.style.boxShadow = '0 8px 24px rgba(0,0,0,0.2)';
  alertDiv.style.minWidth = '300px';
  alertDiv.innerHTML = `<strong>${type === 'success' ? '✅ Succes: ' : type === 'warning' ? '⚠️ Atenție: ' : 'ℹ️ Info: '}</strong> ${message}`;

  document.body.appendChild(alertDiv);
  setTimeout(() => {
    alertDiv.style.opacity = '0';
    alertDiv.style.transition = 'opacity 0.4s ease';
    setTimeout(() => alertDiv.remove(), 400);
  }, 4000);
}

function formatMoney(value) {
  return (Number(value) || 0).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatTipFactura(tip) {
  const map = {
    'APA_RECE': '💧 Apă Rece',
    'APA_CALDA': '🔥 Apă Caldă',
    'APA_POTABILA': '🚰 Apă Potabilă (Asociație)',
    'APA_METEO': '🌧️ Apă Meteo / Canal',
    'CURENT_SCARA': '💡 Curent Scară',
    'CURENT_LIFT': '🛗 Curent Lift',
    'LIFT': '🛗 Întreținere Lift',
    'INCALZIRE': '🌡️ Încălzire',
    'GAZ': '🔥 Gaz',
    'GUNOI': '🗑️ Gunoi / Salubritate',
    'SALAR_ADMIN': '💼 Salariu Administrator',
    'SALAR_FEMEIE': '🧹 Salariu Femeie Serviciu',
    'CH_ADMIN': '📁 Cheltuieli Administrative',
    'CH_SEDIU': '🏢 Cheltuieli Sediu',
    'FOND_REPARATII': '🔨 Fond Reparații',
    'FOND_RULMENT': '💰 Fond Rulment',
    'REPARATII': '🛠️ Reparații Curente',
    'DIFERENTE_APA': '⚡ Diferențe Contor Apă Rece',
    'ALTELE': '📦 Altele'
  };
  return map[tip] || tip;
}


// ============================================================
//  RAPOARTE: OPTIUNI INTERACTIVE PENTRU CELE 14 RAPOARTE PARAMETRIZATE
//  (IN1, IN2, CED, LAR_INST, CCA, COM, LSC, LFA, LIP, LIR, LAF, LAR, LVE, ADU)
// ============================================================
function renderReportCustomOptions(code) {
  const box = document.getElementById('rapoarte-custom-options');
  if (!box) return;

  const activePer = perioadeCache.find(p => Number(p.id) === Number(currentPerioadaId)) || { an: 2026, luna: 9 };
  const defAn = activePer.an || 2026;
  const defLuna = activePer.luna || 9;
  const todayStr = new Date().toISOString().slice(0, 10);

  const monthOptionsHtml = (selectedMonth) => [
    [1, '1 - Ianuarie'], [2, '2 - Februarie'], [3, '3 - Martie'], [4, '4 - Aprilie'],
    [5, '5 - Mai'], [6, '6 - Iunie'], [7, '7 - Iulie'], [8, '8 - August'],
    [9, '9 - Septembrie'], [10, '10 - Octombrie'], [11, '11 - Noiembrie'], [12, '12 - Decembrie']
  ].map(([m, label]) => `<option value="${m}" ${Number(selectedMonth) === m ? 'selected' : ''}>${label}</option>`).join('');

  if (code === 'IN1' || code === 'IN2') {
    box.style.display = 'block';
    const prefix = code.toLowerCase();
    box.innerHTML = `
      <div style="font-weight:700; margin-bottom:0.5rem; color:#1e293b;">
        🏛️ Parametri Încasări Perioadă (FoxPro: ${code}.PRG — ZINC..ZISF & Categorie)
      </div>
      <div class="form-row" style="align-items:flex-end;">
        <div class="form-group" style="min-width:155px;">
          <label class="form-label">Data de început (data_inceput)</label>
          <input type="date" class="form-input" id="opt-${prefix}-data-inceput" value="" onchange="reloadCurrentReport()">
        </div>
        <div class="form-group" style="min-width:155px;">
          <label class="form-label">Data de sfârșit (data_sfarsit)</label>
          <input type="date" class="form-input" id="opt-${prefix}-data-sfarsit" value="" onchange="reloadCurrentReport()">
        </div>
        <div class="form-group" style="min-width:170px;">
          <label class="form-label">Categorie (CEE)</label>
          <select class="form-select" id="opt-${prefix}-categorie" onchange="reloadCurrentReport()">
            <option value="TOATE">DE TOATE (R + F + A + P)</option>
            <option value="R">R — REGIE / ÎNTREȚINERE</option>
            <option value="F">F — FOND RULMENT</option>
            <option value="A">A — FOND REPARAȚII</option>
            <option value="P">P — PENALITĂȚI</option>
          </select>
        </div>
        <div class="form-group">
          <button class="btn btn-primary" onclick="reloadCurrentReport()">🔄 Actualizează ${code}</button>
        </div>
      </div>
    `;
  } else if (code === 'CED') {
    box.style.display = 'block';
    box.innerHTML = `
      <div style="font-weight:700; margin-bottom:0.5rem; color:#1e293b;">
        🏛️ Parametri Valori în Detaliu pe Apartament (FoxPro: CED.PRG — Interval DI..DS)
      </div>
      <div class="form-row" style="align-items:flex-end;">
        <div class="form-group" style="min-width:160px;">
          <label class="form-label">De la Perioada (data_inceput)</label>
          <input type="month" class="form-input" id="opt-ced-data-inceput" value="" onchange="reloadCurrentReport()">
        </div>
        <div class="form-group" style="min-width:160px;">
          <label class="form-label">Până la Perioada (data_sfarsit)</label>
          <input type="month" class="form-input" id="opt-ced-data-sfarsit" value="" onchange="reloadCurrentReport()">
        </div>
        <div class="form-group">
          <button class="btn btn-primary" onclick="reloadCurrentReport()">🔄 Actualizează CED</button>
        </div>
      </div>
    `;
  } else if (code === 'LAR_INST') {
    box.style.display = 'block';
    box.innerHTML = `
      <div style="font-weight:700; margin-bottom:0.5rem; color:#1e293b;">
        🏛️ Parametri Liste Plată Instanță (FoxPro: LAR_INST.PRG — DI..DS & Blocuri)
      </div>
      <div class="form-row" style="align-items:flex-end;">
        <div class="form-group" style="min-width:155px;">
          <label class="form-label">Data de început (data_inceput)</label>
          <input type="date" class="form-input" id="opt-lar-inst-data-inceput" value="" onchange="reloadCurrentReport()">
        </div>
        <div class="form-group" style="min-width:155px;">
          <label class="form-label">Data de sfârșit (data_sfarsit)</label>
          <input type="date" class="form-input" id="opt-lar-inst-data-sfarsit" value="" onchange="reloadCurrentReport()">
        </div>
        <div class="form-group" style="flex:1;">
          <label class="form-label">Blocuri (ex: A1,A2 sau gol pt. toate)</label>
          <input type="text" class="form-input" id="opt-lar-inst-blocuri" placeholder="Toate blocurile" onchange="reloadCurrentReport()">
        </div>
        <div class="form-group" style="flex:1.2;">
          <label class="form-label">Instituție Destinatară</label>
          <input type="text" class="form-input" id="opt-lar-inst-institutie" value="JUDECATORIA / PRIMARIA ALBA IULIA" onchange="reloadCurrentReport()">
        </div>
        <div class="form-group">
          <button class="btn btn-primary" onclick="reloadCurrentReport()">🔄 Actualizează</button>
        </div>
      </div>
    `;
  } else if (code === 'CCA') {
    box.style.display = 'block';
    box.innerHTML = `
      <div style="font-weight:700; margin-bottom:0.5rem; color:#1e293b;">
        💵 Parametri Registru de Casă pe Perioadă (FoxPro: CCA.PRG — VDAFI..VDAFS)
      </div>
      <div class="form-row" style="align-items:flex-end;">
        <div class="form-group" style="min-width:165px;">
          <label class="form-label">Data de început (data_inceput)</label>
          <input type="date" class="form-input" id="opt-cca-data-inceput" value="" onchange="reloadCurrentReport()">
        </div>
        <div class="form-group" style="min-width:165px;">
          <label class="form-label">Data de sfârșit (data_sfarsit)</label>
          <input type="date" class="form-input" id="opt-cca-data-sfarsit" value="" onchange="reloadCurrentReport()">
        </div>
        <div class="form-group">
          <button class="btn btn-secondary btn-small" onclick="const d1=document.getElementById('opt-cca-data-inceput'); const d2=document.getElementById('opt-cca-data-sfarsit'); if(d1)d1.value=''; if(d2)d2.value=''; reloadCurrentReport();">Toate Zilele</button>
          <button class="btn btn-primary" onclick="reloadCurrentReport()">🔄 Filtrează Interval</button>
        </div>
      </div>
    `;
  } else if (code === 'COM') {
    box.style.display = 'block';
    const prevM = defLuna > 1 ? defLuna - 1 : 12;
    const prevY = defLuna > 1 ? defAn : defAn - 1;
    box.innerHTML = `
      <div style="font-weight:700; margin-bottom:0.5rem; color:#1e293b;">
        📊 Parametri Comparație cu Lună de Referință (FoxPro: COM.PRG)
      </div>
      <div class="form-row" style="align-items:flex-end;">
        <div class="form-group" style="min-width:130px;">
          <label class="form-label">An Referință (ref_an)</label>
          <input type="number" class="form-input" id="com-ref-an" value="${prevY}" onchange="reloadCurrentReport()">
        </div>
        <div class="form-group" style="min-width:155px;">
          <label class="form-label">Lună Referință (ref_luna)</label>
          <select class="form-select" id="com-ref-luna" onchange="reloadCurrentReport()">
            ${monthOptionsHtml(prevM)}
          </select>
        </div>
        <div class="form-group" style="min-width:190px;">
          <label class="form-label">Procent Diferență Tolerat % (proc_tolerat)</label>
          <input type="number" class="form-input" id="com-proc-tolerat" step="0.5" min="0" value="0" title="0 = arată toate apartamentele; >0 = arată doar variațiile peste prag" onchange="reloadCurrentReport()">
        </div>
        <div class="form-group">
          <button class="btn btn-primary" onclick="reloadCurrentReport()">🔄 Compară Valorile</button>
        </div>
      </div>
    `;
  } else if (code === 'LSC') {
    box.style.display = 'block';
    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + 15);
    const dateStr = nextDate.toISOString().slice(0, 10);
    box.innerHTML = `
      <div style="font-weight:700; margin-bottom:0.5rem; color:#1e293b;">
        ⚖️ Parametri Scrisori Somație Restanțieri & Borderou Semnături (FoxPro: LSC.PRG / LSA.FRX)
      </div>
      <div class="form-row" style="align-items:flex-end;">
        <div class="form-group" style="min-width:165px;">
          <label class="form-label">Până la ce dată încasată (zilim)</label>
          <input type="date" class="form-input" id="lsc-zilim" value="" onchange="reloadCurrentReport()">
        </div>
        <div class="form-group" style="min-width:165px;">
          <label class="form-label">Data Sistării / Termen (datas)</label>
          <input type="date" class="form-input" id="lsc-datas" value="${dateStr}" onchange="reloadCurrentReport()">
        </div>
        <div class="form-group" style="min-width:190px;">
          <label class="form-label">Variantă Tipărire (varianta)</label>
          <select class="form-select" id="lsc-varianta" onchange="reloadCurrentReport()">
            <option value="LSC">LSC — Scrisori Somație Individuale</option>
            <option value="LSA">LSA — Tabel Borderou Semnături</option>
          </select>
        </div>
        <div class="form-group" style="min-width:140px;">
          <label class="form-label">Prag Minim RON</label>
          <input type="number" class="form-input" id="opt-lsc-prag-minim" step="1" value="0" onchange="reloadCurrentReport()">
        </div>
        <div class="form-group">
          <button class="btn btn-primary" onclick="reloadCurrentReport()">🔄 Actualizează</button>
        </div>
      </div>
    `;
  } else if (code === 'LFA') {
    box.style.display = 'block';
    box.innerHTML = `
      <div style="font-weight:700; margin-bottom:0.5rem; color:#1e293b;">
        📑 Parametri Valori Facturi & Defalcare (FoxPro: LFA.PRG / LFA1.FRX)
      </div>
      <div class="form-row" style="align-items:flex-end;">
        <div class="form-group" style="min-width:175px;">
          <label class="form-label">Ordonare (ordonare)</label>
          <select class="form-select" id="opt-lfa-ordonare" onchange="reloadCurrentReport()">
            <option value="SERVICIU">1 — După Serviciu (LFA.FRX)</option>
            <option value="BLOC">2 — După Bloc (LFA1.FRX)</option>
          </select>
        </div>
        <div class="form-group" style="min-width:175px;">
          <label class="form-label">Energie Termică (CUFET)</label>
          <select class="form-select" id="opt-lfa-cufet" onchange="reloadCurrentReport()">
            <option value="1">1 — Cu Energie Termică</option>
            <option value="2">2 — Fără Energie Termică</option>
          </select>
        </div>
        <div class="form-group" style="flex:1;">
          <label class="form-label">Notă Subsol 1 (NOTA1)</label>
          <input type="text" class="form-input" id="opt-lfa-nota1" placeholder="Notă explicativă 1..." onchange="reloadCurrentReport()">
        </div>
        <div class="form-group" style="flex:1;">
          <label class="form-label">Notă Subsol 2 (NOTA2)</label>
          <input type="text" class="form-input" id="opt-lfa-nota2" placeholder="Notă explicativă 2..." onchange="reloadCurrentReport()">
        </div>
        <div class="form-group">
          <button class="btn btn-primary" onclick="reloadCurrentReport()">🔄 Actualizează LFA</button>
        </div>
      </div>
    `;
  } else if (code === 'LIP' || code === 'LIR' || code === 'LAF' || code === 'LAR') {
    box.style.display = 'block';
    box.innerHTML = `
      <div style="font-weight:700; margin-bottom:0.5rem; color:#1e293b;">
        📋 Opțiuni Format, Energie Termică & Termen Plată (FoxPro: ${code}.PRG)
      </div>
      <div class="form-row" style="align-items:flex-end;">
        <div class="form-group" style="min-width:165px;">
          <label class="form-label">Termen de Plată (term)</label>
          <input type="text" class="form-input" id="opt-termen-plata" placeholder="ex: 25.${String(defLuna).padStart(2, '0')}.${defAn}" onchange="reloadCurrentReport()">
        </div>
        <div class="form-group" style="min-width:190px;">
          <label class="form-label">Format Tabel (EXTP)</label>
          <select class="form-select" id="opt-format-lista" onchange="reloadCurrentReport()">
            <option value="extins">1 — Extins (Toate coloanele)</option>
            <option value="prescurtat">2 — Prescurtat (Sintetic)</option>
          </select>
        </div>
        <div class="form-group" style="min-width:190px;">
          <label class="form-label">Energie Termică (CUFET)</label>
          <select class="form-select" id="opt-cu-energie-termica" onchange="reloadCurrentReport()">
            <option value="1">1 — Cu Energie Termică</option>
            <option value="2">2 — Fără Energie Termică (*F.FRX)</option>
          </select>
        </div>
        <div class="form-group">
          <button class="btn btn-primary" onclick="reloadCurrentReport()">🔄 Aplică</button>
        </div>
      </div>
    `;
  } else if (code === 'LVE') {
    box.style.display = 'block';
    box.innerHTML = `
      <div style="font-weight:700; margin-bottom:0.5rem; color:#1e293b;">
        ⏳ Parametri Verificări Metrologice Apometre (FoxPro: LVE.PRG / LVE1.FRX)
      </div>
      <div class="form-row" style="align-items:flex-end;">
        <div class="form-group" style="min-width:260px;">
          <label class="form-label">Mod Afișare Apometre (CUFEX)</label>
          <select class="form-select" id="opt-lve-include-valid" onchange="reloadCurrentReport()">
            <option value="false">1 — Doar Verificări Expirate (LVE.FRX)</option>
            <option value="true">2 — Toate Apometrele (LVE1.FRX)</option>
          </select>
        </div>
        <div class="form-group">
          <button class="btn btn-primary" onclick="reloadCurrentReport()">🔄 Actualizează LVE</button>
        </div>
      </div>
    `;
  } else if (code === 'ADU') {
    box.style.display = 'block';
    box.innerHTML = `
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
    `;
  } else {
    box.style.display = 'none';
    box.innerHTML = '';
  }
}

function collectCustomReportParams(code, params, isCsv = false) {
  if (!code || !params) return;
  const c = String(code).toUpperCase();

  if (c === 'IN1' || c === 'IN2') {
    const prefix = c.toLowerCase();
    const di = document.getElementById(`opt-${prefix}-data-inceput`)?.value;
    const ds = document.getElementById(`opt-${prefix}-data-sfarsit`)?.value;
    const cat = document.getElementById(`opt-${prefix}-categorie`)?.value;
    if (di) params.set('data_inceput', di);
    if (ds) params.set('data_sfarsit', ds);
    if (cat) params.set('categorie', cat);
  } else if (c === 'CED') {
    const di = document.getElementById('opt-ced-data-inceput')?.value;
    const ds = document.getElementById('opt-ced-data-sfarsit')?.value;
    if (di) params.set('data_inceput', di);
    if (ds) params.set('data_sfarsit', ds);
  } else if (c === 'LAR_INST') {
    const di = document.getElementById('opt-lar-inst-data-inceput')?.value;
    const ds = document.getElementById('opt-lar-inst-data-sfarsit')?.value;
    const bl = document.getElementById('opt-lar-inst-blocuri')?.value;
    const inst = document.getElementById('opt-lar-inst-institutie')?.value;
    if (di) params.set('data_inceput', di);
    if (ds) params.set('data_sfarsit', ds);
    if (bl) params.set('blocuri', bl);
    if (inst) params.set('institutie', inst);
  } else if (c === 'CCA') {
    const di = document.getElementById('opt-cca-data-inceput')?.value;
    const ds = document.getElementById('opt-cca-data-sfarsit')?.value;
    if (di) params.set('data_inceput', di);
    if (ds) params.set('data_sfarsit', ds);
  } else if (c === 'COM') {
    const refAn = document.getElementById('com-ref-an')?.value;
    const refLuna = document.getElementById('com-ref-luna')?.value;
    const procTol = document.getElementById('com-proc-tolerat')?.value;
    if (refAn) params.set('ref_an', refAn);
    if (refLuna) params.set('ref_luna', refLuna);
    if (procTol !== undefined && procTol !== '') params.set('proc_tolerat', procTol);
  } else if (c === 'LSC') {
    const zilim = document.getElementById('lsc-zilim')?.value;
    const datas = document.getElementById('lsc-datas')?.value;
    const varianta = document.getElementById('lsc-varianta')?.value;
    const prag = document.getElementById('opt-lsc-prag-minim')?.value;
    if (zilim) params.set('zilim', zilim);
    if (datas) {
      params.set('datas', datas);
      params.set('data_limita', datas);
    }
    if (varianta) params.set('varianta', varianta);
    if (prag !== undefined && prag !== '') params.set('prag_minim', prag);
  } else if (c === 'LFA') {
    const ord = document.getElementById('opt-lfa-ordonare')?.value;
    const cufet = document.getElementById('opt-lfa-cufet')?.value;
    const n1 = document.getElementById('opt-lfa-nota1')?.value;
    const n2 = document.getElementById('opt-lfa-nota2')?.value;
    if (ord) params.set('ordonare', ord);
    if (cufet) params.set('cu_energie_termica', cufet);
    if (n1) params.set('nota1', n1);
    if (n2) params.set('nota2', n2);
  } else if (c === 'LIP' || c === 'LIR' || c === 'LAF' || c === 'LAR') {
    const term = document.getElementById('opt-termen-plata')?.value;
    const fmt = document.getElementById('opt-format-lista')?.value;
    const cufet = document.getElementById('opt-cu-energie-termica')?.value;
    if (term) params.set('termen_plata', term);
    if (fmt) {
      params.set('format_lista', fmt);
      if (!isCsv) params.set('format', fmt);
    }
    if (cufet) params.set('cu_energie_termica', cufet);
  } else if (c === 'LVE') {
    const incVal = document.getElementById('opt-lve-include-valid')?.value;
    if (incVal !== undefined && incVal !== '') params.set('includeValid', incVal);
  } else if (c === 'ADU') {
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

  const res = await apiGet(`/api/operatiuni/apartamente/${aptId}/adeverinta?data_inr=${dataInr}`);
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

  const res = await apiGet(`/api/operatiuni/apartamente/${aptId}/adeverinta?nr_inr=${nrInr}&data_inr=${dataInr}&serv=${encodeURIComponent(serv)}`);
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

  container.innerHTML = `
    <div style="font-family:'Times New Roman', Times, serif; color:#0f172a; padding:2rem 2.5rem; line-height:1.6; font-size:1.05rem;">
      <div style="display:flex; justify-content:space-between; border-bottom:2px solid #0f172a; padding-bottom:0.75rem; margin-bottom:1.5rem;">
        <div>
          <strong style="font-size:1.15rem;">ASOCIAȚIA DE PROPRIETARI "${a.nume}"</strong><br>
          <span>Cod Fiscal / C.I.F.: ${a.cod_fiscal || '-'}</span><br>
          <span>Sediul: ${a.adresa || '-'}, ${a.oras || 'Alba Iulia'}</span><br>
          <span>Banca: ${a.banca || '-'} | Cont IBAN: ${a.cont_bancar || '-'}</span>
        </div>
        <div style="text-align:right;">
          <span style="font-size:0.9rem;">Evidență Financiară / Notar</span><br>
          <strong style="font-size:1.1rem;">Nr. ${adv.numar_inregistrare} / ${adv.data_inregistrarii}</strong>
        </div>
      </div>

      <div style="text-align:center; margin:2.5rem 0 1.5rem 0;">
        <h2 style="margin:0; letter-spacing:2px; font-size:1.65rem; text-decoration:underline;">A D E V E R I N Ț Ă</h2>
        <span style="font-size:0.9rem; font-style:italic;">(privind situația debitelor la cotele de întreținere și fonduri)</span>
      </div>

      <p style="text-indent:2.5rem; text-align:justify; margin-bottom:1.2rem;">
        ${adv.text_adeverinta}
      </p>

      ${adv.are_datorii ? `
        <div style="margin:1rem 0; border:1px solid #cbd5e1; background:#f8fafc; padding:0.85rem; border-radius:4px;">
          <strong>Situația debitelor defalcate la data de ${adv.data_inregistrarii}:</strong>
          <table style="width:100%; border-collapse:collapse; margin-top:0.5rem; font-size:0.95rem;">
            <tr><td style="padding:4px;">1. Întreținere / Regie (R):</td><td style="text-align:right; font-weight:700;">${formatMoney(d.intretinere_regie)} RON</td></tr>
            <tr><td style="padding:4px;">2. Fond de Rulment (F):</td><td style="text-align:right; font-weight:700;">${formatMoney(d.fond_rulment)} RON</td></tr>
            <tr><td style="padding:4px;">3. Fond de Reparații (A):</td><td style="text-align:right; font-weight:700;">${formatMoney(d.fond_reparatii)} RON</td></tr>
            <tr><td style="padding:4px;">4. Penalități de întârziere:</td><td style="text-align:right; font-weight:700;">${formatMoney(d.penalitati_inregistrate + d.penalitati_calculate)} RON</td></tr>
            <tr style="border-top:1px solid #94a3b8; font-weight:700;"><td style="padding:4px;">TOTAL GENERAL DATORAT:</td><td style="text-align:right; color:#dc2626;">${formatMoney(d.total_datorat)} RON</td></tr>
          </table>
        </div>
      ` : ''}

      <p style="text-indent:2.5rem; text-align:justify; margin-top:1.5rem;">
        ${adv.scop}
      </p>

      <div style="display:flex; justify-content:space-between; margin-top:4rem; padding:0 2rem;">
        <div style="text-align:center;">
          <strong>PREȘEDINTE,</strong><br><br><br>
          <span>${a.presedinte}</span><br>
          <small>(semnătura și ștampila)</small>
        </div>
        <div style="text-align:center;">
          <strong>ADMINISTRATOR,</strong><br><br><br>
          <span>${a.administrator}</span><br>
          <small>(semnătura)</small>
        </div>
      </div>
    </div>
  `;
}

function printAdeverinta() {
  const printContent = document.getElementById('adeverinta-preview-content')?.innerHTML;
  if (!printContent) return;
  const printWindow = window.open('', '_blank', 'width=850,height=900');
  if (printWindow) {
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Adeverinta Plata la Zi - ${currentAdeverintaData?.apartament?.proprietar || ''}</title>
        <style>
          body { font-family: 'Times New Roman', Times, serif; margin: 2cm; color: #000; }
          @media print { body { margin: 1.5cm; } }
        </style>
      </head>
      <body>
        ${printContent}
        <script>window.onload = function() { window.print(); window.close(); }<\/script>
      </body>
      </html>
    `);
    printWindow.document.close();
  } else {
    window.print();
  }
}

