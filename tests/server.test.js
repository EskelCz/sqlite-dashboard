'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');

const { createApp } = require('../src/server');

// ─── Test database setup ───────────────────────────────────────────────────────
let tmpDir;
let dbPath;
let nestedDbPath;
let sqlitePath;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-dashboard-test-'));
  dbPath = path.join(tmpDir, 'test.db');
  nestedDbPath = path.join(tmpDir, 'nested', 'test.db');
  sqlitePath = path.join(tmpDir, 'nested', 'analytics.sqlite');

  fs.mkdirSync(path.dirname(nestedDbPath), { recursive: true });

  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE users (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT    NOT NULL,
      age  INTEGER,
      email TEXT
    );
    INSERT INTO users (name, age, email) VALUES
      ('Alice', 30, 'alice@example.com'),
      ('Bob',   25, 'bob@example.com');

    CREATE TABLE products (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      price REAL
    );

    CREATE VIEW active_users AS SELECT * FROM users WHERE age > 20;
  `);
  db.close();

  const nestedDb = new Database(nestedDbPath);
  nestedDb.exec('CREATE TABLE metrics (id INTEGER PRIMARY KEY, value TEXT);');
  nestedDb.close();

  const sqliteDb = new Database(sqlitePath);
  sqliteDb.exec('CREATE TABLE events (id INTEGER PRIMARY KEY, name TEXT);');
  sqliteDb.close();
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Helper: make a fetch-like request against the app ────────────────────────
function makeRequest(app, method, url, body) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const fullUrl = `http://127.0.0.1:${port}${url}`;
      const options = {
        method,
        headers: { 'Content-Type': 'application/json' },
      };
      if (body !== undefined) options.body = JSON.stringify(body);

      // Use built-in fetch (Node 18+)
      fetch(fullUrl, options)
        .then(async (res) => {
          const json = await res.json();
          resolve({ status: res.status, body: json });
        })
        .catch(reject)
        .finally(() => server.close());
    });
    server.on('error', reject);
  });
}

function getApp() {
  return createApp({
    databases: [{ name: 'testdb', path: dbPath }],
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test('GET /api/databases returns configured databases', async () => {
  const app = getApp();
  const { status, body } = await makeRequest(app, 'GET', '/api/databases');
  assert.equal(status, 200);
  assert.deepEqual(body.databases, ['testdb']);
  app.locals.dbManager.closeAll();
});

test('GET /api/databases/:db/tables lists tables and views', async () => {
  const app = getApp();
  const { status, body } = await makeRequest(app, 'GET', '/api/databases/testdb/tables');
  assert.equal(status, 200);
  const names = body.tables.map((t) => t.name);
  assert.ok(names.includes('users'));
  assert.ok(names.includes('products'));
  assert.ok(names.includes('active_users'));
  app.locals.dbManager.closeAll();
});

test('GET /api/databases/:db/tables returns 404 for unknown db', async () => {
  const app = getApp();
  const { status, body } = await makeRequest(app, 'GET', '/api/databases/nonexistent/tables');
  assert.equal(status, 404);
  assert.ok(body.error);
  app.locals.dbManager.closeAll();
});

test('GET schema for a table returns columns and indices', async () => {
  const app = getApp();
  const { status, body } = await makeRequest(app, 'GET', '/api/databases/testdb/users/schema');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.columns));
  const colNames = body.columns.map((c) => c.name);
  assert.ok(colNames.includes('id'));
  assert.ok(colNames.includes('name'));
  assert.ok(colNames.includes('age'));
  app.locals.dbManager.closeAll();
});

test('GET rows returns paginated rows', async () => {
  const app = getApp();
  const { status, body } = await makeRequest(
    app, 'GET', '/api/databases/testdb/users/rows?page=1&pageSize=10'
  );
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.rows));
  assert.equal(body.rows.length, 2);
  assert.equal(body.total, 2);
  assert.ok('_rowid_' in body.rows[0]);
  app.locals.dbManager.closeAll();
});

test('GET rows with search filters results', async () => {
  const app = getApp();
  const { status, body } = await makeRequest(
    app, 'GET', '/api/databases/testdb/users/rows?search=Alice'
  );
  assert.equal(status, 200);
  assert.equal(body.rows.length, 1);
  assert.equal(body.rows[0].name, 'Alice');
  app.locals.dbManager.closeAll();
});

test('POST rows inserts a new row', async () => {
  const app = getApp();
  const { status, body } = await makeRequest(
    app, 'POST', '/api/databases/testdb/users/rows',
    { name: 'Charlie', age: 22, email: 'charlie@example.com' }
  );
  assert.equal(status, 201);
  assert.ok(body.rowid);

  // Verify it's in the DB
  const { body: listBody } = await makeRequest(app, 'GET', '/api/databases/testdb/users/rows');
  assert.equal(listBody.total, 3);
  app.locals.dbManager.closeAll();
});

test('PATCH row updates a row', async () => {
  const app = getApp();

  // Get existing rows to find a rowid
  const { body: listBody } = await makeRequest(app, 'GET', '/api/databases/testdb/users/rows');
  const rowid = listBody.rows[0]._rowid_;

  const { status } = await makeRequest(
    app, 'PATCH', `/api/databases/testdb/users/rows/${rowid}`,
    { name: 'Alice Updated' }
  );
  assert.equal(status, 200);
  app.locals.dbManager.closeAll();
});

test('PATCH row returns 404 for nonexistent rowid', async () => {
  const app = getApp();
  const { status } = await makeRequest(
    app, 'PATCH', '/api/databases/testdb/users/rows/99999',
    { name: 'Ghost' }
  );
  assert.equal(status, 404);
  app.locals.dbManager.closeAll();
});

test('DELETE row removes a row', async () => {
  const app = getApp();
  const { body: listBody } = await makeRequest(app, 'GET', '/api/databases/testdb/users/rows');
  const rowid = listBody.rows[listBody.rows.length - 1]._rowid_;

  const { status } = await makeRequest(
    app, 'DELETE', `/api/databases/testdb/users/rows/${rowid}`
  );
  assert.equal(status, 200);
  app.locals.dbManager.closeAll();
});

test('POST /query executes a SELECT', async () => {
  const app = getApp();
  const { status, body } = await makeRequest(
    app, 'POST', '/api/databases/testdb/query',
    { sql: 'SELECT count(*) AS cnt FROM users' }
  );
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.rows));
  assert.equal(body.rows[0].cnt >= 1, true);
  app.locals.dbManager.closeAll();
});

test('POST /query returns error for invalid SQL', async () => {
  const app = getApp();
  const { status, body } = await makeRequest(
    app, 'POST', '/api/databases/testdb/query',
    { sql: 'SELECT * FROM nonexistent_table_xyz' }
  );
  assert.equal(status, 400);
  assert.ok(body.error);
  app.locals.dbManager.closeAll();
});

test('GET rows returns 400 for invalid table name', async () => {
  const app = getApp();
  const { status, body } = await makeRequest(
    app, 'GET', '/api/databases/testdb/; DROP TABLE users;/rows'
  );
  assert.equal(status, 400);
  assert.ok(body.error);
  app.locals.dbManager.closeAll();
});

test('createApp throws if no databases configured', () => {
  assert.throws(
    () => createApp({ databases: [] }),
    /non-empty array/
  );
});

test('createApp discovers sqlite files from a directory recursively', () => {
  const app = createApp({ directory: tmpDir });
  const names = app.locals.dbManager.getDatabaseNames();

  assert.deepEqual(names, ['analytics', 'nested - test', 'test']);
  app.locals.dbManager.closeAll();
});

test('createApp supports folder alias for directory scans', () => {
  const app = createApp({ folder: tmpDir });
  const names = app.locals.dbManager.getDatabaseNames();

  assert.ok(names.includes('analytics'));
  assert.ok(names.includes('test'));
  app.locals.dbManager.closeAll();
});

test('createApp throws when a directory has no sqlite files', () => {
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-dashboard-empty-'));

  assert.throws(
    () => createApp({ directory: emptyDir }),
    /No \.db or \.sqlite files found/
  );

  fs.rmSync(emptyDir, { recursive: true, force: true });
});
