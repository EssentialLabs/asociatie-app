/**
 * engine/cre.js
 *
 * Pure implementation of FoxPro CRE.PRG ("Calcul repartitoare căldură").
 * Loop 1: Computes TOT_UNIT for CP_IN='R' apartments across 7 radiators,
 *         finds maximum specific consumption GHP, and imposes it on CP_IN='P' apartments.
 * Loop 2: Splits block thermal energy (Gcal) into common (PROCINCCOM%) and individual shares,
 *         computes GPU & GPS (rounded to 8 decimals), and updates apartment GCAL_UNIT,
 *         GCAL_MP, GCAL_FINAL, IVIN=0, ININ=GCAL_FINAL, CONSTIN=1.
 */

const { round4, round8 } = require('./round');

function num(obj, upperKey, lowerKey, fallback = 0) {
  const v = obj[upperKey] !== undefined ? obj[upperKey] : obj[lowerKey];
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function str(obj, upperKey, lowerKey, fallback = '') {
  const v = obj[upperKey] !== undefined ? obj[upperKey] : obj[lowerKey];
  if (v === null || v === undefined) return fallback;
  return String(v).trim();
}

function setBoth(obj, upperKey, lowerKey, value) {
  obj[lowerKey] = value;
  obj[upperKey] = value;
}

/**
 * Pure function computing heat cost allocators (CRE.PRG).
 * @param {Object} input - { blocuri, apartamente }
 * @param {Object} [options] - { onlyBlocksWithAllocators: false }
 */
function computeAllocators(input, options = {}) {
  const blocuri = (input?.blocuri || []).map(b => ({ ...b }));
  const apartamente = (input?.apartamente || []).map(a => ({ ...a }));
  const onlyBlocksWithAllocators = Boolean(options.onlyBlocksWithAllocators);

  const blockDiagnostics = {};

  // Loop 1: Unit Consumption & Flat-Rate Imposition
  for (const b of blocuri) {
    const bCode = str(b, 'BLOC', 'bloc') || str(b, 'NUMAR', 'numar');
    const bApts = apartamente.filter(a => {
      const aBloc = str(a, 'BLOC', 'bloc') || String(a.bloc_id ?? '');
      return aBloc === bCode || (b.id !== undefined && a.bloc_id === b.id);
    });

    const rApts = bApts.filter(a => str(a, 'CP_IN', 'cp_in').toUpperCase() === 'R');
    const erfg = rApts.length;

    let ghp = 0;
    if (erfg > 0) {
      for (const c of rApts) {
        let sumUnits = 0;
        for (let k = 1; k <= 7; k++) {
          const inR = num(c, `IN_R${k}`, `in_r${k}`, 0);
          const ivR = num(c, `IV_R${k}`, `iv_r${k}`, 0);
          const factTr = num(c, `FACTTR_R${k}`, `facttr_r${k}`, 0);
          const coefSp = num(c, `COEFSP_R${k}`, `coefsp_r${k}`, 0);
          sumUnits += (inR - ivR) * factTr * coefSp;
        }
        const totUnit = round4(sumUnits);
        setBoth(c, 'TOT_UNIT', 'tot_unit', totUnit);

        const sup = num(c, 'SUPRAFATA', 'suprafata', 0);
        const sl1Scaz = num(c, 'SL1_SCAZ', 'sl1_scaz', 0);
        const procAvIn = num(c, 'PROC_AV_IN', 'proc_av_in', 100);
        const effSup = (sup - sl1Scaz) * (procAvIn / 100);
        if (effSup > 0) {
          const spec = totUnit / effSup;
          if (spec > ghp) ghp = spec;
        }
      }

      const pApts = bApts.filter(a => str(a, 'CP_IN', 'cp_in').toUpperCase() === 'P');
      for (const c of pApts) {
        const sup = num(c, 'SUPRAFATA', 'suprafata', 0);
        const sl1Scaz = num(c, 'SL1_SCAZ', 'sl1_scaz', 0);
        const procAvIn = num(c, 'PROC_AV_IN', 'proc_av_in', 100);
        const imposed = ghp * ((sup - sl1Scaz) * (procAvIn / 100));
        setBoth(c, 'TOT_UNIT', 'tot_unit', imposed);
      }
    }

    blockDiagnostics[bCode] = { erfg, ghp };
  }

  // Loop 2: Energy Split and Apartment Gcal Conversion
  for (const b of blocuri) {
    const bCode = str(b, 'BLOC', 'bloc') || str(b, 'NUMAR', 'numar');
    const bApts = apartamente.filter(a => {
      const aBloc = str(a, 'BLOC', 'bloc') || String(a.bloc_id ?? '');
      return aBloc === bCode || (b.id !== undefined && a.bloc_id === b.id);
    });

    const diag = blockDiagnostics[bCode] || { erfg: 0, ghp: 0 };
    if (onlyBlocksWithAllocators && diag.erfg === 0) {
      continue;
    }

    const procIncCom = num(b, 'PROCINCCOM', 'procincccom', num(b, 'PROCINCCOM', 'procinccom', 0));
    const ininB = num(b, 'ININ', 'inin', 0);
    const ivinB = num(b, 'IVIN', 'ivin', 0);
    const constinB = num(b, 'CONSTIN', 'constin', 1);

    const cc = round8(procIncCom / 100);
    const dd = round8((ininB - ivinB) * constinB);
    const ee = round8(dd * cc);
    const ff = dd - ee;

    const nonCApts = bApts.filter(a => str(a, 'CP_IN', 'cp_in').toUpperCase() !== 'C');

    let tuni = 0;
    let tsuprt = 0;
    for (const c of nonCApts) {
      tuni += num(c, 'TOT_UNIT', 'tot_unit', 0);
      const sup = num(c, 'SUPRAFATA', 'suprafata', 0);
      const sl1Scaz = num(c, 'SL1_SCAZ', 'sl1_scaz', 0);
      tsuprt += (sup - sl1Scaz);
    }

    const tsup = round8(tsuprt);
    const gpu = tuni === 0 ? 0 : round8(ff / tuni);
    const gps = tsup === 0 ? 0 : round8(ee / tsup);

    for (const c of nonCApts) {
      const totUnit = num(c, 'TOT_UNIT', 'tot_unit', 0);
      const sup = num(c, 'SUPRAFATA', 'suprafata', 0);
      const sl1Scaz = num(c, 'SL1_SCAZ', 'sl1_scaz', 0);
      const gcalRed = num(c, 'GCAL_RED', 'gcal_red', 0);

      const gcalUnit = round4(gpu * totUnit);
      const gcalMp = round4(gps * (sup - sl1Scaz));
      const gcalFinal = round4(gcalUnit + gcalMp + gcalRed);

      setBoth(c, 'GCAL_UNIT', 'gcal_unit', gcalUnit);
      setBoth(c, 'GCAL_MP', 'gcal_mp', gcalMp);
      setBoth(c, 'GCAL_FINAL', 'gcal_final', gcalFinal);
      setBoth(c, 'IVIN', 'ivin', 0);
      setBoth(c, 'ININ', 'inin', gcalFinal);
      setBoth(c, 'CONSTIN', 'constin', 1);
    }

    blockDiagnostics[bCode] = {
      ...diag,
      cc,
      dd,
      ee,
      ff,
      tuni: round4(tuni),
      tsup,
      gpu,
      gps
    };
  }

  return {
    ...input,
    blocuri,
    apartamente,
    diagnostics: blockDiagnostics
  };
}

module.exports = {
  computeAllocators
};
