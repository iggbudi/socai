// lib/features/evaluasi/routes.js — metrik riset M1–M7 (vertical slicing F7).
import { pool } from '../../shared/db.js';
import { getEvaluationMetrics } from './metrics.js';
import { requireLogin } from '../auth/requireLogin.js';

export function registerEvaluasiRoutes(app) {
  app.get('/api/agent/metrics', requireLogin, async (req, res) => {
    try {
      const metrics = await getEvaluationMetrics(pool, {
        since: req.query.since || null,
        days: req.query.days || null,
        channel: req.query.channel || null,
        autonomy_mode: req.query.autonomy_mode || null,
        source: req.query.source || null,
      });
      res.json(metrics);
    } catch (err) {
      console.error('GET /api/agent/metrics error:', err.message);
      const status = /tidak valid/i.test(err.message) ? 400 : 500;
      res.status(status).json({ error: err.message || 'Gagal menghitung metrik evaluasi' });
    }
  });
}
