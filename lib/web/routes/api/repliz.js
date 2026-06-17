import { getThreadsAccounts } from '../../../repliz.js';
import { requireLogin } from '../../middleware/auth.js';

export function registerReplizRoutes(app) {
  app.get('/api/repliz/accounts', requireLogin, async (req, res) => {
    try {
      const data = await getThreadsAccounts({
        page: Number(req.query.page || 1),
        limit: Math.min(Number(req.query.limit || 20), 50),
      });
      const docs = Array.isArray(data?.docs) ? data.docs : Array.isArray(data) ? data : [];
      res.json({
        docs: docs.map((account) => ({
          id: account.id || account._id,
          username: account.username,
          name: account.name,
          type: account.type,
          isConnected: account.isConnected,
        })),
        totalDocs: data?.totalDocs,
        page: data?.page,
        totalPages: data?.totalPages,
      });
    } catch (err) {
      console.error('GET /api/repliz/accounts error:', err.message);
      res.status(500).json({ error: err.message || 'Gagal mengambil akun Repliz' });
    }
  });
}