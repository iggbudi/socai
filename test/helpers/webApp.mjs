/**
 * Harness route-level (S29 / C1).
 * Membangun app Express minimal dengan sesi palsu yang mendukung regenerate()
 * dan destroy(), supaya route bisa diuji tanpa store sesi, DB, atau HTTP nyata.
 */
import express from 'express';

/**
 * Sesi palsu yang meniru kontrak express-session seperlunya.
 * `events` mencatat regenerate/destroy agar test bisa mengassert pemanggilannya.
 */
export function createFakeSession(initial = {}, { regenerateError = null } = {}) {
  const session = { ...initial };
  const events = [];

  Object.defineProperty(session, 'events', { value: events, enumerable: false });
  Object.defineProperty(session, 'regenerate', {
    enumerable: false,
    value(cb) {
      events.push('regenerate');
      if (regenerateError) return cb(regenerateError);
      for (const key of Object.keys(session)) delete session[key];
      cb(null);
    },
  });
  Object.defineProperty(session, 'destroy', {
    enumerable: false,
    value(cb) {
      events.push('destroy');
      for (const key of Object.keys(session)) delete session[key];
      cb(null);
    },
  });

  return session;
}

/**
 * @param {(app: import('express').Express) => void} register — pemasangan route.
 * @param {object} options
 * @param {object|null} options.session — isi sesi awal; null berarti belum login.
 */
export function createRouteApp(register, { session = null, sessionId = 'sid-test', ...rest } = {}) {
  const app = express();
  const fakeSession = session ? createFakeSession(session, rest) : createFakeSession({}, rest);

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use((req, res, next) => {
    req.session = fakeSession;
    req.sessionID = sessionId;
    res.locals.cspNonce = 'test-nonce';
    next();
  });

  register(app);
  return { app, session: fakeSession };
}

/** Menjalankan app pada port ephemeral dan mengembalikan base URL + penutupnya. */
export async function listen(app) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** Pool palsu: menjawab dengan rows tetap, atau melempar bila diberi Error. */
export function fakePool(rowsOrError, { capture = [] } = {}) {
  return {
    capture,
    query: async (sql, params) => {
      capture.push({ sql, params });
      if (rowsOrError instanceof Error) throw rowsOrError;
      if (typeof rowsOrError === 'function') return rowsOrError(sql, params);
      return { rows: rowsOrError ?? [] };
    },
  };
}
