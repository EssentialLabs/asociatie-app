/**
 * engine/round.js
 *
 * Canonical FoxPro 2.6 ROUND(x, n) implementation:
 * Sign-preserving half-away-from-zero decimal rounding.
 */

function roundFox(val, decimals = 2) {
  if (val === null || val === undefined || val === '') return 0;
  const num = Number(val);
  if (!Number.isFinite(num) || num === 0) return 0;

  const sign = num < 0 ? -1 : 1;
  const abs = Math.abs(num);

  const cleanAbs = Number(abs.toPrecision(14));

  if (decimals === 0) {
    const res = sign * Math.round(cleanAbs);
    return Object.is(res, -0) ? 0 : res;
  }

  const str = String(cleanAbs);
  let roundedAbs;
  if (str.includes('e') || str.includes('E')) {
    const factor = Math.pow(10, decimals);
    roundedAbs = Math.round(cleanAbs * factor) / factor;
  } else {
    roundedAbs = Number(Math.round(Number(str + 'e+' + decimals)) + 'e-' + decimals);
  }

  const res = sign * roundedAbs;
  return Object.is(res, -0) ? 0 : res;
}

function round0(val) {
  return roundFox(val, 0);
}

function round2(val) {
  return roundFox(val, 2);
}

function round4(val) {
  return roundFox(val, 4);
}

function round8(val) {
  return roundFox(val, 8);
}

module.exports = {
  roundFox,
  round0,
  round2,
  round4,
  round8
};
