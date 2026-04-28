# sqlite-dashboard

Web-based SQLite viewer and editor for self-hosting, loosely modeled after the Supabase dashboard.

Projects can install this library, point it at one or more SQLite files, and immediately get a browser UI for viewing and editing database contents.

## Features

- **Multi-database support** – configure any number of SQLite files
- **Table browser** – sidebar with database/table navigator
- **Data grid** – paginated, sortable, searchable row viewer
- **Inline row editing** – click to edit any cell in-place
- **Row insertion** – form built from the table schema
- **Row deletion** – with confirmation dialog
- **Schema viewer** – column definitions and index information
- **SQL editor** – write and run arbitrary SQL queries with results display
- **Zero build step** – ships as plain HTML/CSS/JS, no bundler needed

## Quick Start

### As a library

```bash
npm install sqlite-dashboard --save-dev
```

```js
const { createDashboard } = require('sqlite-dashboard');

createDashboard({
  directory: './data',
  basePath: '/sqlite-dashboard', // optional, for reverse-proxy subpaths
  port: 3000,           // optional, default 3000
  host: '127.0.0.1',   // optional, default 127.0.0.1 (localhost only)
});
// → SQLite Dashboard running at http://127.0.0.1:3000
```

### From the command line

```bash
npx sqlite-dashboard ./path/to/my.db

# Multiple files with custom names
npx sqlite-dashboard --name "Production" ./prod.db --name "Dev" ./dev.db

# Scan a folder recursively for .db and .sqlite files
npx sqlite-dashboard --dir ./data

# Custom port
npx sqlite-dashboard --port 4000 ./app.db

# Require a password before showing the dashboard
SQLITE_DASHBOARD_PASSWORD="choose-a-password" npx sqlite-dashboard ./app.db

# Serve the dashboard under a URL prefix
SQLITE_DASHBOARD_BASE_PATH="/sqlite-dashboard" npx sqlite-dashboard ./app.db
```

## API

### `createDashboard(config)`

Starts the HTTP server and returns `{ app, server, close }`.

| Option              | Type                              | Default       | Description                         |
|---------------------|-----------------------------------|---------------|-------------------------------------|
| `config.databases`  | `Array<{name: string, path: string}>` | **required** | SQLite files to expose             |
| `config.directory`  | `string`                          |               | Folder to scan recursively for `.db` and `.sqlite` files |
| `config.folder`     | `string`                          |               | Alias for `config.directory`       |
| `config.basePath`   | `string`                          |               | URL path prefix for assets, API routes, and login |
| `config.port`       | `number`                          | `3000`        | Port to listen on                   |
| `config.host`       | `string`                          | `'127.0.0.1'` | Bind address                        |

You can pass `config.databases`, `config.directory`, or both. Files discovered from the directory are added automatically.

Set `SQLITE_DASHBOARD_PASSWORD` in the server environment to require a password form before the dashboard and API are available.
Set `SQLITE_DASHBOARD_BASE_PATH` (or `BASE_PATH`) in the server environment to serve the dashboard under a prefixed path such as `/sqlite-dashboard`.

### `createApp(config)`

Returns the Express app without starting a server, useful for testing or custom deployments.

## REST API

The server exposes a JSON API under `/api`:

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/databases` | List configured databases |
| `GET`  | `/api/databases/:db/tables` | List tables and views |
| `GET`  | `/api/databases/:db/:table/schema` | Column and index definitions |
| `GET`  | `/api/databases/:db/:table/rows` | Paginated rows (`page`, `pageSize`, `sortBy`, `sortOrder`, `search`) |
| `POST` | `/api/databases/:db/:table/rows` | Insert a row |
| `PATCH`| `/api/databases/:db/:table/rows/:rowid` | Update a row |
| `DELETE`| `/api/databases/:db/:table/rows/:rowid` | Delete a row |
| `POST` | `/api/databases/:db/query` | Execute raw SQL (`{ sql, params? }`) |

## Development

```bash
git clone https://github.com/EskelCz/sqlite-dashboard
cd sqlite-dashboard
npm install
npm test
```

> **Security note:** The SQL Editor allows running arbitrary SQL against your databases.
> The server binds to `127.0.0.1` by default; do not expose it to the public internet without authentication.
