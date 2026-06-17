import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeImageUrl, isAllowedImageUrl } from '../lib/mediaUrl.js';

describe('sanitizeImageUrl / isAllowedImageUrl', () => {
  it('accepts valid /uploads/ paths', () => {
    const url = '/uploads/produk-123.jpg';
    assert.equal(sanitizeImageUrl(url), url);
    assert.equal(isAllowedImageUrl(url), true);
  });

  it('accepts valid cloudinary https URLs', () => {
    const url = 'https://res.cloudinary.com/demo/image/upload/sample.jpg';
    assert.equal(sanitizeImageUrl(url), url);
    assert.equal(isAllowedImageUrl(url), true);
  });

  it('rejects javascript: URLs', () => {
    assert.throws(() => sanitizeImageUrl('javascript:alert(1)'), /URL gambar tidak valid/);
    assert.equal(isAllowedImageUrl('javascript:alert(1)'), false);
  });

  it('rejects data: URLs', () => {
    assert.throws(() => sanitizeImageUrl('data:image/png;base64,abc'), /URL gambar tidak valid/);
    assert.equal(isAllowedImageUrl('data:image/png;base64,abc'), false);
  });

  it('rejects evil / disallowed hosts', () => {
    assert.throws(() => sanitizeImageUrl('https://evil.example.com/img.jpg'), /URL gambar tidak valid/);
    assert.equal(isAllowedImageUrl('https://evil.example.com/img.jpg'), false);
  });

  it('rejects path traversal in /uploads/', () => {
    assert.throws(() => sanitizeImageUrl('/uploads/../etc/passwd'), /URL gambar tidak valid/);
    assert.equal(isAllowedImageUrl('/uploads/../secret.png'), false);
  });

  it('rejects http:// URLs', () => {
    assert.throws(() => sanitizeImageUrl('http://res.cloudinary.com/demo/image.jpg'), /URL gambar tidak valid/);
    assert.equal(isAllowedImageUrl('http://res.cloudinary.com/demo/image.jpg'), false);
  });

  it('allows empty values when allowEmpty is true', () => {
    assert.equal(sanitizeImageUrl(''), '');
    assert.equal(sanitizeImageUrl(null), '');
    assert.equal(sanitizeImageUrl(undefined), '');
  });
});