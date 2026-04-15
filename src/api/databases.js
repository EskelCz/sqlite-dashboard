'use strict';

const express = require('express');
const router = express.Router();
const { isValidIdentifier } = require('../db');

/**
 * GET /api/databases
 * Returns list of configured databases.
 */
router.get('/', (req, res) => {
  const dbManager = req.app.locals.dbManager;
  const names = dbManager.getDatabaseNames();
  res.json({ databases: names });
});

/**
 * GET /api/databases/:dbName/tables
 * Returns list of tables and views in the specified database.
 */
router.get('/:dbName/tables', (req, res) => {
  const { dbName } = req.params;
  if (!isValidIdentifier(dbName)) {
    return res.status(400).json({ error: 'Invalid database name' });
  }

  let db;
  try {
    db = req.app.locals.dbManager.getConnection(dbName);
  } catch (err) {
    return res.status(404).json({ error: err.message });
  }

  const tables = db
    .prepare(
      `SELECT name, type FROM sqlite_master
       WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
       ORDER BY type, name`
    )
    .all();

  res.json({ tables });
});

module.exports = router;
