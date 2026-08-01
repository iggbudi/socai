import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTelegramCtx } from '../../../../test/helpers/telegramCtx.mjs';
import { escapeTelegramHtml, markdownToTelegramHtml, replyLong, safeReply } from '../helpers.js';
import {
  formatContentProductOptions,
  getContentProductOptions,
  handleContentWizardText,
} from '../wizards/konten.js';
import { handleWizardText, showProductConfirm } from '../wizards/produk.js';

describe('telegram product wizard flow', () => {
  it('validates every product step and reaches confirmation', async () => {
    const productWizard = new Map([
      [456, { step: 'waiting_nama', data: { nama: '', harga: '', stok: '', deskripsi: '', gambar: '' } }],
    ]);
    const confirms = [];
    const { ctx, calls } = createTelegramCtx();
    const run = (text) =>
      handleWizardText(ctx, text, { productWizard, showConfirm: async (_ctx, data) => confirms.push(data) });

    await run('x');
    await run('Batik Pesisir');
    await run('9'.repeat(400));
    await run('50000');
    await run('not-a-stock');
    await run('3');
    await run('skip');
    await run('not a photo');
    await run('skip');
    assert.equal(productWizard.get(456).step, 'confirm');
    assert.equal(confirms.length, 1);
    assert.equal(confirms[0].nama, 'Batik Pesisir');
    assert.ok(calls.some((call) => /minimal 2 karakter/.test(call.args[0])));
    assert.ok(calls.some((call) => /Harga harus angka/.test(call.args[0])));
    assert.ok(calls.some((call) => /Stok harus angka/.test(call.args[0])));
    assert.ok(calls.some((call) => /Kirim foto produk/.test(call.args[0])));
  });

  it('handles cancellation, missing sessions, and unknown steps', async () => {
    const wizard = new Map([[456, { step: 'waiting_nama', data: {} }]]);
    const { ctx, calls } = createTelegramCtx();
    assert.equal(await handleWizardText(ctx, '/batal', { productWizard: wizard }), true);
    assert.equal(wizard.has(456), false);
    assert.equal(await handleWizardText(ctx, 'text', { productWizard: wizard }), false);
    wizard.set(456, { step: 'unknown', data: {} });
    assert.equal(await handleWizardText(ctx, 'text', { productWizard: wizard }), false);
    await showProductConfirm(ctx, { nama: 'Batik', harga: 1, stok: 1, deskripsi: '', gambar: '' });
    assert.match(calls.at(-1).args[0], /Konfirmasi Produk/);
  });
});

describe('telegram content wizard flow', () => {
  function data() {
    return { jenis: '', tujuan: '', produk: '', audiens: '', jadwal: '', tone: '', catatan: '', gambar: '' };
  }

  it('walks through product selection, custom notes, and no-image completion', async () => {
    const contentWizard = new Map([[456, { step: 'jenis', data: data() }]]);
    const dbPool = {
      query: async () => ({
        rows: [
          { nama: 'Batik Pesisir', harga: 50000, stok: 2 },
          { nama: 'Habis', harga: 1, stok: 0 },
        ],
      }),
    };
    const { ctx, calls } = createTelegramCtx();
    const run = (text) =>
      handleContentWizardText(ctx, text, { contentWizard, dbPool, cloudinaryConfigured: () => true });

    await run('1');
    await run('6');
    await run('invalid product');
    await run('1');
    await run('pecinta batik');
    await run('Jumat 19:00');
    await run('hangat');
    await run('catatan custom');
    const prompt = await run('skip');
    assert.match(prompt, /Batik Pesisir/);
    assert.equal(contentWizard.has(456), false);
    assert.ok(calls.some((call) => /Foto akan diunggah/.test(call.args[0])));
    assert.ok(calls.some((call) => /Pilihan produk tidak valid/.test(call.args[0])));
    assert.match(formatContentProductOptions([{ nama: 'X', harga: 1, stok: 0 }]), /Habis/);
  });

  it('handles empty answers, no products, cancellation, and invalid state', async () => {
    const contentWizard = new Map([[456, { step: 'jenis', data: data() }]]);
    const { ctx, calls } = createTelegramCtx();
    const empty = await handleContentWizardText(ctx, '', {
      contentWizard,
      dbPool: { query: async () => ({ rows: [] }) },
    });
    assert.equal(empty, true);
    await handleContentWizardText(ctx, '/batal', { contentWizard });
    contentWizard.set(456, { step: 'tujuan', data: data() });
    await handleContentWizardText(ctx, '1', { contentWizard, dbPool: { query: async () => ({ rows: [] }) } });
    assert.equal(contentWizard.get(456).step, 'audiens');
    contentWizard.set(456, { step: 'unknown', data: data() });
    await handleContentWizardText(ctx, 'x', { contentWizard, dbPool: {} });
    assert.equal(contentWizard.has(456), false);
    assert.ok(calls.some((call) => /Jawaban tidak boleh kosong/.test(call.args[0])));
    assert.ok(calls.some((call) => /Belum ada produk/.test(call.args[0])));
    assert.ok(calls.some((call) => /Sesi wizard tidak valid/.test(call.args[0])));
    assert.equal(await handleContentWizardText(ctx, 'x', { contentWizard }), false);
    await getContentProductOptions({ query: async () => ({ rows: [] }) });
  });
});

describe('telegram rendering helpers', () => {
  it('renders Markdown, HTML escaping, and safe reply fallbacks', async () => {
    assert.equal(escapeTelegramHtml('<x>&'), '&lt;x&gt;&amp;');
    assert.match(
      markdownToTelegramHtml('# Heading **bold** `code` [link](https://example.com)'),
      /<b>Heading/,
    );

    let attempts = 0;
    const markdownCtx = {
      reply: async () => {
        attempts++;
        if (attempts === 1) throw new Error('markdown rejected');
        return 'ok';
      },
    };
    await safeReply(markdownCtx, '*hello*', { parse_mode: 'Markdown' });
    assert.equal(attempts, 2);

    let plainAttempts = 0;
    await safeReply(
      {
        reply: async () => {
          plainAttempts++;
          throw new Error('html rejected');
        },
      },
      '*hello*',
    ).catch(() => {});
    assert.equal(plainAttempts, 2);
  });

  it('splits long Telegram replies', async () => {
    const replies = [];
    await replyLong(
      {
        reply: async (...args) => {
          replies.push(args);
          return args;
        },
      },
      `${'a'.repeat(2000)}\n\n${'b'.repeat(2000)}`,
    );
    assert.equal(replies.length, 2);
  });
});
