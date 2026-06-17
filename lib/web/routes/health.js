import { pool } from '../../agent.js';
import { collectHealthStatus, getHealthHttpStatus } from '../../health.js';

export function registerHealthRoutes(app) {
  app.get('/health', async (req, res) => {
    const detail = req.query.detail === '1' || req.query.detail === 'true';
    const result = await collectHealthStatus({ pool, detail });
    res.status(getHealthHttpStatus(result)).json(result);
  });
}