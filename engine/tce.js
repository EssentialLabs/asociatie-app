/**
 * engine/tce.js
 *
 * Pure implementation of FoxPro TCE.PRG ("Trecere cereri expirate").
 * Expires temporary person/surface reductions where D2 < ULTIMA_ZI.
 * Open-ended reductions (empty/null D2) or D2 >= ULTIMA_ZI remain active.
 */

function parseCalendarDate(val) {
  if (!val) return null;
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    return val.toISOString().slice(0, 10);
  }
  const str = String(val).trim();
  if (!str || str === '.  .' || str === '. .' || /^[\s./-]+$/.test(str) || str.startsWith('0000')) {
    return null;
  }
  // ISO YYYY-MM-DD
  let m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // Compact YYYYMMDD
  m = str.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // European DD.MM.YYYY or DD/MM/YYYY or DD-MM-YYYY
  m = str.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (m) {
    const dd = m[1].padStart(2, '0');
    const mm = m[2].padStart(2, '0');
    return `${m[3]}-${mm}-${dd}`;
  }
  // European 2-digit year DD.MM.YY
  m = str.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2})$/);
  if (m) {
    const dd = m[1].padStart(2, '0');
    const mm = m[2].padStart(2, '0');
    const yy = Number(m[3]);
    const yyyy = yy >= 70 ? 1900 + yy : 2000 + yy;
    return `${yyyy}-${mm}-${dd}`;
  }
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  return null;
}

/**
 * Pure function expiring reductions where D2 < ultima_zi.
 * Can be called as:
 *   expireReductions(apartamenteArray, ultimaZi, options)
 * or:
 *   expireReductions({ apartamente, general, period }, options)
 */
function expireReductions(input, ultimaZiOrOptions, maybeOptions) {
  let apartamente;
  let ultimaZiRaw;
  let options = {};
  let isObjectInput = false;

  if (Array.isArray(input)) {
    apartamente = input;
    if (ultimaZiOrOptions && typeof ultimaZiOrOptions === 'object' && !(ultimaZiOrOptions instanceof Date)) {
      ultimaZiRaw = ultimaZiOrOptions.ultima_zi ?? ultimaZiOrOptions.ULTIMA_ZI;
      options = ultimaZiOrOptions;
    } else {
      ultimaZiRaw = ultimaZiOrOptions;
      options = maybeOptions || {};
    }
  } else if (input && typeof input === 'object') {
    isObjectInput = true;
    apartamente = input.apartamente || [];
    options = ultimaZiOrOptions || {};
    ultimaZiRaw =
      input.ultima_zi ??
      input.ULTIMA_ZI ??
      input.general?.ultima_zi ??
      input.general?.ULTIMA_ZI ??
      input.period?.ultima_zi ??
      input.period?.ULTIMA_ZI ??
      options.ultima_zi ??
      options.ULTIMA_ZI;
  } else {
    apartamente = [];
  }

  // Operator confirmation check (TCE.PRG: "AI ACTUALIZATA ULTIMA_ZI DIN DATE GENERALE ? (D/N)")
  if (options && (options.confirmed === false || String(options.confirmed).toUpperCase() === 'N')) {
    const cloned = apartamente.map(a => ({ ...a }));
    return isObjectInput
      ? { ...input, apartamente: cloned, expiredCount: 0, expiredApartments: [], aborted: true }
      : cloned;
  }

  const dUlt = parseCalendarDate(ultimaZiRaw);
  const expiredApartments = [];

  const updated = apartamente.map(apt => {
    const copy = { ...apt };
    if (!dUlt) return copy;

    const rawD2 = copy.d2 !== undefined ? copy.d2 : copy.D2;
    const d2 = parseCalendarDate(rawD2);

    // Expire strictly when D2 is present and D2 < ULTIMA_ZI
    if (d2 && d2 < dUlt) {
      if ('d1' in copy || !('D1' in copy)) copy.d1 = null;
      if ('D1' in copy) copy.D1 = null;
      if ('d2' in copy || !('D2' in copy)) copy.d2 = null;
      if ('D2' in copy) copy.D2 = null;

      if ('p1_scaz' in copy || !('P1_SCAZ' in copy)) copy.p1_scaz = 0;
      if ('P1_SCAZ' in copy) copy.P1_SCAZ = 0;
      if ('p2_scaz' in copy || !('P2_SCAZ' in copy)) copy.p2_scaz = 0;
      if ('P2_SCAZ' in copy) copy.P2_SCAZ = 0;

      if ('sl1_scaz' in copy || !('SL1_SCAZ' in copy)) copy.sl1_scaz = 0;
      if ('SL1_SCAZ' in copy) copy.SL1_SCAZ = 0;
      if ('sl2_scaz' in copy || !('SL2_SCAZ' in copy)) copy.sl2_scaz = 0;
      if ('SL2_SCAZ' in copy) copy.SL2_SCAZ = 0;
      if ('set_scaz' in copy || !('SET_SCAZ' in copy)) copy.set_scaz = 0;
      if ('SET_SCAZ' in copy) copy.SET_SCAZ = 0;

      if ('observatii' in copy || !('OBSERVATII' in copy)) copy.observatii = '';
      if ('OBSERVATII' in copy) copy.OBSERVATII = '';

      expiredApartments.push({
        bloc: String(copy.bloc ?? copy.BLOC ?? '').trim(),
        apart: String(copy.numar_apart ?? copy.apart ?? copy.APART ?? '').trim(),
        expired_d2: d2
      });
    }

    return copy;
  });

  if (isObjectInput) {
    return {
      ...input,
      apartamente: updated,
      expiredCount: expiredApartments.length,
      expiredApartments,
      aborted: false
    };
  }

  return updated;
}

module.exports = {
  parseCalendarDate,
  expireReductions
};
