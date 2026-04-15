'use strict';

const express = require('express');
const router = express.Router({ mergeParams: true });
const { isValidIdentifier, quoteIdentifier } = require('../db');

/**
 * Resolve db or return 404.
 */
function getDb(req, res) {
  const { dbName } = req.params;
  if (!isValidIdentifier(dbName)) {
    res.status(400).json({ error: 'Invalid database name' });
    return null;
  }
  try {
    return req.app.locals.dbManager.getConnection(dbName);
  } catch (err) {
    res.status(404).json({ error: err.message });
    return null;
  }
}

/**
 * Validate table name and ensure it exists.
 */
function validateTable(db, tableName, res) {
  if (!isValidIdentifier(tableName)) {
    res.status(400).json({ error: 'Invalid table name' });
    return false;
  }
  const exists = db
    .prepare(
      `SELECT 1 FROM sqlite_master WHERE name = ? AND type IN ('table', 'view')`
    )
    .get(tableName);
  if (!exists) {
    res.status(404).json({ error: `Table "${tableName}" not found` });
    return false;
  }
  return true;
}

/**
 * GET /api/databases/:dbName/tables/:tableName/schema
 * Returns column definitions for a table.
 */
router.get('/:tableName/schema', (req, res) => {
  const db = getDb(req, res);
  if (!db) return;
  const { tableName } = req.params;
  if (!validateTable(db, tableName, res)) return;

  const columns = db.pragma(`table_info(${quoteIdentifier(tableName)})`);
  const indices = db
    .prepare(
      `SELECT il.name AS index_name, il."unique", ii.name AS column_name
       FROM sqlite_master AS m,
            pragma_index_list(m.name) AS il,
            pragma_index_info(il.name) AS ii
       WHERE m.type = 'table' AND m.name = ?
       ORDER BY il.name, ii.seqno`
    )
    .all(tableName);

  res.json({ columns, indices });
});

/**
 * GET /api/databases/:dbName/tables/:tableName/rows
 * Returns paginated rows. Query params: page (1-based), pageSize, sortBy, sortOrder, search.
 */
router.get('/:tableName/rows', (req, res) => {
  const db = getDb(req, res);
  if (!db) return;
  const { tableName } = req.params;
  if (!validateTable(db, tableName, res)) return;

  const page = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = Math.min(500, Math.max(1, parseInt(req.query.pageSize) || 50));
  const offset = (page - 1) * pageSize;
  const sortBy = req.query.sortBy || null;
  const sortOrder =
    req.query.sortOrder && req.query.sortOrder.toUpperCase() === 'DESC'
      ? 'DESC'
      : 'ASC';
  const search = req.query.search || '';

  const columns = db.pragma(`table_info(${quoteIdentifier(tableName)})`);
  const colNames = columns.map((c) => c.name);

  // Build WHERE clause for search (text columns only, if search provided)
  let whereClause = '';
  const bindParams = [];
  if (search && colNames.length > 0) {
    const conditions = colNames.map((c) => `${quoteIdentifier(c)} LIKE ?`);
    whereClause = 'WHERE ' + conditions.join(' OR ');
    colNames.forEach(() => bindParams.push(`%${search}%`));
  }

  // Build ORDER BY clause
  let orderClause = '';
  if (sortBy && isValidIdentifier(sortBy) && colNames.includes(sortBy)) {
    orderClause = `ORDER BY ${quoteIdentifier(sortBy)} ${sortOrder}`;
  }

  const quotedTable = quoteIdentifier(tableName);
  const countSql = `SELECT COUNT(*) AS total FROM ${quotedTable} ${whereClause}`;
  const rowsSql = `SELECT rowid AS _rowid_, * FROM ${quotedTable} ${whereClause} ${orderClause} LIMIT ? OFFSET ?`;

  try {
    const { total } = db.prepare(countSql).get(...bindParams);
    const rows = db.prepare(rowsSql).all(...bindParams, pageSize, offset);
    res.json({
      rows,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/databases/:dbName/tables/:tableName/rows
 * Insert a new row.
 */
router.post('/:tableName/rows', (req, res) => {
  const db = getDb(req, res);
  if (!db) return;
  const { tableName } = req.params;
  if (!validateTable(db, tableName, res)) return;

  const data = req.body;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return res.status(400).json({ error: 'Request body must be a JSON object' });
  }

  const columns = Object.keys(data).filter((k) => isValidIdentifier(k));
  if (columns.length === 0) {
    return res.status(400).json({ error: 'No valid columns provided' });
  }

  const quotedTable = quoteIdentifier(tableName);
  const quotedCols = columns.map(quoteIdentifier).join(', ');
  const placeholders = columns.map(() => '?').join(', ');
  const values = columns.map((c) => data[c]);

  try {
    const result = db
      .prepare(
        `INSERT INTO ${quotedTable} (${quotedCols}) VALUES (${placeholders})`
      )
      .run(...values);
    res.status(201).json({ rowid: result.lastInsertRowid });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * PATCH /api/databases/:dbName/tables/:tableName/rows/:rowid
 * Update a row by rowid.
 */
router.patch('/:tableName/rows/:rowid', (req, res) => {
  const db = getDb(req, res);
  if (!db) return;
  const { tableName, rowid } = req.params;
  if (!validateTable(db, tableName, res)) return;

  const data = req.body;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return res.status(400).json({ error: 'Request body must be a JSON object' });
  }

  const columns = Object.keys(data).filter((k) => isValidIdentifier(k));
  if (columns.length === 0) {
    return res.status(400).json({ error: 'No valid columns provided' });
  }

  const quotedTable = quoteIdentifier(tableName);
  const setClauses = columns.map((c) => `${quoteIdentifier(c)} = ?`).join(', ');
  const values = columns.map((c) => data[c]);

  try {
    const result = db
      .prepare(`UPDATE ${quotedTable} SET ${setClauses} WHERE rowid = ?`)
      .run(...values, rowid);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Row not found' });
    }
    res.json({ changes: result.changes });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * DELETE /api/databases/:dbName/tables/:tableName/rows/:rowid
 * Delete a row by rowid.
 */
router.delete('/:tableName/rows/:rowid', (req, res) => {
  const db = getDb(req, res);
  if (!db) return;
  const { tableName, rowid } = req.params;
  if (!validateTable(db, tableName, res)) return;

  const quotedTable = quoteIdentifier(tableName);

  try {
    const result = db
      .prepare(`DELETE FROM ${quotedTable} WHERE rowid = ?`)
      .run(rowid);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Row not found' });
    }
    res.json({ changes: result.changes });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/databases/:dbName/query
 * Execute a raw SQL query.
 */
router.post('/query', (req, res) => {
  const db = getDb(req, res);
  if (!db) return;

  const { sql, params } = req.body || {};
  if (!sql || typeof sql !== 'string') {
    return res.status(400).json({ error: '"sql" field is required' });
  }

  try {
    const stmt = db.prepare(sql);
    if (stmt.reader) {
      const rows = stmt.all(...(Array.isArray(params) ? params : []));
      res.json({ rows, rowCount: rows.length });
    } else {
      const result = stmt.run(...(Array.isArray(params) ? params : []));
      res.json({
        changes: result.changes,
        lastInsertRowid: result.lastInsertRowid,
      });
    }
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
