'use strict';

const { createApp, createServer } = require('./server');

/**
 * Create and start the SQLite dashboard.
 *
 * @example
 * const { createDashboard } = require('sqlite-dashboard');
 * createDashboard({
 *   databases: [
 *     { name: 'My App', path: './data/app.db' },
 *     { name: 'Analytics', path: './data/analytics.db' },
 *   ],
 *   port: 4000,
 * });
 *
 * @param {Object} config
 * @param {Array<{name: string, path: string}>} config.databases  List of SQLite databases to expose
 * @param {string}  [config.directory]                            Folder scanned recursively for .db and .sqlite files
 * @param {string}  [config.folder]                               Alias for config.directory
 * @param {number}  [config.port=3000]                            Port to listen on
 * @param {string}  [config.host='127.0.0.1']                     Host / bind address
 * @returns {{ app, server, close() }}
 */
function createDashboard(config) {
  return createServer(config);
}

module.exports = { createDashboard, createApp, createServer };
