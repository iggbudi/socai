const IMAGE_SIGNATURES = [
  { type: 'jpeg', bytes: [0xFF, 0xD8, 0xFF] },
  { type: 'png', bytes: [0x89, 0x50, 0x4E, 0x47] },
  { type: 'gif', bytes: [0x47, 0x49, 0x46, 0x38] },
];

function matchesBytes(buffer, bytes, offset = 0) {
  if (!buffer || buffer.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) {
    if (buffer[offset + i] !== bytes[i]) return false;
  }
  return true;
}

function isWebp(buffer) {
  if (!buffer || buffer.length < 12) return false;
  if (!matchesBytes(buffer, [0x52, 0x49, 0x46, 0x46], 0)) return false;
  if (!matchesBytes(buffer, [0x57, 0x45, 0x42, 0x50], 8)) return false;
  return true;
}

/**
 * @param {Buffer|Uint8Array} buffer
 * @returns {'jpeg'|'png'|'gif'|'webp'|null}
 */
export function detectImageType(buffer) {
  if (!buffer || buffer.length < 4) return null;

  for (const signature of IMAGE_SIGNATURES) {
    if (matchesBytes(buffer, signature.bytes)) return signature.type;
  }

  if (isWebp(buffer)) return 'webp';
  return null;
}

/**
 * @param {Buffer|Uint8Array} buffer
 * @returns {'jpeg'|'png'|'gif'|'webp'}
 */
export function assertValidImageBuffer(buffer) {
  const type = detectImageType(buffer);
  if (!type) {
    throw new Error('File bukan gambar yang didukung (JPEG, PNG, GIF, atau WEBP).');
  }
  return type;
}

/**
 * @param {'jpeg'|'png'|'gif'|'webp'} type
 * @returns {'.jpg'|'.png'|'.gif'|'.webp'}
 */
export function extForImageType(type) {
  switch (type) {
    case 'jpeg': return '.jpg';
    case 'png': return '.png';
    case 'gif': return '.gif';
    case 'webp': return '.webp';
    default:
      throw new Error(`Tipe gambar tidak dikenal: ${type}`);
  }
}