import { getSchemaStatus } from '../../shared/schema.js';

export async function ensureSchemaReady(dbPool) {
  const status = await getSchemaStatus(dbPool);
  if (!status.ok) {
    throw new Error(
      `Database schema pending: jalankan npm run migrate:up (latest=${status.latestMigration || 'none'}, required=${status.requiredMigration})`,
    );
  }
  return status;
}

export async function syncBotCommands(bot, defaultCommands, superAdminCommands, superAdminId) {
  await bot.telegram.setMyCommands(defaultCommands);
  await bot.telegram.setMyCommands(superAdminCommands, {
    scope: { type: 'chat', chat_id: superAdminId },
  });
}
