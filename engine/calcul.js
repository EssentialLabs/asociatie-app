/**
 * engine/calcul.js
 *
 * Pure 8-step monthly calculation engine matching FoxPro 2.6 SUM.PRG (ORHIDEEA 2005),
 * integrated with TCE.PRG (expireReductions) and CRE.PRG (computeAllocators).
 */

const { round0, round2, round4, round8, roundFox } = require('./round');
const { expireReductions, parseCalendarDate } = require('./tce');
const { computeAllocators } = require('./cre');

function num(obj, upperKey, lowerKey, fallback = 0) {
  if (!obj) return fallback;
  const v = obj[upperKey] !== undefined ? obj[upperKey] : obj[lowerKey];
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function str(obj, upperKey, lowerKey, fallback = '') {
  if (!obj) return fallback;
  const v = obj[upperKey] !== undefined ? obj[upperKey] : obj[lowerKey];
  if (v === null || v === undefined) return fallback;
  return String(v).trim();
}

function setBoth(obj, upperKey, lowerKey, value) {
  obj[lowerKey] = value;
  obj[upperKey] = value;
}

function getBlockCode(b) {
  return str(b, 'BLOC', 'bloc') || str(b, 'NUMAR', 'numar');
}

function getAptBlockCode(a, blocMapById) {
  const code = str(a, 'BLOC', 'bloc');
  if (code) return code;
  if (a.bloc_id !== undefined && blocMapById.has(a.bloc_id)) {
    return blocMapById.get(a.bloc_id);
  }
  return '';
}

function getAptNumber(a) {
  return str(a, 'APART', 'apart') || str(a, 'NUMAR_APART', 'numar_apart') || str(a, 'NUMAR', 'numar');
}

/**
 * Runs the complete 8-step FoxPro SUM.PRG calculation on a period dataset.
 * @param {Object} input - { period, general, asociatie, blocuri, apartamente, chitante, datorii }
 * @param {Object} [options] - { runTce: false, runCre: 'auto' }
 */
function calculatePeriod(input, options = {}) {
  const general = { ...(input?.general || {}), ...(input?.period || {}) };
  const rawAsoc = input?.asociatie || {};
  const rawBlocuri = input?.blocuri || [];
  const rawApartamente = input?.apartamente || [];

  const asociatie = { ...rawAsoc };
  let blocuri = rawBlocuri.map(b => ({ ...b }));
  let apartamente = rawApartamente.map(a => ({ ...a }));

  // Detect whether SL_SALFE column exists (added in 2010+; in 2003-2009 SAL_FEME was allocated by PER_SAL_FE)
  const hasSlSalFeField =
    ('SL_SALFE' in rawAsoc) ||
    ('sl_salfe' in rawAsoc) ||
    rawBlocuri.some(b => ('SL_SALFE' in b) || ('sl_salfe' in b));

  // Optional Step 0A: TCE (expire temporary reductions if requested)
  if (options.runTce) {
    const tceRes = expireReductions({ apartamente, general }, options);
    apartamente = tceRes.apartamente;
  }

  // Optional Step 0B: CRE (heat cost allocators)
  // Auto-runs for blocks with CP_IN='R' when allocator readings are present and ININ hasn't been pre-populated,
  // or when options.runCre === true.
  const hasR = apartamente.some(a => str(a, 'CP_IN', 'cp_in').toUpperCase() === 'R');
  if (options.runCre === true || (options.runCre !== false && hasR)) {
    const creRes = computeAllocators(
      { blocuri, apartamente },
      { onlyBlocksWithAllocators: options.runCre !== true }
    );
    blocuri = creRes.blocuri;
    apartamente = creRes.apartamente;
  }

  // Resolve general tariffs
  const tarifAr = num(general, 'TARIF_AR', 'tarif_ar', 0);
  const tarifCa = num(general, 'TARIF_CA', 'tarif_ca', 0);
  const hasProcCa =
    (input?.general && ('PROC_CA' in input.general || 'proc_ca' in input.general)) ||
    (input?.period && ('PROC_CA' in input.period || 'proc_ca' in input.period));
  const procCa = hasProcCa ? num(general, 'PROC_CA', 'proc_ca', 100) : 75;
  const generalTarifEt = num(general, 'TARIF_ET', 'tarif_et', 0);

  const blocMapById = new Map();
  for (const b of blocuri) {
    const bCode = getBlockCode(b);
    setBoth(b, 'BLOC', 'bloc', bCode);
    if (b.id !== undefined) {
      blocMapById.set(b.id, bCode);
    }
  }
  for (const c of apartamente) {
    const bCode = getAptBlockCode(c, blocMapById);
    const aNum = getAptNumber(c);
    setBoth(c, 'BLOC', 'bloc', bCode);
    setBoth(c, 'APART', 'apart', aNum);
    if (c.numar_apart === undefined) c.numar_apart = aNum;
  }

  // Step 1: Working Fund Status Initialization (CALC_FR & PLAT_FR from ledger if provided)
  const ledgerRows = input?.chitante || input?.datorii || null;
  if (Array.isArray(ledgerRows) && ledgerRows.length > 0) {
    for (const c of apartamente) {
      const bCode = getAptBlockCode(c, blocMapById).toUpperCase();
      const aNum = getAptNumber(c).toUpperCase();
      let frli = 0;
      let frdepl = 0;
      for (const row of ledgerRows) {
        const cee = str(row, 'CEE', 'categorie').toUpperCase() || str(row, 'CEE', 'cee').toUpperCase();
        if (cee !== 'F') continue;
        const rBloc = (str(row, 'BLOC', 'bloc') || str(row, 'BLOC_NUMAR', 'bloc_numar')).toUpperCase();
        const rApart = (str(row, 'APART', 'apart') || str(row, 'NUMAR_APART', 'numar_apart')).toUpperCase();
        const matchById = c.id !== undefined && row.apartament_id !== undefined && c.id === row.apartament_id;
        if (matchById || (rBloc === bCode && rApart === aNum)) {
          const val = num(row, 'VALOARE', 'valoare', 0);
          frli += val;
          if ('CHITANTA1' in row || 'chitanta1' in row || 'PLATA1' in row || 'plata1' in row) {
            const ch1 = num(row, 'CHITANTA1', 'chitanta1', 0);
            const ch2 = num(row, 'CHITANTA2', 'chitanta2', 0);
            const p1 = ch1 !== 0 ? num(row, 'PLATA1', 'plata1', 0) : 0;
            const p2 = ch2 !== 0 ? num(row, 'PLATA2', 'plata2', 0) : 0;
            frdepl += (val - p1 - p2);
          } else if ('restanta' in row || 'RESTANTA' in row) {
            frdepl += num(row, 'RESTANTA', 'restanta', 0);
          }
        }
      }
      setBoth(c, 'CALC_FR', 'calc_fr', round2(frli));
      setBoth(c, 'PLAT_FR', 'plat_fr', round2(frdepl));
    }
  }

  // Step 2: Apartment Meter Consumption & Direct Charges
  for (const b of blocuri) {
    const bCode = getBlockCode(b).toUpperCase();
    const bTarifEt = num(b, 'TARIF_ET', 'tarif_et', 0);
    const tarifEt = bTarifEt > 0 ? bTarifEt : generalTarifEt;
    const ecartTemp = num(b, 'ECART_TEMP', 'ecart_temp', 0);
    const randTr = num(b, 'RAND_TR', 'rand_tr', 0);

    const bApts = apartamente.filter(c => getAptBlockCode(c, blocMapById).toUpperCase() === bCode);

    for (const c of bApts) {
      const cpAr = str(c, 'CP_AR', 'cp_ar').toUpperCase();
      const cpAc = str(c, 'CP_AC', 'cp_ac').toUpperCase();

      if (cpAr === 'C' || cpAc === 'C') {
        const cnsAr =
          (num(c, 'INARBU', 'inarbu', 0) - num(c, 'IVARBU', 'ivarbu', 0)) +
          (num(c, 'INARBA1', 'inarba1', 0) - num(c, 'IVARBA1', 'ivarba1', 0)) +
          (num(c, 'INARBA2', 'inarba2', 0) - num(c, 'IVARBA2', 'ivarba2', 0));
        const cnsAc =
          (num(c, 'INACBU', 'inacbu', 0) - num(c, 'IVACBU', 'ivacbu', 0)) +
          (num(c, 'INACBA1', 'inacba1', 0) - num(c, 'IVACBA1', 'ivacba1', 0)) +
          (num(c, 'INACBA2', 'inacba2', 0) - num(c, 'IVACBA2', 'ivacba2', 0));

        const etacApar = round2(((cnsAc * ecartTemp * (randTr / 100)) / 1000) * tarifEt);
        const apaRece = round2((cnsAr + cnsAc) * tarifAr);
        const arra = round2(cnsAr * tarifAr);
        const arca = round2(cnsAc * tarifAr);
        const canMnj = round2((cnsAr + cnsAc) * (procCa / 100) * tarifCa);
        const canMnjAr = round2(cnsAr * (procCa / 100) * tarifCa);
        const canMnjAc = round2(cnsAc * (procCa / 100) * tarifCa);

        setBoth(c, 'APA_RECE', 'apa_rece', apaRece);
        setBoth(c, 'ARRA', 'arra', arra);
        setBoth(c, 'ARCA', 'arca', arca);
        setBoth(c, 'CAN_MNJ', 'can_mnj', canMnj);
        setBoth(c, 'CAN_MNJAR', 'can_mnjar', canMnjAr);
        setBoth(c, 'CAN_MNJAC', 'can_mnjac', canMnjAc);
        setBoth(c, 'APA_CALDA', 'apa_calda', etacApar);
      }

      // Heat meter calculation on all apartments (SUM.PRG lines 63-71)
      const inin = num(c, 'ININ', 'inin', 0);
      const ivin = num(c, 'IVIN', 'ivin', 0);
      const constin = num(c, 'CONSTIN', 'constin', 1);
      const cnsin = round4((inin - ivin) * constin);
      const incapar = round2(cnsin * tarifEt);
      setBoth(c, 'INCALZIRE', 'incalzire', incapar);
    }
  }

  // Step 3: Block Bases Aggregation (SUM.PRG lines 80-191)
  for (const b of blocuri) {
    const bCode = getBlockCode(b).toUpperCase();
    const bApts = apartamente.filter(c => getAptBlockCode(c, blocMapById).toUpperCase() === bCode);

    const ap = bApts.length;
    let apcar09 = 0;
    let apcac09 = 0;
    let apcin09 = 0;
    let apCUACC09 = 0;
    let apte09 = 0;
    let apabo09 = 0;
    let apascen09 = 0;
    let appres09 = 0;
    let apdifar09 = 0;
    let apdifac09 = 0;

    let p1 = 0;
    let p2 = 0;
    let par = 0;
    let pac2 = 0;
    let pak3 = 0;
    let pak4 = 0;
    let pgaz = 0;
    let pgun = 0;
    let pasce = 0;
    let pcureSc = 0;
    let pcureLi = 0;
    let psalfe = 0;
    let pdifer = 0;

    let sl1 = 0;
    let sl2 = 0;
    let sldifin = 0;
    let setyu = 0;
    let setdifin = 0;
    let sdin = 0;
    let sll1 = 0;
    let set1 = 0;
    let slAbona = 0;
    let slSaltes = 0;
    let slSalfem = 0;
    let slPresser = 0;
    let slChse1 = 0;
    let slChadmi = 0;
    let slAscens = 0;

    let puta1 = 0;
    let puMa1 = 0;
    let puta2 = 0;
    let puMa2 = 0;
    let rere = 0;
    let rete = 0;
    let rexe = 0;

    for (const c of bApts) {
      const cpAr = str(c, 'CP_AR', 'cp_ar').toUpperCase();
      const cpAc = str(c, 'CP_AC', 'cp_ac').toUpperCase();
      const cpIn = str(c, 'CP_IN', 'cp_in').toUpperCase();

      const procAvAc = num(c, 'PROC_AV_AC', 'proc_av_ac', 0);
      const procAvIn = num(c, 'PROC_AV_IN', 'proc_av_in', 0);
      const procSalTe = num(c, 'PROC_SAL_TE', 'proc_sal_te', num(c, 'PROC_SAL_T', 'proc_sal_t', 0));
      const procSalFe = num(c, 'PROC_SAL_FE', 'proc_sal_fe', num(c, 'PROC_SAL_F', 'proc_sal_f', 0));
      const procAbona = num(c, 'PROC_ABONA', 'proc_abona', 0);
      const procAscens = num(c, 'PROCASCENS', 'procascens', 0);
      const pPresServ = num(c, 'P_PRESSERV', 'p_presserv', 0);
      const procDifer = num(c, 'PROC_DIFER', 'proc_difer', 0);
      const procDifIn = num(c, 'PROC_DIFIN', 'proc_difin', 0);
      const procG = num(c, 'PROCG', 'procg', 0);
      const procGunoi = num(c, 'PROCGUNOI', 'procgunoi', 0);
      const procCuSc = num(c, 'PROC_CU_SC', 'proc_cu_sc', 0);
      const procCuLi = num(c, 'PROC_CU_LI', 'proc_cu_li', 0);
      const procChSed = num(c, 'PROC_CHSED', 'proc_chsed', 0);
      const procChAdm = num(c, 'PROC_CHADM', 'proc_chadm', 0);

      if (cpAr === 'C') apcar09++;
      if (cpAc === 'C') apcac09++;
      if (cpIn === 'C' || cpIn === 'R') apcin09++;
      if (procAvAc === 100) apCUACC09++;

      apte09 += procSalTe / 100;
      apabo09 += procAbona / 100;
      apascen09 += procAscens / 100;
      appres09 += pPresServ / 100;
      apdifar09 += procDifer / 100;
      apdifac09 += (procDifer / 100) * (procAvAc / 100);

      const pers1 = num(c, 'PERSOANE', 'persoane', 0) - num(c, 'P1_SCAZ', 'p1_scaz', 0);
      const pers2 = num(c, 'PERSOANE', 'persoane', 0) - num(c, 'P2_SCAZ', 'p2_scaz', 0);
      p1 += pers1;
      p2 += pers2;
      if (cpAr === 'P') par += pers1;
      if (cpAc === 'P') pac2 += pers1 * (procAvAc / 100);
      pak3 += pers1 * (procAvAc / 100);
      pak4 += pers1 * (procAvAc / 100) * (procDifer / 100);
      pgaz += pers1 * (procG / 100);
      pgun += pers1 * (procGunoi / 100);
      pasce += pers1 * (procAscens / 100);
      pcureSc += pers1 * (procCuSc / 100);
      pcureLi += pers1 * (procCuLi / 100);
      psalfe += pers1 * (procSalFe / 100);
      pdifer += pers1 * (procDifer / 100);

      const sup = num(c, 'SUPRAFATA', 'suprafata', 0);
      const effSl1 = sup - num(c, 'SL1_SCAZ', 'sl1_scaz', 0);
      const effSl2 = sup - num(c, 'SL2_SCAZ', 'sl2_scaz', 0);
      const effSet = num(c, 'SUP_EC_TER', 'sup_ec_ter', 0) - num(c, 'SET_SCAZ', 'set_scaz', 0);

      sl1 += effSl1;
      sl2 += effSl2;
      sldifin += effSl1 * (procDifIn / 100);
      setyu += effSet;
      setdifin += effSet * (procDifIn / 100);
      sdin += effSl1 * (procAvIn / 100);
      if (cpIn === 'P') {
        sll1 += effSl1 * (procAvIn / 100);
        set1 += effSet * (procAvIn / 100);
      }

      slAbona += sup * (procAbona / 100);
      slSaltes += sup * (procSalTe / 100);
      slSalfem += sup * (procSalFe / 100);
      slPresser += sup * (pPresServ / 100);
      slChse1 += sup * (procChSed / 100);
      slChadmi += sup * (procChAdm / 100);
      slAscens += sup * (procAscens / 100);

      const arra = num(c, 'ARRA', 'arra', 0);
      const arca = num(c, 'ARCA', 'arca', 0);
      const apaCalda = num(c, 'APA_CALDA', 'apa_calda', 0);
      const incalzire = num(c, 'INCALZIRE', 'incalzire', 0);

      if (cpAr === 'C') {
        puta1 += arra;
        puMa1 += arra * (procDifer / 100);
      }
      if (cpAc === 'C') {
        puta2 += arca;
        puMa2 += arca * (procDifer / 100);
        rere += apaCalda;
      }
      if (cpIn === 'C') {
        rete += incalzire;
      }
      rexe += incalzire;
    }

    const bProcAvAc = num(b, 'PROC_AV_AC', 'proc_av_ac', 0);
    const bProcAvIn = num(b, 'PROC_AV_IN', 'proc_av_in', 0);
    const bProcSalT = num(b, 'PROC_SAL_T', 'proc_sal_t', num(b, 'PROC_SAL_TE', 'proc_sal_te', 0));
    const bProcSalF = num(b, 'PROC_SAL_F', 'proc_sal_f', num(b, 'PROC_SAL_FE', 'proc_sal_fe', 0));
    const bProcAbona = num(b, 'PROC_ABONA', 'proc_abona', 0);
    const bProcGunoi = num(b, 'PROCGUNOI', 'procgunoi', 0);
    const bProcChSed = num(b, 'PROC_CHSED', 'proc_chsed', 0);
    const bProcChAdm = num(b, 'PROC_CHADM', 'proc_chadm', 0);

    const pac1 = round0(pac2);
    const pac = round0(pac1 * bProcAvAc * 0.01);
    const pax = round0((pak3 * bProcAvAc) / 100);
    const pav = round0((pak4 * bProcAvAc) / 100);
    const sll = round2(sll1);
    const slin = round2(sll * bProcAvIn * 0.01);
    const set = round2(set1);
    const reme = rexe - rete;

    setBoth(b, 'APCAR', 'apcar', apcar09);
    setBoth(b, 'APCAC', 'apcac', apcac09);
    setBoth(b, 'APCIN', 'apcin', apcin09);
    setBoth(b, 'APASCEN', 'apascen', apascen09);
    setBoth(b, 'APPRES', 'appres', appres09);
    setBoth(b, 'AP_SAL_TE', 'ap_sal_te', round0((apte09 * bProcSalT) / 100));
    setBoth(b, 'AP_ABON', 'ap_abon', round0((apabo09 * bProcAbona) / 100));
    setBoth(b, 'AP_CUACC', 'ap_cuacc', round0((apCUACC09 * bProcAvAc) / 100));
    setBoth(b, 'APDIFAR', 'apdifar', apdifar09);
    setBoth(b, 'APDIFAC', 'apdifac', apdifac09);
    setBoth(b, 'TOT_APART', 'tot_apart', ap);

    setBoth(b, 'PERSOANE1', 'persoane1', p1);
    setBoth(b, 'PERSOANE2', 'persoane2', p2);
    setBoth(b, 'PERS_AR', 'pers_ar', par);
    setBoth(b, 'PERS_AC', 'pers_ac', pac1);
    setBoth(b, 'PERS_ACD', 'pers_acd', pac);
    setBoth(b, 'PERS_ACX', 'pers_acx', pax);
    setBoth(b, 'PERSOANEG', 'persoaneg', pgaz);
    setBoth(b, 'PERSGU', 'persgu', round0((pgun * bProcGunoi) / 100));
    setBoth(b, 'PASCENS', 'pascens', pasce);
    setBoth(b, 'PCURENT_SC', 'pcurent_sc', pcureSc);
    setBoth(b, 'PCURENT_LI', 'pcurent_li', pcureLi);
    setBoth(b, 'PER_SAL_FE', 'per_sal_fe', round0((psalfe * bProcSalF) / 100));
    setBoth(b, 'PERDIFAR', 'perdifar', pdifer);
    setBoth(b, 'PERDIFAC', 'perdifac', pav);

    setBoth(b, 'SL_ABON', 'sl_abon', round0((slAbona * bProcAbona) / 100));
    setBoth(b, 'SL_SALTE', 'sl_salte', round0((slSaltes * bProcSalT) / 100));
    setBoth(b, 'SL_SALFE', 'sl_salfe', round0((slSalfem * bProcSalF) / 100));
    setBoth(b, 'SL_PRESSE', 'sl_presse', slPresser);
    setBoth(b, 'SL_CHSED', 'sl_chsed', round0((slChse1 * bProcChSed) / 100));
    setBoth(b, 'SL_ASCEN', 'sl_ascen', slAscens);
    setBoth(b, 'SL_CHADM', 'sl_chadm', round0((slChadmi * bProcChAdm) / 100));
    setBoth(b, 'SL_INC', 'sl_inc', sll);
    setBoth(b, 'SL_INCD', 'sl_incd', slin);
    setBoth(b, 'SUPRAFATA1', 'suprafata1', round2(sl1));
    setBoth(b, 'SUPRAFATA2', 'suprafata2', round2(sl2));
    setBoth(b, 'SL_DINC', 'sl_dinc', round2(sdin));
    setBoth(b, 'SL_DIFIN', 'sl_difin', round2(sldifin));
    setBoth(b, 'SET_COMUN', 'set_comun', round2(setyu));
    setBoth(b, 'SET_DIFIN', 'set_difin', round2(setdifin));
    setBoth(b, 'SUP_EC_TER', 'sup_ec_ter', set);

    setBoth(b, 'ARAC', 'arac', round2(puta1));
    setBoth(b, 'ACAC', 'acac', round2(puta2));
    setBoth(b, 'ARDIFER', 'ardifer', round2(puMa1));
    setBoth(b, 'ACDIFER', 'acdifer', round2(puMa2));
    setBoth(b, 'ETACAC', 'etacac', round2(rere));
    setBoth(b, 'ETINAC', 'etinac', round2(rete + reme));
    setBoth(b, 'INCCAP', 'inccap', round2(rete));
    setBoth(b, 'INCRAP', 'incrap', round2(reme));
  }

  // Step 4: Block Meter Values (SUM.PRG lines 199-225)
  for (const b of blocuri) {
    const bCpAr = str(b, 'CP_AR', 'cp_ar').toUpperCase();
    const bCpAc = str(b, 'CP_AC', 'cp_ac').toUpperCase();
    const bCpIn = str(b, 'CP_IN', 'cp_in').toUpperCase();
    const bTarifEt = num(b, 'TARIF_ET', 'tarif_et', 0);
    const tarifEt = bTarifEt > 0 ? bTarifEt : generalTarifEt;

    if (bCpAr === 'C' || bCpAc === 'C') {
      const cnsAr = num(b, 'INAR', 'inar', 0) - num(b, 'IVAR', 'ivar', 0);
      const cnsAc = num(b, 'INAC', 'inac', 0) - num(b, 'IVAC', 'ivac', 0);
      const ecartTemp = num(b, 'ECART_TEMP', 'ecart_temp', 0);
      const randTr = num(b, 'RAND_TR', 'rand_tr', 0);

      const etacBl = round2(cnsAc * tarifEt * ((ecartTemp * (randTr / 100)) / 1000));
      setBoth(b, 'APA_RECE', 'apa_rece', round2(cnsAr * tarifAr));
      setBoth(b, 'APA_CALDA', 'apa_calda', round2(cnsAc * tarifAr));
      setBoth(b, 'ETAC', 'etac', etacBl);
    }

    setBoth(b, 'INCALZIRE', 'incalzire', 0);
    if (bCpIn === 'C') {
      const inin = num(b, 'ININ', 'inin', 0);
      const ivin = num(b, 'IVIN', 'ivin', 0);
      const constin = num(b, 'CONSTIN', 'constin', 1);
      const cnsInB = round4((inin - ivin) * constin);
      const incaBl = round2(cnsInB * tarifEt);
      setBoth(b, 'INCALZIRE', 'incalzire', incaBl);
    }
  }

  // Step 5: Association Bases Aggregation (SUM.PRG lines 236-309)
  let ap8 = 0;
  let apte09 = 0;
  let apabol09 = 0;
  let p18 = 0;
  let p28 = 0;
  let par8 = 0;
  let pac9 = 0;
  let pad9 = 0;
  let pgaz = 0;
  let pgucu = 0;
  let pcureSc = 0;
  let pcureLi = 0;
  let psalfe = 0;
  let s18 = 0;
  let s28 = 0;
  let slin9 = 0;
  let slabo8 = 0;
  let slsteo8 = 0;
  let slsfeo8 = 0;
  let sldero8 = 0;
  let slchado8 = 0;
  let set8 = 0;
  let yyy1 = 0;
  let yyy2 = 0;
  let yyy3 = 0;
  let zzz1 = 0;
  let zzz2 = 0;
  let zzz3 = 0;
  let qqq1 = 0;
  let qqq2 = 0;
  let qqq3 = 0;
  let kkk1 = 0;
  let kkk2 = 0;
  let kkk3 = 0;

  for (const b of blocuri) {
    const bCpAr = str(b, 'CP_AR', 'cp_ar').toUpperCase();
    const bCpAc = str(b, 'CP_AC', 'cp_ac').toUpperCase();
    const bCpIn = str(b, 'CP_IN', 'cp_in').toUpperCase();

    ap8 += num(b, 'TOT_APART', 'tot_apart', 0);
    apte09 += num(b, 'AP_SAL_TE', 'ap_sal_te', 0);
    apabol09 += num(b, 'AP_ABON', 'ap_abon', 0);
    p18 += num(b, 'PERSOANE1', 'persoane1', 0);
    p28 += num(b, 'PERSOANE2', 'persoane2', 0);
    if (bCpAr === 'P') par8 += num(b, 'PERS_AR', 'pers_ar', 0);
    if (bCpAc === 'P') pac9 += num(b, 'PERS_ACD', 'pers_acd', 0);
    pad9 += num(b, 'PERS_ACX', 'pers_acx', 0);
    pgaz += num(b, 'PERSOANEG', 'persoaneg', 0);
    pgucu += num(b, 'PERSGU', 'persgu', 0);
    pcureSc += num(b, 'PCURENT_SC', 'pcurent_sc', 0);
    pcureLi += num(b, 'PCURENT_LI', 'pcurent_li', 0);
    psalfe += num(b, 'PER_SAL_FE', 'per_sal_fe', 0);
    s18 += num(b, 'SUPRAFATA1', 'suprafata1', 0);
    s28 += num(b, 'SUPRAFATA2', 'suprafata2', 0);
    if (bCpIn === 'P') slin9 += num(b, 'SL_INCD', 'sl_incd', 0);
    slabo8 += num(b, 'SL_ABON', 'sl_abon', 0);
    slsteo8 += num(b, 'SL_SALTE', 'sl_salte', 0);
    slsfeo8 += num(b, 'SL_SALFE', 'sl_salfe', 0);
    sldero8 += num(b, 'SL_CHSED', 'sl_chsed', 0);
    slchado8 += num(b, 'SL_CHADM', 'sl_chadm', 0);
    set8 += num(b, 'SUP_EC_TER', 'sup_ec_ter', 0);

    if (bCpAr === 'C') {
      yyy1 += num(b, 'APA_RECE', 'apa_rece', 0);
      yyy2 += num(b, 'ARAC', 'arac', 0);
    } else if (bCpAr === 'P') {
      yyy3 += num(b, 'ARAC', 'arac', 0);
    }

    if (bCpAc === 'C') {
      zzz1 += num(b, 'APA_CALDA', 'apa_calda', 0);
      zzz2 += num(b, 'ACAC', 'acac', 0);
      qqq1 += num(b, 'ETAC', 'etac', 0);
      qqq2 += num(b, 'ETACAC', 'etacac', 0);
    } else if (bCpAc === 'P') {
      zzz3 += num(b, 'ACAC', 'acac', 0);
      qqq3 += num(b, 'ETACAC', 'etacac', 0);
    }

    if (bCpIn === 'C') {
      kkk1 += num(b, 'INCALZIRE', 'incalzire', 0);
      kkk2 += num(b, 'ETINAC', 'etinac', 0);
    } else if (bCpIn === 'P') {
      kkk3 += num(b, 'ETINAC', 'etinac', 0);
    }
  }

  const pac8 = round0(pac9);
  const slin8 = round2(slin9);

  setBoth(asociatie, 'TOT_APART', 'tot_apart', ap8);
  setBoth(asociatie, 'AP_SAL_TE', 'ap_sal_te', apte09);
  setBoth(asociatie, 'AP_ABON', 'ap_abon', apabol09);
  setBoth(asociatie, 'PERSOANE1', 'persoane1', p18);
  setBoth(asociatie, 'PERSOANE2', 'persoane2', p28);
  setBoth(asociatie, 'PERS_AR', 'pers_ar', par8);
  setBoth(asociatie, 'PERS_AC', 'pers_ac', pac8);
  setBoth(asociatie, 'PERS_ACX', 'pers_acx', pad9);
  setBoth(asociatie, 'PERSGA', 'persga', pgaz);
  setBoth(asociatie, 'PERSGU', 'persgu', pgucu);
  setBoth(asociatie, 'PCURENT_SC', 'pcurent_sc', pcureSc);
  setBoth(asociatie, 'PCURENT_LI', 'pcurent_li', pcureLi);
  setBoth(asociatie, 'PER_SAL_FE', 'per_sal_fe', psalfe);
  setBoth(asociatie, 'SL_INC', 'sl_inc', slin8);
  setBoth(asociatie, 'SUPRAFATA1', 'suprafata1', round2(s18));
  setBoth(asociatie, 'SUPRAFATA2', 'suprafata2', round2(s28));
  setBoth(asociatie, 'SL_ABON', 'sl_abon', slabo8);
  setBoth(asociatie, 'SL_SALTE', 'sl_salte', slsteo8);
  setBoth(asociatie, 'SL_SALFE', 'sl_salfe', slsfeo8);
  setBoth(asociatie, 'SL_CHSED', 'sl_chsed', sldero8);
  setBoth(asociatie, 'SL_CHADM', 'sl_chadm', slchado8);
  setBoth(asociatie, 'SUP_EC_TER', 'sup_ec_ter', round2(set8));
  setBoth(asociatie, 'ARBC', 'arbc', round2(yyy1));
  setBoth(asociatie, 'ARACBC', 'aracbc', round2(yyy2));
  setBoth(asociatie, 'ARACBN', 'aracbn', round2(yyy3));
  setBoth(asociatie, 'ACBC', 'acbc', round2(zzz1));
  setBoth(asociatie, 'ACACBC', 'acacbc', round2(zzz2));
  setBoth(asociatie, 'ACACBN', 'acacbn', round2(zzz3));
  setBoth(asociatie, 'ETACBC', 'etacbc', round2(qqq1));
  setBoth(asociatie, 'ETACACBC', 'etacacbc', round2(qqq2));
  setBoth(asociatie, 'ETACACBN', 'etacacbn', round2(qqq3));
  setBoth(asociatie, 'ETINBC', 'etinbc', round2(kkk1));
  setBoth(asociatie, 'ETINACBC', 'etinacbc', round2(kkk2));
  setBoth(asociatie, 'ETINACBN', 'etinacbn', round2(kkk3));

  // Step 6: Block Water, Thermal & Differences DO CASE (SUM.PRG lines 322-465)
  const aApaRece = num(asociatie, 'APA_RECE', 'apa_rece', 0);
  const aArbc = num(asociatie, 'ARBC', 'arbc', 0);
  const aAracbn = num(asociatie, 'ARACBN', 'aracbn', 0);
  const aPersAr = num(asociatie, 'PERS_AR', 'pers_ar', 0);

  const aApaCalda = num(asociatie, 'APA_CALDA', 'apa_calda', 0);
  const aAcbc = num(asociatie, 'ACBC', 'acbc', 0);
  const aAcacbn = num(asociatie, 'ACACBN', 'acacbn', 0);
  const aPersAc = num(asociatie, 'PERS_AC', 'pers_ac', 0);

  const aEtac = num(asociatie, 'ETAC', 'etac', 0);
  const aEtacbc = num(asociatie, 'ETACBC', 'etacbc', 0);
  const aEtacacbn = num(asociatie, 'ETACACBN', 'etacacbn', 0);

  const aIncalzire = num(asociatie, 'INCALZIRE', 'incalzire', 0);
  const aEtinbc = num(asociatie, 'ETINBC', 'etinbc', 0);
  const aEtinacbn = num(asociatie, 'ETINACBN', 'etinacbn', 0);
  const aSlInc = num(asociatie, 'SL_INC', 'sl_inc', 0);

  const aGunoi = num(asociatie, 'GUNOI', 'gunoi', 0);
  const aPersGu = num(asociatie, 'PERSGU', 'persgu', 0);
  const aChAdmin = num(asociatie, 'CH_ADMIN', 'ch_admin', 0);
  const aSlChadm = num(asociatie, 'SL_CHADM', 'sl_chadm', 0);
  const aChSediu = num(asociatie, 'CH_SEDIU', 'ch_sediu', 0);
  const aSlChsed = num(asociatie, 'SL_CHSED', 'sl_chsed', 0);
  const aAbonament = num(asociatie, 'ABONAMENT', 'abonament', 0);
  const aSlAbon = num(asociatie, 'SL_ABON', 'sl_abon', 0);
  const aSalTesa = num(asociatie, 'SAL_TESA', 'sal_tesa', 0);
  const aSlSalte = num(asociatie, 'SL_SALTE', 'sl_salte', 0);
  const aSalFeme = num(asociatie, 'SAL_FEME', 'sal_feme', 0);
  const aSlSalfe = num(asociatie, 'SL_SALFE', 'sl_salfe', 0);
  const aPerSalFe = num(asociatie, 'PER_SAL_FE', 'per_sal_fe', 0);

  for (const b of blocuri) {
    const bCpAr = str(b, 'CP_AR', 'cp_ar').toUpperCase();
    const bCpAc = str(b, 'CP_AC', 'cp_ac').toUpperCase();
    const bCpIn = str(b, 'CP_IN', 'cp_in').toUpperCase();

    const totApart = num(b, 'TOT_APART', 'tot_apart', 0);
    const apcar = num(b, 'APCAR', 'apcar', 0);
    const apcac = num(b, 'APCAC', 'apcac', 0);
    const apcin = num(b, 'APCIN', 'apcin', 0);

    const bApaRece = num(b, 'APA_RECE', 'apa_rece', 0);
    const bArac = num(b, 'ARAC', 'arac', 0);
    const bApaCalda = num(b, 'APA_CALDA', 'apa_calda', 0);
    const bAcac = num(b, 'ACAC', 'acac', 0);
    const bEtac = num(b, 'ETAC', 'etac', 0);
    const bEtacac = num(b, 'ETACAC', 'etacac', 0);
    const bPersAr = num(b, 'PERS_AR', 'pers_ar', 0);
    const bPersAcd = num(b, 'PERS_ACD', 'pers_acd', 0);

    // Substep 6A: Cold & Hot Water Combinations (b.CP_AR, b.CP_AC)
    if (bCpAr === 'C' && bCpAc === 'P') {
      if (totApart === apcar) {
        const difAr = round2(bApaRece - bArac);
        const difCanAr = tarifAr === 0 ? 0 : round2((difAr / tarifAr) * (procCa / 100) * tarifCa);
        setBoth(b, 'DIFARAR', 'difarar', difAr);
        setBoth(b, 'DIFCANAR', 'difcanar', difCanAr);
        setBoth(b, 'APA_RECE', 'apa_rece', 0);
      } else {
        setBoth(b, 'DIFARAR', 'difarar', 0);
        setBoth(b, 'DIFCANAR', 'difcanar', 0);
        setBoth(b, 'APA_RECE', 'apa_rece', round2(bApaRece - bArac));
      }
      setBoth(b, 'DIFARAC', 'difarac', 0);
      setBoth(b, 'DIFCANAC', 'difcanac', 0);
      setBoth(b, 'DIFETAC', 'difetac', 0);
      setBoth(
        b,
        'APA_CALDA',
        'apa_calda',
        aPersAc === 0 ? 0 : round2(((aApaCalda - aAcbc - aAcacbn) / aPersAc) * bPersAcd)
      );
      setBoth(
        b,
        'ETAC',
        'etac',
        aPersAc === 0 ? 0 : round2(((aEtac - aEtacbc - aEtacacbn) / aPersAc) * bPersAcd)
      );
    } else if (bCpAr === 'P' && bCpAc === 'P') {
      setBoth(b, 'DIFARAR', 'difarar', 0);
      setBoth(b, 'DIFCANAR', 'difcanar', 0);
      setBoth(
        b,
        'APA_RECE',
        'apa_rece',
        aPersAr === 0 ? 0 : round2(((aApaRece - aArbc - aAracbn) / aPersAr) * bPersAr)
      );
      setBoth(b, 'DIFARAC', 'difarac', 0);
      setBoth(b, 'DIFCANAC', 'difcanac', 0);
      setBoth(b, 'DIFETAC', 'difetac', 0);
      setBoth(
        b,
        'APA_CALDA',
        'apa_calda',
        aPersAc === 0 ? 0 : round2(((aApaCalda - aAcbc - aAcacbn) / aPersAc) * bPersAcd)
      );
      setBoth(
        b,
        'ETAC',
        'etac',
        aPersAc === 0 ? 0 : round2(((aEtac - aEtacbc - aEtacacbn) / aPersAc) * bPersAcd)
      );
    } else if (bCpAr === 'P' && bCpAc === 'C') {
      setBoth(b, 'DIFARAR', 'difarar', 0);
      setBoth(b, 'DIFCANAR', 'difcanar', 0);
      setBoth(
        b,
        'APA_RECE',
        'apa_rece',
        aPersAr === 0 ? 0 : round2(((aApaRece - aArbc - aAracbn) / aPersAr) * bPersAr)
      );
      if (totApart === apcac) {
        const difEtAc = round2(bEtac - bEtacac);
        const difArAc = round2(bApaCalda - bAcac);
        const difCanAc = tarifAr === 0 ? 0 : round2((difArAc / tarifAr) * (procCa / 100) * tarifCa);
        setBoth(b, 'DIFETAC', 'difetac', difEtAc);
        setBoth(b, 'DIFARAC', 'difarac', difArAc);
        setBoth(b, 'DIFCANAC', 'difcanac', difCanAc);
        setBoth(b, 'APA_CALDA', 'apa_calda', 0);
        setBoth(b, 'ETAC', 'etac', 0);
      } else {
        setBoth(b, 'DIFARAC', 'difarac', 0);
        setBoth(b, 'DIFCANAC', 'difcanac', 0);
        setBoth(b, 'DIFETAC', 'difetac', 0);
        setBoth(b, 'APA_CALDA', 'apa_calda', round2(bApaCalda - bAcac));
        setBoth(b, 'ETAC', 'etac', round2(bEtac - bEtacac));
      }
    } else if (bCpAr === 'C' && bCpAc === 'C') {
      if (totApart === apcar && totApart !== apcac) {
        const difAr = round2(bApaRece - bArac);
        const difCanAr = tarifAr === 0 ? 0 : round2((difAr / tarifAr) * (procCa / 100) * tarifCa);
        setBoth(b, 'DIFARAR', 'difarar', difAr);
        setBoth(b, 'DIFCANAR', 'difcanar', difCanAr);
        setBoth(b, 'APA_RECE', 'apa_rece', 0);
        setBoth(b, 'DIFARAC', 'difarac', 0);
        setBoth(b, 'DIFCANAC', 'difcanac', 0);
        setBoth(b, 'DIFETAC', 'difetac', 0);
        setBoth(b, 'APA_CALDA', 'apa_calda', round2(bApaCalda - bAcac));
        setBoth(b, 'ETAC', 'etac', round2(bEtac - bEtacac));
      } else if (totApart === apcar && totApart === apcac) {
        const difAr = round2(bApaRece - bArac);
        const difCanAr = tarifAr === 0 ? 0 : round2((difAr / tarifAr) * (procCa / 100) * tarifCa);
        const difEtAc = round2(bEtac - bEtacac);
        const difArAc = round2(bApaCalda - bAcac);
        const difCanAc = tarifAr === 0 ? 0 : round2((difArAc / tarifAr) * (procCa / 100) * tarifCa);
        setBoth(b, 'DIFARAR', 'difarar', difAr);
        setBoth(b, 'DIFCANAR', 'difcanar', difCanAr);
        setBoth(b, 'APA_RECE', 'apa_rece', 0);
        setBoth(b, 'DIFETAC', 'difetac', difEtAc);
        setBoth(b, 'DIFARAC', 'difarac', difArAc);
        setBoth(b, 'DIFCANAC', 'difcanac', difCanAc);
        setBoth(b, 'APA_CALDA', 'apa_calda', 0);
        setBoth(b, 'ETAC', 'etac', 0);
      } else if (totApart !== apcar && totApart !== apcac) {
        setBoth(b, 'DIFARAR', 'difarar', 0);
        setBoth(b, 'DIFCANAR', 'difcanar', 0);
        setBoth(b, 'APA_RECE', 'apa_rece', round2(bApaRece - bArac));
        setBoth(b, 'DIFARAC', 'difarac', 0);
        setBoth(b, 'DIFCANAC', 'difcanac', 0);
        setBoth(b, 'DIFETAC', 'difetac', 0);
        setBoth(b, 'APA_CALDA', 'apa_calda', round2(bApaCalda - bAcac));
        setBoth(b, 'ETAC', 'etac', round2(bEtac - bEtacac));
      } else if (totApart !== apcar && totApart === apcac) {
        const difEtAc = round2(bEtac - bEtacac);
        const difArAc = round2(bApaCalda - bAcac);
        const difCanAc = tarifAr === 0 ? 0 : round2((difArAc / tarifAr) * (procCa / 100) * tarifCa);
        setBoth(b, 'DIFARAR', 'difarar', 0);
        setBoth(b, 'DIFCANAR', 'difcanar', 0);
        setBoth(b, 'APA_RECE', 'apa_rece', round2(bApaRece - bArac));
        setBoth(b, 'DIFETAC', 'difetac', difEtAc);
        setBoth(b, 'DIFARAC', 'difarac', difArAc);
        setBoth(b, 'DIFCANAC', 'difcanac', difCanAc);
        setBoth(b, 'APA_CALDA', 'apa_calda', 0);
        setBoth(b, 'ETAC', 'etac', 0);
      }
    }

    const curBApaRece = num(b, 'APA_RECE', 'apa_rece', 0);
    const curBApaCalda = num(b, 'APA_CALDA', 'apa_calda', 0);
    const canMnjArB = tarifAr === 0 ? 0 : round2((curBApaRece / tarifAr) * (procCa / 100) * tarifCa);
    const canMnjAcB = tarifAr === 0 ? 0 : round2((curBApaCalda / tarifAr) * (procCa / 100) * tarifCa);
    setBoth(b, 'CAN_MNJAR', 'can_mnjar', canMnjArB);
    setBoth(b, 'CAN_MNJAC', 'can_mnjac', canMnjAcB);
    setBoth(b, 'CAN_MNJ', 'can_mnj', round2(canMnjArB + canMnjAcB));

    // Substep 6B: Heating DO CASE on b.CP_IN
    const bIncalzire = num(b, 'INCALZIRE', 'incalzire', 0);
    const bEtinac = num(b, 'ETINAC', 'etinac', 0);
    const bProcIncCom = num(b, 'PROCINCCOM', 'procinccom', 0);
    const bSlIncd = num(b, 'SL_INCD', 'sl_incd', 0);
    const bSlInc = num(b, 'SL_INC', 'sl_inc', 0);

    if (bCpIn === 'C') {
      if (totApart === apcin) {
        setBoth(b, 'DIFETIN', 'difetin', round2(bIncalzire - bEtinac));
        setBoth(b, 'INCALZIRE', 'incalzire', 0);
      } else {
        setBoth(b, 'DIFETIN', 'difetin', 0);
        setBoth(b, 'INCALZIRE', 'incalzire', round2(bIncalzire - bEtinac));
      }
    } else if (bCpIn === 'P') {
      setBoth(b, 'DIFETIN', 'difetin', 0);
      const incAlloc =
        bSlInc === 0 || aSlInc === 0
          ? 0
          : round2(((aIncalzire - aEtinbc - aEtinacbn) / aSlInc) * bSlIncd);
      setBoth(b, 'INCALZIRE', 'incalzire', incAlloc);
    }

    const finalBInc = num(b, 'INCALZIRE', 'incalzire', 0);
    const incComun = round2((finalBInc * bProcIncCom) / 100);
    const incSupr = round2(finalBInc - incComun);
    setBoth(b, 'INCCOMUN', 'inccomun', incComun);
    setBoth(b, 'INCSUPR', 'incsupr', incSupr);

    // Substep 6C: Association Invoice Distribution to Blocks
    const bPersGu = num(b, 'PERSGU', 'persgu', 0);
    const bSlChadm = num(b, 'SL_CHADM', 'sl_chadm', 0);
    const bSlChsed = num(b, 'SL_CHSED', 'sl_chsed', 0);
    const bSlAbon = num(b, 'SL_ABON', 'sl_abon', 0);
    const bSlSalte = num(b, 'SL_SALTE', 'sl_salte', 0);
    const bSlSalfe = num(b, 'SL_SALFE', 'sl_salfe', 0);
    const bPerSalFe = num(b, 'PER_SAL_FE', 'per_sal_fe', 0);

    setBoth(b, 'GUNOI', 'gunoi', aPersGu === 0 ? 0 : round2((aGunoi / aPersGu) * bPersGu));
    setBoth(b, 'CH_ADMIN', 'ch_admin', aSlChadm === 0 ? 0 : round2((aChAdmin / aSlChadm) * bSlChadm));
    setBoth(b, 'CH_SEDIU', 'ch_sediu', aSlChsed === 0 ? 0 : round2((aChSediu / aSlChsed) * bSlChsed));
    setBoth(b, 'ABONAMENT', 'abonament', aSlAbon === 0 ? 0 : round2((aAbonament / aSlAbon) * bSlAbon));
    setBoth(b, 'SAL_TESA', 'sal_tesa', aSlSalte === 0 ? 0 : round2((aSalTesa / aSlSalte) * bSlSalte));
    if (hasSlSalFeField) {
      setBoth(b, 'SAL_FEME', 'sal_feme', aSlSalfe === 0 ? 0 : round2((aSalFeme / aSlSalfe) * bSlSalfe));
    } else {
      setBoth(b, 'SAL_FEME', 'sal_feme', aPerSalFe === 0 ? 0 : round2((aSalFeme / aPerSalFe) * bPerSalFe));
    }
  }

  // Step 7: Final Apartment Charges (SUM.PRG lines 473-561)
  for (const b of blocuri) {
    const bCode = getBlockCode(b).toUpperCase();
    const bApts = apartamente.filter(c => getAptBlockCode(c, blocMapById).toUpperCase() === bCode);

    const bPersAc = num(b, 'PERS_AC', 'pers_ac', 0);
    const bPersAr = num(b, 'PERS_AR', 'pers_ar', 0);
    const bEtac = num(b, 'ETAC', 'etac', 0);
    const bApaCalda = num(b, 'APA_CALDA', 'apa_calda', 0);
    const bApaRece = num(b, 'APA_RECE', 'apa_rece', 0);

    const modrDifin = str(b, 'MODR_DIFIN', 'modr_difin').toUpperCase();
    const bDifetin = num(b, 'DIFETIN', 'difetin', 0);
    const bSlDifin = num(b, 'SL_DIFIN', 'sl_difin', 0);
    const bSetDifin = num(b, 'SET_DIFIN', 'set_difin', 0);
    const bEtinac = num(b, 'ETINAC', 'etinac', 0);
    const bProcAvIn = num(b, 'PROC_AV_IN', 'proc_av_in', 0);

    const modRInc = str(b, 'MOD_R_INC', 'mod_r_inc').toUpperCase();
    const bIncrap = num(b, 'INCRAP', 'incrap', 0);
    const bInccomun = num(b, 'INCCOMUN', 'inccomun', 0);
    const bIncsupr = num(b, 'INCSUPR', 'incsupr', 0);
    const bSuprafata1 = num(b, 'SUPRAFATA1', 'suprafata1', 0);
    const bSlInc = num(b, 'SL_INC', 'sl_inc', 0);
    const bSetComun = num(b, 'SET_COMUN', 'set_comun', 0);
    const bSupEcTer = num(b, 'SUP_EC_TER', 'sup_ec_ter', 0);

    const modRDif = str(b, 'MOD_R_DIF', 'mod_r_dif').toUpperCase();
    const bApdifar = num(b, 'APDIFAR', 'apdifar', 0);
    const bApdifac = num(b, 'APDIFAC', 'apdifac', 0);
    const bArdifer = num(b, 'ARDIFER', 'ardifer', 0);
    const bAcdifer = num(b, 'ACDIFER', 'acdifer', 0);
    const bPerdifar = num(b, 'PERDIFAR', 'perdifar', 0);
    const bPerdifac = num(b, 'PERDIFAC', 'perdifac', 0);
    const bDifarar = num(b, 'DIFARAR', 'difarar', 0);
    const bDifcanar = num(b, 'DIFCANAR', 'difcanar', 0);
    const bDifarac = num(b, 'DIFARAC', 'difarac', 0);
    const bDifcanac = num(b, 'DIFCANAC', 'difcanac', 0);
    const bDifetac = num(b, 'DIFETAC', 'difetac', 0);
    const bProcAvAc = num(b, 'PROC_AV_AC', 'proc_av_ac', 0);

    const bSuprafata2 = num(b, 'SUPRAFATA2', 'suprafata2', 0);
    const bCanMet = num(b, 'CAN_MET', 'can_met', 0);
    const bPersoaneG = num(b, 'PERSOANEG', 'persoaneg', 0);
    const bGaz = num(b, 'GAZ', 'gaz', 0);

    const modRAsc = str(b, 'MOD_R_ASC', 'mod_r_asc').toUpperCase();
    const bAscensor = num(b, 'ASCENSOR', 'ascensor', 0);
    const bPascens = num(b, 'PASCENS', 'pascens', 0);
    const bApascen = num(b, 'APASCEN', 'apascen', 0);
    const bSlAscen = num(b, 'SL_ASCEN', 'sl_ascen', 0);

    const bGunoi = num(b, 'GUNOI', 'gunoi', 0);
    const bPersGu = num(b, 'PERSGU', 'persgu', 0);
    const bProcGunoi = num(b, 'PROCGUNOI', 'procgunoi', 0);

    const bCurentSc = num(b, 'CURENT_SC', 'curent_sc', 0);
    const bPcurentSc = num(b, 'PCURENT_SC', 'pcurent_sc', 0);
    const bCurentLi = num(b, 'CURENT_LI', 'curent_li', 0);
    const bPcurentLi = num(b, 'PCURENT_LI', 'pcurent_li', 0);

    const bChAdmin = num(b, 'CH_ADMIN', 'ch_admin', 0);
    const bSlChadm = num(b, 'SL_CHADM', 'sl_chadm', 0);
    const bProcChadm = num(b, 'PROC_CHADM', 'proc_chadm', 0);

    const bChSediu = num(b, 'CH_SEDIU', 'ch_sediu', 0);
    const bSlChsed = num(b, 'SL_CHSED', 'sl_chsed', 0);
    const bProcChsed = num(b, 'PROC_CHSED', 'proc_chsed', 0);

    const bPrestServ = num(b, 'PREST_SERV', 'prest_serv', 0);
    const bSlPresse = num(b, 'SL_PRESSE', 'sl_presse', 0);

    const bAbonament = num(b, 'ABONAMENT', 'abonament', 0);
    const bSlAbon = num(b, 'SL_ABON', 'sl_abon', 0);
    const bProcAbona = num(b, 'PROC_ABONA', 'proc_abona', 0);

    const bCotaFr = num(b, 'COTA_FR', 'cota_fr', 0);
    const bCheltInc = num(b, 'CHELT_INC', 'chelt_inc', 0);

    const bSalTesa = num(b, 'SAL_TESA', 'sal_tesa', 0);
    const bSlSalte = num(b, 'SL_SALTE', 'sl_salte', 0);
    const bProcSalT = num(b, 'PROC_SAL_T', 'proc_sal_t', num(b, 'PROC_SAL_TE', 'proc_sal_te', 0));

    const bSalFeme = num(b, 'SAL_FEME', 'sal_feme', 0);
    const bSlSalfe = num(b, 'SL_SALFE', 'sl_salfe', 0);
    const bPerSalFe = num(b, 'PER_SAL_FE', 'per_sal_fe', 0);
    const bProcSalF = num(b, 'PROC_SAL_F', 'proc_sal_f', num(b, 'PROC_SAL_FE', 'proc_sal_fe', 0));

    for (const c of bApts) {
      const cpAr = str(c, 'CP_AR', 'cp_ar').toUpperCase();
      const cpAc = str(c, 'CP_AC', 'cp_ac').toUpperCase();

      const pers1 = num(c, 'PERSOANE', 'persoane', 0) - num(c, 'P1_SCAZ', 'p1_scaz', 0);
      const sup = num(c, 'SUPRAFATA', 'suprafata', 0);
      const effSl1 = sup - num(c, 'SL1_SCAZ', 'sl1_scaz', 0);
      const effSl2 = sup - num(c, 'SL2_SCAZ', 'sl2_scaz', 0);
      const effSet = num(c, 'SUP_EC_TER', 'sup_ec_ter', 0) - num(c, 'SET_SCAZ', 'set_scaz', 0);

      const cProcAvAc = num(c, 'PROC_AV_AC', 'proc_av_ac', 0);
      const cProcAvIn = num(c, 'PROC_AV_IN', 'proc_av_in', 0);
      const cProcDifin = num(c, 'PROC_DIFIN', 'proc_difin', 0);
      const cProcDifer = num(c, 'PROC_DIFER', 'proc_difer', 0);
      const cProcG = num(c, 'PROCG', 'procg', 0);
      const cProcAscens = num(c, 'PROCASCENS', 'procascens', 0);
      const cProcGunoi = num(c, 'PROCGUNOI', 'procgunoi', 0);
      const cProcCuSc = num(c, 'PROC_CU_SC', 'proc_cu_sc', 0);
      const cProcCuLi = num(c, 'PROC_CU_LI', 'proc_cu_li', 0);
      const cProcChadm = num(c, 'PROC_CHADM', 'proc_chadm', 0);
      const cProcChsed = num(c, 'PROC_CHSED', 'proc_chsed', 0);
      const cPPresServ = num(c, 'P_PRESSERV', 'p_presserv', 0);
      const cProcAbona = num(c, 'PROC_ABONA', 'proc_abona', 0);
      const cProcSalTe = num(c, 'PROC_SAL_TE', 'proc_sal_te', num(c, 'PROC_SAL_T', 'proc_sal_t', 0));
      const cProcSalFe = num(c, 'PROC_SAL_FE', 'proc_sal_fe', num(c, 'PROC_SAL_F', 'proc_sal_f', 0));

      const cArra = num(c, 'ARRA', 'arra', 0);
      const cArca = num(c, 'ARCA', 'arca', 0);

      // 7.1 Water for Flat-Rate Apartments
      if (cpAr === 'C' && cpAc === 'P') {
        const apaCalda = bPersAc === 0 ? 0 : round2((bEtac / bPersAc) * pers1 * cProcAvAc * 0.01);
        const apaRece = round2(
          cArra + (bPersAc === 0 ? 0 : round2((bApaCalda / bPersAc) * pers1 * cProcAvAc * 0.01))
        );
        const canMnj = tarifAr === 0 ? 0 : round2((apaRece / tarifAr) * (procCa / 100) * tarifCa);
        setBoth(c, 'APA_CALDA', 'apa_calda', apaCalda);
        setBoth(c, 'APA_RECE', 'apa_rece', apaRece);
        setBoth(c, 'CAN_MNJ', 'can_mnj', canMnj);
      } else if (cpAr === 'P' && cpAc === 'P') {
        const apaCalda = bPersAc === 0 ? 0 : round2((bEtac / bPersAc) * pers1 * cProcAvAc * 0.01);
        const partAr = bPersAr === 0 ? 0 : round2((bApaRece / bPersAr) * pers1);
        const partAc = bPersAc === 0 ? 0 : round2((bApaCalda / bPersAc) * pers1 * cProcAvAc * 0.01);
        const apaRece = round2(partAr + partAc);
        const canMnj = tarifAr === 0 ? 0 : round2((apaRece / tarifAr) * (procCa / 100) * tarifCa);
        setBoth(c, 'APA_CALDA', 'apa_calda', apaCalda);
        setBoth(c, 'APA_RECE', 'apa_rece', apaRece);
        setBoth(c, 'CAN_MNJ', 'can_mnj', canMnj);
      } else if (cpAr === 'P' && cpAc === 'C') {
        const partAr = bPersAr === 0 ? 0 : round2((bApaRece / bPersAr) * pers1);
        const apaRece = round2(cArca + partAr);
        const canMnj = tarifAr === 0 ? 0 : round2((apaRece / tarifAr) * (procCa / 100) * tarifCa);
        setBoth(c, 'APA_RECE', 'apa_rece', apaRece);
        setBoth(c, 'CAN_MNJ', 'can_mnj', canMnj);
      }

      // 7.2 Heating Differences (DIFETIN) by MODR_DIFIN
      const curIncalzire = num(c, 'INCALZIRE', 'incalzire', 0);
      if (modrDifin === 'SL') {
        setBoth(
          c,
          'DIFETIN',
          'difetin',
          bSlDifin === 0 ? 0 : round2((bDifetin / bSlDifin) * effSl1 * (cProcDifin / 100))
        );
      } else if (modrDifin === 'SET') {
        setBoth(
          c,
          'DIFETIN',
          'difetin',
          bSetDifin === 0 ? 0 : round2((bDifetin / bSetDifin) * effSet * (cProcDifin / 100))
        );
      } else if (modrDifin === 'CNS') {
        setBoth(
          c,
          'DIFETIN',
          'difetin',
          bEtinac === 0 ? 0 : round2((bDifetin / bEtinac) * curIncalzire * cProcAvIn * 0.01 * bProcAvIn * 0.01)
        );
      }

      // 7.3 Heating Flat-Rate (when b.INCRAP = 0) by MOD_R_INC
      if (modRInc === 'SL') {
        if (bIncrap === 0) {
          const commonShare = bSuprafata1 === 0 ? 0 : (bInccomun / bSuprafata1) * effSl1;
          const indivShare = bSlInc === 0 ? 0 : round2((bIncsupr / bSlInc) * effSl1 * cProcAvIn * 0.01);
          setBoth(c, 'INCALZIRE', 'incalzire', round2(curIncalzire + commonShare + indivShare));
        }
      } else if (modRInc === 'SET') {
        if (bIncrap === 0) {
          const commonShare = bSetComun === 0 ? 0 : (bInccomun / bSetComun) * effSet;
          const indivShare = bSupEcTer === 0 ? 0 : round2((bIncsupr / bSupEcTer) * effSet * cProcAvIn * 0.01);
          setBoth(c, 'INCALZIRE', 'incalzire', round2(curIncalzire + commonShare + indivShare));
        }
      }

      // 7.4 Water Differences by MOD_R_DIF
      if (modRDif === 'APT') {
        setBoth(c, 'DIFARAR', 'difarar', bApdifar === 0 ? 0 : round2((bDifarar / bApdifar) * (cProcDifer / 100)));
        setBoth(c, 'DIFCANAR', 'difcanar', bApdifar === 0 ? 0 : round2((bDifcanar / bApdifar) * (cProcDifer / 100)));
        setBoth(
          c,
          'DIFARAC',
          'difarac',
          bApdifac === 0
            ? 0
            : round2((bDifarac / bApdifac) * (cProcAvAc / 100) * (bProcAvAc / 100) * (cProcDifer / 100))
        );
        setBoth(
          c,
          'DIFCANAC',
          'difcanac',
          bApdifac === 0
            ? 0
            : round2((bDifcanac / bApdifac) * (cProcAvAc / 100) * (bProcAvAc / 100) * (cProcDifer / 100))
        );
        setBoth(
          c,
          'DIFETAC',
          'difetac',
          bApdifac === 0
            ? 0
            : round2((bDifetac / bApdifac) * (cProcAvAc / 100) * (bProcAvAc / 100) * (cProcDifer / 100))
        );
      } else if (modRDif === 'CNS') {
        setBoth(
          c,
          'DIFARAR',
          'difarar',
          bArdifer === 0 ? 0 : round2((bDifarar / bArdifer) * cArra * (cProcDifer / 100))
        );
        setBoth(
          c,
          'DIFCANAR',
          'difcanar',
          bArdifer === 0 ? 0 : round2((bDifcanar / bArdifer) * cArra * (cProcDifer / 100))
        );
        setBoth(
          c,
          'DIFARAC',
          'difarac',
          bAcdifer === 0 ? 0 : round2((bDifarac / bAcdifer) * cArca * (cProcDifer / 100))
        );
        setBoth(
          c,
          'DIFCANAC',
          'difcanac',
          bAcdifer === 0 ? 0 : round2((bDifcanac / bAcdifer) * cArca * (cProcDifer / 100))
        );
        setBoth(
          c,
          'DIFETAC',
          'difetac',
          bAcdifer === 0 ? 0 : round2((bDifetac / bAcdifer) * cArca * (cProcDifer / 100))
        );
      } else if (modRDif === 'PER') {
        setBoth(
          c,
          'DIFARAR',
          'difarar',
          bPerdifar === 0 ? 0 : round2((bDifarar / bPerdifar) * pers1 * cProcDifer * 0.01)
        );
        setBoth(
          c,
          'DIFCANAR',
          'difcanar',
          bPerdifar === 0 ? 0 : round2((bDifcanar / bPerdifar) * pers1 * cProcDifer * 0.01)
        );
        setBoth(
          c,
          'DIFARAC',
          'difarac',
          bPerdifac === 0
            ? 0
            : round2((bDifarac / bPerdifac) * pers1 * cProcAvAc * 0.01 * bProcAvAc * 0.01 * cProcDifer * 0.01)
        );
        setBoth(
          c,
          'DIFCANAC',
          'difcanac',
          bPerdifac === 0
            ? 0
            : round2((bDifcanac / bPerdifac) * pers1 * cProcAvAc * 0.01 * bProcAvAc * 0.01 * cProcDifer * 0.01)
        );
        setBoth(
          c,
          'DIFETAC',
          'difetac',
          bPerdifac === 0
            ? 0
            : round2((bDifetac / bPerdifac) * pers1 * cProcAvAc * 0.01 * bProcAvAc * 0.01 * cProcDifer * 0.01)
        );
      }

      // 7.5 Rain Water (CAN_MET)
      setBoth(c, 'CAN_MET', 'can_met', bSuprafata2 === 0 ? 0 : round2((bCanMet / bSuprafata2) * effSl2));

      // 7.6 Gas (GAZ)
      setBoth(c, 'GAZ', 'gaz', bPersoaneG === 0 ? 0 : round2((bGaz / bPersoaneG) * pers1 * (cProcG / 100)));

      // 7.7 Elevator (ASCENSOR) by MOD_R_ASC
      if (modRAsc === 'PER') {
        setBoth(
          c,
          'ASCENSOR',
          'ascensor',
          bPascens === 0 ? 0 : round2((bAscensor / bPascens) * pers1 * (cProcAscens / 100))
        );
      } else if (modRAsc === 'APT') {
        setBoth(
          c,
          'ASCENSOR',
          'ascensor',
          bApascen === 0 ? 0 : round2((bAscensor / bApascen) * (cProcAscens / 100))
        );
      } else {
        setBoth(
          c,
          'ASCENSOR',
          'ascensor',
          bSlAscen === 0 ? 0 : round2((bAscensor / bSlAscen) * sup * (cProcAscens / 100))
        );
      }

      // 7.8 Garbage (GUNOI)
      setBoth(
        c,
        'GUNOI',
        'gunoi',
        bPersGu === 0 ? 0 : round2((bGunoi / bPersGu) * pers1 * (cProcGunoi / 100) * (bProcGunoi / 100))
      );

      // 7.9 Staircase & Elevator Electricity (CURENT_SC, CURENT_LI, CURENT)
      const curentSc = bPcurentSc === 0 ? 0 : round2((bCurentSc / bPcurentSc) * pers1 * (cProcCuSc / 100));
      const curentLi = bPcurentLi === 0 ? 0 : round2((bCurentLi / bPcurentLi) * pers1 * (cProcCuLi / 100));
      const curent = round2(curentSc + curentLi);
      setBoth(c, 'CURENT_SC', 'curent_sc', curentSc);
      setBoth(c, 'CURENT_LI', 'curent_li', curentLi);
      setBoth(c, 'CURENT', 'curent', curent);

      // 7.10 Administrative Expenses & Salaries
      setBoth(
        c,
        'CH_ADMIN',
        'ch_admin',
        bSlChadm === 0 || bProcChadm === 0
          ? 0
          : round2((bChAdmin / (bSlChadm / (bProcChadm * 0.01))) * sup * (cProcChadm / 100))
      );
      setBoth(
        c,
        'CH_SEDIU',
        'ch_sediu',
        bSlChsed === 0 || bProcChsed === 0
          ? 0
          : round2((bChSediu / (bSlChsed / (bProcChsed * 0.01))) * sup * (cProcChsed / 100))
      );
      setBoth(
        c,
        'PREST_SERV',
        'prest_serv',
        bSlPresse === 0 ? 0 : round2((bPrestServ / bSlPresse) * sup * (cPPresServ / 100))
      );
      setBoth(
        c,
        'ABONAMENT',
        'abonament',
        bSlAbon === 0 || bProcAbona === 0
          ? 0
          : round2((bAbonament / (bSlAbon / (bProcAbona * 0.01))) * sup * (cProcAbona / 100))
      );

      const calcFr = num(c, 'CALC_FR', 'calc_fr', 0);
      const maxFr = num(c, 'MAX_FR', 'max_fr', 0);
      setBoth(c, 'RULMENT', 'rulment', calcFr >= maxFr ? 0 : round2(bCotaFr));

      setBoth(
        c,
        'CHELT_INC',
        'chelt_inc',
        bSlInc === 0 ? 0 : round2((bCheltInc / bSlInc) * effSl1 * cProcAvIn * 0.01)
      );
      setBoth(
        c,
        'SAL_TESA',
        'sal_tesa',
        bSlSalte === 0 || bProcSalT === 0
          ? 0
          : round2((bSalTesa / (bSlSalte / (bProcSalT * 0.01))) * sup * (cProcSalTe / 100))
      );

      if (hasSlSalFeField) {
        setBoth(
          c,
          'SAL_FEME',
          'sal_feme',
          bSlSalfe === 0 || bProcSalF === 0
            ? 0
            : round2((bSalFeme / (bSlSalfe / (bProcSalF * 0.01))) * sup * (cProcSalFe / 100))
        );
      } else {
        setBoth(
          c,
          'SAL_FEME',
          'sal_feme',
          bPerSalFe === 0 || bProcSalF === 0
            ? 0
            : round2((bSalFeme / (bPerSalFe / (bProcSalF * 0.01))) * pers1 * (cProcSalFe / 100))
        );
      }

      // Ensure manual charges have normalized keys
      const chBox = round2(num(c, 'CH_BOX', 'ch_box', 0));
      const chHav = round2(num(c, 'CH_HAV', 'ch_hav', 0));
      const reparCrt = round2(num(c, 'REPAR_CRT', 'repar_crt', 0));
      const altele = round2(num(c, 'ALTELE', 'altele', 0));
      const colI = round2(num(c, 'I', 'i', 0));
      const fondRepar = round2(num(c, 'FOND_REPAR', 'fond_repar', 0));

      setBoth(c, 'CH_BOX', 'ch_box', chBox);
      setBoth(c, 'CH_HAV', 'ch_hav', chHav);
      setBoth(c, 'REPAR_CRT', 'repar_crt', reparCrt);
      setBoth(c, 'ALTELE', 'altele', altele);
      setBoth(c, 'I', 'i', colI);
      setBoth(c, 'FOND_REPAR', 'fond_repar', fondRepar);

      // Compute TRE.PRG Category R (TOTAL_REGIE / total_intretinere) and TOTAL_LUNA
      const totalRegie = round2(
        num(c, 'APA_RECE', 'apa_rece', 0) +
        num(c, 'CAN_MNJ', 'can_mnj', 0) +
        num(c, 'CAN_MET', 'can_met', 0) +
        num(c, 'APA_CALDA', 'apa_calda', 0) +
        num(c, 'INCALZIRE', 'incalzire', 0) +
        num(c, 'GAZ', 'gaz', 0) +
        num(c, 'GUNOI', 'gunoi', 0) +
        num(c, 'CURENT', 'curent', 0) +
        num(c, 'ASCENSOR', 'ascensor', 0) +
        num(c, 'CH_ADMIN', 'ch_admin', 0) +
        num(c, 'CH_SEDIU', 'ch_sediu', 0) +
        num(c, 'PREST_SERV', 'prest_serv', 0) +
        altele +
        colI +
        reparCrt +
        num(c, 'DIFARAR', 'difarar', 0) +
        num(c, 'DIFARAC', 'difarac', 0) +
        num(c, 'DIFCANAR', 'difcanar', 0) +
        num(c, 'DIFCANAC', 'difcanac', 0) +
        num(c, 'DIFETAC', 'difetac', 0) +
        num(c, 'DIFETIN', 'difetin', 0) +
        chBox +
        chHav +
        num(c, 'ABONAMENT', 'abonament', 0) +
        num(c, 'CHELT_INC', 'chelt_inc', 0) +
        num(c, 'SAL_FEME', 'sal_feme', 0) +
        num(c, 'SAL_TESA', 'sal_tesa', 0)
      );
      const rulment = num(c, 'RULMENT', 'rulment', 0);
      const totalLuna = round2(totalRegie + rulment + fondRepar);

      setBoth(c, 'TOTAL_REGIE', 'total_regie', totalRegie);
      setBoth(c, 'TOTAL_INTRETINERE', 'total_intretinere', totalRegie);
      setBoth(c, 'TOTAL_LUNA', 'total_luna', totalLuna);
    }
  }

  return {
    period: general,
    general,
    asociatie,
    blocuri,
    apartamente
  };
}

module.exports = {
  calculatePeriod,
  computeMonthlyCharges: calculatePeriod,
  computePeriod: calculatePeriod,
  expireReductions,
  parseCalendarDate,
  computeAllocators,
  round0,
  round2,
  round4,
  round8,
  roundFox
};
