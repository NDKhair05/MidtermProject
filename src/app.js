import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import { engine } from 'express-handlebars';
import { makeBook, ValidationError } from './book.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
export function createApp({ config, books, store, health = async () => {} }) {
  if (!store) throw new Error('Atlas session store is required');
  const app = express();
  app.disable('x-powered-by');
  if (config.production) app.set('trust proxy', 1); // Render reverse proxy
  app.use(helmet());
  app.use(express.urlencoded({ extended: false, limit: '10kb' }));
  app.engine('hbs', engine({ extname: '.hbs', helpers: {
    money: value => new Intl.NumberFormat('vi-VN').format(value)
  } }));
  app.set('view engine', 'hbs');
  app.set('views', path.join(dirname, '../views'));
  app.get('/health', async (req, res) => {
    try { await health(); res.json({ status: 'ok' }); }
    catch { res.status(503).json({ status: 'unavailable' }); }
  });
  app.use(session({
    name: 'books.sid', secret: config.sessionSecret, store,
    resave: false, saveUninitialized: false,
    cookie: { httpOnly: true, secure: config.production, sameSite: 'lax', maxAge: 86400000 }
  }));
  app.use((req, res, next) => {
    res.locals.fullName = config.fullName;
    res.locals.mssv = config.mssv;
    res.locals.vatPercent = config.vatPercent;
    res.locals.prefix = config.prefix;
    next();
  });
  async function renderBooks(req, res, status = 200, message = '') {
    const rows = await books.list();
    res.status(status).render('books', {
      books: rows, csrf: req.session.csrf, message,
      startedAt: req.session.startedAt,
      instanceId: process.env.RENDER_INSTANCE_ID || `pid-${process.pid}`
    });
  }
  app.get('/', async (req, res) => {
    if (!req.session.csrf) {
      req.session.csrf = randomBytes(32).toString('hex');
      req.session.startedAt = new Date().toISOString();
    }
    await renderBooks(req, res);
  });
  app.post('/books', async (req, res) => {
    const expected = req.session.csrf;
    const received = req.body._csrf;
    if (typeof received !== 'string' || typeof expected !== 'string'
      || Buffer.byteLength(received) !== Buffer.byteLength(expected)
      || !timingSafeEqual(Buffer.from(received), Buffer.from(expected))) {
      return res.status(403).send('Phien/form khong hop le. Hay mo lai trang chu.');
    }
    try {
      const book = makeBook(req.body, config);
      await books.insert(book); // No read operation on write-only connection.
      res.redirect(303, '/'); // Browser GET uses reader connection.
    } catch (error) {
      if (error instanceof ValidationError) return renderBooks(req, res, 400, error.message);
      if (error.code === 11000) return renderBooks(req, res, 409, 'Ma sach da ton tai.');
      throw error;
    }
  });
  app.use((req, res) => res.status(404).send('Khong tim thay trang.'));
  app.use((error, req, res, next) => {
    // Log classification, not error messages which could contain credentials or input data.
    console.error('Request failed', { name: error.name, code: error.code });
    if (res.headersSent) return next(error);
    res.status(500).send('He thong tam thoi gap loi. Vui long thu lai.');
  });
  return app;
}
