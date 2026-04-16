'use strict';

const Database = require('better-sqlite3');

/**
 * Validates a SQL identifier (table name, column name, database name).
 * Only allows alphanumeric characters, underscores, and hyphens.
 * @param {string} name
 * @returns {boolean}
 */
function isValidIdentifier(name) {
  return typeof name === 'string' && /^[a-zA-Z0-9_\- ]+$/.test(name);
}

/**
 * Wraps a SQL identifier in double quotes, escaping any inner double quotes.
 * @param {string} name
 * @returns {string}
 */
function quoteIdentifier(name) {
  return '"' + name.replace(/"/g, '""') + '"';
}

class DatabaseManager {
  constructor(configs) {
    this._configs = configs;
    this._connections = new Map();
  }

  /**
   * Returns a list of configured database names.
   * @returns {string[]}
   */
  getDatabaseNames() {
    return this._configs.map((c) => c.name);
  }

  /**
   * Opens (or returns a cached) connection to a named database.
   * @param {string} name
   * @returns {import('better-sqlite3').Database}
   */
  getConnection(name) {
    if (!this._connections.has(name)) {
      const config = this._configs.find((c) => c.name === name);
      if (!config) {
        throw new Error(`Database "${name}" is not configured`);
      }
      const db = new Database(config.path, { readonly: false });
      // Prefer clean filesystem state over WAL sidecar files (-wal/-shm)
      db.pragma('journal_mode = DELETE');
      db.pragma('foreign_keys = ON');
      this._connections.set(name, db);
    }
    return this._connections.get(name);
  }

  /**
   * Closes all open database connections.
   */
  closeAll() {
    for (const db of this._connections.values()) {
      db.close();
    }
    this._connections.clear();
  }
}

module.exports = { DatabaseManager, isValidIdentifier, quoteIdentifier };
