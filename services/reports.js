/**
 * services/reports.js
 *
 * Complete 33+2 Report Generation Engine matching FoxPro 2.6 (.PRG & .FRX/.FRT)
 * for ORHIDEEA (Partaj 3, 2005).
 * Covers:
 * - Listare (16 reports): LIP, LIR, LAF, LAR, LP1, LP2, LPP, LRC, SCR, LFA, CCA, CBA, CP1, MAX, ORD, ADU
 * - Situatii (17 reports): SBL, SAP, PV, PVR, SRE, RE1, CED, LAR_INST (LRI), SRU, SFR, SPE, PER, GOT, AJU, LSC, LVE, COM
 * - Centralizare (2 reports): IN1, IN2
 * - GDPR Notice-Board Masking (owner names hidden by default on LAF, LAR, LP1, LP2, LPP, MAX; toggleable via showNames=true).
 */

const { getDb } = require('../db');
const { calculatePeriod, round2, round4 } = require('../engine/calcul');
const { parseCalendarDate } = require('../engine/tce');
const { getPeriodCalculationData, LUNI_RO } = require('./ledger');
const { calculatePenalties } = require('./penalties');
const { numarInLitere } = require('../numar-in-litere');

const GDPR_NOTICE_BOARD_CODES = new Set(['LAF', 'LAR', 'LP1', 'LP2', 'LPP', 'MAX']);

const REPORT_CATALOG = [
  // LISTARE (16)
  { code: 'LIP', menu: 'LISTARE', key: 'A', title: 'Fluturași fără restanțe', prg: 'LIP.PRG', frx: 'LIR1.FRX', orientation: 'portrait', gdpr: false },
  { code: 'LIR', menu: 'LISTARE', key: 'B', title: 'Fluturași cu restanțe', prg: 'LIR.PRG', frx: 'LIR.FRX', orientation: 'portrait', gdpr: false },
  { code: 'LAF', menu: 'LISTARE', key: 'C', title: 'Liste de afișat fără restanțe', prg: 'LAF.PRG', frx: 'LAF.FRX', orientation: 'landscape', gdpr: true },
  { code: 'LAR', menu: 'LISTARE', key: 'D', title: 'Liste de afișat cu restanțe', prg: 'LAR.PRG', frx: 'LAR.FRX', orientation: 'landscape', gdpr: true },
  { code: 'LP1', menu: 'LISTARE', key: 'E', title: 'Liste primărie fără restanțe', prg: 'LP1.PRG', frx: 'LP2F.FRX', orientation: 'landscape', gdpr: true },
  { code: 'LP2', menu: 'LISTARE', key: 'F', title: 'Liste primărie cu restanțe', prg: 'LP2.PRG', frx: 'LP2.FRX', orientation: 'landscape', gdpr: true },
  { code: 'LPP', menu: 'LISTARE', key: 'G', title: 'Cele mai simple liste de plată', prg: 'LPP.PRG', frx: 'LPP.FRX', orientation: 'portrait', gdpr: true },
  { code: 'LRC', menu: 'LISTARE', key: 'H', title: 'Repartizare cheltuieli pe unități', prg: 'LRC.PRG', frx: 'LRC.FRX', orientation: 'landscape', gdpr: false },
  { code: 'SCR', menu: 'LISTARE', key: 'I', title: 'Situație calcul repartitoare', prg: 'SCR.PRG', frx: 'SCR7.FRX', orientation: 'landscape', gdpr: false },
  { code: 'LFA', menu: 'LISTARE', key: 'J', title: 'Valori facturi și sinteză reconciliere', prg: 'LFA.PRG', frx: 'LFA.FRX', orientation: 'portrait', gdpr: false },
  { code: 'CCA', menu: 'LISTARE', key: 'K', title: 'Registrul de casă', prg: 'CCA.PRG', frx: 'CCA.FRX', orientation: 'portrait', gdpr: false },
  { code: 'CBA', menu: 'LISTARE', key: 'L', title: 'Contul gestiunii bancă', prg: 'CBA.PRG', frx: 'CBA.FRX', orientation: 'portrait', gdpr: false },
  { code: 'CP1', menu: 'LISTARE', key: 'M', title: 'Situație patrimonială Activ / Pasiv', prg: 'CP1.PRG', frx: 'CPA.FRX', orientation: 'portrait', gdpr: false },
  { code: 'MAX', menu: 'LISTARE', key: 'N', title: 'Valori în ordine descrescătoare', prg: 'MAX.PRG', frx: 'MAX.FRX', orientation: 'portrait', gdpr: true },
  { code: 'ORD', menu: 'LISTARE', key: 'O', title: 'Ordine de plată bancare', prg: 'ORD.PRG', frx: 'ORD.FRX', orientation: 'portrait', gdpr: false },
  { code: 'ADU', menu: 'LISTARE', key: 'P', title: 'Convocator adunare generală', prg: 'ADU.PRG', frx: 'ADU.FRX', orientation: 'portrait', gdpr: false },
  // SITUATII (17)
  { code: 'SBL', menu: 'SITUATII', key: 'A', title: 'Situație parametri blocuri', prg: 'SBL.PRG', frx: 'SBL.FRX', orientation: 'landscape', gdpr: false },
  { code: 'SAP', menu: 'SITUATII', key: 'B', title: 'Consumuri contoare apartamente', prg: 'SAP.PRG', frx: 'SP111.FRX', orientation: 'landscape', gdpr: false },
  { code: 'PV', menu: 'SITUATII', key: 'C', title: 'Fișă citire contoare apă', prg: 'PV.PRG', frx: 'PV111.FRX', orientation: 'portrait', gdpr: false },
  { code: 'PVR', menu: 'SITUATII', key: 'D', title: 'Fișă citire repartitoare căldură', prg: 'PVR.PRG', frx: 'PVR7.FRX', orientation: 'landscape', gdpr: false },
  { code: 'SRE', menu: 'SITUATII', key: 'E', title: 'Situație totală restanțe', prg: 'SRE.PRG', frx: 'SRE.FRX', orientation: 'portrait', gdpr: false },
  { code: 'RE1', menu: 'SITUATII', key: 'F', title: 'Restanțe și penalități detaliate', prg: 'RE1.PRG', frx: 'RE1.FRX', orientation: 'landscape', gdpr: false },
  { code: 'CED', menu: 'SITUATII', key: 'G', title: 'Valori în detaliu apartament (multi-lună)', prg: 'CED.PRG', frx: 'CED.FRX', orientation: 'landscape', gdpr: false },
  { code: 'LAR_INST', menu: 'SITUATII', key: 'H', title: 'Liste plată pentru instanță (Dosar juridic)', prg: 'LAR_INST.PRG', frx: 'LAR_INSC.FRX', orientation: 'portrait', gdpr: false },
  { code: 'SRU', menu: 'SITUATII', key: 'I', title: 'Situație fond de rulment', prg: 'SRU.PRG', frx: 'SRU.FRX', orientation: 'portrait', gdpr: false },
  { code: 'SFR', menu: 'SITUATII', key: 'J', title: 'Situație fond de reparații', prg: 'SFR.PRG', frx: 'SFR.FRX', orientation: 'portrait', gdpr: false },
  { code: 'SPE', menu: 'SITUATII', key: 'K', title: 'Situație penalități', prg: 'SPE.PRG', frx: 'SPE.FRX', orientation: 'portrait', gdpr: false },
  { code: 'PER', menu: 'SITUATII', key: 'L', title: 'Persoane, suprafețe, baze repartizare', prg: 'PER.PRG', frx: 'PER.FRX', orientation: 'landscape', gdpr: false },
  { code: 'GOT', menu: 'SITUATII', key: 'M', title: 'Debranșări și restanțe (Blindate)', prg: 'GOT.PRG', frx: 'GOT.FRX', orientation: 'portrait', gdpr: false },
  { code: 'AJU', menu: 'SITUATII', key: 'N', title: 'Ajutoare sociale pentru încălzire', prg: 'AJU.PRG', frx: 'AJU.FRX', orientation: 'landscape', gdpr: false },
  { code: 'LSC', menu: 'SITUATII', key: 'O', title: 'Scrisori somație restanțieri', prg: 'LSC.PRG', frx: 'LSC.FRX', orientation: 'portrait', gdpr: false },
  { code: 'LVE', menu: 'SITUATII', key: 'P', title: 'Verificări metrologice expirate', prg: 'LVE.PRG', frx: 'LVE.FRX', orientation: 'portrait', gdpr: false },
  { code: 'COM', menu: 'SITUATII', key: 'Q', title: 'Comparare valori cu lună referință', prg: 'COM.PRG', frx: 'COM.FRX', orientation: 'portrait', gdpr: false },
  // CENTRALIZARE (2)
  { code: 'IN1', menu: 'CENTRALIZARE', key: 'C', title: 'Încasări perioadă (ordine bloc / apartament)', prg: 'IN1.PRG', frx: 'IN1.FRX', orientation: 'portrait', gdpr: false },
  { code: 'IN2', menu: 'CENTRALIZARE', key: 'D', title: 'Încasări perioadă (ordine număr chitanță)', prg: 'IN2.PRG', frx: 'IN2.FRX', orientation: 'portrait', gdpr: false }
];

function resolveDb(dbOrNull) {
  if (dbOrNull && typeof dbOrNull.prepare === 'function') return dbOrNull;
  return getDb();
}

function maskOwnerName(name, aptNum, shouldShowNames) {
  if (shouldShowNames) return String(name || '');
  return `[GDPR - Ap. ${aptNum}]`;
}

/**
 * Loads calculated apartment & block rows for the target period, enriched with ledger arrears & penalties.
 */
function loadReportPeriodContext(d, options = {}) {
  const rawData = getPeriodCalculationData(d, options);
  const calc = calculatePeriod(rawData);
  const { period, general, asociatie } = calc;

  let blocuri = calc.blocuri;
  let apartamente = calc.apartamente;

  if (options.bloc_id || options.blocId) {
    const targetBlocId = Number(options.bloc_id || options.blocId);
    blocuri = blocuri.filter(b => b.id === targetBlocId);
    apartamente = apartamente.filter(a => a.bloc_id === targetBlocId);
  } else if (options.bloc) {
    const targetCode = String(options.bloc).trim().toUpperCase();
    blocuri = blocuri.filter(b => String(b.bloc || '').trim().toUpperCase() === targetCode);
    apartamente = apartamente.filter(a => String(a.bloc || '').trim().toUpperCase() === targetCode);
  }

  if (options.apartament_id || options.apartamentId) {
    const targetAptId = Number(options.apartament_id || options.apartamentId);
    apartamente = apartamente.filter(a => a.id === targetAptId);
  }

  // Load unpaid ledger balances per apartment (prior to or across all periods)
  const aptIds = apartamente.map(a => a.id).filter(Boolean);
  const arrearsMap = new Map();

  if (aptIds.length > 0) {
    const ph = aptIds.map(() => '?').join(',');
    const rows = d
      .prepare(`
        SELECT
          d.apartament_id,
          d.categorie,
          d.an,
          d.luna,
          ROUND(SUM(d.valoare), 2) AS val_sum,
          ROUND(SUM(COALESCE(p.ach, 0)), 2) AS ach_sum,
          ROUND(SUM(d.valoare - COALESCE(p.ach, 0)), 2) AS rest_sum
        FROM datorii d
        LEFT JOIN (
          SELECT pl.datorie_id, SUM(CASE WHEN ch.anulata = 1 THEN 0 ELSE pl.suma END) AS ach
          FROM plati pl
          LEFT JOIN chitante ch ON ch.id = pl.chitanta_id
          GROUP BY pl.datorie_id
        ) p ON p.datorie_id = d.id
        WHERE d.apartament_id IN (${ph})
        GROUP BY d.apartament_id, d.categorie, d.an, d.luna
        ORDER BY d.an ASC, d.luna ASC
      `)
      .all(...aptIds);

    for (const r of rows) {
      if (!arrearsMap.has(r.apartament_id)) {
        arrearsMap.set(r.apartament_id, {
          R: 0, F: 0, A: 0, P: 0,
          val_R: 0, val_F: 0, val_A: 0, val_P: 0,
          ach_R: 0, ach_F: 0, ach_A: 0, ach_P: 0,
          priorRestanta: 0,
          totalRestanta: 0,
          oldestPeriod: null,
          monthsCount: new Set()
        });
      }
      const entry = arrearsMap.get(r.apartament_id);
      const cat = String(r.categorie || 'R').toUpperCase();
      const rest = round2(r.rest_sum);
      const val = round2(r.val_sum);
      const ach = round2(r.ach_sum);

      if (cat in entry) {
        entry[cat] = round2(entry[cat] + rest);
        entry[`val_${cat}`] = round2(entry[`val_${cat}`] + val);
        entry[`ach_${cat}`] = round2(entry[`ach_${cat}`] + ach);
      }

      const isCurrentPeriod = r.an === period.an && r.luna === period.luna;
      if (cat !== 'P') {
        entry.totalRestanta = round2(entry.totalRestanta + rest);
        if (!isCurrentPeriod) {
          entry.priorRestanta = round2(entry.priorRestanta + rest);
        }
      }
      if (rest > 0 && cat !== 'P') {
        entry.monthsCount.add(`${r.an}-${r.luna}`);
        if (!entry.oldestPeriod) {
          entry.oldestPeriod = `${LUNI_RO[r.luna] || r.luna} ${r.an}`;
        }
      }
    }
  }

  return {
    period,
    general,
    asociatie,
    blocuri,
    apartamente,
    arrearsMap
  };
}

/**
 * Generates any of the 35 reports by code.
 */
function generateReport(dbOrCode, maybeCode, maybeOptions = {}) {
  let d;
  let rawCode;
  let options;
  if (dbOrCode && typeof dbOrCode.prepare === 'function') {
    d = dbOrCode;
    rawCode = maybeCode;
    options = maybeOptions || {};
  } else {
    d = getDb();
    rawCode = dbOrCode;
    options = maybeCode || {};
  }

  const codeUpper = String(rawCode || 'LAR').trim().toUpperCase();
  const code = codeUpper === 'LRI' ? 'LAR_INST' : codeUpper;
  const catalogEntry = REPORT_CATALOG.find(r => r.code === code) || {
    code,
    menu: 'LISTARE',
    title: `Raport ${code}`,
    orientation: 'portrait',
    gdpr: false
  };

  // GDPR default: hide names on public notice-board lists unless showNames=true
  const showNames = catalogEntry.gdpr
    ? Boolean(options.showNames === true || options.show_names === true || options.gdpr === false)
    : options.showNames !== false;

  const ctx = loadReportPeriodContext(d, options);
  const { period, general, asociatie, blocuri, apartamente, arrearsMap } = ctx;
  const targetDate = options.target_date || options.data_calcul || general.ultima_zi || new Date().toISOString().slice(0, 10);

  // 1. LAF / LAR (Notice-Board Lists without / with arrears)
  if (code === 'LAF' || code === 'LAR') {
    const includeArrears = code === 'LAR';
    const rows = apartamente.map(c => {
      const arr = arrearsMap.get(c.id) || { priorRestanta: 0, totalRestanta: 0, P: 0 };
      const pers = Number(c.persoane || 0) - Number(c.p1_scaz || 0);
      const apaReceCalda = round2(Number(c.apa_rece || 0) + Number(c.can_mnj || 0) + Number(c.apa_calda || 0));
      const cheltPers = round2(Number(c.curent || 0) + Number(c.gaz || 0) + Number(c.gunoi || 0));
      const cheltCotaParte = round2(
        Number(c.sal_feme || 0) + Number(c.ascensor || 0) + Number(c.ch_admin || 0) +
        Number(c.sal_tesa || 0) + Number(c.ch_sediu || 0) + Number(c.prest_serv || 0) +
        Number(c.chelt_inc || 0) + Number(c.altele || 0) + Number(c.repar_crt || 0) + Number(c.i || 0)
      );
      const incalzire = round2(c.incalzire || 0);
      const canalMeteo = round2(c.can_met || 0);
      const diferente = round2(
        Number(c.difarar || 0) + Number(c.difarac || 0) + Number(c.difcanar || 0) +
        Number(c.difcanac || 0) + Number(c.difetac || 0) + Number(c.difetin || 0)
      );
      const chiriiSpatii = round2(Number(c.ch_box || 0) + Number(c.ch_hav || 0));
      const fonduri = round2(Number(c.fond_repar || 0) + Number(c.abonament || 0) + Number(c.rulment || 0));
      const totalRegie = round2(c.total_luna || (apaReceCalda + cheltPers + cheltCotaParte + incalzire + canalMeteo + diferente + chiriiSpatii + fonduri));
      const restanta = includeArrears ? round2(arr.priorRestanta || arr.totalRestanta || c.restante || 0) : 0;
      const penalizari = includeArrears ? round2(arr.P || c.penalizari || 0) : 0;
      const totalGeneral = round2(totalRegie + restanta + penalizari);

      return {
        apartament_id: c.id,
        bloc: c.bloc,
        apart: c.numar_apart,
        nume: maskOwnerName(c.nume_proprietar, c.numar_apart, showNames),
        pers,
        suprafata: Number(c.suprafata || 0),
        apa_rece_calda: apaReceCalda,
        chelt_pers: cheltPers,
        chelt_cota_parte: cheltCotaParte,
        incalzire,
        canal_meteo: canalMeteo,
        diferente,
        chirii_spatii: chiriiSpatii,
        fonduri,
        total_regie: totalRegie,
        ...(includeArrears ? { restanta, penalizari, total_general: totalGeneral } : {})
      };
    });

    const columns = [
      { key: 'bloc', label: 'Bloc' },
      { key: 'apart', label: 'Ap.' },
      { key: 'nume', label: 'Proprietar' },
      { key: 'pers', label: 'Pers.' },
      { key: 'apa_rece_calda', label: 'Apă Rece/Caldă/Can.' },
      { key: 'chelt_pers', label: 'Chelt. Pers. (Gaz/Gunoi/El.)' },
      { key: 'chelt_cota_parte', label: 'Chelt. Cotă-Parte' },
      { key: 'incalzire', label: 'Încălzire' },
      { key: 'canal_meteo', label: 'Canal Meteo' },
      { key: 'diferente', label: 'Diferențe' },
      { key: 'chirii_spatii', label: 'Chirii Spații' },
      { key: 'fonduri', label: 'Fonduri' },
      { key: 'total_regie', label: 'Total Lună' }
    ];
    if (includeArrears) {
      columns.push(
        { key: 'restanta', label: 'Restanțe' },
        { key: 'penalizari', label: 'Penalități' },
        { key: 'total_general', label: 'Total General' }
      );
    }

    return buildResponse(catalogEntry, period, asociatie, showNames, columns, rows, {
      signatures: ['PREȘEDINTE: ' + (asociatie.presedinte || ''), 'ADMINISTRATOR: ' + (asociatie.administrator || ''), 'COMISIA DE CENZORI']
    });
  }

  // 2. LIP / LIR (Individual Payment Slips / Fluturași)
  if (code === 'LIP' || code === 'LIR') {
    const includeArrears = code === 'LIR';
    const rows = apartamente.map(c => {
      const arr = arrearsMap.get(c.id) || { priorRestanta: 0, totalRestanta: 0, P: 0 };
      const restanta = includeArrears ? round2(arr.priorRestanta || arr.totalRestanta || c.restante || 0) : 0;
      const penalizari = includeArrears ? round2(arr.P || c.penalizari || 0) : 0;
      const totalLuna = round2(c.total_luna || 0);
      return {
        apartament_id: c.id,
        bloc: c.bloc,
        apart: c.numar_apart,
        nume: c.nume_proprietar,
        persoane_calcul: Number(c.persoane || 0) - Number(c.p1_scaz || 0),
        suprafata: Number(c.suprafata || 0),
        apa_rece: round2(c.apa_rece),
        can_mnj: round2(c.can_mnj),
        can_met: round2(c.can_met),
        apa_calda: round2(c.apa_calda),
        incalzire: round2(c.incalzire),
        gaz: round2(c.gaz),
        gunoi: round2(c.gunoi),
        curent_sc: round2(c.curent_sc),
        curent_li: round2(c.curent_li),
        ascensor: round2(c.ascensor),
        sal_feme: round2(c.sal_feme),
        sal_tesa: round2(c.sal_tesa),
        ch_admin: round2(c.ch_admin),
        ch_sediu: round2(c.ch_sediu),
        prest_serv: round2(c.prest_serv),
        abonament: round2(c.abonament),
        chelt_inc: round2(c.chelt_inc),
        diferente: round2(
          Number(c.difarar || 0) + Number(c.difarac || 0) + Number(c.difcanar || 0) +
          Number(c.difcanac || 0) + Number(c.difetac || 0) + Number(c.difetin || 0)
        ),
        rulment: round2(c.rulment),
        fond_repar: round2(c.fond_repar),
        max_fr: round2(c.max_fr),
        calc_fr: round2(c.calc_fr),
        achitat_fr: round2(Number(c.calc_fr || 0) - Number(c.plat_fr || 0)),
        total_luna: totalLuna,
        restanta,
        penalizari,
        total_de_plata: round2(totalLuna + restanta + penalizari)
      };
    });

    const columns = [
      { key: 'bloc', label: 'Bloc' },
      { key: 'apart', label: 'Ap.' },
      { key: 'nume', label: 'Titular' },
      { key: 'persoane_calcul', label: 'Pers.' },
      { key: 'apa_rece', label: 'Apă Rece' },
      { key: 'can_mnj', label: 'Canal' },
      { key: 'apa_calda', label: 'Apă Caldă' },
      { key: 'incalzire', label: 'Încălzire' },
      { key: 'gunoi', label: 'Gunoi' },
      { key: 'curent_sc', label: 'Curent' },
      { key: 'sal_tesa', label: 'Admin/Salarii' },
      { key: 'fond_repar', label: 'Fond Rep.' },
      { key: 'total_luna', label: 'Total Lună' },
      { key: 'restanta', label: 'Restanță' },
      { key: 'penalizari', label: 'Penalități' },
      { key: 'total_de_plata', label: 'Total Plată' }
    ];
    return buildResponse(catalogEntry, period, asociatie, showNames, columns, rows);
  }

  // 3. LP1 / LP2 (City Hall Lists without / with arrears)
  if (code === 'LP1' || code === 'LP2') {
    const includeArrears = code === 'LP2';
    const rows = apartamente.map(c => {
      const arr = arrearsMap.get(c.id) || { priorRestanta: 0, totalRestanta: 0, P: 0 };
      const restanta = includeArrears ? round2(arr.priorRestanta || arr.totalRestanta || 0) : 0;
      const penalizari = includeArrears ? round2(arr.P || 0) : 0;
      const totalLuna = round2(c.total_luna || 0);
      return {
        bloc: c.bloc,
        apart: c.numar_apart,
        nume: maskOwnerName(c.nume_proprietar, c.numar_apart, showNames),
        pers: Number(c.persoane || 0) - Number(c.p1_scaz || 0),
        suprafata: Number(c.suprafata || 0),
        sup_ec_ter: Number(c.sup_ec_ter || 0),
        incalzire: round2(c.incalzire),
        apa_calda: round2(c.apa_calda),
        apa_rece: round2(Number(c.apa_rece || 0) + Number(c.can_mnj || 0)),
        gaz: round2(c.gaz),
        curent: round2(c.curent),
        gunoi: round2(c.gunoi),
        salarii: round2(Number(c.sal_feme || 0) + Number(c.sal_tesa || 0)),
        chelt_comune: round2(
          Number(c.ch_admin || 0) + Number(c.ch_sediu || 0) + Number(c.prest_serv || 0) +
          Number(c.ascensor || 0) + Number(c.abonament || 0) + Number(c.can_met || 0)
        ),
        total_luna: totalLuna,
        ...(includeArrears ? { restanta, penalizari, total_general: round2(totalLuna + restanta + penalizari) } : {})
      };
    });
    const columns = [
      { key: 'bloc', label: 'Bloc' },
      { key: 'apart', label: 'Ap.' },
      { key: 'nume', label: 'Proprietar' },
      { key: 'pers', label: 'Pers.' },
      { key: 'suprafata', label: 'Supr. (m²)' },
      { key: 'sup_ec_ter', label: 'SET' },
      { key: 'incalzire', label: 'Încălzire' },
      { key: 'apa_calda', label: 'Apă Caldă' },
      { key: 'apa_rece', label: 'Apă Rece+Can' },
      { key: 'gaz', label: 'Gaze' },
      { key: 'curent', label: 'Curent' },
      { key: 'gunoi', label: 'Gunoi' },
      { key: 'salarii', label: 'Salarii' },
      { key: 'chelt_comune', label: 'Chelt. Comune' },
      { key: 'total_luna', label: 'Total Lună' }
    ];
    if (includeArrears) {
      columns.push({ key: 'restanta', label: 'Restanțe' }, { key: 'penalizari', label: 'Penalități' }, { key: 'total_general', label: 'Total General' });
    }
    return buildResponse(catalogEntry, period, asociatie, showNames, columns, rows);
  }

  // 4. LPP (Simple Payment List)
  if (code === 'LPP') {
    const rows = apartamente.map(c => ({
      bloc: c.bloc,
      apart: c.numar_apart,
      nume: maskOwnerName(c.nume_proprietar, c.numar_apart, showNames),
      pers: Number(c.persoane || 0) - Number(c.p1_scaz || 0),
      total: round2(c.total_luna || 0)
    }));
    const columns = [
      { key: 'bloc', label: 'Bloc' },
      { key: 'apart', label: 'Apartament' },
      { key: 'nume', label: 'Proprietar' },
      { key: 'pers', label: 'Persoane' },
      { key: 'total', label: 'Total de Plată (RON)' }
    ];
    return buildResponse(catalogEntry, period, asociatie, showNames, columns, rows);
  }

  // 5. MAX (Descending Order of Current Month Totals)
  if (code === 'MAX') {
    const sorted = [...apartamente].sort((a, b) => Number(b.total_luna || 0) - Number(a.total_luna || 0));
    const rows = sorted.map((c, idx) => ({
      pozitie: idx + 1,
      bloc: c.bloc,
      apart: c.numar_apart,
      nume: maskOwnerName(c.nume_proprietar, c.numar_apart, showNames),
      pers: Number(c.persoane || 0) - Number(c.p1_scaz || 0),
      suprafata: Number(c.suprafata || 0),
      valoare: round2(c.total_luna || 0)
    }));
    const columns = [
      { key: 'pozitie', label: 'Poz.' },
      { key: 'bloc', label: 'Bloc' },
      { key: 'apart', label: 'Ap.' },
      { key: 'nume', label: 'Proprietar' },
      { key: 'pers', label: 'Pers.' },
      { key: 'suprafata', label: 'Suprafață (m²)' },
      { key: 'valoare', label: 'Valoare Lună (RON)' }
    ];
    return buildResponse(catalogEntry, period, asociatie, showNames, columns, rows);
  }

  // 6. LRC (Unit Expense Allocation Breakdown)
  if (code === 'LRC') {
    const rows = apartamente.map(c => {
      const cnsAr =
        (Number(c.inarbu || 0) - Number(c.ivarbu || 0)) +
        (Number(c.inarba1 || 0) - Number(c.ivarba1 || 0)) +
        (Number(c.inarba2 || 0) - Number(c.ivarba2 || 0));
      const cnsAc =
        (Number(c.inacbu || 0) - Number(c.ivacbu || 0)) +
        (Number(c.inacba1 || 0) - Number(c.ivacba1 || 0)) +
        (Number(c.inacba2 || 0) - Number(c.ivacba2 || 0));
      return {
        bloc: c.bloc,
        apart: c.numar_apart,
        nume: c.nume_proprietar,
        pers: Number(c.persoane || 0) - Number(c.p1_scaz || 0),
        suprafata: Number(c.suprafata || 0),
        mc_ar: round2(cnsAr),
        mc_ac: round2(cnsAc),
        apa_rece: round2(c.apa_rece),
        can_mnj: round2(c.can_mnj),
        can_met: round2(c.can_met),
        gunoi: round2(c.gunoi),
        curent: round2(c.curent),
        sal_tesa: round2(c.sal_tesa),
        sal_feme: round2(c.sal_feme),
        ch_admin: round2(c.ch_admin),
        total_regie: round2(c.total_regie)
      };
    });
    const columns = [
      { key: 'bloc', label: 'Bloc' },
      { key: 'apart', label: 'Ap.' },
      { key: 'nume', label: 'Titular' },
      { key: 'pers', label: 'Pers.' },
      { key: 'suprafata', label: 'm²' },
      { key: 'mc_ar', label: 'm³ AR' },
      { key: 'apa_rece', label: 'Apă Rece' },
      { key: 'can_mnj', label: 'Canal' },
      { key: 'can_met', label: 'Meteo' },
      { key: 'gunoi', label: 'Gunoi' },
      { key: 'curent', label: 'Curent' },
      { key: 'sal_tesa', label: 'Sal. TESA' },
      { key: 'sal_feme', label: 'Sal. Îngr.' },
      { key: 'ch_admin', label: 'Ch. Admin' },
      { key: 'total_regie', label: 'Total Regie' }
    ];
    return buildResponse(catalogEntry, period, asociatie, showNames, columns, rows);
  }

  // 7. SCR (Heat Cost Allocator Calculation Report)
  if (code === 'SCR') {
    const rows = apartamente.map(c => ({
      bloc: c.bloc,
      apart: c.numar_apart,
      nume: c.nume_proprietar,
      suprafata: Number(c.suprafata || 0) - Number(c.sl1_scaz || 0),
      cp_in: c.cp_in,
      r1_unit: round4((Number(c.in_r1 || 0) - Number(c.iv_r1 || 0)) * Number(c.facttr_r1 || 1) * Number(c.coefsp_r1 || 1)),
      r2_unit: round4((Number(c.in_r2 || 0) - Number(c.iv_r2 || 0)) * Number(c.facttr_r2 || 1) * Number(c.coefsp_r2 || 1)),
      r3_unit: round4((Number(c.in_r3 || 0) - Number(c.iv_r3 || 0)) * Number(c.facttr_r3 || 1) * Number(c.coefsp_r3 || 1)),
      tot_unit: round4(c.tot_unit),
      gcal_unit: round4(c.gcal_unit),
      gcal_mp: round4(c.gcal_mp),
      gcal_red: round4(c.gcal_red),
      gcal_final: round4(c.gcal_final),
      incalzire: round2(c.incalzire)
    }));
    const columns = [
      { key: 'bloc', label: 'Bloc' },
      { key: 'apart', label: 'Ap.' },
      { key: 'nume', label: 'Proprietar' },
      { key: 'suprafata', label: 'Supr. (m²)' },
      { key: 'cp_in', label: 'Mod' },
      { key: 'r1_unit', label: 'Unit R1' },
      { key: 'r2_unit', label: 'Unit R2' },
      { key: 'r3_unit', label: 'Unit R3' },
      { key: 'tot_unit', label: 'Total Unități' },
      { key: 'gcal_unit', label: 'Gcal Unit' },
      { key: 'gcal_mp', label: 'Gcal Comun' },
      { key: 'gcal_red', label: 'Gcal Red.' },
      { key: 'gcal_final', label: 'Gcal Final' },
      { key: 'incalzire', label: 'Valoare (RON)' }
    ];
    return buildResponse(catalogEntry, period, asociatie, showNames, columns, rows);
  }

  // 8. LFA (Invoices & Mathematical Reconciliation Synthesis)
  if (code === 'LFA') {
    const categories = [
      { key: 'apa_rece', label: 'Apă Rece' },
      { key: 'can_mnj', label: 'Canalizare Menajeră' },
      { key: 'can_met', label: 'Apă Meteo' },
      { key: 'apa_calda', label: 'Apă Caldă' },
      { key: 'incalzire', label: 'Încălzire' },
      { key: 'gaz', label: 'Gaze Naturale' },
      { key: 'gunoi', label: 'Salubritate (Gunoi)' },
      { key: 'curent', label: 'Energie Electrică' },
      { key: 'ascensor', label: 'Ascensor' },
      { key: 'sal_tesa', label: 'Salarii TESA / Admin' },
      { key: 'sal_feme', label: 'Salarii Îngrijitor' },
      { key: 'ch_admin', label: 'Cheltuieli Administrative' },
      { key: 'ch_sediu', label: 'Cheltuieli Sediu' },
      { key: 'prest_serv', label: 'Prestări Servicii' },
      { key: 'abonament', label: 'Abonamente' }
    ];
    const rows = categories.map(cat => {
      const blocSum = round2(blocuri.reduce((s, b) => s + Number(b[cat.key] || 0), 0));
      const aptSum = round2(apartamente.reduce((s, a) => s + Number(a[cat.key] || 0), 0));
      return {
        categorie: cat.label,
        facturat_blocuri: blocSum,
        repartizat_apartamente: aptSum,
        diferenta_rotunjire: round2(blocSum - aptSum)
      };
    });
    const columns = [
      { key: 'categorie', label: 'Categorie Cheltuială' },
      { key: 'facturat_blocuri', label: 'Total Blocuri (RON)' },
      { key: 'repartizat_apartamente', label: 'Total Repartizat Ap. (RON)' },
      { key: 'diferenta_rotunjire', label: 'Diferență (RON)' }
    ];
    return buildResponse(catalogEntry, period, asociatie, showNames, columns, rows);
  }

  // 9. CCA (Cash Register / Registrul de Casă)
  if (code === 'CCA') {
    const rawCasa = d.prepare('SELECT * FROM casa ORDER BY data ASC, id ASC').all();
    let sold = Number(options.sold_initial || 0);
    const rows = [
      {
        document: '-',
        data: `${period.an}-${String(period.luna).padStart(2, '0')}-01`,
        explicatie: 'SOLD ZIUA PRECEDENTA',
        incasare: 0,
        plata: 0,
        sold: round2(sold)
      }
    ];
    for (const r of rawCasa) {
      const isInc = String(r.tip || 'I').toUpperCase().startsWith('I');
      const inc = isInc ? round2(r.suma) : 0;
      const pla = !isInc ? round2(r.suma) : 0;
      sold = round2(sold + inc - pla);
      rows.push({
        document: r.document || '-',
        data: r.data,
        explicatie: r.explicatie,
        incasare: inc,
        plata: pla,
        sold
      });
    }
    const columns = [
      { key: 'document', label: 'Nr. Doc.' },
      { key: 'data', label: 'Data' },
      { key: 'explicatie', label: 'Explicație' },
      { key: 'incasare', label: 'Încasări (RON)' },
      { key: 'plata', label: 'Plăți (RON)' },
      { key: 'sold', label: 'Sold (RON)' }
    ];
    return buildResponse(catalogEntry, period, asociatie, showNames, columns, rows);
  }

  // 10. CBA (Bank Journal / Contul Gestiunii Bancă)
  if (code === 'CBA') {
    const rawBanca = d.prepare('SELECT * FROM banca ORDER BY data ASC, id ASC').all();
    let sold = Number(options.sold_initial || 0);
    const rows = rawBanca.map(r => {
      const isDep = String(r.tip || 'D').toUpperCase().startsWith('D');
      const dep = isDep ? round2(r.suma) : 0;
      const vir = !isDep ? round2(r.suma) : 0;
      sold = round2(sold + dep - vir);
      return {
        document: r.document || '-',
        data: r.data,
        explicatie: r.explicatie,
        depunere: dep,
        virament: vir,
        sold
      };
    });
    const columns = [
      { key: 'document', label: 'Nr. Doc.' },
      { key: 'data', label: 'Data' },
      { key: 'explicatie', label: 'Explicație' },
      { key: 'depunere', label: 'Depuneri (D)' },
      { key: 'virament', label: 'Viramente (V)' },
      { key: 'sold', label: 'Sold Bancă' }
    ];
    return buildResponse(catalogEntry, period, asociatie, showNames, columns, rows);
  }

  // 11. CP1 (Patrimony Statement Activ / Pasiv)
  if (code === 'CP1') {
    const rawPatrim = d.prepare('SELECT * FROM patrimoniu ORDER BY act_pas ASC, id ASC').all();
    const rows = rawPatrim.map(r => ({
      act_pas: r.act_pas === 'A' ? 'ACTIV' : 'PASIV',
      document: r.document || '-',
      data: r.data || '-',
      explicatie_completa: `${r.explicatie || ''}${r.data_pres ? ' LA ' + r.data_pres : ''}${r.perioada ? ' PE ' + r.perioada : ''}`.trim(),
      suma: round2(r.suma)
    }));
    const columns = [
      { key: 'act_pas', label: 'Activ / Pasiv' },
      { key: 'document', label: 'Document' },
      { key: 'data', label: 'Data' },
      { key: 'explicatie_completa', label: 'Explicație Patrimonială' },
      { key: 'suma', label: 'Sumă (RON)' }
    ];
    return buildResponse(catalogEntry, period, asociatie, showNames, columns, rows);
  }

  // 12. ORD (Bank Payment Orders / Ordine de Plată)
  if (code === 'ORD') {
    const rawOrd = d.prepare('SELECT * FROM ordine_plata ORDER BY numar DESC, id DESC').all();
    const rows = rawOrd.map(r => ({
      numar: r.numar,
      data: r.data,
      platitor: r.platitor1 || asociatie.nume,
      cui_platitor: r.codf_plat || asociatie.cod_fiscal,
      iban_platitor: r.cont_plat || asociatie.cont_bancar,
      beneficiar: r.beneficiar,
      cui_beneficiar: r.codf_bene,
      iban_beneficiar: r.cont_bene,
      banca_beneficiar: r.banca_bene,
      suma: round2(r.suma),
      suma_litere: numarInLitere(r.suma),
      explicatie: [r.reprez1, r.reprez2, r.reprez3].filter(Boolean).join(' ')
    }));
    const columns = [
      { key: 'numar', label: 'Nr. OP' },
      { key: 'data', label: 'Data' },
      { key: 'platitor', label: 'Plătitor' },
      { key: 'beneficiar', label: 'Beneficiar' },
      { key: 'iban_beneficiar', label: 'IBAN Beneficiar' },
      { key: 'suma', label: 'Sumă (RON)' },
      { key: 'suma_litere', label: 'Sumă în Litere' },
      { key: 'explicatie', label: 'Reprezentând' }
    ];
    return buildResponse(catalogEntry, period, asociatie, showNames, columns, rows);
  }

  // 13. ADU (General Assembly Convocation / Convocator Adunare Generală)
  if (code === 'ADU') {
    const rows = apartamente.map(c => ({
      bloc: c.bloc,
      apart: c.numar_apart,
      nume: c.nume_proprietar,
      suprafata: Number(c.suprafata || 0),
      semnatura: '________________________'
    }));
    const columns = [
      { key: 'bloc', label: 'Bloc' },
      { key: 'apart', label: 'Ap.' },
      { key: 'nume', label: 'Nume și Prenume Proprietar' },
      { key: 'suprafata', label: 'Cotă / m²' },
      { key: 'semnatura', label: 'Semnătură Luare la Cunoștință' }
    ];
    return buildResponse(catalogEntry, period, asociatie, showNames, columns, rows, {
      convocator: {
        titlu: options.ceconv || 'CONVOCATOR ADUNARE GENERALĂ A PROPRIETARILOR',
        data_intrunire: options.cand || `${period.an}-${String(period.luna).padStart(2, '0')}-25, ora 18:00`,
        locatie: options.unde || asociatie.adresa || 'Sediul Asociației',
        ordinea_de_zi: [
          options.ord1 || '1. Prezentarea și aprobarea raportului financiar-contabil.',
          options.ord2 || '2. Aprobarea bugetului de venituri și cheltuieli și a fondului de reparații.',
          options.ord3 || '3. Analiza situației restanțierilor și măsuri de recuperare a debitelor.',
          options.ord4 || '4. Lucrări de întreținere și reparații părți comune.',
          options.ord5 || '5. Diverse.'
        ]
      }
    });
  }

  // 14. SBL (Block Parameters & Invoices Situation)
  if (code === 'SBL') {
    const rows = blocuri.map(b => ({
      bloc: b.bloc,
      tot_apart: b.tot_apart,
      persoane1: b.persoane1,
      suprafata1: round2(b.suprafata1),
      mod_r_dif: b.mod_r_dif,
      mod_r_inc: b.mod_r_inc,
      modr_difin: b.modr_difin,
      mod_r_asc: b.mod_r_asc,
      cns_ar: round2(Number(b.inar || 0) - Number(b.ivar || 0)),
      apa_rece: round2(b.apa_rece),
      difarar: round2(b.difarar),
      gunoi: round2(b.gunoi),
      curent_sc: round2(b.curent_sc),
      sal_tesa: round2(b.sal_tesa),
      sal_feme: round2(b.sal_feme),
      ch_admin: round2(b.ch_admin)
    }));
    const columns = [
      { key: 'bloc', label: 'Bloc' },
      { key: 'tot_apart', label: 'Nr. Ap.' },
      { key: 'persoane1', label: 'Pers.' },
      { key: 'suprafata1', label: 'Supr. (m²)' },
      { key: 'mod_r_dif', label: 'Mod Dif.' },
      { key: 'mod_r_inc', label: 'Mod Înc.' },
      { key: 'cns_ar', label: 'Cons. AR (m³)' },
      { key: 'difarar', label: 'Dif. AR (RON)' },
      { key: 'gunoi', label: 'Gunoi' },
      { key: 'curent_sc', label: 'Curent Sc.' },
      { key: 'sal_tesa', label: 'Sal. TESA' },
      { key: 'sal_feme', label: 'Sal. Îngr.' },
      { key: 'ch_admin', label: 'Ch. Admin' }
    ];
    return buildResponse(catalogEntry, period, asociatie, showNames, columns, rows);
  }

  // 15. SAP (Apartment Meter Consumptions)
  if (code === 'SAP') {
    const rows = apartamente.map(c => {
      const cnsArBu = round2(Number(c.inarbu || 0) - Number(c.ivarbu || 0));
      const cnsArBa1 = round2(Number(c.inarba1 || 0) - Number(c.ivarba1 || 0));
      const cnsArBa2 = round2(Number(c.inarba2 || 0) - Number(c.ivarba2 || 0));
      const cnsAcBu = round2(Number(c.inacbu || 0) - Number(c.ivacbu || 0));
      const cnsAcBa1 = round2(Number(c.inacba1 || 0) - Number(c.ivacba1 || 0));
      const cnsAcBa2 = round2(Number(c.inacba2 || 0) - Number(c.ivacba2 || 0));
      return {
        bloc: c.bloc,
        apart: c.numar_apart,
        nume: c.nume_proprietar,
        ivarbu: round2(c.ivarbu), inarbu: round2(c.inarbu), cns_ar_bu: cnsArBu,
        ivarba1: round2(c.ivarba1), inarba1: round2(c.inarba1), cns_ar_ba1: cnsArBa1,
        ivarba2: round2(c.ivarba2), inarba2: round2(c.inarba2), cns_ar_ba2: cnsArBa2,
        total_ar: round2(cnsArBu + cnsArBa1 + cnsArBa2),
        total_ac: round2(cnsAcBu + cnsAcBa1 + cnsAcBa2),
        gcal: round4((Number(c.inin || 0) - Number(c.ivin || 0)) * Number(c.constin || 1))
      };
    });
    const columns = [
      { key: 'bloc', label: 'Bloc' },
      { key: 'apart', label: 'Ap.' },
      { key: 'nume', label: 'Titular' },
      { key: 'ivarbu', label: 'IV Buc' },
      { key: 'inarbu', label: 'IN Buc' },
      { key: 'cns_ar_bu', label: 'Cons. Buc' },
      { key: 'ivarba1', label: 'IV Baie1' },
      { key: 'inarba1', label: 'IN Baie1' },
      { key: 'cns_ar_ba1', label: 'Cons. Baie1' },
      { key: 'cns_ar_ba2', label: 'Cons. Baie2' },
      { key: 'total_ar', label: 'Total AR (m³)' },
      { key: 'total_ac', label: 'Total AC (m³)' },
      { key: 'gcal', label: 'Căldură (Gcal)' }
    ];
    return buildResponse(catalogEntry, period, asociatie, showNames, columns, rows);
  }

  // 16. PV (Water Meter Reading Sheet / Fișă Citire Contoare Apă)
  if (code === 'PV') {
    const rows = apartamente.map(c => ({
      bloc: c.bloc,
      apart: c.numar_apart,
      nume: c.nume_proprietar,
      ser_ar_bu: c.ser_ar_bu || '-',
      iv_ar_bu: round2(c.inarbu || c.iv_ar_bu || 0),
      in_ar_bu_gol: '__________',
      ser_ar_ba1: c.ser_ar_ba1 || '-',
      iv_ar_ba1: round2(c.inarba1 || c.iv_ar_ba1 || 0),
      in_ar_ba1_gol: '__________',
      semnatura: '_______________'
    }));
    const columns = [
      { key: 'bloc', label: 'Bloc' },
      { key: 'apart', label: 'Ap.' },
      { key: 'nume', label: 'Titular' },
      { key: 'ser_ar_bu', label: 'Serie Buc.' },
      { key: 'iv_ar_bu', label: 'Index Vechi Buc.' },
      { key: 'in_ar_bu_gol', label: 'Index Nou Buc.' },
      { key: 'ser_ar_ba1', label: 'Serie Baie 1' },
      { key: 'iv_ar_ba1', label: 'Index Vechi Baie 1' },
      { key: 'in_ar_ba1_gol', label: 'Index Nou Baie 1' },
      { key: 'semnatura', label: 'Semnătură' }
    ];
    return buildResponse(catalogEntry, period, asociatie, showNames, columns, rows);
  }

  // 17. PVR (Allocator Reading Sheet / Fișă Citire Repartitoare)
  if (code === 'PVR') {
    const rows = apartamente.map(c => ({
      bloc: c.bloc,
      apart: c.numar_apart,
      nume: c.nume_proprietar,
      serie_r1: c.serie_r1 || '-', iv_r1: round2(c.in_r1 || c.iv_r1 || 0), in_r1_gol: '________',
      serie_r2: c.serie_r2 || '-', iv_r2: round2(c.in_r2 || c.iv_r2 || 0), in_r2_gol: '________',
      serie_r3: c.serie_r3 || '-', iv_r3: round2(c.in_r3 || c.iv_r3 || 0), in_r3_gol: '________',
      semnatura: '_____________'
    }));
    const columns = [
      { key: 'bloc', label: 'Bloc' },
      { key: 'apart', label: 'Ap.' },
      { key: 'nume', label: 'Titular' },
      { key: 'serie_r1', label: 'Serie R1' },
      { key: 'iv_r1', label: 'Index Vechi R1' },
      { key: 'in_r1_gol', label: 'Index Nou R1' },
      { key: 'serie_r2', label: 'Serie R2' },
      { key: 'iv_r2', label: 'Index Vechi R2' },
      { key: 'in_r2_gol', label: 'Index Nou R2' },
      { key: 'semnatura', label: 'Semnătură' }
    ];
    return buildResponse(catalogEntry, period, asociatie, showNames, columns, rows);
  }

  // 18. SRE (Total Arrears Summary / Situație Totală Restanțe)
  if (code === 'SRE') {
    const rows = [];
    for (const c of apartamente) {
      const arr = arrearsMap.get(c.id);
      const totalRes = round2(arr?.totalRestanta || 0);
      if (totalRes <= 0 && !options.includeZero) continue;
      rows.push({
        bloc: c.bloc,
        apart: c.numar_apart,
        nume: c.nume_proprietar,
        luna_veche: arr?.oldestPeriod || '-',
        nr_luni: arr?.monthsCount ? arr.monthsCount.size : 0,
        restanta_r: round2(arr?.R || 0),
        restanta_f: round2(arr?.F || 0),
        restanta_a: round2(arr?.A || 0),
        total_restanta: totalRes
      });
    }
    const columns = [
      { key: 'bloc', label: 'Bloc' },
      { key: 'apart', label: 'Ap.' },
      { key: 'nume', label: 'Proprietar' },
      { key: 'luna_veche', label: 'Vechime Debit' },
      { key: 'nr_luni', label: 'Nr. Luni' },
      { key: 'restanta_r', label: 'Restanță Regie' },
      { key: 'restanta_f', label: 'Restanță Rulment' },
      { key: 'restanta_a', label: 'Restanță Reparații' },
      { key: 'total_restanta', label: 'Total Debit Principal' }
    ];
    return buildResponse(catalogEntry, period, asociatie, showNames, columns, rows);
  }

  // 19. RE1 & LAR_INST (Detailed Arrears & Penalties / Court Dossier)
  if (code === 'RE1' || code === 'LAR_INST') {
    const rows = [];
    for (const c of apartamente) {
      const penCalc = calculatePenalties(d, c.id, targetDate);
      for (const item of penCalc.rows) {
        if (item.restanta <= 0) continue;
        rows.push({
          bloc: c.bloc,
          apart: c.numar_apart,
          nume: c.nume_proprietar,
          perioada: `${LUNI_RO[item.luna] || item.luna} ${item.an}`,
          categorie: item.categorie,
          data_scadenta: item.data_scadenta,
          restanta: item.restanta,
          zile_intarziere: item.zile_intarziere,
          procent: item.procent,
          penalizare: item.valoare_penalizare,
          total_rand: round2(item.restanta + item.valoare_penalizare)
        });
      }
    }
    const columns = [
      { key: 'bloc', label: 'Bloc' },
      { key: 'apart', label: 'Ap.' },
      { key: 'nume', label: 'Titular / Pârât' },
      { key: 'perioada', label: 'Perioada Debitului' },
      { key: 'categorie', label: 'Cat.' },
      { key: 'data_scadenta', label: 'Scadența' },
      { key: 'restanta', label: 'Debit Restant' },
      { key: 'zile_intarziere', label: 'Zile Întârziere' },
      { key: 'procent', label: '% / Zi' },
      { key: 'penalizare', label: 'Penalități' },
      { key: 'total_rand', label: 'Total Datorat' }
    ];
    return buildResponse(catalogEntry, period, asociatie, showNames, columns, rows, {
      target_date: targetDate,
      legal_header: code === 'LAR_INST' ? 'FIȘĂ DE CONT PENTRU INSTANȚĂ (L. 196/2018)' : undefined
    });
  }

  // 20. CED (Apartment Multi-Month Detailed Breakdown)
  if (code === 'CED') {
    const targetApt = apartamente[0];
    let snaps = [];
    if (targetApt) {
      snaps = d
        .prepare(`
          SELECT * FROM apartamente_luna
          WHERE bloc = ? AND numar_apart = ?
          ORDER BY an DESC, luna DESC
          LIMIT 12
        `)
        .all(String(targetApt.bloc || ''), String(targetApt.numar_apart || ''));
    }
    if (snaps.length === 0 && targetApt) {
      snaps = [{ ...targetApt, an: period.an, luna: period.luna }];
    }
    const rows = snaps.map(s => ({
      perioada: `${LUNI_RO[s.luna] || s.luna} ${s.an}`,
      bloc: s.bloc,
      apart: s.numar_apart,
      apa_rece: round2(s.apa_rece),
      can_mnj: round2(s.can_mnj),
      can_met: round2(s.can_met),
      apa_calda: round2(s.apa_calda),
      incalzire: round2(s.incalzire),
      gaz: round2(s.gaz),
      gunoi: round2(s.gunoi),
      curent: round2(s.curent),
      ascensor: round2(s.ascensor),
      sal_feme: round2(s.sal_feme),
      sal_tesa: round2(s.sal_tesa),
      ch_admin: round2(s.ch_admin),
      fond_repar: round2(s.fond_repar || s.fond_reparatii),
      total_luna: round2(s.total_luna)
    }));
    const columns = [
      { key: 'perioada', label: 'Perioada' },
      { key: 'bloc', label: 'Bloc' },
      { key: 'apart', label: 'Ap.' },
      { key: 'apa_rece', label: 'Apă Rece' },
      { key: 'can_mnj', label: 'Canal' },
      { key: 'can_met', label: 'Meteo' },
      { key: 'incalzire', label: 'Încălzire' },
      { key: 'gunoi', label: 'Gunoi' },
      { key: 'curent', label: 'Curent' },
      { key: 'sal_tesa', label: 'Sal. TESA' },
      { key: 'ch_admin', label: 'Ch. Admin' },
      { key: 'fond_repar', label: 'Fond Rep.' },
      { key: 'total_luna', label: 'Total Lună' }
    ];
    return buildResponse(catalogEntry, period, asociatie, showNames, columns, rows);
  }

  // 21. SRU / SFR / SPE (Working Fund / Repair Fund / Penalties Ledger Status)
  if (code === 'SRU' || code === 'SFR' || code === 'SPE') {
    const catKey = code === 'SRU' ? 'F' : code === 'SFR' ? 'A' : 'P';
    const rows = apartamente.map(c => {
      const arr = arrearsMap.get(c.id) || {};
      const val = round2(arr[`val_${catKey}`] || 0);
      const plat = round2(arr[`ach_${catKey}`] || 0);
      const nplat = round2(arr[catKey] || 0);
      return {
        bloc: c.bloc,
        apart: c.numar_apart,
        nume: c.nume_proprietar,
        ...(code === 'SRU' ? { max_fr: round2(c.max_fr) } : {}),
        valoare: val,
        platit: plat,
        neplatit: nplat
      };
    });
    const columns = [
      { key: 'bloc', label: 'Bloc' },
      { key: 'apart', label: 'Ap.' },
      { key: 'nume', label: 'Titular' },
      ...(code === 'SRU' ? [{ key: 'max_fr', label: 'Plafon Maxim (MAX_FR)' }] : []),
      { key: 'valoare', label: 'Total Facturat (RON)' },
      { key: 'platit', label: 'Total Achitat (RON)' },
      { key: 'neplatit', label: 'Rest de Plată (RON)' }
    ];
    return buildResponse(catalogEntry, period, asociatie, showNames, columns, rows);
  }

  // 22. PER (Persons, Surfaces & Allocation Bases per Block)
  if (code === 'PER') {
    const rows = blocuri.map(b => ({
      bloc: b.bloc,
      tot_apart: b.tot_apart,
      persoane1: b.persoane1,
      persoane2: b.persoane2,
      pers_ar: b.pers_ar,
      pers_ac: b.pers_ac,
      persgu: b.persgu,
      persoaneg: b.persoaneg,
      suprafata1: round2(b.suprafata1),
      suprafata2: round2(b.suprafata2),
      sup_ec_ter: round2(b.sup_ec_ter),
      sl_abon: b.sl_abon,
      sl_salte: b.sl_salte,
      sl_salfe: b.sl_salfe,
      sl_chsed: b.sl_chsed,
      sl_chadm: b.sl_chadm
    }));
    const columns = [
      { key: 'bloc', label: 'Bloc' },
      { key: 'tot_apart', label: 'Ap.' },
      { key: 'persoane1', label: 'Pers. 1' },
      { key: 'pers_ar', label: 'Pers. AR' },
      { key: 'pers_ac', label: 'Pers. AC' },
      { key: 'persgu', label: 'Pers. Gunoi' },
      { key: 'suprafata1', label: 'Supr. 1 (m²)' },
      { key: 'suprafata2', label: 'Supr. 2 (m²)' },
      { key: 'sl_salte', label: 'Bază TESA' },
      { key: 'sl_salfe', label: 'Bază Îngr.' },
      { key: 'sl_chadm', label: 'Bază Admin' }
    ];
    return buildResponse(catalogEntry, period, asociatie, showNames, columns, rows);
  }

  // 23. GOT (Disconnected Apartments & Arrears / Debranșări)
  if (code === 'GOT') {
    const disconn = apartamente.filter(c => Number(c.proc_av_in ?? 100) === 0 || Number(c.proc_av_ac ?? 100) === 0);
    const rows = disconn.map(c => {
      const arr = arrearsMap.get(c.id) || {};
      const types = [];
      if (Number(c.proc_av_in ?? 100) === 0) types.push('BLINDAT INCALZIRE');
      if (Number(c.proc_av_ac ?? 100) === 0) types.push('BLINDAT APA CALDA');
      return {
        bloc: c.bloc,
        apart: c.numar_apart,
        nume: c.nume_proprietar,
        tip_debransare: types.join(' / '),
        luna_veche: arr.oldestPeriod || '-',
        tot_res: round2(arr.totalRestanta || 0)
      };
    });
    const columns = [
      { key: 'bloc', label: 'Bloc' },
      { key: 'apart', label: 'Ap.' },
      { key: 'nume', label: 'Proprietar' },
      { key: 'tip_debransare', label: 'Tip Debranșare' },
      { key: 'luna_veche', label: 'Luna Vechime' },
      { key: 'tot_res', label: 'Total Debit Restant (RON)' }
    ];
    return buildResponse(catalogEntry, period, asociatie, showNames, columns, rows);
  }

  // 24. AJU (Social Heating Aid / Ajutoare Sociale Încălzire)
  if (code === 'AJU') {
    const eligible = apartamente.filter(
      c => round2(Number(c.apa_calda || 0) + Number(c.difetac || 0) + Number(c.incalzire || 0) + Number(c.difetin || 0)) !== 0
    );
    const rows = eligible.map(c => {
      const valInc = round2(Number(c.incalzire || 0) + Number(c.difetin || 0));
      const valAc = round2(Number(c.apa_calda || 0) + Number(c.difetac || 0));
      return {
        bloc: c.bloc,
        apart: c.numar_apart,
        nume: c.nume_proprietar,
        gcal_incalzire: round4(c.gcal_final || ((Number(c.inin || 0) - Number(c.ivin || 0)) * Number(c.constin || 1))),
        valoare_incalzire: valInc,
        valoare_apa_calda: valAc,
        total_termic: round2(valInc + valAc)
      };
    });
    const columns = [
      { key: 'bloc', label: 'Bloc' },
      { key: 'apart', label: 'Ap.' },
      { key: 'nume', label: 'Titular' },
      { key: 'gcal_incalzire', label: 'Consum Încălzire (Gcal)' },
      { key: 'valoare_incalzire', label: 'Valoare Încălzire (RON)' },
      { key: 'valoare_apa_calda', label: 'Valoare Apă Caldă (RON)' },
      { key: 'total_termic', label: 'Total Termic (RON)' }
    ];
    return buildResponse(catalogEntry, period, asociatie, showNames, columns, rows);
  }

  // 25. LSC (Dunning Letters / Scrisori Somație Restanțieri)
  if (code === 'LSC') {
    const rows = [];
    for (const c of apartamente) {
      const arr = arrearsMap.get(c.id);
      const rest = round2(arr?.totalRestanta || 0);
      if (rest <= 0) continue;
      const pen = calculatePenalties(d, c.id, targetDate);
      rows.push({
        bloc: c.bloc,
        apart: c.numar_apart,
        nume: c.nume_proprietar,
        luna_veche: arr.oldestPeriod || '-',
        debit_principal: rest,
        penalitati: pen.total_penalizare,
        total_somat: round2(rest + pen.total_penalizare),
        termen_plata: options.datas || targetDate,
        text_somatie: `Prin prezenta vă somăm ca până la data de ${options.datas || targetDate} să achitați debitul restant în sumă de ${round2(rest + pen.total_penalizare)} RON, în caz contrar urmând a vă acționa în judecată conform Legii 196/2018.`
      });
    }
    const columns = [
      { key: 'bloc', label: 'Bloc' },
      { key: 'apart', label: 'Ap.' },
      { key: 'nume', label: 'Destinatar' },
      { key: 'luna_veche', label: 'Vechime' },
      { key: 'debit_principal', label: 'Debit Restant' },
      { key: 'penalitati', label: 'Penalități' },
      { key: 'total_somat', label: 'Total Somat (RON)' },
      { key: 'termen_plata', label: 'Termen Conformare' }
    ];
    return buildResponse(catalogEntry, period, asociatie, showNames, columns, rows);
  }

  // 26. LVE (Expired Metrology / Verificări Metrologice Expirate — ignores empty dates per Edge Case #15)
  if (code === 'LVE') {
    const refIso = parseCalendarDate(targetDate) || '2026-09-30';
    const meterDefs = [
      { key: 'd_v_ar_bu', ser: 'ser_ar_bu', label: 'AR Bucătărie' },
      { key: 'd_v_ar_ba1', ser: 'ser_ar_ba1', label: 'AR Baie 1' },
      { key: 'd_v_ar_ba2', ser: 'ser_ar_ba2', label: 'AR Baie 2' },
      { key: 'd_v_ac_bu', ser: 'ser_ac_bu', label: 'AC Bucătărie' },
      { key: 'd_v_ac_ba1', ser: 'ser_ac_ba1', label: 'AC Baie 1' },
      { key: 'd_v_ac_ba2', ser: 'ser_ac_ba2', label: 'AC Baie 2' },
      { key: 'd_v_inin', ser: 'ser_inin', label: 'Contor Căldură' }
    ];
    const rows = [];
    for (const c of apartamente) {
      for (const m of meterDefs) {
        const dtIso = parseCalendarDate(c[m.key]);
        // Edge Case #15: empty/blank dates are ignored (never falsely flagged)
        if (!dtIso) continue;
        const isExpired = dtIso < refIso;
        if (!isExpired && !options.includeValid) continue;
        rows.push({
          bloc: c.bloc,
          apart: c.numar_apart,
          nume: c.nume_proprietar,
          tip_contor: m.label,
          serie: c[m.ser] || '-',
          data_verificare: dtIso,
          status: isExpired ? 'EXPIRAT' : 'VALID'
        });
      }
    }
    const columns = [
      { key: 'bloc', label: 'Bloc' },
      { key: 'apart', label: 'Ap.' },
      { key: 'nume', label: 'Proprietar' },
      { key: 'tip_contor', label: 'Contor' },
      { key: 'serie', label: 'Serie' },
      { key: 'data_verificare', label: 'Data Expirării / Verificării' },
      { key: 'status', label: 'Stare' }
    ];
    return buildResponse(catalogEntry, period, asociatie, showNames, columns, rows);
  }

  // 27. COM (Month Comparison / Comparare Valori cu Lună Referință)
  if (code === 'COM') {
    const refAn = Number(options.ref_an || period.an);
    const refLuna = Number(options.ref_luna || (period.luna > 1 ? period.luna - 1 : 12));
    const refSnaps = d
      .prepare('SELECT bloc, numar_apart, total_luna FROM apartamente_luna WHERE an = ? AND luna = ?')
      .all(refAn, refLuna);
    const refMap = new Map(refSnaps.map(s => [`${s.bloc}:${s.numar_apart}`, Number(s.total_luna || 0)]));

    const rows = apartamente.map(c => {
      const totalC = round2(c.total_luna || 0);
      const totalR = round2(refMap.get(`${c.bloc}:${c.numar_apart}`) || 0);
      const dif = round2(totalC - totalR);
      const procVar = totalR === 0 ? 0 : round2((dif / totalR) * 100);
      return {
        bloc: c.bloc,
        apart: c.numar_apart,
        nume: c.nume_proprietar,
        total_curent: totalC,
        total_referinta: totalR,
        diferenta: dif,
        procent_variatie: procVar
      };
    });
    const columns = [
      { key: 'bloc', label: 'Bloc' },
      { key: 'apart', label: 'Ap.' },
      { key: 'nume', label: 'Proprietar' },
      { key: 'total_curent', label: `Total ${period.luna}/${period.an}` },
      { key: 'total_referinta', label: `Total Ref. ${refLuna}/${refAn}` },
      { key: 'diferenta', label: 'Diferență (RON)' },
      { key: 'procent_variatie', label: 'Variație (%)' }
    ];
    return buildResponse(catalogEntry, period, asociatie, showNames, columns, rows);
  }

  // 28. IN1 & IN2 (Collections by Block/Apartment or by Receipt Number)
  if (code === 'IN1' || code === 'IN2') {
    const orderBy =
      code === 'IN1'
        ? 'b.bloc ASC, CAST(a.numar_apart AS INTEGER) ASC, c.numar ASC'
        : 'c.numar ASC, c.id ASC';

    const rawPayments = d
      .prepare(`
        SELECT
          c.id AS chitanta_id,
          c.serie,
          c.numar,
          c.data_emiterii,
          c.anulata,
          c.tip_plata,
          c.suma AS suma_chitanta,
          COALESCE(b.bloc, c.cod_bloc, '') AS bloc,
          COALESCE(a.numar_apart, c.numar_apart, '') AS apart,
          COALESCE(a.nume_proprietar, c.nume_platitor, '') AS nume,
          d.categorie,
          d.an AS debit_an,
          d.luna AS debit_luna,
          COALESCE(p.suma, c.suma) AS suma_achitata,
          COALESCE(p.sursa, 'CASA') AS sursa
        FROM chitante c
        LEFT JOIN plati p ON p.chitanta_id = c.id
        LEFT JOIN datorii d ON d.id = p.datorie_id
        LEFT JOIN apartamente a ON a.id = COALESCE(d.apartament_id, c.apartament_id)
        LEFT JOIN blocuri b ON b.id = COALESCE(d.bloc_id, c.bloc_id, a.bloc_id)
        ORDER BY ${orderBy}
        LIMIT 500
      `)
      .all();

    const rows = rawPayments.map(r => ({
      numar_chitanta: `${r.serie || 'ORH'}-${String(r.numar).padStart(5, '0')}`,
      data: r.data_emiterii,
      bloc: r.bloc,
      apart: r.apart,
      nume: r.nume,
      perioada_achitata: r.debit_luna ? `${r.debit_luna}/${r.debit_an}` : '-',
      categorie: r.categorie || 'R',
      sursa: r.sursa,
      status: r.anulata ? 'ANULATĂ' : 'ACTIVĂ',
      suma: r.anulata ? 0 : round2(r.suma_achitata)
    }));

    const columns = [
      { key: 'numar_chitanta', label: 'Chitanță' },
      { key: 'data', label: 'Data' },
      { key: 'bloc', label: 'Bloc' },
      { key: 'apart', label: 'Ap.' },
      { key: 'nume', label: 'Plătitor' },
      { key: 'perioada_achitata', label: 'Perioada' },
      { key: 'categorie', label: 'Cat.' },
      { key: 'sursa', label: 'Sursă' },
      { key: 'status', label: 'Stare' },
      { key: 'suma', label: 'Sumă Încasată (RON)' }
    ];
    return buildResponse(catalogEntry, period, asociatie, showNames, columns, rows);
  }

  throw new Error(`Cod raport necunoscut: ${code}`);
}

function buildResponse(catalogEntry, period, asociatie, showNames, columns, rows, extraMeta = {}) {
  const numericTotals = {};
  for (const col of columns) {
    if (['bloc', 'apart', 'nume', 'pozitie', 'cp_in', 'categorie', 'document', 'data', 'explicatie', 'act_pas', 'explicatie_completa', 'platitor', 'beneficiar', 'iban_beneficiar', 'suma_litere', 'semnatura', 'mod_r_dif', 'mod_r_inc', 'ser_ar_bu', 'in_ar_bu_gol', 'ser_ar_ba1', 'in_ar_ba1_gol', 'serie_r1', 'in_r1_gol', 'serie_r2', 'in_r2_gol', 'luna_veche', 'perioada', 'data_scadenta', 'tip_debransare', 'termen_plata', 'tip_contor', 'serie', 'data_verificare', 'status', 'numar_chitanta', 'perioada_achitata', 'sursa'].includes(col.key)) {
      continue;
    }
    let sum = 0;
    let hasNum = false;
    for (const r of rows) {
      const v = r[col.key];
      if (typeof v === 'number' && Number.isFinite(v)) {
        sum += v;
        hasNum = true;
      }
    }
    if (hasNum) {
      numericTotals[col.key] = round2(sum);
    }
  }

  return {
    code: catalogEntry.code,
    menu: catalogEntry.menu,
    key: catalogEntry.key,
    title: catalogEntry.title,
    prg: catalogEntry.prg,
    frx: catalogEntry.frx,
    orientation: catalogEntry.orientation || 'portrait',
    gdpr_applicable: Boolean(catalogEntry.gdpr),
    gdpr_masked: Boolean(catalogEntry.gdpr && !showNames),
    show_names: showNames,
    period: {
      id: period.id,
      an: period.an,
      luna: period.luna,
      luna_nume: LUNI_RO[period.luna] || String(period.luna),
      status: period.status
    },
    asociatie: {
      id: asociatie.id || 1,
      nume: asociatie.nume,
      cod_fiscal: asociatie.cod_fiscal,
      adresa: asociatie.adresa,
      presedinte: asociatie.presedinte,
      administrator: asociatie.administrator,
      cont_bancar: asociatie.cont_bancar,
      banca: asociatie.banca
    },
    columns,
    rows,
    totals: numericTotals,
    meta: {
      generated_at: new Date().toISOString(),
      row_count: rows.length,
      ...extraMeta
    }
  };
}

/**
 * Converts a generated report object into a UTF-8 BOM CSV string.
 */
function reportToCsv(report) {
  const cols = report.columns || [];
  const header = cols.map(c => `"${String(c.label || c.key).replace(/"/g, '""')}"`).join(',');
  const lines = [header];

  for (const row of report.rows || []) {
    const vals = cols.map(c => {
      const v = row[c.key];
      if (v === null || v === undefined) return '""';
      if (typeof v === 'number') return String(v);
      return `"${String(v).replace(/"/g, '""')}"`;
    });
    lines.push(vals.join(','));
  }

  return '\uFEFF' + lines.join('\r\n');
}

module.exports = {
  REPORT_CATALOG,
  GDPR_NOTICE_BOARD_CODES,
  generateReport,
  reportToCsv
};
