// Load better-sqlite3 the way the packaged app does. Run by the packaged executable with ELECTRON_RUN_AS_NODE=1
// (see electron-smoke.yml): it requires the copy inside the app's own resources/app.asar, because a plain
// require('better-sqlite3') from the repo would load the development copy in node_modules and pass without testing
// the package. better-sqlite3 13 ships N-API prebuilds inside the package, so the native file must come from
// app.asar.unpacked/node_modules/better-sqlite3/prebuilds/.
const path = require('path');

const resources = process.platform === 'darwin'
  ? path.join(path.dirname(process.execPath), '..', 'Resources')
  : path.join(path.dirname(process.execPath), 'resources');
const Database = require(path.join(resources, 'app.asar', 'node_modules', 'better-sqlite3'));

const db = new Database(':memory:');
const { v } = db.prepare('SELECT sqlite_version() AS v').get();
db.close();

// Windows reports backslash paths; an empty list must fail, not pass every() vacuously
const expected = 'app.asar.unpacked/node_modules/better-sqlite3/prebuilds/';
const loaded = process.report.getReport().sharedObjects
  .map((p) => p.replace(/\\/g, '/'))
  .filter((p) => /better[-_]sqlite3/.test(p));
if (loaded.length === 0 || !loaded.every((p) => p.includes(expected))) {
  throw new Error(`better-sqlite3 native file did not load from ${expected}: ${JSON.stringify(loaded)}`);
}
console.log(`packaged native binding OK (SQLite ${v}): ${loaded.join(', ')}`);
