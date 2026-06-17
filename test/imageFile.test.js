import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectImageType, assertValidImageBuffer } from '../lib/imageFile.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
const JPEG_SIGNATURE = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]);
const JUNK = Buffer.from('not an image file');

describe('detectImageType', () => {
  it('detects png signature', () => {
    assert.equal(detectImageType(PNG_SIGNATURE), 'png');
  });

  it('detects jpeg signature', () => {
    assert.equal(detectImageType(JPEG_SIGNATURE), 'jpeg');
  });

  it('returns null for junk data', () => {
    assert.equal(detectImageType(JUNK), null);
    assert.equal(detectImageType(Buffer.alloc(2)), null);
    assert.equal(detectImageType(null), null);
  });
});

describe('assertValidImageBuffer', () => {
  it('returns type for png and jpeg buffers', () => {
    assert.equal(assertValidImageBuffer(PNG_SIGNATURE), 'png');
    assert.equal(assertValidImageBuffer(JPEG_SIGNATURE), 'jpeg');
  });

  it('throws for junk buffers', () => {
    assert.throws(() => assertValidImageBuffer(JUNK), /File bukan gambar yang didukung/);
    assert.throws(() => assertValidImageBuffer(Buffer.alloc(0)), /File bukan gambar yang didukung/);
  });
});