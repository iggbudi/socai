import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildContentPrompt,
  normalizeContentGoal,
  normalizeContentType,
  resolveContentProductChoice,
} from './konten.js';

describe('konten wizard helpers', () => {
  it('normalizes numbered choices and leaves custom text intact', () => {
    assert.equal(normalizeContentType('1'), 'Edukasi');
    assert.equal(normalizeContentGoal('6'), 'Conversion — mendorong pembelian secara halus');
    assert.equal(normalizeContentType('custom heritage'), 'custom heritage');
  });

  it('resolves product by number, exact name, partial name is rejected, and skip', () => {
    const products = [{ nama: 'Batik Pesisir' }, { nama: 'Batik Lasem' }];
    assert.equal(resolveContentProductChoice('1', products), 'Batik Pesisir');
    assert.equal(resolveContentProductChoice('batik lasem', products), 'Batik Lasem');
    assert.equal(resolveContentProductChoice('pesisir', products), null);
    assert.equal(resolveContentProductChoice('0', products), '');
  });

  it('builds a single-content prompt with product, type, and goal', () => {
    const prompt = buildContentPrompt({
      jenis: 'Edukasi',
      tujuan: 'Awareness',
      produk: 'Batik Pesisir',
      audiens: 'pecinta batik',
      jadwal: 'Jumat 19:00 WIB',
      tone: 'hangat',
      catatan: '',
      gambar: '',
    });
    assert.match(prompt, /Batik Pesisir/);
    assert.match(prompt, /Edukasi/);
    assert.match(prompt, /Awareness/);
  });
});
