import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isAddProductIntent } from '../wizards/produk.js';

describe('produk wizard helpers', () => {
  it('recognizes common add-product phrases only', () => {
    assert.equal(isAddProductIntent('Tolong tambah produk baru'), true);
    assert.equal(isAddProductIntent('produk batik merah'), false);
    assert.equal(isAddProductIntent(''), false);
  });
});
