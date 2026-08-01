import fs from 'fs';
import path from 'path';
import { pool } from '../../shared/db.js';
import { sanitizeImageUrl } from '../../shared/mediaUrl.js';
import { requireLogin } from '../auth/requireLogin.js';
import { upload } from './upload.js';
import { assertValidImageBuffer, detectImageType, extForImageType } from '../../shared/imageFile.js';

export function registerProdukRoutes(app) {
  app.get('/api/produk', requireLogin, async (req, res) => {
    try {
      const result = await pool.query('SELECT * FROM produk ORDER BY id DESC');
      res.json(result.rows);
    } catch (err) {
      console.error('GET /api/produk error:', err.message);
      res.status(500).json({ error: 'Gagal mengambil data produk' });
    }
  });

  app.get('/api/produk/:id', requireLogin, async (req, res) => {
    try {
      const result = await pool.query('SELECT * FROM produk WHERE id = $1', [req.params.id]);
      if (result.rows.length === 0) return res.status(404).json({ error: 'Produk tidak ditemukan' });
      res.json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: 'Gagal mengambil produk' });
    }
  });

  app.post('/api/produk', requireLogin, async (req, res) => {
    const { nama, harga, stok, gambar, deskripsi } = req.body;
    const parsedHarga = Number(harga);
    const parsedStok = Number.parseInt(stok, 10);
    if (!nama || harga === undefined || harga === '' || !Number.isFinite(parsedHarga) || parsedHarga < 0) {
      return res.status(400).json({ error: 'Nama dan harga valid wajib diisi' });
    }
    let sanitizedGambar = '';
    try {
      sanitizedGambar = sanitizeImageUrl(gambar, { allowEmpty: true });
    } catch {
      return res.status(400).json({ error: 'URL gambar tidak valid' });
    }
    try {
      const result = await pool.query(
        'INSERT INTO produk (nama, harga, stok, gambar, deskripsi) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [nama, parsedHarga, Number.isFinite(parsedStok) && parsedStok >= 0 ? parsedStok : 0, sanitizedGambar, deskripsi || '']
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error('POST /api/produk error:', err.message);
      res.status(500).json({ error: 'Gagal menambah produk' });
    }
  });

  app.put('/api/produk/:id', requireLogin, async (req, res) => {
    const { nama, harga, stok, gambar, deskripsi } = req.body;
    const parsedHarga = Number(harga);
    const parsedStok = Number.parseInt(stok, 10);
    if (!nama || harga === undefined || harga === '' || !Number.isFinite(parsedHarga) || parsedHarga < 0) {
      return res.status(400).json({ error: 'Nama dan harga valid wajib diisi' });
    }
    let sanitizedGambar = '';
    try {
      sanitizedGambar = sanitizeImageUrl(gambar, { allowEmpty: true });
    } catch {
      return res.status(400).json({ error: 'URL gambar tidak valid' });
    }
    try {
      const result = await pool.query(
        'UPDATE produk SET nama=$1, harga=$2, stok=$3, gambar=$4, deskripsi=$5, updated_at=NOW() WHERE id=$6 RETURNING *',
        [nama, parsedHarga, Number.isFinite(parsedStok) && parsedStok >= 0 ? parsedStok : 0, sanitizedGambar, deskripsi || '', req.params.id]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'Produk tidak ditemukan' });
      res.json(result.rows[0]);
    } catch (err) {
      console.error('PUT /api/produk error:', err.message);
      res.status(500).json({ error: 'Gagal mengupdate produk' });
    }
  });

  app.delete('/api/produk/:id', requireLogin, async (req, res) => {
    try {
      const result = await pool.query('DELETE FROM produk WHERE id = $1 RETURNING id', [req.params.id]);
      if (result.rows.length === 0) return res.status(404).json({ error: 'Produk tidak ditemukan' });
      res.json({ message: 'Produk berhasil dihapus' });
    } catch (err) {
      console.error('DELETE /api/produk error:', err.message);
      res.status(500).json({ error: 'Gagal menghapus produk' });
    }
  });
}

export function registerUploadRoutes(app) {
  app.post('/api/upload', requireLogin, upload.single('gambar'), (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'File tidak valid. Gunakan JPG, PNG, GIF, atau WebP (max 5MB).' });
    }
    try {
      const head = fs.readFileSync(req.file.path).subarray(0, 16);
      assertValidImageBuffer(head);
      const detected = detectImageType(head);
      const correctExt = extForImageType(detected);
      const currentExt = path.extname(req.file.filename).toLowerCase();
      if (correctExt && currentExt !== correctExt) {
        const newFilename = req.file.filename.replace(/\.[^.]+$/, '') + correctExt;
        const newPath = path.join(path.dirname(req.file.path), newFilename);
        fs.renameSync(req.file.path, newPath);
        req.file.filename = newFilename;
        req.file.path = newPath;
      }
      res.json({ filename: req.file.filename, url: '/uploads/' + req.file.filename });
    } catch {
      try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(400).json({ error: 'File bukan gambar valid' });
    }
  });
}