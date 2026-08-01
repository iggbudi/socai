// lib/shared/db.js — PostgreSQL pools (vertical slicing F0).
// Shared infra: dipakai web, bot, dan AI agent. Jangan import dari lib/features/.
import pg from 'pg';

const { Pool } = pg;

const poolDefaults = {
  host: process.env.DB_HOST || '127.0.0.1',
  database: process.env.DB_NAME || 'socai',
  port: Number(process.env.DB_PORT) || 5432,
};

// ---------- Database Pool ----------
export const pool = new Pool({
  ...poolDefaults,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

let aiReadPoolFallbackWarned = false;

function resolveAiReadPoolCredentials() {
  const user = process.env.DB_AI_READ_USER;
  const password = process.env.DB_AI_READ_PASSWORD;

  if (user && password !== undefined && password !== '') {
    return { user, password };
  }

  if (!aiReadPoolFallbackWarned) {
    aiReadPoolFallbackWarned = true;
    console.warn('[AI] DB_AI_READ_USER/DB_AI_READ_PASSWORD tidak diisi - db_query memakai kredensial DB_USER (tidak disarankan production)');
  }

  return {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  };
}

const aiReadCredentials = resolveAiReadPoolCredentials();

export const aiReadPool = new Pool({
  ...poolDefaults,
  user: aiReadCredentials.user,
  password: aiReadCredentials.password,
});

// Nama dipertahankan (server.js) — menutup kedua pool.
export async function closeAgentPools() {
  await Promise.all([pool.end(), aiReadPool.end()]);
}
