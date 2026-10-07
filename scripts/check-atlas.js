import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { connectDatabase } from '../src/database.js';

const config = loadConfig();
const db = await connectDatabase(config);
async function denied(label, operation) {
  try { await operation(); } catch (error) {
    assert.equal(error.code, 13, `${label}: loi khac Unauthorized; hay kiem tra Atlas`);
    console.log(`PASS ${label}: Unauthorized`);
    return;
  }
  throw new Error(`${label}: thao tac thanh cong, quyen Atlas dang qua rong!`);
}
try {
  await db.books.list();
  console.log('PASS reader: find books');
  await denied('reader cannot insert books', () => db.readDb.collection('books').insertOne({
    code: `permission-probe-${Date.now()}`, title: 'REMOVE IF ROLE TEST FAILS'
  }));
  await denied('writer cannot find books', () => db.writeDb.collection('books').findOne({}));
  // A random non-existent document makes these probes non-destructive even if roles are wrong.
  const missing = { _id: `missing-probe-${Date.now()}` };
  await denied('writer cannot update books', () => db.writeDb.collection('books').updateOne(missing, { $set: { test: true } }));
  await denied('writer cannot remove books', () => db.writeDb.collection('books').deleteOne(missing));
} finally { await db.close(); }
