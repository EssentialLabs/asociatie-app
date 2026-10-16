/**
 * tests/helpers/test_db.js
 * 
 * Helper for managing isolated SQLite database instances for automated tests.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');

/**
 * Creates a unique temporary database file for test isolation.
 * @param {string} prefix Optional prefix for the temp db name
 * @returns {{ db: Database.Database, filepath: string, cleanup: Function }}
 */
function createTempDb(prefix = 'test_asoc_') {
  const tmpDir = os.tmpdir();
  const dbName = `${prefix}${Date.now()}_${Math.random().toString(36).substring(2, 8)}.db`;
  const filepath = path.join(tmpDir, dbName);

  const db = new Database(filepath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const cleanup = () => {
    try {
      db.close();
    } catch (_) {}
    try {
      if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
      const wal = `${filepath}-wal`;
      if (fs.existsSync(wal)) fs.unlinkSync(wal);
      const shm = `${filepath}-shm`;
      if (fs.existsSync(shm)) fs.unlinkSync(shm);
    } catch (_) {}
  };

  return { db, filepath, cleanup };
}

/**
 * Retrieves all table names from a SQLite database.
 * @param {Database.Database} db
 * @returns {string[]}
 */
function getTableNames(db) {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  return rows.map(r => r.name);
}

/**
 * Retrieves all column definitions for a given table.
 * @param {Database.Database} db
 * @param {string} tableName
 * @returns {Array<{ cid: number, name: string, type: string, notnull: number, dflt_value: any, pk: number }>}
 */
function getTableColumns(db, tableName) {
  return db.prepare(`PRAGMA table_info("${tableName}")`).all();
}

/**
 * Checks if a specific column exists in a table.
 * @param {Database.Database} db
 * @param {string} tableName
 * @param {string} columnName
 * @returns {boolean}
 */
function hasColumn(db, tableName, columnName) {
  const cols = getTableColumns(db, tableName);
  const target = columnName.toLowerCase();
  return cols.some(c => c.name.toLowerCase() === target);
}

/**
 * Retrieves foreign key definitions for a given table.
 * @param {Database.Database} db
 * @param {string} tableName
 * @returns {Array<Object>}
 */
function getForeignKeys(db, tableName) {
  return db.prepare(`PRAGMA foreign_key_list("${tableName}")`).all();
}

module.exports = {
  createTempDb,
  getTableNames,
  getTableColumns,
  hasColumn,
  getForeignKeys
};
