import 'dotenv/config';

function splitModelRefs(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function isValidModelRef(value) {
  const text = String(value || '').trim();
  const slashIndex = text.indexOf('/');
  return slashIndex > 0 && slashIndex < text.length - 1;
}

function usesProvider(provider, ...values) {
  return values.flatMap(splitModelRefs).some((ref) => ref.startsWith(`${provider}/`));
}

function validatePositiveIntegerEnv(env, name, errors) {
  const value = env[name];
  if (value === undefined || value === '') return;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    errors.push(`${name} harus berupa bilangan bulat positif.`);
  }
}

function collectWebEnvironmentIssues(env = process.env) {
  const errors = [];
  const warnings = [];
  const isProduction = env.NODE_ENV === 'production';

  if (!env.DB_USER) errors.push('DB_USER wajib diisi.');
  if (!env.DB_PASSWORD) errors.push('DB_PASSWORD wajib diisi.');

  if (isProduction && !env.SESSION_SECRET) {
    errors.push('SESSION_SECRET wajib diisi di production agar session tidak invalid saat restart.');
  } else if (!env.SESSION_SECRET) {
    warnings.push('SESSION_SECRET tidak diisi - memakai secret random sementara (session hilang saat restart).');
  }

  if (isProduction && !env.APP_URL) {
    errors.push('APP_URL wajib diisi di production untuk validasi CSRF Origin/Referer.');
  } else if (!env.APP_URL) {
    warnings.push('APP_URL tidak diisi - CSRF hanya mengandalkan localhost/request host.');
  }

  const modelVars = ['AI_MODEL', 'TELEGRAM_AI_MODEL'];
  const fallbackVars = ['AI_MODEL_FALLBACKS', 'TELEGRAM_AI_MODEL_FALLBACKS'];
  for (const name of modelVars) {
    if (env[name] && !isValidModelRef(env[name])) {
      errors.push(`${name} harus berformat provider/model-id.`);
    }
  }
  for (const name of fallbackVars) {
    const invalid = splitModelRefs(env[name]).filter((ref) => !isValidModelRef(ref));
    if (invalid.length > 0) errors.push(`${name} berisi model ref tidak valid: ${invalid.join(', ')}`);
  }

  if (usesProvider('xiaomi', env.AI_MODEL, env.AI_MODEL_FALLBACKS, env.TELEGRAM_AI_MODEL, env.TELEGRAM_AI_MODEL_FALLBACKS) && !env.XIAOMI_API_KEY) {
    errors.push('XIAOMI_API_KEY wajib diisi karena model Xiaomi MiMo dikonfigurasi.');
  }

  if (!env.BRAVE_API_KEY) warnings.push('BRAVE_API_KEY tidak diisi - fitur web_search AI nonaktif.');

  if (env.PORT && !Number.isInteger(Number(env.PORT))) errors.push('PORT harus berupa angka.');
  if (env.DB_PORT && !Number.isInteger(Number(env.DB_PORT))) errors.push('DB_PORT harus berupa angka.');

  validatePositiveIntegerEnv(env, 'AI_MESSAGE_MAX_LENGTH', errors);
  validatePositiveIntegerEnv(env, 'TELEGRAM_AI_RATE_LIMIT', errors);
  validatePositiveIntegerEnv(env, 'TELEGRAM_AI_RATE_WINDOW_MS', errors);

  if (isProduction && !env.DB_AI_READ_USER) {
    warnings.push('DB_AI_READ_USER tidak diisi - db_query memakai DB_USER penuh (tidak disarankan production)');
  }

  return { errors, warnings };
}

function collectBotEnvironmentIssues(env = process.env) {
  const { errors, warnings } = collectWebEnvironmentIssues(env);
  const isProduction = env.NODE_ENV === 'production';

  if (isProduction && !env.TELEGRAM_BOT_TOKEN) {
    errors.push('TELEGRAM_BOT_TOKEN wajib diisi di production.');
  }
  if (isProduction && !env.TELEGRAM_SUPER_ADMIN_ID) {
    errors.push('TELEGRAM_SUPER_ADMIN_ID wajib diisi di production.');
  }

  return { errors, warnings };
}

function reportEnvironmentIssues({ errors, warnings }, { exitOnError = true } = {}) {
  if (warnings.length > 0) {
    console.warn('\n⚠️  Environment warnings:');
    warnings.forEach((warning) => console.warn(`   - ${warning}`));
  }

  if (errors.length > 0) {
    console.error('\n❌ Environment errors:');
    errors.forEach((error) => console.error(`   - ${error}`));
    console.error('');
    if (exitOnError) process.exit(1);
  }

  if (warnings.length > 0) console.warn('');
  return { errors, warnings };
}

export function validateWebEnvironment(options = {}) {
  return reportEnvironmentIssues(collectWebEnvironmentIssues(process.env), options);
}

export function validateBotEnvironment(options = {}) {
  return reportEnvironmentIssues(collectBotEnvironmentIssues(process.env), options);
}

export function validateEnvironment(options = {}) {
  return validateWebEnvironment(options);
}