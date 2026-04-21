'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const TARGET_DIRS = ['bin', 'src', 'tests'];
const filesToCheck = [];

function collectJsFiles(directory) {
  if (!fs.existsSync(directory)) return;

  const entries = fs.readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectJsFiles(fullPath);
      continue;
    }

    if (entry.isFile() && fullPath.endsWith('.js')) {
      filesToCheck.push(fullPath);
    }
  }
}

for (const targetDir of TARGET_DIRS) {
  collectJsFiles(path.join(ROOT, targetDir));
}

if (filesToCheck.length === 0) {
  console.log('No JavaScript files found to lint.');
  process.exit(0);
}

for (const filePath of filesToCheck.sort()) {
  const result = spawnSync(process.execPath, ['--check', filePath], {
    stdio: 'inherit'
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

console.log(`Lint passed for ${filesToCheck.length} JavaScript files.`);
