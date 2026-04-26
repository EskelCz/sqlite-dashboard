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
let symlinkDbPath;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-dashboard-test-'));
  dbPath = path.join(tmpDir, 'test.db');
  nestedDbPath = path.join(tmpDir, 'nested', 'test.db');
  sqlitePath = path.join(tmpDir, 'nested', 'analytics.sqlite');
  symlinkDbPath = path.join(tmpDir, 'linked-test.db');

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

  try {
    fs.symlinkSync(dbPath, symlinkDbPath);
  } catch {
    symlinkDbPath = null;
  }
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Helper: make a fetch-like request against the app ────────────────────────
function makeRequest(app, method, url, body) {
  return makeRequestWithHeaders(app, method, url, {}, body);
}

function makeRequestWithHeaders(app, method, url, headers = {}, body) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1');

    server.once('listening', () => {
      const port = server.address().port;
      const fullUrl = `http://127.0.0.1:${port}${url}`;
      const options = {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
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
    server.once('error', reject);
  });
}

function makeRawRequest(app, method, url, options = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1');

    server.once('listening', () => {
      const port = server.address().port;
      const fullUrl = `http://127.0.0.1:${port}${url}`;
      const headers = options.headers || {};

      fetch(fullUrl, {
        method,
        headers,
        body: options.body,
        redirect: 'manual',
      })
        .then(async (res) => {
          const text = await res.text();
          resolve({ status: res.status, headers: res.headers, text });
        })
        .catch(reject)
        .finally(() => server.close());
    });
    server.once('error', reject);
  });
}

function getApp() {
  return createApp({
    databases: [{ name: 'testdb', path: dbPath }],
  });
}

function getPasswordApp(password = 'secret') {
  const previousPassword = process.env.SQLITE_DASHBOARD_PASSWORD;
  process.env.SQLITE_DASHBOARD_PASSWORD = password;

  try {
    return getApp();
  } finally {
    if (previousPassword === undefined) {
      delete process.env.SQLITE_DASHBOARD_PASSWORD;
    } else {
      process.env.SQLITE_DASHBOARD_PASSWORD = previousPassword;
    }
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test('GET /api/databases returns configured databases', async () => {
  const app = getApp();
  const { status, body } = await makeRequest(app, 'GET', '/api/databases');
  assert.equal(status, 200);
  assert.deepEqual(body.databases, ['testdb']);
  app.locals.dbManager.closeAll();
});

test('password auth redirects browser requests to login', async () => {
  const app = getPasswordApp();
  const { status, headers } = await makeRawRequest(app, 'GET', '/');

  assert.equal(status, 302);
  assert.equal(headers.get('location'), '/login');
  app.locals.dbManager.closeAll();
});

test('password auth shows a login form', async () => {
  const app = getPasswordApp();
  const { status, text } = await makeRawRequest(app, 'GET', '/login');

  assert.equal(status, 200);
  assert.match(text, /<form method="post" action="\/login">/);
  assert.match(text, /name="password"/);
  app.locals.dbManager.closeAll();
});

test('password auth rejects incorrect passwords', async () => {
  const app = getPasswordApp();
  const { status, text } = await makeRawRequest(app, 'POST', '/login', {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: 'wrong' }),
  });

  assert.equal(status, 401);
  assert.match(text, /Incorrect password/);
  app.locals.dbManager.closeAll();
});

test('password auth allows requests with a valid session cookie', async () => {
  const app = getPasswordApp();
  const login = await makeRawRequest(app, 'POST', '/login', {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: 'secret' }),
  });
  const cookie = login.headers.get('set-cookie');

  assert.equal(login.status, 302);
  assert.ok(cookie);
  const sessionCookie = cookie.split(';')[0];

  const { status, body } = await makeRequestWithHeaders(
    app, 'GET', '/api/databases',
    { Cookie: sessionCookie }
  );
  assert.equal(status, 200);
  assert.deepEqual(body.databases, ['testdb']);
  app.locals.dbManager.closeAll();
});

test('password auth returns 401 for unauthenticated API requests', async () => {
  const app = getPasswordApp();
  const { status, body } = await makeRequest(app, 'GET', '/api/databases');

  assert.equal(status, 401);
  assert.equal(body.error, 'Authentication required');
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

test('createApp discovers symlinked sqlite files from a directory', () => {
  if (!symlinkDbPath) {
    return;
  }

  const app = createApp({ directory: tmpDir });
  const names = app.locals.dbManager.getDatabaseNames();

  assert.ok(names.includes('linked-test'));
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
