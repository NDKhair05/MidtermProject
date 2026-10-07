import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeBook, ValidationError } from '../src/book.js';
import { loadConfig } from '../src/config.js';
import { AtlasSessionStore } from '../src/atlas-session-store.js';
import { createApp } from '../src/app.js';

const config = { fullName: 'Sinh vien mau', mssv: '012345678', prefix: '678', vatPercent: 12,
  production: false, sessionSecret: 'test-secret-only-never-use-in-production-123' };

// Test double for Atlas only; production always uses MongoClient-backed collections.
function fixture() {
  const sessions = new Map();
  const calls = [];
  const readDb = { collection(name) {
    assert.equal(name, 'sessions');
    return { async findOne(filter) {
      calls.push('reader.find');
      const doc = sessions.get(filter._id);
      return doc && doc.expiresAt > filter.expiresAt.$gt ? { ...doc } : null;
    } };
  } };
  const writeDb = { collection(name) {
    assert.equal(name, 'sessions');
    return {
      async updateOne(filter, change, options = {}) {
        calls.push('writer.update');
        if (sessions.has(filter._id) || options.upsert) {
          sessions.set(filter._id, { ...sessions.get(filter._id), ...change.$set });
        }
      },
      async deleteOne(filter) { calls.push('writer.remove'); sessions.delete(filter._id); }
    };
  } };
  const rows = [];
  const books = {
    async list() { return [...rows]; },
    async insert(doc) {
      if (rows.some(row => row.code === doc.code)) throw Object.assign(new Error('duplicate'), { code: 11000 });
      rows.push(doc);
    }
  };
  return { readDb, writeDb, sessions, calls, rows, books };
}
function token(response) { return response.text.match(/name="_csrf" value="([a-f0-9]+)"/)[1]; }
function cookie(response) { return response.headers['set-cookie'][0].split(';')[0]; }
function callStore(store, method, ...args) {
  return new Promise((resolve, reject) => store[method](...args, (error, value) => error ? reject(error) : resolve(value)));
}

test('MSSV keeps leading zeros and computes suffix/VAT', () => {
  const c = loadConfig({ FULL_NAME: 'Test', MSSV: '001000', MONGO_READ_URI: 'test', MONGO_WRITE_URI: 'test',
    SESSION_SECRET: config.sessionSecret });
  assert.equal(c.dbName, 'DB_001000'); assert.equal(c.prefix, '000'); assert.equal(c.vatPercent, 4);
});
test('server computes VAT for each final MSSV digit; ignores forged finalPrice', () => {
  for (let digit = 0; digit <= 9; digit++) {
    const book = makeBook({ code: '678-001', title: 'Cloud', basePrice: '100000', finalPrice: 1 },
      { ...config, vatPercent: digit + 4 });
    assert.equal(book.finalPrice, 100000 + (digit + 4) * 1000);
  }
});
test('validation rejects bad prefix, empty title, arrays, decimal, negative and oversized amounts', () => {
  const valid = { code: '678-001', title: 'Cloud', basePrice: '100' };
  for (const invalid of [{ code: '111-001' }, { title: ' ' }, { basePrice: ['100'] },
    { basePrice: '1.5' }, { basePrice: '-1' }, { basePrice: '1000000001' }]) {
    assert.throws(() => makeBook({ ...valid, ...invalid }, config), ValidationError);
  }
});
test('two app instances restore same Atlas-backed session and accept the same CSRF token', async () => {
  const f = fixture();
  const appA = createApp({ config, books: f.books, store: new AtlasSessionStore(f.readDb, f.writeDb) });
  const first = await request(appA).get('/').expect(200);
  const sidCookie = cookie(first);
  const csrf = token(first);
  assert.equal(f.sessions.size, 1);
  assert.match(first.headers['set-cookie'][0], /HttpOnly/);
  assert.match(first.headers['set-cookie'][0], /SameSite=Lax/);
  const started = first.text.match(/Phiên bắt đầu: ([^<]+)/)[1];
  // New Express instance and new Store; only shared database state survives.
  const appB = createApp({ config, books: f.books, store: new AtlasSessionStore(f.readDb, f.writeDb) });
  const restored = await request(appB).get('/').set('Cookie', sidCookie).expect(200);
  assert.equal(token(restored), csrf); assert.ok(restored.text.includes(started));
  await request(appB).post('/books').set('Cookie', sidCookie).type('form')
    .send({ _csrf: csrf, code: '678-001', title: '<script>alert(1)</script>', basePrice: '100000' }).expect(303);
  assert.equal(f.rows[0].finalPrice, 112000);
  const page = await request(appA).get('/').set('Cookie', sidCookie).expect(200);
  assert.ok(page.text.includes('&lt;script&gt;')); assert.ok(page.text.includes('112.000'));
  assert.ok(f.calls.includes('reader.find')); assert.ok(f.calls.includes('writer.update'));
});
test('invalid input, missing CSRF and duplicate code never add a second book', async () => {
  const f = fixture();
  const app = createApp({ config, books: f.books, store: new AtlasSessionStore(f.readDb, f.writeDb) });
  const first = await request(app).get('/');
  const sid = cookie(first); const csrf = token(first);
  const post = data => request(app).post('/books').set('Cookie', sid).type('form').send(data);
  await post({ code: '678-001', title: 'Cloud', basePrice: '100' }).expect(403);
  await post({ _csrf: csrf, code: '111-001', title: 'Cloud', basePrice: '100' }).expect(400);
  assert.equal(f.rows.length, 0);
  const valid = { _csrf: csrf, code: '678-001', title: 'Cloud', basePrice: '100' };
  await post(valid).expect(303); await post(valid).expect(409); assert.equal(f.rows.length, 1);
});
test('store rejects expired session and supports touch/destroy without reader writes', async () => {
  const f = fixture(); const store = new AtlasSessionStore(f.readDb, f.writeDb);
  await callStore(store, 'set', 'expired', { cookie: { expires: new Date(Date.now() - 1000) } });
  assert.equal(await callStore(store, 'get', 'expired'), null);
  await callStore(store, 'set', 'valid', { cookie: { expires: new Date(Date.now() + 10000) }, csrf: 'abc' });
  assert.equal((await callStore(store, 'get', 'valid')).csrf, 'abc');
  const future = new Date(Date.now() + 50000);
  await callStore(store, 'touch', 'valid', { cookie: { expires: future } });
  assert.equal(f.sessions.get('valid').expiresAt.getTime(), future.getTime());
  await callStore(store, 'destroy', 'valid');
  assert.equal(await callStore(store, 'get', 'valid'), null);
});
test('production sets secure cookie through Render proxy', async () => {
  const f = fixture();
  const app = createApp({ config: { ...config, production: true }, books: f.books,
    store: new AtlasSessionStore(f.readDb, f.writeDb) });
  const response = await request(app).get('/').set('X-Forwarded-Proto', 'https').expect(200);
  assert.match(response.headers['set-cookie'][0], /; Secure/);
});
test('health reports database unavailable', async () => {
  const f = fixture();
  const app = createApp({ config, books: f.books, store: new AtlasSessionStore(f.readDb, f.writeDb),
    health: async () => { throw new Error('offline'); } });
  await request(app).get('/health').expect(503);
});
