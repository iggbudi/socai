import { sanitizeImageUrl } from './mediaUrl.js';
import { createThreadsSchedule, getReplizSchedule, isReplizConfigured } from './repliz.js';

export const bulanIndonesia = {
  jan: 0, januari: 0,
  feb: 1, februari: 1,
  mar: 2, maret: 2,
  apr: 3, april: 3,
  mei: 4,
  jun: 5, juni: 5,
  jul: 6, juli: 6,
  agu: 7, agustus: 7,
  sep: 8, september: 8,
  okt: 9, oktober: 9,
  nov: 10, november: 10,
  des: 11, desember: 11,
};

export function parseMarketingSchedule(plan) {
  const rawDate = plan?.scheduled_at || plan?.repliz_scheduled_at;
  if (rawDate) {
    const parsed = new Date(rawDate);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const text = String(plan?.jadwal || '').trim().toLowerCase();
  if (!text) return null;

  const isoLike = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})(?:[ t,]+(\d{1,2})(?::|\.)(\d{2}))?/i);
  if (isoLike) {
    const [, y, m, d, hh = '0', mm = '0'] = isoLike;
    const date = new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm));
    if (!Number.isNaN(date.getTime())) return date;
  }

  const idDate = text.match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})/i);
  if (idDate) {
    const day = Number(idDate[1]);
    const month = bulanIndonesia[idDate[2]];
    const year = Number(idDate[3]);
    const time = text.match(/(?:jam|pukul)?\s*(\d{1,2})(?:[:.](\d{2}))\s*(?:wib)?/i);
    const hour = time ? Number(time[1]) : 0;
    const minute = time && time[2] ? Number(time[2]) : 0;
    if (Number.isFinite(day) && month !== undefined && Number.isFinite(year)) {
      const date = new Date(year, month, day, hour, minute);
      if (!Number.isNaN(date.getTime())) return date;
    }
  }

  return null;
}

export function extractReplizScheduleId(response) {
  if (!response || typeof response !== 'object') return null;
  return response.scheduleId
    || response.id
    || response._id
    || response.data?.scheduleId
    || response.data?.id
    || response.data?._id
    || response?.schedule?.id
    || null;
}

export function normalizeReplizStatus(schedule) {
  const status = String(schedule?.status || '').toLowerCase();
  if (['pending', 'process', 'error', 'success'].includes(status)) return status;
  return status || 'unknown';
}

export function normalizePlansInput(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.rencana_mingguan)) return body.rencana_mingguan;
  if (Array.isArray(body?.rencana)) return body.rencana;
  if (Array.isArray(body?.plans)) return body.plans;
  return [body];
}

export function toPlanText(value) {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return value.filter(Boolean).map(toPlanText).filter(Boolean).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  const text = String(value).trim();
  return text || null;
}

export function limitPlanText(value, max) {
  const text = toPlanText(value);
  return text && text.length > max ? text.slice(0, max) : text;
}

export function normalizePlan(rawPlan, index) {
  const rawGambar = toPlanText(rawPlan?.gambar || rawPlan?.image || rawPlan?.image_url || rawPlan?.url_gambar);
  let gambar = '';
  if (rawGambar) {
    gambar = sanitizeImageUrl(rawGambar, { allowEmpty: true });
  }
  return {
    judul: limitPlanText(rawPlan?.judul || rawPlan?.title || `Rencana Threads Hari ${index + 1}`, 255),
    strategi: toPlanText(rawPlan?.strategi || rawPlan?.strategy),
    target_audiens: limitPlanText(rawPlan?.target_audiens || rawPlan?.target || rawPlan?.audience, 255),
    kanal: 'threads',
    jadwal: toPlanText(rawPlan?.jadwal || rawPlan?.schedule),
    scheduled_at: toPlanText(rawPlan?.scheduled_at || rawPlan?.schedule_at || rawPlan?.scheduledAt),
    copywriting: toPlanText(rawPlan?.copywriting || rawPlan?.caption || rawPlan?.copy),
    produk_terkait: limitPlanText(rawPlan?.produk_terkait || rawPlan?.produk || rawPlan?.product, 255),
    gambar,
  };
}

export async function savePlansToDb(planData, dbPool) {
  const rawPlans = normalizePlansInput(planData).filter(Boolean);
  const plans = rawPlans.map(normalizePlan);
  if (plans.length === 0 || plans.some((plan) => !plan.judul || !plan.strategi)) {
    throw new Error('Data rencana tidak valid. Pastikan setiap item memiliki judul dan strategi.');
  }

  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    const saved = [];
    const seenSchedules = new Set();
    for (const plan of plans) {
      const scheduleKey = (plan.jadwal || '').toLowerCase().replace(/\s+/g, ' ').trim();
      if (scheduleKey) {
        if (seenSchedules.has(scheduleKey)) {
          throw new Error(`Jadwal duplikat dalam rencana yang sama: ${plan.jadwal}`);
        }
        seenSchedules.add(scheduleKey);
        const duplicate = await client.query(
          `SELECT id, judul, jadwal FROM pemasaran
           WHERE lower(regexp_replace(coalesce(jadwal, ''), '\\s+', ' ', 'g')) = $1
             AND lower(coalesce(kanal, '')) = 'threads'
           LIMIT 1`,
          [scheduleKey]
        );
        if (duplicate.rows.length > 0) {
          throw new Error(`Jadwal sudah ada di pemasaran Threads: ${plan.jadwal}. Buat jadwal lanjutan agar tidak menumpuk.`);
        }
      }
      const result = await client.query(
        `INSERT INTO pemasaran (judul, strategi, target_audiens, kanal, jadwal, scheduled_at, copywriting, produk_terkait, gambar, status)
         VALUES ($1, $2, $3, $4, $5, NULLIF($6, '')::timestamptz, $7, $8, $9, 'draft') RETURNING *`,
        [plan.judul, plan.strategi, plan.target_audiens, plan.kanal, plan.jadwal, plan.scheduled_at, plan.copywriting, plan.produk_terkait, plan.gambar]
      );
      saved.push(result.rows[0]);
    }
    await client.query('COMMIT');
    return saved;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function syncPlanReplizStatus(planId, dbPool) {
  const result = await dbPool.query('SELECT * FROM pemasaran WHERE id = $1', [planId]);
  if (result.rows.length === 0) {
    const err = new Error('Rencana pemasaran tidak ditemukan.');
    err.statusCode = 404;
    throw err;
  }
  const plan = result.rows[0];
  if (!plan.repliz_schedule_id) {
    const err = new Error('Rencana ini belum memiliki schedule id Repliz.');
    err.statusCode = 400;
    throw err;
  }

  const schedule = await getReplizSchedule(plan.repliz_schedule_id);
  const replizStatus = normalizeReplizStatus(schedule);
  const localStatus = replizStatus === 'success' ? 'posted' : replizStatus === 'error' ? 'failed' : 'scheduled';
  const saved = await dbPool.query(
    `UPDATE pemasaran
     SET repliz_status = $2,
         repliz_synced_at = NOW(),
         repliz_last_error = CASE WHEN $2 = 'error' THEN coalesce($3, repliz_last_error) ELSE NULL END,
         external_status = $2,
         status = $4,
         published_at = CASE WHEN $2 = 'success' THEN coalesce(published_at, NOW()) ELSE published_at END,
         last_error = CASE WHEN $2 = 'error' THEN coalesce($3, last_error) ELSE NULL END
     WHERE id = $1
     RETURNING *`,
    [planId, replizStatus, schedule?.error || schedule?.message || null, localStatus]
  );
  return { plan: saved.rows[0], repliz: schedule };
}

export async function schedulePlanToRepliz(planId, dbPool, { force = false, scheduleAtOverride = null } = {}) {
  if (!isReplizConfigured()) {
    const err = new Error('Repliz belum dikonfigurasi lengkap. Isi REPLIZ_API_KEY, REPLIZ_SECRET, dan REPLIZ_ACCOUNT_ID.');
    err.statusCode = 400;
    throw err;
  }

  const client = await dbPool.connect();
  let plan;
  try {
    await client.query('BEGIN');
    const locked = await client.query('SELECT * FROM pemasaran WHERE id = $1 FOR UPDATE', [planId]);
    if (locked.rows.length === 0) {
      const err = new Error('Rencana pemasaran tidak ditemukan.');
      err.statusCode = 404;
      throw err;
    }
    plan = locked.rows[0];
    if (plan.repliz_schedule_id && !force && !scheduleAtOverride) {
      const err = new Error('Rencana ini sudah dijadwalkan ke Repliz.');
      err.statusCode = 409;
      throw err;
    }
    if (String(plan.kanal || '').toLowerCase() !== 'threads') {
      const err = new Error('Hanya rencana kanal Threads yang bisa dijadwalkan ke Repliz.');
      err.statusCode = 400;
      throw err;
    }
    if (!String(plan.copywriting || plan.strategi || '').trim()) {
      const err = new Error('Copywriting/strategi rencana kosong.');
      err.statusCode = 400;
      throw err;
    }

    let scheduledAt;
    if (scheduleAtOverride) {
      scheduledAt = new Date(scheduleAtOverride);
      if (Number.isNaN(scheduledAt.getTime())) {
        const err = new Error('Jadwal override tidak valid.');
        err.statusCode = 400;
        throw err;
      }
    } else {
      scheduledAt = parseMarketingSchedule(plan);
      if (!scheduledAt) {
        const err = new Error('Jadwal tidak bisa diparse. Gunakan format seperti "2026-06-05 19:00" atau "5 Juni 2026 jam 19:00".');
        err.statusCode = 400;
        throw err;
      }
    }

    await client.query(
      `UPDATE pemasaran
       SET repliz_status = 'syncing', repliz_last_error = NULL, repliz_attempts = coalesce(repliz_attempts, 0) + 1, scheduled_at = $2
       WHERE id = $1`,
      [planId, scheduledAt.toISOString()]
    );
    await client.query('COMMIT');

    const scheduleAtIso = scheduledAt.toISOString();
    const replizResponse = await createThreadsSchedule(
      { ...plan, scheduled_at: scheduleAtIso },
      { scheduleAt: scheduleAtIso }
    );
    const scheduleId = extractReplizScheduleId(replizResponse);
    if (!scheduleId) throw new Error('Repliz tidak mengembalikan schedule id.');

    const saved = await dbPool.query(
      `UPDATE pemasaran
       SET repliz_schedule_id = $2,
           repliz_status = 'pending',
           repliz_scheduled_at = $3,
           repliz_synced_at = NOW(),
           repliz_last_error = NULL,
           status = 'scheduled',
           external_post_id = $2,
           external_status = 'pending'
       WHERE id = $1
       RETURNING *`,
      [planId, scheduleId, scheduleAtIso]
    );
    return { plan: saved.rows[0], repliz: replizResponse };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (plan) {
      await dbPool.query(
        `UPDATE pemasaran
         SET repliz_status = 'error', repliz_last_error = $2, repliz_synced_at = NOW(), external_status = 'error', last_error = $2
         WHERE id = $1`,
        [planId, String(err.message || err).slice(0, 1000)]
      ).catch(() => {});
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function schedulePlanToReplizNow(planId, dbPool, { force = false } = {}) {
  return schedulePlanToRepliz(planId, dbPool, {
    force,
    scheduleAtOverride: new Date(Date.now() + 60_000).toISOString(),
  });
}