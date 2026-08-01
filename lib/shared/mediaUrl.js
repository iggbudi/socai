const DEFAULT_ALLOWED_HOSTS = ['res.cloudinary.com'];

function parseAllowedHosts(env = process.env) {
  const raw = env.ALLOWED_IMAGE_HOSTS || DEFAULT_ALLOWED_HOSTS.join(',');
  return raw.split(',').map((host) => host.trim().toLowerCase()).filter(Boolean);
}

export function isAllowedImageUrl(raw, options = {}) {
  try {
    sanitizeImageUrl(raw, options);
    return true;
  } catch {
    return false;
  }
}

export function sanitizeImageUrl(raw, { allowEmpty = true } = {}) {
  if (raw === undefined || raw === null) {
    if (allowEmpty) return '';
    throw new Error('URL gambar tidak valid');
  }

  const trimmed = String(raw).trim();
  if (!trimmed) {
    if (allowEmpty) return '';
    throw new Error('URL gambar tidak valid');
  }

  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith('javascript:') ||
    lower.startsWith('data:') ||
    lower.startsWith('blob:') ||
    lower.startsWith('http://')
  ) {
    throw new Error('URL gambar tidak valid');
  }

  if (trimmed.startsWith('/')) {
    if (trimmed.includes('..') || trimmed.includes('\\') || trimmed.includes('//')) {
      throw new Error('URL gambar tidak valid');
    }
    if (!/^\/uploads\/[a-zA-Z0-9._-]+$/.test(trimmed)) {
      throw new Error('URL gambar tidak valid');
    }
    return trimmed;
  }

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('URL gambar tidak valid');
  }

  if (url.protocol !== 'https:') {
    throw new Error('URL gambar tidak valid');
  }

  const hostname = url.hostname.trim().toLowerCase();
  if (!hostname) {
    throw new Error('URL gambar tidak valid');
  }

  const allowedHosts = parseAllowedHosts();
  if (!allowedHosts.includes(hostname)) {
    throw new Error('URL gambar tidak valid');
  }

  return url.toString();
}