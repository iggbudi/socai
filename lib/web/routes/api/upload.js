import fs from 'fs';
import path from 'path';
import { requireLogin } from '../../middleware/auth.js';
import { upload } from '../../middleware/upload.js';
import { assertValidImageBuffer, detectImageType, extForImageType } from '../../../imageFile.js';

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