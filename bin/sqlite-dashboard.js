#!/usr/bin/env node
'use strict';

const path = require('path');
const { createServer } = require('../src/server');

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: sqlite-dashboard [options] <database-path> [<database-path> ...]

Options:
  --port, -p <number>   Port to listen on (default: 3000)
  --host <string>       Host to bind to (default: 127.0.0.1)
  --name <string>       Name for the last specified database file
  --help, -h            Show this help message

Examples:
  sqlite-dashboard ./app.db
  sqlite-dashboard --port 4000 ./data/prod.db ./data/dev.db
  sqlite-dashboard --name "Production DB" ./prod.db --name "Dev DB" ./dev.db
`);
  process.exit(0);
}

let port = 3000;
let host = '127.0.0.1';
const databases = [];
const pendingNames = [];

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--port' || arg === '-p') {
    port = parseInt(args[++i], 10);
  } else if (arg === '--host') {
    host = args[++i];
  } else if (arg === '--name') {
    pendingNames.push(args[++i]);
  } else if (!arg.startsWith('--')) {
    // Treat as database path
    const dbPath = path.resolve(arg);
    const name =
      pendingNames.shift() || path.basename(dbPath, path.extname(dbPath));
    databases.push({ name, path: dbPath });
  }
}

if (databases.length === 0) {
  console.error(
    'Error: No database files specified.\nRun `sqlite-dashboard --help` for usage.'
  );
  process.exit(1);
}

createServer({ databases, port, host });
