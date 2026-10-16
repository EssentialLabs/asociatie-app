/**
 * Modul de conversie a numerelor în cuvinte în limba română pentru chitanțe și acte financiare.
 * Exemplu: 142.50 -> "una sută patruzeci și doi lei și cincizeci bani"
 */

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

function numarInLitere(suma) {
  if (suma === null || suma === undefined || isNaN(suma)) return 'zero lei';
  const val = Math.abs(parseFloat(suma));
  const intPart = Math.floor(val);
  const bani = Math.round((val - intPart) * 100);

  if (intPart === 0 && bani === 0) return 'zero lei';

  let textLei = '';

  if (intPart === 0) {
    textLei = 'zero lei';
  } else if (intPart === 1) {
    textLei = 'un leu';
  } else {
    const mii = Math.floor(intPart / 1000);
    const rest = intPart % 1000;

    let partMii = '';
    if (mii > 0) {
      if (mii === 1) partMii = 'o mie ';
      else if (mii === 2) partMii = 'două mii ';
      else partMii = suteInLitere(mii, true) + ' mii ';
    }

    let partRest = '';
    if (rest > 0) {
      partRest = suteInLitere(rest, false) + ' ';
    }

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

module.exports = { numarInLitere };

// Test rapid la rulare directă
if (require.main === module) {
  console.log('142.50 ->', numarInLitere(142.50));
  console.log('1.00   ->', numarInLitere(1.00));
  console.log('2.05   ->', numarInLitere(2.05));
  console.log('1050.25->', numarInLitere(1050.25));
  console.log('2300.00->', numarInLitere(2300.00));
}
