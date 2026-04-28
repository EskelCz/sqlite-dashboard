'use strict';

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DatabaseManager } = require('./db');
const { resolveBasePath, resolveDatabases } = require('./config');
const databasesRouter = require('./api/databases');
const tablesRouter = require('./api/tables');

const AUTH_COOKIE_NAME = 'sqlite_dashboard_session';
const PASSWORD_ENV_VAR = 'SQLITE_DASHBOARD_PASSWORD';
const PUBLIC_DIR = path.join(__dirname, 'public');
const INDEX_PATH = path.join(PUBLIC_DIR, 'index.html');

/**
 * @param {string} basePath
 * @param {string} routePath
 * @returns {string}
 */
function joinBasePath(basePath, routePath) {
  if (!basePath) return routePath;
  if (routePath === '/') return `${basePath}/`;
  return `${basePath}${routePath.startsWith('/') ? routePath : `/${routePath}`}`;
}

/**
 * @param {string} basePath
 * @returns {string}
 */
function renderIndexPage(basePath) {
  const configScript =
    `<script>window.SQLITE_DASHBOARD_CONFIG = ${JSON.stringify({ basePath })};</script>`;

  return fs.readFileSync(INDEX_PATH, 'utf8')
    .replace('href="/css/app.css"', `href="${joinBasePath(basePath, '/css/app.css')}"`)
    .replace(
      '<script src="/js/app.js"></script>',
      `${configScript}\n<script src="${joinBasePath(basePath, '/js/app.js')}"></script>`
    );
}

/**
 * @param {string} actionPath
 * @param {boolean} [hasError=false]
 * @returns {string}
 */
function renderLoginPage(actionPath, hasError = false) {
  const errorMarkup = hasError
    ? '<p class="error" role="alert">Incorrect password. Try again.</p>'
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SQLite Dashboard Login</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      min-height: 100vh;
      margin: 0;
      display: grid;
      place-items: center;
      background: #f9fafb;
      color: #111827;
      font: 14px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    main {
      width: min(100% - 32px, 360px);
      padding: 28px;
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0,0,0,.08);
    }
    h1 {
      margin: 0 0 8px;
      font-size: 20px;
      line-height: 1.2;
    }
    p {
      margin: 0 0 20px;
      color: #6b7280;
    }
    label {
      display: block;
      margin-bottom: 6px;
      font-weight: 600;
    }
    input {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      font: inherit;
    }
    input:focus {
      border-color: #3ecf8e;
      outline: 2px solid rgba(62,207,142,.18);
      outline-offset: 0;
    }
    button {
      width: 100%;
      margin-top: 16px;
      padding: 10px 12px;
      border: 0;
      border-radius: 6px;
      background: #3ecf8e;
      color: #fff;
      cursor: pointer;
      font: inherit;
      font-weight: 700;
    }
    button:hover { background: #2dbf7e; }
    .error {
      margin: 0 0 14px;
      color: #b91c1c;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <main>
    <h1>SQLite Dashboard</h1>
    <p>Enter the dashboard password to continue.</p>
    ${errorMarkup}
    <form method="post" action="${actionPath}">
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" autofocus />
      <button type="submit">Sign in</button>
    </form>
  </main>
</body>
</html>`;
}

/**
 * @param {string | undefined} header
 * @returns {Record<string, string>}
 */
function parseCookies(header) {
  if (!header) return {};

  return header.split(';').reduce((cookies, cookie) => {
    const separatorIndex = cookie.indexOf('=');
    if (separatorIndex === -1) return cookies;

    const name = cookie.slice(0, separatorIndex).trim();
    const value = cookie.slice(separatorIndex + 1).trim();
    if (name) {
      try {
        cookies[name] = decodeURIComponent(value);
      } catch {
        cookies[name] = value;
      }
    }
    return cookies;
  }, {});
}

/**
 * @param {string} left
 * @param {string} right
 * @returns {boolean}
 */
function passwordsMatch(left, right) {
  const leftHash = crypto.createHash('sha256').update(left).digest();
  const rightHash = crypto.createHash('sha256').update(right).digest();
  return crypto.timingSafeEqual(leftHash, rightHash);
}

/**
 * @param {express.Application} app
 * @param {string} password
 * @param {string} basePath
 */
function addPasswordAuth(app, password, basePath) {
  const sessions = new Set();
  app.locals = app.locals || {};
  app.locals.authSessions = sessions;
  const homePath = joinBasePath(basePath, '/');
  const loginPath = joinBasePath(basePath, '/login');

  app.use(express.urlencoded({ extended: false }));

  app.get('/login', (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    if (sessions.has(cookies[AUTH_COOKIE_NAME])) {
      res.redirect(homePath);
      return;
    }

    res.type('html').send(renderLoginPage(loginPath));
  });

  app.post('/login', (req, res) => {
    const submittedPassword = typeof req.body.password === 'string' ? req.body.password : '';
    if (!passwordsMatch(submittedPassword, password)) {
      res.status(401).type('html').send(renderLoginPage(loginPath, true));
      return;
    }

    const token = crypto.randomBytes(32).toString('base64url');
    sessions.add(token);
    res.cookie(AUTH_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.secure,
    });
    res.redirect(homePath);
  });

  app.use((req, res, next) => {
    const cookies = parseCookies(req.headers.cookie);
    if (sessions.has(cookies[AUTH_COOKIE_NAME])) {
      next();
      return;
    }

    if (req.path.startsWith('/api/')) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    res.redirect(loginPath);
  });
}

/**
 * Creates an Express application for the SQLite dashboard.
 * @param {Object} config
 * @param {Array<{name: string, path: string}>} config.databases
 * @param {string} [config.basePath]
 * @returns {import('express').Application}
 */
function createApp(config) {
  const databases = resolveDatabases(config);
  const basePath = resolveBasePath(config);
  if (!Array.isArray(databases) || databases.length === 0) {
    throw new Error(
      'config.databases must be a non-empty array of {name, path} objects or config.directory must contain SQLite files'
    );
  }

  const dbManager = new DatabaseManager(databases);

  const app = express();
  const router = express.Router();
  router.use(express.json());

  // Store dbManager so routes can access it via req.app.locals
  app.locals.dbManager = dbManager;
  app.locals.basePath = basePath;

  const password = process.env[PASSWORD_ENV_VAR];
  if (password) {
    addPasswordAuth(router, password, basePath);
  }

  router.get(['/', '/index.html'], (req, res) => {
    res.type('html').send(renderIndexPage(basePath));
  });

  // Serve static frontend files
  router.use(express.static(PUBLIC_DIR, { index: false }));

  // API routes
  router.use('/api/databases', databasesRouter);
  router.use('/api/databases/:dbName', tablesRouter);

  if (basePath) {
    app.get('/', (req, res) => {
      res.redirect(joinBasePath(basePath, '/'));
    });
    app.use(basePath, router);
  } else {
    app.use(router);
  }

  return app;
}

/**
 * Creates and starts the SQLite dashboard server.
 * @param {Object} config
 * @param {Array<{name: string, path: string}>} config.databases
 * @param {string} [config.basePath]
 * @param {number} [config.port=3000]
 * @param {string} [config.host='127.0.0.1']
 * @returns {{ app, server, close() }}
 */
function createServer(config) {
  const port = config.port || 3000;
  const host = config.host || '127.0.0.1';

  const app = createApp(config);

  const server = app.listen(port, host, () => {
    const basePath = app.locals.basePath || '';
    const dashboardUrl = `http://${host}:${port}${basePath}`;
    const clickableUrl = `\u001B]8;;${dashboardUrl}\u0007${dashboardUrl}\u001B]8;;\u0007`;
    console.log(`SQLite Dashboard running at ${clickableUrl}`);
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
