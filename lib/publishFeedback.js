let cachedSummary = null;
let cachedAt = null;

export async function refreshPublishFeedback(readPool) {
  const result = await readPool.query(
    `SELECT id, judul, status, repliz_status, published_at, repliz_last_error, repliz_synced_at
     FROM pemasaran
     WHERE lower(coalesce(kanal, '')) = 'threads'
       AND (
         repliz_schedule_id IS NOT NULL
         OR lower(coalesce(status, '')) IN ('posted', 'failed', 'scheduled', 'pending_approval')
       )
     ORDER BY coalesce(repliz_synced_at, published_at, created_at) DESC
     LIMIT 20`,
  );

  const rows = result.rows;
  const posted = rows.filter((r) => (r.repliz_status || '').toLowerCase() === 'success' || r.status === 'posted').length;
  const failed = rows.filter((r) => (r.repliz_status || '').toLowerCase() === 'error' || r.status === 'failed').length;
  const pending = rows.filter((r) => r.status === 'pending_approval').length;

  const highlights = rows.slice(0, 8).map((r) => {
    const st = r.repliz_status || r.status || 'unknown';
    const err = r.repliz_last_error ? ` err=${String(r.repliz_last_error).slice(0, 80)}` : '';
    return `#${r.id} [${st}] ${(r.judul || '').slice(0, 60)}${err}`;
  });

  cachedSummary = {
    total_sampled: rows.length,
    posted_count: posted,
    failed_count: failed,
    pending_approval_count: pending,
    highlights,
    refreshed_at: new Date().toISOString(),
  };
  cachedAt = Date.now();
  return cachedSummary;
}

export function getPublishFeedbackSummary() {
  return cachedSummary;
}

export function buildPublishFeedbackPromptSection() {
  if (!cachedSummary) return '';
  const lines = [
    '',
    'FEEDBACK PUBLISH TERBARU (dari sync Repliz — gunakan untuk menyesuaikan rencana berikutnya):',
    `- Sampel: ${cachedSummary.total_sampled} konten | posted: ${cachedSummary.posted_count} | failed: ${cachedSummary.failed_count} | pending approval: ${cachedSummary.pending_approval_count}`,
  ];
  if (cachedSummary.highlights.length > 0) {
    lines.push('- Highlight:', ...cachedSummary.highlights.map((h) => `  • ${h}`));
  }
  lines.push('- Jika banyak gagal, perbaiki copywriting/jadwal; hindari tema yang sering error.');
  return lines.join('\n');
}