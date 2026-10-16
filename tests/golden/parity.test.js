/**
 * tests/golden/parity.test.js
 * 
 * Golden-Month Mathematical Parity Test Harness.
 * Verifies mathematical parity between FoxPro legacy calculation engine output and
 * the new Node.js calculation engine across historical and active monthly datasets.
 * 
 * Source: ORIGINAL_REQUEST.md (Acceptance Criteria), TEST_INFRA.md (Feature 8).
 * Datasets:
 * - Active baseline: G:\INCASOR\INCASARI\DATE\ANI_LUNI\2026\SEPTEMBR
 * - Winter heating month: G:\INCASOR\INCASARI\DATE\ANI_LUNI\2006\IANUARIE
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { readDbf } = require('../helpers/dbf_reader');

const BASE_DATA_DIR = 'G:\\INCASOR\\INCASARI\\DATE\\ANI_LUNI';

/**
 * Loads golden-month data directly from legacy DBF files.
 * @param {string|number} year
 * @param {string} monthName
 * @returns {{
 *   general: Object,
 *   asociatie: Object,
 *   blocuri: Array<Object>,
 *   apartamente: Array<Object>
 * }}
 */
function loadGoldenMonth(year, monthName) {
  const dir = path.join(BASE_DATA_DIR, String(year), monthName);
  if (!fs.existsSync(dir)) {
    throw new Error(`Golden month directory not found: ${dir}`);
  }

  const general = readDbf(path.join(dir, 'GENERAL.DBF')).records[0] || {};
  const asociatie = readDbf(path.join(dir, 'ASOC.DBF')).records[0] || {};
  const blocuri = readDbf(path.join(dir, 'BLOCURI.DBF')).records;
  const apartamente = readDbf(path.join(dir, 'APART.DBF')).records;

  return { general, asociatie, blocuri, apartamente };
}

/**
 * Canonical half-away-from-zero 2-decimal rounding matching FoxPro ROUND(x, 2)
 */
function round2(val) {
  if (val === null || val === undefined || isNaN(val)) return 0;
  return Number((Math.round(val + 'e+2') + 'e-2'));
}

/**
 * Canonical half-away-from-zero 4-decimal rounding matching FoxPro ROUND(x, 4)
 */
function round4(val) {
  if (val === null || val === undefined || isNaN(val)) return 0;
  return Number((Math.round(val + 'e+4') + 'e-4'));
}

/**
 * Validates calculation engine output against golden DBF vectors within tolerance.
 * @param {Object} engineOutput
 * @param {Object} golden
 * @param {number} tolerance Max allowed difference in RON (default 0.01)
 * @returns {{ passed: boolean, diffs: Array<Object> }}
 */
function verifyEngineAgainstGolden(engineOutput, golden, tolerance = 0.01) {
  const diffs = [];

  if (!engineOutput || !engineOutput.apartamente) {
    return { passed: false, diffs: [{ error: 'No engine output apartments provided' }] };
  }

  for (const gApt of golden.apartamente) {
    const bId = (gApt.BLOC || '').trim();
    const aId = (gApt.APART || '').trim();

    const eApt = engineOutput.apartamente.find(
      a => (String(a.bloc || a.bloc_id || '').trim() === bId) &&
           (String(a.apart || a.numar_apart || '').trim() === aId)
    );

    if (!eApt) {
      diffs.push({ bloc: bId, apart: aId, error: 'Apartment missing from engine output' });
      continue;
    }

    const checkFields = [
      'APA_RECE', 'CAN_MNJ', 'CAN_MET', 'APA_CALDA', 'INCALZIRE',
      'GAZ', 'GUNOI', 'CURENT', 'ASCENSOR', 'CH_ADMIN', 'CH_SEDIU',
      'PREST_SERV', 'ABONAMENT', 'CHELT_INC', 'SAL_FEME', 'SAL_TESA',
      'DIFARAR', 'DIFARAC', 'DIFCANAR', 'DIFCANAC', 'DIFETAC', 'DIFETIN',
      'RULMENT', 'FOND_REPAR'
    ];

    for (const f of checkFields) {
      const gVal = Number(gApt[f] || 0);
      const eVal = Number(eApt[f] || eApt[f.toLowerCase()] || 0);
      const diff = Math.abs(round2(gVal) - round2(eVal));

      if (diff > tolerance) {
        diffs.push({
          bloc: bId,
          apart: aId,
          field: f,
          golden: gVal,
          engine: eVal,
          diff: round2(diff)
        });
      }
    }
  }

  return {
    passed: diffs.length === 0,
    diffs
  };
}

describe('Golden-Month Parity Harness: September 2026 Ground Truth Vector Validation', () => {
  let golden2026;

  it('G1.1: Loads golden dataset for 2026\\SEPTEMBR successfully', () => {
    golden2026 = loadGoldenMonth(2026, 'SEPTEMBR');
    assert.ok(golden2026.general, 'GENERAL.DBF must be loaded');
    assert.ok(golden2026.asociatie, 'ASOC.DBF must be loaded');
    assert.equal(golden2026.blocuri.length, 10, 'Must have 10 blocks');
    assert.equal(golden2026.apartamente.length, 78, 'Must have 78 apartments');
  });

  it('G1.2: General tariffs in 2026\\SEPTEMBR match expected authoritative rates', () => {
    if (!golden2026) golden2026 = loadGoldenMonth(2026, 'SEPTEMBR');
    const { general } = golden2026;
    assert.equal(Number(general.TARIF_AR), 9.48, 'Cold water tariff must be 9.48 lei/m³');
    assert.equal(Number(general.TARIF_CA), 9.67, 'Sewage tariff must be 9.67 lei/m³');
    assert.equal(Number(general.PROC_CA), 100.00, 'Sewage percentage must be 100.00%');
  });

  it('G1.3: Metered apartment water costs match TARIF_AR volume multiplication within ±0.01 RON', () => {
    if (!golden2026) golden2026 = loadGoldenMonth(2026, 'SEPTEMBR');
    const tarifAr = Number(golden2026.general.TARIF_AR);

    for (const a of golden2026.apartamente) {
      if (a.CP_AR === 'C' && a.CP_AC === 'C') {
        const cnsCold = (a.INARBU - a.IVARBU) + (a.INARBA1 - a.IVARBA1) + (a.INARBA2 - a.IVARBA2);
        const cnsHot = (a.INACBU - a.IVACBU) + (a.INACBA1 - a.IVACBA1) + (a.INACBA2 - a.IVACBA2);
        const expectedApaRece = round2((cnsCold + cnsHot) * tarifAr);
        const actualApaRece = round2(a.APA_RECE || 0);

        const diff = Math.abs(expectedApaRece - actualApaRece);
        assert.ok(
          diff <= 0.01,
          `Apt ${a.BLOC}/${a.APART} APA_RECE (${actualApaRece}) differs from expected (${expectedApaRece}) by ${diff}`
        );
      }
    }
  });

  it('G1.4: Metered sewage (CAN_MNJ) matches PROC_CA and TARIF_CA formula within ±0.01 RON', () => {
    if (!golden2026) golden2026 = loadGoldenMonth(2026, 'SEPTEMBR');
    const tarifCa = Number(golden2026.general.TARIF_CA);
    const procCa = Number(golden2026.general.PROC_CA);

    for (const a of golden2026.apartamente) {
      if (a.CP_AR === 'C' && a.CP_AC === 'C') {
        const cnsCold = (a.INARBU - a.IVARBU) + (a.INARBA1 - a.IVARBA1) + (a.INARBA2 - a.IVARBA2);
        const cnsHot = (a.INACBU - a.IVACBU) + (a.INACBA1 - a.IVACBA1) + (a.INACBA2 - a.IVACBA2);
        const expectedCanal = round2((cnsCold + cnsHot) * (procCa / 100) * tarifCa);
        const actualCanal = round2(a.CAN_MNJ || 0);

        const diff = Math.abs(expectedCanal - actualCanal);
        assert.ok(
          diff <= 0.01,
          `Apt ${a.BLOC}/${a.APART} CAN_MNJ (${actualCanal}) differs from expected (${expectedCanal}) by ${diff}`
        );
      }
    }
  });

  it('G1.5: Block total surfaces equal the sum of constituent apartment surfaces', () => {
    if (!golden2026) golden2026 = loadGoldenMonth(2026, 'SEPTEMBR');

    for (const b of golden2026.blocuri) {
      const bCode = (b.BLOC || '').trim();
      const bApts = golden2026.apartamente.filter(a => (a.BLOC || '').trim() === bCode);

      let sumSl1 = 0;
      for (const apt of bApts) {
        const sl1 = (apt.SUPRAFATA || 0) - (apt.SL1_SCAZ || 0);
        sumSl1 += sl1;
      }

      const expected = round2(sumSl1);
      const actual = round2(b.SUPRAFATA1 || 0);
      const diff = Math.abs(expected - actual);
      assert.ok(
        diff <= 0.05,
        `Bloc ${bCode} SUPRAFATA1 (${actual}) differs from apartment sum (${expected}) by ${diff}`
      );
    }
  });
});

describe('Golden-Month Parity Harness: Winter Heating Month (2006\\IANUARIE) Validation', () => {
  let golden2006;

  it('G2.1: Loads winter heating golden month 2006\\IANUARIE successfully', () => {
    golden2006 = loadGoldenMonth(2006, 'IANUARIE');
    assert.ok(golden2006.general, '2006 GENERAL.DBF must be loaded');
    assert.ok(golden2006.asociatie, '2006 ASOC.DBF must be loaded');
    assert.ok(golden2006.blocuri.length > 0, '2006 blocks must be loaded');
    assert.ok(golden2006.apartamente.length > 0, '2006 apartments must be loaded');
  });

  it('G2.2: Winter heating apartments have active heating charges and differences', () => {
    if (!golden2006) golden2006 = loadGoldenMonth(2006, 'IANUARIE');
    const aptsWithHeating = golden2006.apartamente.filter(a => (a.INCALZIRE || 0) > 0 || (a.DIFETIN || 0) > 0);
    assert.ok(
      aptsWithHeating.length > 0,
      'Winter heating month must contain apartments with non-zero heating charges'
    );
  });
});

describe('Engine Parity Verification Interface Integration', () => {
  it('G3.1: Engine parity verification interface is functional and reports diffs accurately', () => {
    const dummyGolden = {
      apartamente: [
        { BLOC: '1', APART: '1', APA_RECE: 100.00, CAN_MNJ: 50.00 },
        { BLOC: '1', APART: '2', APA_RECE: 80.00, CAN_MNJ: 40.00 }
      ]
    };

    const dummyEnginePass = {
      apartamente: [
        { bloc: '1', apart: '1', apa_rece: 100.00, can_mnj: 50.00 },
        { bloc: '1', apart: '2', apa_rece: 80.00, can_mnj: 40.00 }
      ]
    };

    const resPass = verifyEngineAgainstGolden(dummyEnginePass, dummyGolden);
    assert.equal(resPass.passed, true, 'Matching output must pass parity check');
    assert.equal(resPass.diffs.length, 0);

    const dummyEngineFail = {
      apartamente: [
        { bloc: '1', apart: '1', apa_rece: 100.00, can_mnj: 50.00 },
        { bloc: '1', apart: '2', apa_rece: 80.00, can_mnj: 45.00 } // diff = 5.00
      ]
    };

    const resFail = verifyEngineAgainstGolden(dummyEngineFail, dummyGolden);
    assert.equal(resFail.passed, false, 'Differing output must fail parity check');
    assert.equal(resFail.diffs.length, 1);
    assert.equal(resFail.diffs[0].field, 'CAN_MNJ');
    assert.equal(resFail.diffs[0].diff, 5.00);
  });

  it('G3.2: Check if engine/calcul.js exists and passes full Golden-Month Parity (2026\\IULIE, 2026\\IUNIE, 2026\\IANUARIE, 2006\\IANUARIE)', () => {
    const engineCalculPath = path.join(__dirname, '..', '..', 'engine', 'calcul.js');
    assert.ok(fs.existsSync(engineCalculPath), 'engine/calcul.js must exist');
    const { calculatePeriod, expireReductions, computeAllocators, round2: r2 } = require(engineCalculPath);
    assert.equal(typeof calculatePeriod, 'function', 'engine/calcul.js must export calculatePeriod');
    assert.equal(typeof expireReductions, 'function', 'engine/calcul.js must export expireReductions');
    assert.equal(typeof computeAllocators, 'function', 'engine/calcul.js must export computeAllocators');

    // Negative half-away-from-zero rounding check
    assert.equal(r2(-8.545), -8.55, 'Negative half-away-from-zero must round -8.545 to -8.55');
    assert.equal(r2(1 * 0.75 * 0.58), 0.44, 'Exact decimal midpoint 0.435 must round to 0.44');

    const goldenMonths = [
      [2026, 'IULIE'],
      [2026, 'IUNIE'],
      [2026, 'IANUARIE'],
      [2006, 'IANUARIE']
    ];

    for (const [year, month] of goldenMonths) {
      const golden = loadGoldenMonth(year, month);
      const output = calculatePeriod(golden);
      const result = verifyEngineAgainstGolden(output, golden, 0.01);
      assert.equal(
        result.passed,
        true,
        `${year}\\${month} failed parity with ${result.diffs.length} diffs: ${JSON.stringify(result.diffs.slice(0, 5))}`
      );
      assert.equal(result.diffs.length, 0, `${year}\\${month} must have 0 diffs`);
    }
  });

  it('G3.3: TCE reduction expiration honors strict D2 < ULTIMA_ZI and open-ended reductions', () => {
    const { expireReductions } = require(path.join(__dirname, '..', '..', 'engine', 'tce.js'));
    const apts = [
      { BLOC: 'A1', APART: '1', D1: '2026-09-01', D2: '2026-09-29', P1_SCAZ: 2, SL1_SCAZ: 15, OBSERVATII: 'Temp' },
      { BLOC: 'A1', APART: '2', D1: '2026-09-01', D2: '2026-09-30', P1_SCAZ: 1, SL1_SCAZ: 10, OBSERVATII: 'Boundary' },
      { BLOC: 'A1', APART: '3', D1: '2026-01-01', D2: '', P1_SCAZ: 1, SL1_SCAZ: 20, OBSERVATII: 'Permanent' }
    ];
    const res = expireReductions({ apartamente: apts, general: { ULTIMA_ZI: '2026-09-30' } });
    assert.equal(res.expiredCount, 1);
    assert.equal(res.apartamente[0].P1_SCAZ, 0);
    assert.equal(res.apartamente[0].SL1_SCAZ, 0);
    assert.equal(res.apartamente[0].OBSERVATII, '');
    assert.equal(res.apartamente[1].P1_SCAZ, 1, 'D2 == ULTIMA_ZI must NOT expire');
    assert.equal(res.apartamente[2].P1_SCAZ, 1, 'Empty D2 (permanent) must NOT expire');
  });

  it('G3.4: CRE heat cost allocator engine computes TOT_UNIT, GHP imposition, and Gcal split', () => {
    const { computeAllocators } = require(path.join(__dirname, '..', '..', 'engine', 'cre.js'));
    const input = {
      blocuri: [
        { BLOC: 'B1', PROCINCCOM: 30, ININ: 10, IVIN: 0, CONSTIN: 1 }
      ],
      apartamente: [
        {
          BLOC: 'B1', APART: '1', CP_IN: 'R', SUPRAFATA: 50, SL1_SCAZ: 0, PROC_AV_IN: 100,
          IV_R1: 100, IN_R1: 200, FACTTR_R1: 1.5, COEFSP_R1: 0.8, GCAL_RED: 0
        },
        {
          BLOC: 'B1', APART: '2', CP_IN: 'P', SUPRAFATA: 50, SL1_SCAZ: 0, PROC_AV_IN: 100,
          GCAL_RED: 0
        }
      ]
    };
    const out = computeAllocators(input);
    const a1 = out.apartamente[0];
    const a2 = out.apartamente[1];
    assert.equal(a1.TOT_UNIT, 120, 'Apt 1 TOT_UNIT = (200-100)*1.5*0.8 = 120');
    assert.equal(a2.TOT_UNIT, 120, 'Apt 2 P imposed with GHP (120/50)*50 = 120');
    assert.equal(a1.GCAL_MP, 1.5, 'Common 30% of 10 Gcal = 3 Gcal / 100 mp * 50 mp = 1.5 Gcal');
    assert.equal(a1.GCAL_UNIT, 3.5, 'Individual 70% of 10 Gcal = 7 Gcal / 240 units * 120 units = 3.5 Gcal');
    assert.equal(a1.GCAL_FINAL, 5.0);
    assert.equal(a1.ININ, 5.0);
    assert.equal(a1.CONSTIN, 1);
  });
});

module.exports = {
  loadGoldenMonth,
  verifyEngineAgainstGolden,
  round2,
  round4
};
