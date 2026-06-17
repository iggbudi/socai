import { pool } from '../../../agent.js';
import {
  bulanIndonesia,
  savePlansToDb,
  schedulePlanToRepliz,
  syncPlanReplizStatus,
} from '../../../pemasaran.js';
import { requireLogin } from '../../middleware/auth.js';
import { sleep, randomBulkDelayMs } from '../../replizJobs.js';

export function registerPemasaranRoutes(app) {
  app.get('/api/pemasaran', requireLogin, async (req, res) => {
    try {
      const result = await pool.query(`
      SELECT id, judul, target_audiens, kanal, jadwal, created_at,
             gambar, status, scheduled_at, published_at, external_status,
             repliz_schedule_id, repliz_status, repliz_scheduled_at,
             repliz_last_error, repliz_synced_at
      FROM pemasaran
      ORDER BY COALESCE(scheduled_at, created_at) DESC, id DESC
      LIMIT 200
    `);
      const bulanMap = bulanIndonesia;
      const parseJadwal = (jadwal) => {
        const text = String(jadwal || '').toLowerCase();
        const dateMatch = text.match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})/i);
        if (!dateMatch) return Number.MAX_SAFE_INTEGER;
        const day = Number(dateMatch[1]);
        const month = bulanMap[dateMatch[2]];
        const year = Number(dateMatch[3]);
        if (!Number.isFinite(day) || month === undefined || !Number.isFinite(year)) return Number.MAX_SAFE_INTEGER;
        const timeMatch = text.match(/(?:jam|pukul)\s*(\d{1,2})(?:[:.](\d{2}))?/i);
        const hour = timeMatch ? Number(timeMatch[1]) : 0;
        const minute = timeMatch && timeMatch[2] ? Number(timeMatch[2]) : 0;
        return new Date(year, month, day, hour, minute).getTime();
      };
      const rows = result.rows.sort((a, b) => {
        const diff = parseJadwal(a.jadwal) - parseJadwal(b.jadwal);
        if (diff !== 0) return diff;
        return a.id - b.id;
      });
      res.json(rows);
    } catch (err) {
      console.error('GET /api/pemasaran error:', err.message);
      res.status(500).json({ error: 'Gagal mengambil data pemasaran' });
    }
  });

  app.get('/api/pemasaran/:id', requireLogin, async (req, res) => {
    try {
      const result = await pool.query('SELECT * FROM pemasaran WHERE id = $1', [req.params.id]);
      if (result.rows.length === 0) return res.status(404).json({ error: 'Rencana pemasaran tidak ditemukan' });
      res.json(result.rows[0]);
    } catch (err) {
      console.error('GET /api/pemasaran/:id error:', err.message);
      res.status(500).json({ error: 'Gagal mengambil detail pemasaran' });
    }
  });

  app.post('/api/pemasaran', requireLogin, async (req, res) => {
    try {
      const saved = await savePlansToDb(req.body, pool);
      res.status(201).json(saved.length === 1 ? saved[0] : { count: saved.length, rows: saved });
    } catch (err) {
      if (err.message === 'URL gambar tidak valid') {
        return res.status(400).json({ error: 'URL gambar tidak valid' });
      }
      if (err.message?.startsWith('Data rencana tidak valid')) {
        return res.status(400).json({ error: 'Setiap rencana wajib memiliki judul dan strategi.' });
      }
      console.error('POST /api/pemasaran error:', err.message);
      res.status(500).json({ error: 'Gagal menyimpan rencana pemasaran: ' + err.message });
    }
  });

  app.post('/api/pemasaran/repliz/schedule', requireLogin, async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((id) => /^\d+$/.test(String(id))) : [];
    if (ids.length === 0) return res.status(400).json({ error: 'Pilih minimal satu rencana pemasaran.' });
    if (ids.length > 20) return res.status(400).json({ error: 'Maksimal 20 rencana per bulk schedule.' });

    const results = [];
    for (const [index, id] of ids.entries()) {
      try {
        const result = await schedulePlanToRepliz(id, pool, { force: false });
        results.push({ id, ok: true, repliz_schedule_id: result.plan.repliz_schedule_id });
      } catch (err) {
        results.push({ id, ok: false, error: err.message || 'Gagal menjadwalkan' });
      }

      if (index < ids.length - 1) {
        const delayMs = randomBulkDelayMs();
        console.log(`[Repliz] Bulk schedule delay ${delayMs}ms before next item`);
        await sleep(delayMs);
      }
    }

    const success = results.filter((item) => item.ok).length;
    res.status(success > 0 ? 207 : 400).json({ success, failed: results.length - success, results });
  });

  app.post('/api/pemasaran/:id/repliz/schedule', requireLogin, async (req, res) => {
    try {
      const result = await schedulePlanToRepliz(req.params.id, pool, { force: false });
      res.json({ message: 'Rencana berhasil dijadwalkan ke Repliz', plan: result.plan, repliz: result.repliz });
    } catch (err) {
      const status = err.statusCode || 500;
      console.error('POST /api/pemasaran/:id/repliz/schedule error:', err.message);
      res.status(status).json({ error: err.message || 'Gagal menjadwalkan ke Repliz' });
    }
  });

  app.post('/api/pemasaran/:id/repliz/retry', requireLogin, async (req, res) => {
    try {
      const result = await schedulePlanToRepliz(req.params.id, pool, { force: true });
      res.json({ message: 'Retry Repliz berhasil', plan: result.plan, repliz: result.repliz });
    } catch (err) {
      const status = err.statusCode || 500;
      console.error('POST /api/pemasaran/:id/repliz/retry error:', err.message);
      res.status(status).json({ error: err.message || 'Gagal retry Repliz' });
    }
  });

  app.post('/api/pemasaran/:id/repliz/sync', requireLogin, async (req, res) => {
    try {
      const result = await syncPlanReplizStatus(req.params.id, pool);
      res.json({ message: 'Status Repliz berhasil disinkronkan', plan: result.plan, repliz: result.repliz });
    } catch (err) {
      const status = err.statusCode || 500;
      console.error('POST /api/pemasaran/:id/repliz/sync error:', err.message);
      res.status(status).json({ error: err.message || 'Gagal sync status Repliz' });
    }
  });

  app.delete('/api/pemasaran/:id', requireLogin, async (req, res) => {
    try {
      const result = await pool.query('DELETE FROM pemasaran WHERE id = $1 RETURNING id', [req.params.id]);
      if (result.rows.length === 0) return res.status(404).json({ error: 'Rencana tidak ditemukan' });
      res.json({ message: 'Rencana berhasil dihapus' });
    } catch (err) {
      console.error('DELETE /api/pemasaran error:', err.message);
      res.status(500).json({ error: 'Gagal menghapus rencana' });
    }
  });
}