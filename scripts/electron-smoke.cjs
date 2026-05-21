const Database = require('better-sqlite3');

const db = new Database(':memory:');
db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
db.prepare('INSERT INTO t (v) VALUES (?)').run('hello');
const row = db.prepare('SELECT v FROM t WHERE id = 1').get();
if (!row || row.v !== 'hello') {
  throw new Error('better-sqlite3 native binding failed');
}
console.log('native binding OK');
db.close();
