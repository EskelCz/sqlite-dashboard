'use strict';

const express = require('express');
const path = require('path');
const { DatabaseManager } = require('./db');
const databasesRouter = require('./api/databases');
const tablesRouter = require('./api/tables');

/**
 * Creates an Express application for the SQLite dashboard.
 * @param {Object} config
 * @param {Array<{name: string, path: string}>} config.databases
 * @returns {import('express').Application}
 */
function createApp(config) {
  const databases = config.databases || [];
  if (!Array.isArray(databases) || databases.length === 0) {
    throw new Error(
      'config.databases must be a non-empty array of {name, path} objects'
    );
  }

  const dbManager = new DatabaseManager(databases);

  const app = express();
  app.use(express.json());

  // Store dbManager so routes can access it via req.app.locals
  app.locals.dbManager = dbManager;

  // Serve static frontend files
  app.use(express.static(path.join(__dirname, 'public')));

  // API routes
  app.use('/api/databases', databasesRouter);
  app.use('/api/databases/:dbName', tablesRouter);

  return app;
}

/**
 * Creates and starts the SQLite dashboard server.
 * @param {Object} config
 * @param {Array<{name: string, path: string}>} config.databases
 * @param {number} [config.port=3000]
 * @param {string} [config.host='127.0.0.1']
 * @returns {{ app, server, close() }}
 */
function createServer(config) {
  const port = config.port || 3000;
  const host = config.host || '127.0.0.1';

  const app = createApp(config);

  const server = app.listen(port, host, () => {
    console.log(`SQLite Dashboard running at http://${host}:${port}`);
  });

  function close() {
    return new Promise((resolve, reject) => {
      app.locals.dbManager.closeAll();
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  return { app, server, close };
}

module.exports = { createApp, createServer };
