'use strict';

const fs = require('fs');
const path = require('path');

const SQLITE_FILE_PATTERN = /\.(db|sqlite)$/i;

/**
 * @param {string} directoryPath
 * @returns {string[]}
 */
function findSqliteFiles(directoryPath) {
  const rootPath = path.resolve(directoryPath);
  let stats;

  try {
    stats = fs.statSync(rootPath);
  } catch {
    throw new Error(`Database directory does not exist: ${rootPath}`);
  }

  if (!stats.isDirectory()) {
    throw new Error(`Database directory is not a folder: ${rootPath}`);
  }

  /** @type {string[]} */
  const files = [];
  /** @type {string[]} */
  const pending = [rootPath];

  while (pending.length > 0) {
    const currentPath = pending.pop();
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
        continue;
      }
      if (entry.isFile() && SQLITE_FILE_PATTERN.test(entry.name)) {
        files.push(entryPath);
      }
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

/**
 * @param {string} value
 * @returns {string}
 */
function stripExtension(value) {
  return value.replace(/\.(db|sqlite)$/i, '');
}

/**
 * @param {string} value
 * @returns {string}
 */
function toDisplayName(value) {
  return value
    .split(path.sep)
    .filter(Boolean)
    .join(' - ')
}

/**
 * @param {string[]} filePaths
 * @param {string} directoryPath
 * @returns {Array<{name: string, path: string}>}
 */
function createDirectoryDatabaseConfigs(filePaths, directoryPath) {
  const rootPath = path.resolve(directoryPath)
  const relativePaths = filePaths.map((filePath) => path.relative(rootPath, filePath))
  const baseNameCounts = new Map()

  for (const relativePath of relativePaths) {
    const baseName = stripExtension(path.basename(relativePath))
    baseNameCounts.set(baseName, (baseNameCounts.get(baseName) || 0) + 1)
  }

  const usedNames = new Map()

  return filePaths.map((filePath, index) => {
    const relativePath = relativePaths[index]
    const baseName = stripExtension(path.basename(relativePath))
    const preferredName = baseNameCounts.get(baseName) > 1
      ? toDisplayName(stripExtension(relativePath))
      : baseName
    const count = (usedNames.get(preferredName) || 0) + 1
    usedNames.set(preferredName, count)
    const name = count === 1 ? preferredName : `${preferredName} ${count}`

    return { name, path: filePath }
  })
}

/**
 * @param {Array<{name: string, path: string}>} databases
 * @returns {Array<{name: string, path: string}>}
 */
function normalizeDatabaseList(databases) {
  return databases.map((database) => ({
    name: String(database.name || '').trim(),
    path: path.resolve(String(database.path || '')),
  }))
}

/**
 * @param {Object} config
 * @param {Array<{name: string, path: string}>} [config.databases]
 * @param {string} [config.directory]
 * @param {string} [config.folder]
 * @returns {Array<{name: string, path: string}>}
 */
function resolveDatabases(config = {}) {
  const databases = Array.isArray(config.databases) ? normalizeDatabaseList(config.databases) : []
  const directory = typeof config.directory === 'string' && config.directory.trim()
    ? config.directory.trim()
    : typeof config.folder === 'string' && config.folder.trim()
      ? config.folder.trim()
      : ''

  if (directory) {
    const filePaths = findSqliteFiles(directory)
    if (filePaths.length === 0) {
      throw new Error(`No .db or .sqlite files found in ${path.resolve(directory)}`)
    }
    databases.push(...createDirectoryDatabaseConfigs(filePaths, directory))
  }

  return databases
}

module.exports = { findSqliteFiles, resolveDatabases }