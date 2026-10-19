/**
 * public/browser-runtime.js
 *
 * 1. Global Frontend Error Telemetry Collector (captures window.onerror, unhandledrejection,
 *    and failed API calls; persists to localStorage AND posts to /api/telemetry/errors -> logs/telemetry-errors.jsonl).
 * 2. Quick Test Account Switcher (ORHIDEEA Legacy vs. Clean New Agency vs. Superadmin) + 1-Click Telemetry .jsonl Download.
 * 3. Transparent Browser API Fallback for Static Hosting (GitHub Pages: https://essentiallabs.github.io/asociatie-app/):
 *    When the Node.js backend is not reachable (static host), serves all /api/* routes interactively from demo-seed.json + localStorage.
 */

(function () {
  const TELEMETRY_STORAGE_KEY = 'orhideea_telemetry_errors_v1';
  const STATE_STORAGE_KEY = 'orhideea_serverless_state_v1';
  const GDPR_CODES = new Set(['LAF', 'LAR', 'LP1', 'LP2', 'LPP', 'MAX']);

  const nativeFetch = window.fetch.bind(window);
  let backendMode = null; // 'node' | 'browser'
  if (
    typeof window !== 'undefined' &&
    window.location &&
    (window.location.hostname.endsWith('surge.sh') || window.location.hostname.endsWith('github.io'))
  ) {
    backendMode = 'browser';
  }
  let seedCache = null;

  // =========================================================================
  // 1. PERSISTENT CLIENT-SIDE & SERVER-SIDE TELEMETRY LOGGER
  // =========================================================================
  function getLocalTelemetryErrors() {
    try {
      return JSON.parse(localStorage.getItem(TELEMETRY_STORAGE_KEY) || '[]');
    } catch (_) {
      return [];
    }
  }

  function saveLocalTelemetryError(entry) {
    try {
      const list = getLocalTelemetryErrors();
      const record = {
        id: list.length + 1,
        creat_la: entry.timestamp || new Date().toISOString(),
        timestamp: entry.timestamp || new Date().toISOString(),
        platforma: entry.platforma || 'frontend-web',
        severity: entry.severity || 'ERROR',
        method: entry.method || null,
        url: entry.url || window.location.pathname,
        status: entry.status || null,
        asociatie_id: Number(localStorage.getItem('activeAsociatieId') || 1),
        user: localStorage.getItem('activeTestAccount') || 'operator',
        mesaj: String(entry.mesaj || entry.message || 'Eroare necunoscută'),
        stack: String(entry.stack || ''),
        rezolvat: 0
      };
      list.unshift(record);
      localStorage.setItem(TELEMETRY_STORAGE_KEY, JSON.stringify(list.slice(0, 500)));
      updateTelemetryBadge();
      return record;
    } catch (_) {
      return null;
    }
  }

  async function reportErrorToTelemetry(payload) {
    const rec = saveLocalTelemetryError(payload);
    if (backendMode !== 'browser') {
      try {
        await nativeFetch('/api/telemetry/errors', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Skip-Telemetry': '1' },
          body: JSON.stringify(payload)
        });
      } catch (_) {}
    }
    return rec;
  }

  window.addEventListener('error', (event) => {
    reportErrorToTelemetry({
      platforma: 'window.onerror',
      severity: 'ERROR',
      url: event.filename || window.location.href,
      mesaj: event.message || 'Uncaught JavaScript Error',
      stack: event.error?.stack || `${event.filename}:${event.lineno}:${event.colno}`
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    reportErrorToTelemetry({
      platforma: 'unhandledrejection',
      severity: 'ERROR',
      url: window.location.href,
      mesaj: reason?.message || String(reason || 'Unhandled Promise Rejection'),
      stack: reason?.stack || ''
    });
  });

  window.downloadTelemetryJsonl = async function (format = 'jsonl') {
    if (backendMode === 'node') {
      window.open(`/api/telemetry/errors/download?format=${encodeURIComponent(format)}`, '_blank');
      return;
    }
    const errors = getLocalTelemetryErrors();
    let content = '';
    let filename = `telemetry-errors.${format}`;
    if (format === 'log') {
      content = errors
        .map(
          (e) =>
            `[${e.timestamp}] [${e.severity}] [${e.platforma}] ${e.mesaj}\n  Stack: ${e.stack || '-'}\n--------------------------------------------------------------------------------`
        )
        .join('\n');
    } else {
      content = errors.map((e) => JSON.stringify(e)).join('\n') + '\n';
    }
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
  };

  window.triggerTestTelemetryError = async function () {
    const testMsg = `Eroare Test Telemetrie (${new Date().toLocaleTimeString('ro-RO')}) — verificat pt. salvare în telemetry-errors.jsonl`;
    if (backendMode === 'node') {
      await fetch('/api/telemetry/errors/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mesaj: testMsg })
      });
    } else {
      saveLocalTelemetryError({
        platforma: 'telemetry-self-test',
        severity: 'TEST',
        method: 'POST',
        url: '/api/telemetry/errors/test',
        status: 500,
        mesaj: testMsg,
        stack: new Error('SimulatedTelemetryTestError: Salvata in telemetry-errors.jsonl').stack
      });
    }
    updateTelemetryBadge();
    if (typeof window.showToast === 'function') {
      window.showToast('Eroare de test înregistrată în fișierul de telemetrie (.jsonl)!', 'success');
    } else {
      alert('Eroare de test salvată în telemetrie!');
    }
  };

  // =========================================================================
  // 2. TRANSPARENT IN-BROWSER BACKEND FOR GITHUB PAGES / STATIC HOSTING
  // =========================================================================
  function ensureDefaultAsociatii(state) {
    if (!state.asociatii || !Array.isArray(state.asociatii)) {
      state.asociatii = [];
    }
    let asoc1 = state.asociatii.find((a) => Number(a.id) === 1);
    if (!asoc1) {
      asoc1 = {
        id: 1,
        nume: 'ASOCIAȚIA TEST (10 Blocuri / 78 Ap.)',
        cod_fiscal: '',
        administrator: 'Administrator Test',
        presedinte: 'Președinte Asociație',
        adresa: 'Str. Principală Nr. 1',
        serie_chitante: 'ASN',
        urmatorul_numar_chitanta: 1,
        luna_lucru: 9,
        an_lucru: 2026
      };
      state.asociatii.unshift(asoc1);
    } else {
      asoc1.nume = 'ASOCIAȚIA TEST (10 Blocuri / 78 Ap.)';
      asoc1.cod_fiscal = '';
    }

    let asoc2 = state.asociatii.find((a) => Number(a.id) === 2);
    if (!asoc2) {
      asoc2 = {
        id: 2,
        nume: 'ASOCIAȚIA DEMO CURATĂ (Workspace Nou)',
        cod_fiscal: '',
        administrator: 'Admin Agenție Nouă',
        presedinte: 'Președinte Nou',
        adresa: 'Bulevardul Unirii Nr. 10',
        serie_chitante: 'AGN',
        urmatorul_numar_chitanta: 1,
        luna_lucru: 9,
        an_lucru: 2026
      };
      state.asociatii.push(asoc2);
    } else {
      asoc2.nume = 'ASOCIAȚIA DEMO CURATĂ (Workspace Nou)';
      asoc2.cod_fiscal = '';
    }
  }

  async function ensureSeedLoaded() {
    if (seedCache) return seedCache;
    try {
      const saved = localStorage.getItem(STATE_STORAGE_KEY);
      if (saved) {
        seedCache = JSON.parse(saved);
        if (seedCache && Array.isArray(seedCache.asociatii) && seedCache.precomputed_reports) {
          seedCache.casa = seedCache.casa || [];
          seedCache.banca = seedCache.banca || [];
          seedCache.patrimoniu = seedCache.patrimoniu || [];
          seedCache.ordine_plata = seedCache.ordine_plata || [];
          seedCache.audit_logs = seedCache.audit_logs || [];
          seedCache.facturi = seedCache.facturi || [];
          ensureDefaultAsociatii(seedCache);
          return seedCache;
        }
      }
    } catch (_) {}

    const res = await nativeFetch('./demo-seed.json');
    seedCache = await res.json();
    seedCache.casa = seedCache.casa || [];
    seedCache.banca = seedCache.banca || [];
    seedCache.patrimoniu = seedCache.patrimoniu || [];
    seedCache.ordine_plata = seedCache.ordine_plata || [];
    seedCache.audit_logs = seedCache.audit_logs || [];
    seedCache.facturi = seedCache.facturi || [];
    ensureDefaultAsociatii(seedCache);
    persistState();
    return seedCache;
  }

  function persistState() {
    if (!seedCache) return;
    try {
      const slim = { ...seedCache };
      localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(slim));
    } catch (_) {}
  }

  function jsonResponse(obj, status = 200) {
    return new Response(JSON.stringify(obj), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  function maskReportGdpr(report, code, showNames) {
    const cloned = JSON.parse(JSON.stringify(report));
    const isNoticeBoard = GDPR_CODES.has(String(code || '').toUpperCase());
    cloned.gdpr_applicable = isNoticeBoard;
    cloned.gdpr_masked = isNoticeBoard && !showNames;
    if (cloned.gdpr_masked && Array.isArray(cloned.rows)) {
      cloned.rows = cloned.rows.map((r) => {
        const copy = { ...r };
        const apt = copy.numar_apart || copy.apartament || copy.APART || '?';
        if ('nume_proprietar' in copy) copy.nume_proprietar = `[GDPR - Ap. ${apt}]`;
        if ('nume' in copy) copy.nume = `[GDPR - Ap. ${apt}]`;
        if ('proprietar' in copy) copy.proprietar = `[GDPR - Ap. ${apt}]`;
        return copy;
      });
    }
    return cloned;
  }

  async function handleBrowserApi(urlStr, options = {}) {
    const state = await ensureSeedLoaded();
    state.facturi = state.facturi || [];
    const u = new URL(urlStr, window.location.origin);
    const path = u.pathname.replace(/^.*\/api/, '/api');
    const method = String(options.method || 'GET').toUpperCase();
    const headers = options.headers || {};
    const asocId = Number(
      headers['X-Asociatie-Id'] ||
        headers['x-asociatie-id'] ||
        u.searchParams.get('asociatie_id') ||
        localStorage.getItem('asoc_workspace_id') ||
        localStorage.getItem('activeAsociatieId') ||
        1
    );
    let body = {};
    if (options.body) {
      try {
        body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
      } catch (_) {}
    }

    const activeAsoc = state.asociatii.find((a) => Number(a.id) === asocId) || state.asociatii[0];
    const asocBlocs = Number(activeAsoc.id) === 2
      ? state.blocuri.filter((b) => Number(b.asociatie_id) === 2)
      : state.blocuri.filter((b) => Number(b.asociatie_id || 1) === 1);
    const asocBlocIds = new Set(asocBlocs.map((b) => Number(b.id)));
    const asocApts = state.apartamente.filter((a) => asocBlocIds.has(Number(a.bloc_id)));

    // Auth & Multi-Tenant
    if (path === '/api/auth/login' && method === 'POST') {
      const uname = String(body.username || body.role || 'admin').trim();
      const isSuper = body.role === 'superadmin' || uname === 'superadmin';
      const targetAsocId = uname === 'agentie_noua' ? 2 : 1;
      return jsonResponse({
        success: true,
        token: 'demo-jwt-token-' + uname,
        role: isSuper ? 'superadmin' : 'admin',
        name: isSuper ? 'Superadmin Turn de Control' : 'Administrator Asociație',
        user: {
          id: 1,
          username: uname,
          role: isSuper ? 'superadmin' : 'admin',
          rol: isSuper ? 'superadmin' : 'administrator',
          name: isSuper ? 'Superadmin Turn de Control' : 'Administrator Asociație',
          asociatie_id: targetAsocId
        }
      });
    }

    if (path === '/api/operatiuni/asociatii' && method === 'GET') {
      return jsonResponse(
        state.asociatii.map((a) => {
          const isClean = Number(a.id) === 2;
          const bList = isClean
            ? state.blocuri.filter((b) => Number(b.asociatie_id) === 2)
            : state.blocuri.filter((b) => Number(b.asociatie_id || 1) === 1);
          const bIds = new Set(bList.map((b) => Number(b.id)));
          const aptCount = state.apartamente.filter((ap) => bIds.has(Number(ap.bloc_id))).length;
          return {
            ...a,
            nr_blocuri: bList.length,
            total_blocuri: bList.length,
            nr_apartamente: aptCount,
            total_apartamente: aptCount
          };
        })
      );
    }

    if (path === '/api/operatiuni/asociatii' && method === 'POST') {
      const newId = Math.max(...state.asociatii.map((a) => Number(a.id))) + 1;
      const newAsoc = {
        id: newId,
        nume: body.nume || `ASOCIAȚIA NOUĂ #${newId}`,
        cod_fiscal: body.cod_fiscal || '',
        administrator: body.administrator || 'Administrator Nou',
        presedinte: body.presedinte || '',
        adresa: body.adresa || '',
        proc_penalizare: 0.2,
        zile_penalizare: 45,
        serie_chitante: body.serie_chitante || 'ASN',
        urmatorul_numar_chitanta: 1,
        luna_lucru: 9,
        an_lucru: 2026
      };
      state.asociatii.push(newAsoc);
      state.perioade.unshift({
        id: Date.now(),
        asociatie_id: newId,
        an: 2026,
        luna: 9,
        status: 'DESCHISA',
        ultima_zi: '2026-09-30',
        tarif_ar: 9.48,
        tarif_ca: 9.67,
        proc_ca: 100
      });
      persistState();
      return jsonResponse({ success: true, asociatie_id: newId, asociatie: newAsoc });
    }

    if (path === '/api/asociatie' || path === '/api/operatiuni/asociatie/facturi') {
      if (method === 'PUT') {
        Object.assign(activeAsoc, body);
        persistState();
      }
      return jsonResponse(activeAsoc);
    }

    const perGenMatch = path.match(/^\/api\/(?:operatiuni\/)?perioade\/(\d+)\/generale$/);
    if (perGenMatch || path === '/api/operatiuni/perioade' || path === '/api/perioade') {
      if (method === 'POST' || method === 'PUT') {
        const targetId = perGenMatch ? Number(perGenMatch[1]) : null;
        let targetPer = state.perioade.find((p) =>
          targetId
            ? Number(p.id) === targetId
            : Number(p.asociatie_id || 1) === Number(activeAsoc.id) &&
              (!body.an || Number(p.an) === Number(body.an)) &&
              (!body.luna || Number(p.luna) === Number(body.luna))
        );
        if (!targetPer) {
          targetPer = state.perioade.find((p) => Number(p.asociatie_id || 1) === Number(activeAsoc.id));
        }
        if (!targetPer) {
          targetPer = {
            id: Date.now(),
            asociatie_id: activeAsoc.id,
            an: Number(body.an || activeAsoc.an_lucru || 2026),
            luna: Number(body.luna || activeAsoc.luna_lucru || 9),
            status: 'DESCHISA',
            ultima_zi: '2026-09-30',
            tarif_ar: 9.48,
            tarif_ca: 9.67,
            proc_ca: 100,
            tarif_et: 0
          };
          state.perioade.unshift(targetPer);
        }
        Object.assign(targetPer, body);
        persistState();
        return jsonResponse({ success: true, perioada: targetPer });
      }
      const per = state.perioade.filter((p) => Number(p.asociatie_id || 1) === Number(activeAsoc.id));
      return jsonResponse(per.length ? per : state.perioade.slice(0, 12));
    }

    if (path === '/api/blocuri' && method === 'GET') {
      return jsonResponse(
        asocBlocs.map((b) => {
          const apts = state.apartamente.filter((a) => Number(a.bloc_id) === Number(b.id));
          return {
            ...b,
            nr_apartamente_actual: apts.length,
            nr_persoane: apts.reduce((s, a) => s + Number(a.persoane || 0), 0)
          };
        })
      );
    }

    if (path === '/api/blocuri' && method === 'POST') {
      const newBloc = {
        id: Date.now(),
        asociatie_id: activeAsoc.id,
        bloc: body.bloc || 'BL1',
        strada: body.strada || '',
        numar: body.numar || '',
        total_apartamente: Number(body.total_apartamente || 0),
        suprafata_totala: Number(body.suprafata_totala || 0),
        mod_r_dif: 'PER',
        mod_r_inc: 'SL',
        modr_difin: 'SL',
        mod_r_asc: 'PER',
        nr_apartamente_actual: 0,
        nr_persoane: 0
      };
      state.blocuri.push(newBloc);
      persistState();
      return jsonResponse({ id: newBloc.id, success: true, bloc: newBloc });
    }

    const blocRepDifMatch = path.match(/^\/api\/blocuri\/(\d+)\/repartizeaza-diferente-apa$/);
    if (blocRepDifMatch && method === 'POST') {
      const bId = Number(blocRepDifMatch[1]);
      const b = state.blocuri.find((x) => Number(x.id) === bId) || asocBlocs[0] || {};
      const apts = state.apartamente.filter((a) => Number(a.bloc_id) === Number(b.id));
      const consumBloc = Math.max(0, Number(b.index_nou_ar || b.inar || 0) - Number(b.index_vechi_ar || b.ivar || 0));
      const consumAp = apts.reduce(
        (s, a) =>
          s +
          Math.max(0, Number(a.in_ar_bu || 0) - Number(a.iv_ar_bu || 0)) +
          Math.max(0, Number(a.in_ar_ba1 || 0) - Number(a.iv_ar_ba1 || 0)) +
          Math.max(0, Number(a.in_ar_ba2 || 0) - Number(a.iv_ar_ba2 || 0)),
        0
      );
      const diferentaMc = Math.max(0, Number((consumBloc - consumAp).toFixed(2)));
      const tarif = Number(b.tarif_apa_rece || 8.5) + Number(b.tarif_canal || 4.0);
      const valoareTotala = Number((diferentaMc * tarif).toFixed(2));
      return jsonResponse({
        success: true,
        diferentaMc,
        valoareTotala,
        modRepartizare: b.mod_r_dif || 'PER'
      });
    }

    const listaPlataMatch = path.match(/^\/api\/blocuri\/(\d+)\/lista-plata$/);
    if (listaPlataMatch) {
      const bId = Number(listaPlataMatch[1]);
      const bloc = state.blocuri.find((x) => Number(x.id) === bId) || asocBlocs[0] || { id: bId, bloc: 'A1' };
      const apts = state.apartamente.filter((a) => Number(a.bloc_id) === Number(bloc.id));
      const rows = apts.map((a) => {
        const consum_ar_mc = Number(
          (
            Math.max(0, Number(a.in_ar_bu || 0) - Number(a.iv_ar_bu || 0)) +
            Math.max(0, Number(a.in_ar_ba1 || 0) - Number(a.iv_ar_ba1 || 0)) +
            Math.max(0, Number(a.in_ar_ba2 || 0) - Number(a.iv_ar_ba2 || 0))
          ).toFixed(2)
        );
        const valoare_ar = Number((Number(a.apa_rece || 0) + Number(a.can_mnj || 0)).toFixed(2));
        const diferente_apa = Number((Number(a.difarar || 0) + Number(a.difcanar || 0)).toFixed(2));
        const valoare_ac = Number(a.apa_calda || 0);
        const incalzire = Number(a.incalzire || 0);
        const gunoi = Number(a.gunoi || 0);
        const lift = Number(a.ascensor || 0);
        const curent_comun = Number((Number(a.curent_sc || 0) + Number(a.curent_li || 0)).toFixed(2));
        const salarii_admin = Number(
          (
            Number(a.sal_feme || 0) +
            Number(a.sal_tesa || 0) +
            Number(a.ch_admin || 0) +
            Number(a.ch_sediu || 0) +
            Number(a.abonament || 0)
          ).toFixed(2)
        );
        const fond_reparatii = Number(a.fond_repar || a.fond_reparatii || 0);
        const altele = Number(
          (
            Number(a.gaz || 0) +
            Number(a.prest_serv || 0) +
            Number(a.chelt_inc || 0) +
            Number(a.repar_crt || 0) +
            Number(a.ch_box || 0) +
            Number(a.ch_hav || 0) +
            Number(a.altele || 0)
          ).toFixed(2)
        );
        const total_luna = Number(
          (
            valoare_ar +
            diferente_apa +
            valoare_ac +
            incalzire +
            gunoi +
            lift +
            curent_comun +
            salarii_admin +
            fond_reparatii +
            altele
          ).toFixed(2)
        );
        const restante = Number(a.restante || 0);
        const penalizari = Number(a.penalizari || 0);
        const total_general = Number((total_luna + restante + penalizari).toFixed(2));
        return {
          id: a.id,
          numar_apart: a.numar_apart,
          nume_proprietar: a.nume_proprietar,
          persoane: Number(a.persoane ?? 1),
          suprafata: Number(a.suprafata || 0),
          consum_ar_mc,
          valoare_ar,
          diferente_apa,
          valoare_ac,
          incalzire,
          gunoi,
          lift,
          curent_comun,
          salarii_admin,
          fond_reparatii,
          altele,
          total_luna,
          restante,
          penalizari,
          total_general
        };
      });

      const sumField = (key) => Number(rows.reduce((s, r) => s + Number(r[key] || 0), 0).toFixed(2));
      const totaluri = {
        persoane: rows.reduce((s, r) => s + Number(r.persoane || 0), 0),
        suprafata: sumField('suprafata'),
        consum_ar_mc: sumField('consum_ar_mc'),
        valoare_ar: sumField('valoare_ar'),
        diferente_apa: sumField('diferente_apa'),
        valoare_ac: sumField('valoare_ac'),
        incalzire: sumField('incalzire'),
        gunoi: sumField('gunoi'),
        lift: sumField('lift'),
        curent_comun: sumField('curent_comun'),
        salarii_admin: sumField('salarii_admin'),
        fond_reparatii: sumField('fond_reparatii'),
        altele: sumField('altele'),
        total_luna: sumField('total_luna'),
        restante: sumField('restante'),
        penalizari: sumField('penalizari'),
        total_general: sumField('total_general')
      };

      const lunaNum = Number(u.searchParams.get('luna') || 9);
      const luniNume = [
        '',
        'Ianuarie',
        'Februarie',
        'Martie',
        'Aprilie',
        'Mai',
        'Iunie',
        'Iulie',
        'August',
        'Septembrie',
        'Octombrie',
        'Noiembrie',
        'Decembrie'
      ];
      return jsonResponse({
        asociatie: activeAsoc,
        bloc,
        luna: lunaNum,
        an: Number(u.searchParams.get('an') || 2026),
        lunaNume: luniNume[lunaNum] || 'Septembrie',
        tarife: {
          apa_rece: Number(bloc.tarif_apa_rece || 19.15),
          apa_calda: Number(bloc.tarif_apa_calda || 18.0)
        },
        apartamente: rows,
        totaluri
      });
    }

    const blocAptsMatch = path.match(/^\/api\/blocuri\/(\d+)\/apartamente$/);
    if (blocAptsMatch) {
      const bId = Number(blocAptsMatch[1]);
      if (method === 'GET') {
        return jsonResponse(state.apartamente.filter((a) => Number(a.bloc_id) === bId));
      }
      if (method === 'POST') {
        const newApt = {
          id: Date.now(),
          bloc_id: bId,
          numar_apart: String(body.numar_apart || 1),
          nume_proprietar: body.nume_proprietar || `Proprietar Ap. ${body.numar_apart || 1}`,
          persoane: Number(body.persoane ?? 0),
          suprafata: Number(body.suprafata || 50),
          cp_ar: 'C',
          cp_ac: 'C',
          cp_in: 'P',
          restante: 0,
          penalizari: 0
        };
        state.apartamente.push(newApt);
        persistState();
        return jsonResponse({ id: newApt.id, success: true });
      }
    }

    const blocMatch = path.match(/^\/api\/(?:operatiuni\/)?blocuri\/(\d+)(?:\/extins)?$/);
    if (blocMatch) {
      const bId = Number(blocMatch[1]);
      if (method === 'DELETE') {
        state.blocuri = state.blocuri.filter((x) => Number(x.id) !== bId);
        state.apartamente = state.apartamente.filter((a) => Number(a.bloc_id) !== bId);
        persistState();
        return jsonResponse({ success: true });
      }
      const b = state.blocuri.find((x) => Number(x.id) === bId);
      if (!b) return jsonResponse({ error: 'Bloc negăsit' }, 404);
      if (method === 'PUT') {
        Object.assign(b, body);
        persistState();
      }
      return jsonResponse(b);
    }

    if (path === '/api/apartamente') {
      return jsonResponse(asocApts);
    }

    const adevMatch = path.match(/^\/api\/operatiuni\/apartamente\/(\d+)\/adeverinta$/);
    if (adevMatch) {
      const aId = Number(adevMatch[1]);
      const apt = state.apartamente.find((x) => Number(x.id) === aId) || asocApts[0] || { id: aId, numar_apart: '1', nume_proprietar: '-' };
      const serv = u.searchParams.get('serv') || 'NOTAR PUBLIC, VANZARE APARTAMENT';
      const intret = Number(apt.restante || 0);
      const rulment = Number(apt.rulment || 0);
      const fondRep = Number(apt.fond_repar || 0);
      const penal = Number(apt.penalizari || 0);
      return jsonResponse({
        success: true,
        adeverinta: {
          numar_inregistrare: u.searchParams.get('nr_inr') || 1,
          data_inregistrarii: u.searchParams.get('data_inr') || new Date().toISOString().slice(0, 10),
          serviciu: serv,
          asociatie: activeAsoc,
          apartament: apt,
          are_datorii: intret > 0,
          defalcare_datorii: {
            intretinere_regie: intret,
            fond_rulment: rulment,
            fond_reparatii: fondRep,
            penalitati_inregistrate: penal,
            penalitati_calculate: 0,
            total_datorat: Number((intret + penal).toFixed(2))
          },
          text_adeverinta: `Subsemnații reprezentanți ai ${activeAsoc.nume}, adeverim prin prezenta că ap. ${apt.numar_apart} (proprietar ${apt.nume_proprietar || '-'}) figurează în evidențele asociației.`,
          scop: `Prezenta adeverință s-a eliberat pentru a-i servi la: ${serv}.`
        }
      });
    }

    const aptMatch = path.match(/^\/api\/(?:operatiuni\/)?apartamente\/(\d+)(?:\/extins)?$/);
    if (aptMatch) {
      const aId = Number(aptMatch[1]);
      if (method === 'DELETE') {
        state.apartamente = state.apartamente.filter((x) => Number(x.id) !== aId);
        persistState();
        return jsonResponse({ success: true });
      }
      const apt = state.apartamente.find((x) => Number(x.id) === aId);
      if (!apt) return jsonResponse({ error: 'Apartament negăsit' }, 404);
      if (method === 'PUT') {
        Object.assign(apt, body);
        persistState();
      }
      return jsonResponse(apt);
    }

    const avizierMatch = path.match(/^\/api\/avizier\/(\d+)$/);
    if (avizierMatch) {
      const bId = Number(avizierMatch[1]);
      const bloc = state.blocuri.find((x) => Number(x.id) === bId) || asocBlocs[0] || {};
      const apts = state.apartamente.filter((a) => Number(a.bloc_id) === Number(bloc.id));
      const rows = apts.map((a) => {
        const total_intretinere = Number(
          (
            Number(a.apa_rece || 0) +
            Number(a.can_mnj || 0) +
            Number(a.difarar || 0) +
            Number(a.difcanar || 0) +
            Number(a.apa_calda || 0) +
            Number(a.incalzire || 0) +
            Number(a.gaz || 0) +
            Number(a.gunoi || 0) +
            Number(a.curent_sc || 0) +
            Number(a.curent_li || 0) +
            Number(a.ascensor || 0) +
            Number(a.sal_feme || 0) +
            Number(a.sal_tesa || 0) +
            Number(a.ch_admin || 0) +
            Number(a.ch_sediu || 0) +
            Number(a.abonament || 0) +
            Number(a.prest_serv || 0) +
            Number(a.chelt_inc || 0) +
            Number(a.repar_crt || 0) +
            Number(a.ch_box || 0) +
            Number(a.ch_hav || 0) +
            Number(a.altele || 0)
          ).toFixed(2)
        );
        return {
          ...a,
          consum_ar:
            Math.max(0, Number(a.in_ar_bu || 0) - Number(a.iv_ar_bu || 0)) +
            Math.max(0, Number(a.in_ar_ba1 || 0) - Number(a.iv_ar_ba1 || 0)) +
            Math.max(0, Number(a.in_ar_ba2 || 0) - Number(a.iv_ar_ba2 || 0)),
          cost_apa_rece: Number(a.apa_rece || 0),
          cost_canal: Number(a.can_mnj || 0),
          cost_dif_apa: Number(((a.difarar || 0) + (a.difcanar || 0)).toFixed(2)),
          cost_apa_calda: Number(a.apa_calda || 0),
          cost_incalzire: Number(a.incalzire || 0),
          cost_gunoi: Number(a.gunoi || 0),
          cost_curent_scara: Number(((a.curent_sc || 0) + (a.curent_li || 0)).toFixed(2)),
          cost_lift: Number(a.ascensor || 0),
          cost_salarii: Number(((a.sal_feme || 0) + (a.sal_tesa || 0)).toFixed(2)),
          cost_administrare: Number(((a.ch_admin || 0) + (a.ch_sediu || 0) + (a.abonament || 0)).toFixed(2)),
          cost_fond_reparatii: Number(a.fond_repar || 0),
          cost_alte: Number(((a.repar_crt || 0) + (a.altele || 0) + (a.gaz || 0)).toFixed(2)),
          total_intretinere,
          total_general: Number((total_intretinere + Number(a.fond_repar || 0) + Number(a.rulment || 0) + Number(a.restante || 0) + Number(a.penalizari || 0)).toFixed(2))
        };
      });
      return jsonResponse({ asociatie: activeAsoc, bloc, apartamente: rows });
    }

    // Reports Catalog & 35 Reports
    if (path === '/api/rapoarte/catalog') {
      return jsonResponse(state.report_catalog || []);
    }

    const repMatch = path.match(/^\/api\/rapoarte\/([A-Za-z0-9_]+)$/);
    if (repMatch) {
      const code = repMatch[1].toUpperCase();
      const showNames = u.searchParams.get('showNames') === 'true' || u.searchParams.get('gdpr') === 'false';
      let baseReport = (state.precomputed_reports && state.precomputed_reports[code])
        ? JSON.parse(JSON.stringify(state.precomputed_reports[code]))
        : null;

      if (!baseReport) {
        baseReport = {
          code,
          title: `Raport ${code}`,
          category: 'LISTARE',
          asociatie: activeAsoc,
          period: { an: activeAsoc.an_lucru || 2026, luna: activeAsoc.luna_lucru || 9 },
          columns: [
            { key: 'bloc', label: 'Bloc' },
            { key: 'numar_apart', label: 'Ap.' },
            { key: 'nume_proprietar', label: 'Proprietar' },
            { key: 'persoane', label: 'Pers.' },
            { key: 'suprafata', label: 'Suprafață' },
            { key: 'restante', label: 'Restanțe (RON)' }
          ],
          rows: asocApts,
          totals: { count: asocApts.length }
        };
      } else {
        baseReport.asociatie = activeAsoc;
        if (Number(activeAsoc.id) === 2) {
          baseReport.rows = [];
          baseReport.totals = { count: 0 };
        }
      }

      const masked = maskReportGdpr(baseReport, code, showNames);
      if (u.searchParams.get('format') === 'csv') {
        const cols = masked.columns || [];
        const header = cols.map((c) => `"${String(c.label || c.key || '').replace(/"/g, '""')}"`).join(',');
        const lines = (masked.rows || []).map((r) =>
          cols.map((c) => `"${String(r[c.key] ?? '').replace(/"/g, '""')}"`).join(',')
        );
        return new Response('\uFEFF' + [header, ...lines].join('\r\n'), {
          status: 200,
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="raport_${code}.csv"`
          }
        });
      }
      return jsonResponse(masked);
    }

    // Cashier & Ledger
    const ledgerMatch = path.match(/^\/api\/(?:chitante\/)?ledger\/apartament\/(\d+)$/);
    if (ledgerMatch) {
      const aptId = Number(ledgerMatch[1]);
      const apt = state.apartamente.find((a) => Number(a.id) === aptId) || state.apartamente[0] || { id: aptId, numar_apart: '1', restante: 0, penalizari: 0 };
      let rows = (state.datorii || []).filter((d) => Number(d.apartament_id) === aptId);
      if (rows.length === 0 && (Number(apt.restante || 0) > 0 || Number(apt.penalizari || 0) > 0)) {
        rows = [];
        if (Number(apt.restante || 0) > 0) {
          rows.push({
            id: aptId * 1000 + 1,
            apartament_id: aptId,
            categorie: 'R',
            descriere: 'Sold restanță întreținere reportată',
            data_scadenta: '2026-08-30',
            valoare_initiala: Number(apt.restante || 0),
            suma_achitata: 0,
            restanta: Number(apt.restante || 0)
          });
        }
        if (Number(apt.penalizari || 0) > 0) {
          rows.push({
            id: aptId * 1000 + 2,
            apartament_id: aptId,
            categorie: 'P',
            descriere: 'Penalități înregistrate',
            data_scadenta: '2026-08-30',
            valoare_initiala: Number(apt.penalizari || 0),
            suma_achitata: 0,
            restanta: Number(apt.penalizari || 0)
          });
        }
      }
      const totals = { R: 0, F: 0, A: 0, P: 0, totalRestanta: 0 };
      rows.forEach((r) => {
        const rest = Number(r.restanta ?? r.valoare ?? 0);
        totals[r.categorie || 'R'] = Number(((totals[r.categorie || 'R'] || 0) + rest).toFixed(2));
        totals.totalRestanta = Number((totals.totalRestanta + rest).toFixed(2));
      });
      return jsonResponse({
        apartament: apt,
        rows,
        unpaidRows: rows,
        totals,
        penalties_preview: {
          total_penalizare: 0,
          target_date: new Date().toISOString().slice(0, 10),
          proc_penal: activeAsoc.proc_penalizare || 0.2,
          zile_penal: activeAsoc.zile_penalizare || 45
        },
        penaltiesPreview: { totalPenalty: 0, items: [] }
      });
    }

    const penalInregMatch = path.match(/^\/api\/chitante\/penalitati\/(\d+)\/inregistreaza$/);
    if (penalInregMatch && method === 'POST') {
      return jsonResponse({ success: true, booked_amount: 0, total_penalizare: 0 });
    }

    if (path === '/api/chitante/colectiv' && method === 'POST') {
      const suma = Number(body.suma || 0);
      const nr = activeAsoc.urmatorul_numar_chitanta || (state.chitante?.length || 0) + 1;
      activeAsoc.urmatorul_numar_chitanta = nr + 1;
      const blocObj = state.blocuri.find((b) => Number(b.id) === Number(body.bloc_id)) || asocBlocs[0] || {};
      const ch = {
        id: Date.now(),
        serie: activeAsoc.serie_chitante || 'ORH',
        numar: nr,
        apartament_id: null,
        numar_apart: 'COLECTIV',
        nume_proprietar: body.platitor || `Colectiv Bloc ${blocObj.bloc || 'A1'}`,
        bloc: blocObj.bloc || 'A1',
        suma,
        suma_in_litere: `${suma.toFixed(2)} RON`,
        reprezinta: body.reprezinta || body.tip_fond || 'Încasare Colectivă',
        data_emitere: new Date().toISOString().slice(0, 10),
        anulata: 0
      };
      state.chitante = state.chitante || [];
      state.chitante.unshift(ch);
      persistState();
      return jsonResponse({ success: true, chitanta: ch });
    }

    const chAnulMatch = path.match(/^\/api\/chitante\/(\d+)\/anuleaza$/);
    if (chAnulMatch && method === 'POST') {
      const chId = Number(chAnulMatch[1]);
      const ch = (state.chitante || []).find((c) => Number(c.id) === chId);
      if (ch) {
        ch.anulata = 1;
        persistState();
      }
      return jsonResponse({ success: true });
    }

    if (path === '/api/chitante' || path === '/api/chitante/individual') {
      if (method === 'GET') {
        return jsonResponse(state.chitante || []);
      }
      if (method === 'POST') {
        const apt = state.apartamente.find((a) => Number(a.id) === Number(body.apartament_id)) || {};
        const suma = Number(body.suma || 0);
        const nr = activeAsoc.urmatorul_numar_chitanta || (state.chitante?.length || 0) + 1;
        activeAsoc.urmatorul_numar_chitanta = nr + 1;
        const ch = {
          id: Date.now(),
          serie: activeAsoc.serie_chitante || 'ORH',
          numar: nr,
          apartament_id: apt.id,
          numar_apart: apt.numar_apart || '1',
          nume_proprietar: apt.nume_proprietar || 'Proprietar',
          bloc: (state.blocuri.find((b) => Number(b.id) === Number(apt.bloc_id)) || {}).bloc || 'A1',
          suma,
          suma_in_litere: `${suma.toFixed(2)} RON`,
          reprezinta: body.explicatie || 'Cote întreținere (P -> A -> F -> R)',
          data_emitere: new Date().toISOString().slice(0, 10),
          anulata: 0
        };
        state.chitante.unshift(ch);
        persistState();
        return jsonResponse({ success: true, chitanta: ch });
      }
    }

    // Istoric Luni Închise
    if (path === '/api/luna/istoric' && method === 'GET') {
      const list = state.perioade
        .filter((p) => Number(p.asociatie_id || 1) === Number(activeAsoc.id))
        .slice(0, 12)
        .map((p) => ({
          id: p.id,
          luna: p.luna,
          an: p.an,
          data_inchidere: p.ultima_zi || `${p.an}-${String(p.luna).padStart(2, '0')}-28`,
          total_calculat: 18450.25,
          total_incasat: 16200.0
        }));
      return jsonResponse(list);
    }

    // Calcul & Lifecycle endpoints
    if (path.startsWith('/api/calcul/') || path.startsWith('/api/luna/')) {
      return jsonResponse({
        success: true,
        message: `Operațiune ${path.split('/').pop().toUpperCase()} executată cu succes în modul Demo Live.`,
        expiredCount: 0,
        ultima_zi: '2026-09-30',
        apartamente: asocApts,
        apartamente_procesate: asocApts.length
      });
    }

    // Registre Financiare (GET, POST, DELETE)
    const regDelMatch = path.match(/^\/api\/operatiuni\/(casa|banca|patrimoniu|ordine-plata)\/(\d+)$/);
    if (regDelMatch && method === 'DELETE') {
      const key = regDelMatch[1].replace('-', '_');
      const itemId = Number(regDelMatch[2]);
      state[key] = (state[key] || []).filter((x) => Number(x.id) !== itemId);
      persistState();
      return jsonResponse({ success: true });
    }

    for (const reg of ['casa', 'banca', 'patrimoniu', 'ordine-plata']) {
      const key = reg.replace('-', '_');
      if (path === `/api/operatiuni/${reg}`) {
        if (method === 'GET') return jsonResponse(state[key] || []);
        if (method === 'POST') {
          const item = { id: Date.now(), ...body, creat_la: new Date().toISOString() };
          state[key] = state[key] || [];
          state[key].unshift(item);
          persistState();
          return jsonResponse({ success: true, id: item.id, item });
        }
      }
    }

    // Raw DB Audit & Ledger Integrity
    const rawAuditMatch = path.match(/^\/api\/operatiuni\/audit\/raw\/([A-Za-z0-9_]+)$/);
    if (rawAuditMatch && method === 'GET') {
      const table = rawAuditMatch[1];
      let rows = [];
      if (table === 'asociatii') rows = state.asociatii || [];
      else if (table === 'blocuri') rows = asocBlocs;
      else if (table === 'apartamente') rows = asocApts;
      else if (table === 'datorii_apartamente' || table === 'datorii') rows = state.datorii || [];
      else if (table === 'chitante') rows = state.chitante || [];
      else if (table === 'perioade') rows = state.perioade || [];
      return jsonResponse({ table, rows });
    }

    if (path === '/api/operatiuni/admin/integrity' && method === 'GET') {
      return jsonResponse({
        integrity_ok: true,
        orphan_payments: 0,
        ledger_summary: {
          totals: {
            totalRestanta: 290492.47
          }
        }
      });
    }

    // Control Tower & Telemetry
    if (path === '/api/control-tower/summary') {
      const errs = getLocalTelemetryErrors();
      return jsonResponse({
        platform: activeAsoc.nume || 'TEST ADMINISTRATORI',
        version: '2.5.0-FoxPro-Parity',
        environment: window.location.hostname.endsWith('surge.sh') ? 'surge-live' : 'github-pages-live',
        uptime: Math.floor(performance.now() / 1000),
        asociatie: activeAsoc,
        stats: {
          total_blocuri: asocBlocs.length,
          total_apartamente: asocApts.length,
          total_erori: errs.length
        },
        errors: errs
      });
    }

    const telResolveMatch = path.match(/^\/api\/telemetry\/errors\/(\d+)\/resolve$/);
    if (telResolveMatch && method === 'POST') {
      const errId = Number(telResolveMatch[1]);
      const list = getLocalTelemetryErrors();
      const target = list.find((e) => Number(e.id) === errId);
      if (target) {
        target.rezolvat = 1;
        try {
          localStorage.setItem(TELEMETRY_STORAGE_KEY, JSON.stringify(list));
        } catch (_) {}
      }
      return jsonResponse({ success: true });
    }

    if (path === '/api/telemetry/errors') {
      if (method === 'GET') return jsonResponse(getLocalTelemetryErrors());
      if (method === 'POST') {
        const rec = saveLocalTelemetryError(body);
        return jsonResponse({ success: true, id: rec?.id || 1, entry: rec });
      }
    }

    if (path === '/api/statistici') {
      return jsonResponse({
        blocuri: asocBlocs.length,
        apartamente: asocApts.length,
        persoane: asocApts.reduce((s, a) => s + Number(a.persoane || 0), 0),
        facturi: Number(activeAsoc.id) === 2 ? 0 : (state.facturi.length || 12),
        totalFacturi: Number(activeAsoc.id) === 2 ? 0 : 18450.25,
        chitante: (state.chitante || []).length,
        totalIncasat: (state.chitante || []).reduce((s, c) => s + Number(c.suma || 0), 0),
        luna_lucru: activeAsoc.luna_lucru || 9,
        an_lucru: activeAsoc.an_lucru || 2026
      });
    }

    // Facturi Endpoints
    if (path === '/api/facturi') {
      if (method === 'GET') {
        const bIdFilter = u.searchParams.get('bloc_id');
        let list = (state.facturi || []).filter(
          (f) => !f.asociatie_id || Number(f.asociatie_id) === Number(activeAsoc.id)
        );
        if (bIdFilter) {
          list = list.filter((f) => !f.bloc_id || Number(f.bloc_id) === Number(bIdFilter));
        }
        return jsonResponse(
          list.map((f) => ({
            ...f,
            bloc_nume: f.bloc_id
              ? (state.blocuri.find((b) => Number(b.id) === Number(f.bloc_id)) || {}).bloc || ''
              : 'Toată Asociația'
          }))
        );
      }
      if (method === 'POST') {
        const newFactura = {
          id: Date.now(),
          asociatie_id: activeAsoc.id,
          bloc_id: body.bloc_id ? Number(body.bloc_id) : null,
          tip_serviciu: body.tip_serviciu || 'altele',
          furnizor: body.furnizor || '',
          numar_factura: body.numar_factura || '',
          data_factura: body.data_factura || new Date().toISOString().slice(0, 10),
          valoare: Number(body.valoare || 0),
          cantitate: Number(body.cantitate || 0),
          mod_repartizare: body.mod_repartizare || 'apartament',
          luna: Number(body.luna || 9),
          an: Number(body.an || 2026),
          nr_repartizari: 0,
          repartizari: []
        };
        state.facturi.unshift(newFactura);
        persistState();
        return jsonResponse({ success: true, id: newFactura.id, factura: newFactura });
      }
    }

    const factRepMatch = path.match(/^\/api\/facturi\/(\d+)\/repartizeaza$/);
    if (factRepMatch && method === 'POST') {
      const fId = Number(factRepMatch[1]);
      const f = (state.facturi || []).find((x) => Number(x.id) === fId);
      if (!f) return jsonResponse({ error: 'Factură negăsită' }, 404);
      const targetApts = f.bloc_id
        ? state.apartamente.filter((a) => Number(a.bloc_id) === Number(f.bloc_id))
        : asocApts;
      const totalVal = Number(f.valoare || 0);
      const count = targetApts.length || 1;
      const totalPers = targetApts.reduce((s, a) => s + Number(a.persoane || 0), 0) || 1;
      const totalSup = targetApts.reduce((s, a) => s + Number(a.suprafata || 0), 0) || 1;
      const shares = targetApts.map((a) => {
        let baza = 1;
        let suma = totalVal / count;
        if (f.mod_repartizare === 'persoane') {
          baza = Number(a.persoane || 0);
          suma = (totalVal * baza) / totalPers;
        } else if (f.mod_repartizare === 'suprafata' || f.mod_repartizare === 'cota_indiviza') {
          baza = Number(a.suprafata || 0);
          suma = (totalVal * baza) / totalSup;
        }
        return {
          apartament_id: a.id,
          numar_apart: a.numar_apart,
          nume_proprietar: a.nume_proprietar,
          baza_calcul: Number(baza.toFixed(2)),
          suma_repartizata: Number(suma.toFixed(2))
        };
      });
      f.repartizari = shares;
      f.nr_repartizari = shares.length;
      persistState();
      return jsonResponse({ success: true, repartizari: shares.length, detalii: shares });
    }

    const factGetRepMatch = path.match(/^\/api\/facturi\/(\d+)\/repartizare$/);
    if (factGetRepMatch && method === 'GET') {
      const fId = Number(factGetRepMatch[1]);
      const f = (state.facturi || []).find((x) => Number(x.id) === fId);
      return jsonResponse(f?.repartizari || []);
    }

    const factDelMatch = path.match(/^\/api\/facturi\/(\d+)$/);
    if (factDelMatch && method === 'DELETE') {
      const fId = Number(factDelMatch[1]);
      state.facturi = (state.facturi || []).filter((x) => Number(x.id) !== fId);
      persistState();
      return jsonResponse({ success: true });
    }

    return jsonResponse({ success: true });
  }

  // Intercept window.fetch to auto-detect Node backend vs. GitHub Pages static mode & capture API errors
  window.fetch = async function (input, init = {}) {
    const urlStr = typeof input === 'string' ? input : input?.url || '';
    const isApi = urlStr.includes('/api/');

    if (!isApi) {
      return nativeFetch(input, init);
    }

    if (
      typeof window !== 'undefined' &&
      window.location &&
      (window.location.hostname.endsWith('surge.sh') || window.location.hostname.endsWith('github.io'))
    ) {
      backendMode = 'browser';
    }

    // Inject active multi-tenant X-Asociatie-Id header if set
    const activeAsocId = localStorage.getItem('asoc_workspace_id') || localStorage.getItem('activeAsociatieId') || '1';
    init.headers = {
      ...(init.headers || {}),
      'X-Asociatie-Id': (init.headers && (init.headers['X-Asociatie-Id'] || init.headers['x-asociatie-id'])) || activeAsocId
    };

    if (backendMode === 'browser') {
      return handleBrowserApi(urlStr, init);
    }

    try {
      const response = await nativeFetch(input, init);
      const contentType = response.headers.get('content-type') || '';

      // If hosted on GitHub Pages or Surge, /api/* returns 404 HTML -> switch seamlessly to in-browser runtime!
      if (response.status === 404 && !contentType.includes('application/json') && window.location.hostname !== 'localhost') {
        backendMode = 'browser';
        updateModeIndicator();
        return handleBrowserApi(urlStr, init);
      }

      backendMode = 'node';
      if (response.status >= 400 && !init.headers['X-Skip-Telemetry']) {
        const clone = response.clone();
        clone
          .json()
          .then((errBody) => {
            saveLocalTelemetryError({
              platforma: `api-${response.status}`,
              severity: response.status >= 500 ? 'CRITICAL' : 'WARN',
              method: init.method || 'GET',
              url: urlStr,
              status: response.status,
              mesaj: errBody?.error || errBody?.message || `HTTP ${response.status} pe ${urlStr}`
            });
          })
          .catch(() => {});
      }
      return response;
    } catch (networkErr) {
      backendMode = 'browser';
      updateModeIndicator();
      return handleBrowserApi(urlStr, init);
    }
  };

  // =========================================================================
  // 3. 1-CLICK TEST ACCOUNT BAR & TELEMETRY DOWNLOAD WIDGET
  // =========================================================================
  window.switchTestAccount = async function (accountType) {
    localStorage.setItem('activeTestAccount', accountType);
    let targetId = '1';
    if (accountType === 'orhideea' || accountType === 'test_asoc') {
      targetId = '1';
      if (typeof window.setRole === 'function') window.setRole('admin');
    } else if (accountType === 'clean_agency') {
      targetId = '2';
      // Ensure asociatie_id = 2 exists on backend if running on Node
      if (backendMode === 'node') {
        try {
          const listRes = await fetch('/api/operatiuni/asociatii');
          const list = await listRes.json();
          let cleanAsoc = Array.isArray(list) ? list.find((a) => Number(a.id) === 2 || Number(a.id) > 1) : null;
          if (!cleanAsoc) {
            const createRes = await fetch('/api/operatiuni/asociatii', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                nume: 'ASOCIAȚIA DEMO CURATĂ (Workspace Nou)',
                cod_fiscal: '',
                administrator: 'Admin Agenție Nouă',
                serie_chitante: 'AGN'
              })
            });
            const created = await createRes.json();
            cleanAsoc = { id: created.asociatie_id || 2 };
          }
          targetId = String(cleanAsoc.id || 2);
        } catch (_) {
          targetId = '2';
        }
      }
      if (typeof window.setRole === 'function') window.setRole('admin');
    } else if (accountType === 'superadmin') {
      targetId = '1';
      if (typeof window.setRole === 'function') window.setRole('superadmin');
    }

    localStorage.setItem('asoc_workspace_id', targetId);
    localStorage.setItem('activeAsociatieId', targetId);

    const sel = document.getElementById('global-asociatie-select');
    if (sel) {
      sel.value = targetId;
    }

    if (typeof window.switchAsociatieWorkspace === 'function') {
      await window.switchAsociatieWorkspace(targetId);
    } else if (sel) {
      sel.dispatchEvent(new Event('change'));
    } else {
      window.location.reload();
    }
    renderQuickTestBar();
  };

  function updateTelemetryBadge() {
    const badge = document.getElementById('quick-telemetry-count');
    if (badge) {
      const count = getLocalTelemetryErrors().length;
      badge.textContent = String(count);
    }
  }

  function updateModeIndicator() {
    const el = document.getElementById('quick-runtime-mode');
    if (el) {
      const isSurge = typeof window !== 'undefined' && window.location.hostname.endsWith('surge.sh');
      const isGhPages = typeof window !== 'undefined' && window.location.hostname.endsWith('github.io');
      el.textContent = backendMode === 'browser'
        ? (isSurge ? '☁️ Surge Live' : isGhPages ? '☁️ GitHub Pages Live' : '☁️ In-Browser Demo')
        : '🟢 Server SQLite Activ';
    }
  }

  function renderQuickTestBar() {
    let bar = document.getElementById('orhideea-quick-test-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'orhideea-quick-test-bar';
      bar.style.cssText =
        'background:#0f172a;color:#f8fafc;padding:6px 14px;font-size:12px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;border-bottom:1px solid #334155;z-index:9999;';
      document.body.insertBefore(bar, document.body.firstChild);
    }
    const activeAcc = localStorage.getItem('activeTestAccount') || 'test_asoc';
    const isTestAsoc = activeAcc === 'test_asoc' || activeAcc === 'orhideea';
    const errCount = getLocalTelemetryErrors().length;

    const isSurge = typeof window !== 'undefined' && window.location.hostname.endsWith('surge.sh');
    const isGhPages = typeof window !== 'undefined' && window.location.hostname.endsWith('github.io');
    const modeLabel = backendMode === 'browser'
      ? (isSurge ? '☁️ Surge Live' : isGhPages ? '☁️ GitHub Pages Live' : '☁️ In-Browser Demo')
      : '🟢 Server SQLite Activ';

    bar.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <span style="font-weight:700;color:#38bdf8;">🔑 Conturi Rapide de Test:</span>
        <button onclick="window.switchTestAccount('test_asoc')" style="cursor:pointer;padding:3px 9px;border-radius:4px;border:1px solid ${
          isTestAsoc ? '#38bdf8' : '#475569'
        };background:${isTestAsoc ? '#0284c7' : '#1e293b'};color:#fff;font-weight:600;font-size:11px;">
          🏢 1. Asociația TEST (Date FoxPro: 10 Blocuri / 78 Ap.)
        </button>
        <button onclick="window.switchTestAccount('clean_agency')" style="cursor:pointer;padding:3px 9px;border-radius:4px;border:1px solid ${
          activeAcc === 'clean_agency' ? '#10b981' : '#475569'
        };background:${activeAcc === 'clean_agency' ? '#059669' : '#1e293b'};color:#fff;font-weight:600;font-size:11px;">
          ✨ 2. Agenție Nouă (Workspace Curat / 0 Blocuri)
        </button>
        <button onclick="window.switchTestAccount('superadmin')" style="cursor:pointer;padding:3px 9px;border-radius:4px;border:1px solid ${
          activeAcc === 'superadmin' ? '#f59e0b' : '#475569'
        };background:${activeAcc === 'superadmin' ? '#d97706' : '#1e293b'};color:#fff;font-weight:600;font-size:11px;">
          🛡️ 3. Superadmin (Turn de Control)
        </button>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <span id="quick-runtime-mode" style="color:#94a3b8;font-size:11px;">${modeLabel}</span>
        <button onclick="window.triggerTestTelemetryError()" title="Generează o eroare de test și o salvează în telemetry-errors.jsonl" style="cursor:pointer;padding:3px 8px;border-radius:4px;border:1px solid #64748b;background:#1e293b;color:#fca5a5;font-size:11px;">
          🧪 Test Eroare (<span id="quick-telemetry-count">${errCount}</span>)
        </button>
        <button onclick="window.downloadTelemetryJsonl('jsonl')" title="Descarcă toate erorile în format .jsonl gata de trimis unui agent AI" style="cursor:pointer;padding:3px 9px;border-radius:4px;border:1px solid #ef4444;background:#991b1b;color:#fff;font-weight:600;font-size:11px;">
          📥 Descarcă Erori (.jsonl pt. AI)
        </button>
        <button onclick="window.downloadTelemetryJsonl('log')" title="Descarcă jurnalul text de erori (.log)" style="cursor:pointer;padding:3px 8px;border-radius:4px;border:1px solid #475569;background:#1e293b;color:#e2e8f0;font-size:11px;">
          📄 .log
        </button>
      </div>
    `;
  }

  document.addEventListener('DOMContentLoaded', () => {
    renderQuickTestBar();
  });
})();
