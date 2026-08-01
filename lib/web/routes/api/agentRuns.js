import { pool } from '../../../shared/db.js';
import { listAgentRuns } from '../../../agentRuns.js';
import { getEvaluationMetrics } from '../../../evaluationMetrics.js';
import { requireLogin } from '../../../features/auth/requireLogin.js';

export function registerAgentRunsRoutes(app) {
  app.get('/api/agent/runs', requireLogin, async (req, res) => {
    try {
      const limit = req.query.limit;
      const sessionKey = req.sessionID || String(req.session?.user?.id);
      const runs = await listAgentRuns(pool, { limit, session_key: sessionKey });
      res.json(runs);
    } catch (err) {
      console.error('GET /api/agent/runs error:', err.message);
      res.status(500).json({ error: 'Gagal mengambil data agent runs' });
    }
  });

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