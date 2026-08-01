import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { assertValidImageBuffer, detectImageType, extForImageType } from '../../../shared/imageFile.js';

export function isCloudinaryConfigured(env = process.env) {
  return Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);
}

export async function uploadBufferToCloudinary(buffer, folder = 'socai', options = {}) {
  const env = options.env || process.env;
  if (!isCloudinaryConfigured(env)) return null;

  const timestamp = Math.floor(Date.now() / 1000);
  const paramsToSign = `folder=${folder}&timestamp=${timestamp}${env.CLOUDINARY_API_SECRET}`;
  const signature = crypto.createHash('sha1').update(paramsToSign).digest('hex');
  const form = new FormData();
  form.append('file', new Blob([buffer]), 'telegram-photo.jpg');
  form.append('api_key', env.CLOUDINARY_API_KEY);
  form.append('timestamp', String(timestamp));
  form.append('folder', folder);
  form.append('signature', signature);

  const url = `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/image/upload`;
  const request = options.fetchImpl || fetch;
  const resp = await request(url, { method: 'POST', body: form });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error?.message || `Cloudinary upload gagal: ${resp.status}`);
  return data.secure_url;
}

// Download gambar dari Telegram. Produk disimpan lokal; konten bisa diunggah ke Cloudinary.
export async function downloadTelegramPhoto(fileId, options = {}) {
  const {
    bot,
    uploadDir,
    cloudinary = false,
    folder = 'socai',
    prefix = 'produk-telegram',
    fetchImpl = fetch,
    fsImpl = fs,
    env = process.env,
  } = options;

  try {
    if (!bot?.telegram?.getFileLink) throw new Error('Bot Telegram tidak tersedia.');
    if (!uploadDir) throw new Error('Direktori upload belum dikonfigurasi.');

    const link = await bot.telegram.getFileLink(fileId);
    const resp = await fetchImpl(link.href);
    if (!resp.ok) throw new Error('Gagal download gambar: ' + resp.status);
    const buffer = Buffer.from(await resp.arrayBuffer());
    assertValidImageBuffer(buffer);
    const ext = extForImageType(detectImageType(buffer));

    if (cloudinary) {
      const cloudUrl = await uploadBufferToCloudinary(buffer, folder, { env, fetchImpl });
      if (cloudUrl) return cloudUrl;
    }

    const filename = prefix + '-' + Date.now() + '-' + Math.round(Math.random() * 1e6) + ext;
    const filepath = path.join(uploadDir, filename);
    fsImpl.writeFileSync(filepath, buffer);

    return '/uploads/' + filename;
  } catch (err) {
    throw new Error('Gagal memproses gambar: ' + err.message);
  }
}
