/**
 * tests/helpers/dbf_reader.js
 * 
 * Independent, pure FoxPro / dBase III DBF reader for test verifications.
 * Reads binary DBF files, parses field descriptors, decodes CP852 Romanian text,
 * and extracts raw and converted records with full numeric precision.
 */

const fs = require('fs');
const iconv = require('iconv-lite');

/**
 * Parses a DBF file into an array of records and metadata.
 * 
 * @param {string} filepath Absolute path to .DBF file
 * @returns {{
 *   fields: Array<{ name: string, type: string, length: number, decimals: number }>,
 *   records: Array<Object>,
 *   totalRecords: number,
 *   deletedRecords: number,
 *   activeRecords: number
 * }}
 */
function readDbf(filepath) {
  if (!fs.existsSync(filepath)) {
    throw new Error(`DBF file not found: ${filepath}`);
  }

  const buf = fs.readFileSync(filepath);
  if (buf.length < 32) {
    throw new Error(`DBF file too small: ${filepath} (${buf.length} bytes)`);
  }

  const numRecords = buf.readUInt32LE(4);
  const headerSize = buf.readUInt16LE(8);
  const recordSize = buf.readUInt16LE(10);

  const fields = [];
  let pos = 32;

  while (pos < headerSize && buf[pos] !== 0x0D) {
    if (pos + 32 > buf.length) break;

    const nameBuf = buf.subarray(pos, pos + 11);
    const zeroIdx = nameBuf.indexOf(0);
    const name = nameBuf.subarray(0, zeroIdx === -1 ? 11 : zeroIdx).toString('ascii').trim();
    const type = String.fromCharCode(buf[pos + 11]);
    const length = buf[pos + 16];
    const decimals = buf[pos + 17];

    fields.push({ name, type, length, decimals });
    pos += 32;
  }

  const records = [];
  let deletedCount = 0;
  let offset = headerSize;

  for (let i = 0; i < numRecords; i++) {
    if (offset + recordSize > buf.length) break;

    const isDeleted = buf[offset] === 0x2A; // '*'
    offset += 1;

    if (isDeleted) {
      deletedCount++;
      offset += recordSize - 1;
      continue;
    }

    const record = {};
    for (const field of fields) {
      const fieldBuf = buf.subarray(offset, offset + field.length);
      offset += field.length;

      const rawText = iconv.decode(fieldBuf, 'cp852').trim();

      if (field.type === 'N') {
        if (rawText === '') {
          record[field.name] = 0;
        } else {
          const val = parseFloat(rawText);
          record[field.name] = isNaN(val) ? 0 : val;
        }
      } else if (field.type === 'D') {
        record[field.name] = rawText === '' || rawText === '00000000' ? null : rawText;
      } else if (field.type === 'L') {
        record[field.name] = rawText === 'T' || rawText === 't' || rawText === 'Y' || rawText === 'y';
      } else {
        record[field.name] = rawText;
      }
    }

    records.push(record);
  }

  return {
    fields,
    records,
    totalRecords: numRecords,
    deletedRecords: deletedCount,
    activeRecords: records.length
  };
}

module.exports = {
  readDbf
};
