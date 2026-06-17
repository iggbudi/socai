import { pool } from '../../../agent.js';
import { listAgentRuns } from '../../../agentRuns.js';
import { requireLogin } from '../../middleware/auth.js';

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
}