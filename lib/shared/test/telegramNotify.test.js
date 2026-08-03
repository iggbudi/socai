/**
 * S29 (C1) — notifikasi operator Telegram.
 * Diuji lewat seam DI: tanpa token, fan-out ke banyak operator, dan ketahanan
 * saat satu pengiriman gagal. Tidak menyentuh jaringan.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notifyTelegramOperators, resolveNotifyMinRole } from '../telegramNotify.js';

test('tanpa bot token → dilewati tanpa melempar error', async () => {
  const result = await notifyTelegramOperators('halo', {}, { api: null, listUserIds: () => [1, 2] });
  assert.deepEqual(result, { sent: 0, skipped: true, reason: 'no_token' });
});

test('mengirim ke seluruh operator dan meneruskan opsi extra', async () => {
  const calls = [];
  const api = {
    sendMessage: async (chatId, text, extra) => calls.push({ chatId, text, extra }),
  };

  const result = await notifyTelegramOperators(
    'butuh persetujuan',
    { parse_mode: 'HTML' },
    { api, listUserIds: () => [11, 22] },
  );

  assert.deepEqual(result, { sent: 2, skipped: false, targets: 2 });
  assert.deepEqual(
    calls.map((c) => c.chatId),
    [11, 22],
  );
  assert.equal(calls[0].text, 'butuh persetujuan');
  assert.deepEqual(calls[0].extra, { parse_mode: 'HTML' });
});

test('id ganda hanya dikirimi sekali', async () => {
  const sentTo = [];
  const api = { sendMessage: async (chatId) => sentTo.push(chatId) };

  const result = await notifyTelegramOperators('halo', {}, { api, listUserIds: () => [7, 7, 8, 7] });

  assert.deepEqual(sentTo, [7, 8]);
  assert.equal(result.targets, 2);
});

test('satu pengiriman gagal tidak menghentikan operator lainnya', async () => {
  const sentTo = [];
  const api = {
    sendMessage: async (chatId) => {
      if (chatId === 2) throw new Error('bot diblokir user');
      sentTo.push(chatId);
    },
  };

  const result = await notifyTelegramOperators('halo', {}, { api, listUserIds: () => [1, 2, 3] });

  assert.deepEqual(sentTo, [1, 3]);
  assert.equal(result.sent, 2);
  assert.equal(result.targets, 3);
  assert.equal(result.skipped, false);
});

test('tanpa penerima → tidak mengirim apa pun tapi tetap bukan skipped', async () => {
  let called = 0;
  const api = {
    sendMessage: async () => {
      called++;
    },
  };

  const result = await notifyTelegramOperators('halo', {}, { api, listUserIds: () => [] });

  assert.equal(called, 0);
  assert.deepEqual(result, { sent: 0, skipped: false, targets: 0 });
});

test('resolveNotifyMinRole memilih peran terendah dari daftar', () => {
  assert.equal(resolveNotifyMinRole('super_admin,operator'), 'operator');
  assert.equal(resolveNotifyMinRole('viewer,super_admin'), 'viewer');
  assert.equal(resolveNotifyMinRole(''), 'operator');
  assert.equal(resolveNotifyMinRole(undefined), 'operator');
  assert.equal(resolveNotifyMinRole('peran_ngawur'), 'operator');
});

test('resolveNotifyMinRole menghormati peran tunggal yang lebih tinggi dari default (D4)', () => {
  // D4: sebelumnya akumulator reduce diinisialisasi 'operator', sehingga peran yang
  // lebih tinggi tidak pernah menang — 'super_admin' saja tetap dianggap 'operator'.
  // Sekarang rank minimum dihitung murni dari daftar yang dikonfigurasi.
  assert.equal(resolveNotifyMinRole('super_admin'), 'super_admin');
  assert.equal(resolveNotifyMinRole('viewer'), 'viewer');
});
