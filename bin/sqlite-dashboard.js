#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { createServer } = require('../src/server');

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: sqlite-dashboard [options] <database-path> [<database-path> ...]

Options:
  --port, -p <number>   Port to listen on (default: 3000)
  --host <string>       Host to bind to (default: 127.0.0.1)
  --dir, --folder <dir> Scan a folder recursively for .db and .sqlite files
  --name <string>       Name for the last specified database file
  --help, -h            Show this help message

Examples:
  sqlite-dashboard ./app.db
  sqlite-dashboard --port 4000 ./data/prod.db ./data/dev.db
  sqlite-dashboard --dir ./data
  sqlite-dashboard --name "Production DB" ./prod.db --name "Dev DB" ./dev.db
`);
  process.exit(0);
}

let port = 3000;
let host = '127.0.0.1';
let directory = '';
const databases = [];
const pendingNames = [];

/**
 * @param {string} value
 * @returns {boolean}
 */
function isDirectory(value) {
  try {
    return fs.statSync(value).isDirectory();
  } catch {
    return false;
  }
}

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--port' || arg === '-p') {
    port = parseInt(args[++i], 10);
  } else if (arg === '--host') {
    host = args[++i];
  } else if (arg === '--dir' || arg === '--folder') {
    directory = args[++i];
  } else if (arg === '--name') {
    pendingNames.push(args[++i]);
  } else if (!arg.startsWith('--')) {
    const resolvedPath = path.resolve(arg);
    if (!directory && isDirectory(resolvedPath)) {
      directory = resolvedPath;
      continue;
    }
    const name = pendingNames.shift() || path.basename(resolvedPath, path.extname(resolvedPath));
    databases.push({ name, path: resolvedPath });
  }
}

if (databases.length === 0 && !directory) {
  console.error(
    'Error: No database files or directory specified.\nRun `sqlite-dashboard --help` for usage.'
  );
  process.exit(1);
}

createServer({ databases, directory, port, host });
