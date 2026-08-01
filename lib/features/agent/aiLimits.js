export class AiMessageError extends Error { name = 'AiMessageError'; }
export const AI_MESSAGE_MAX_LENGTH = Number(process.env.AI_MESSAGE_MAX_LENGTH) || 4000;
export function normalizeAiMessage(raw) {
  const text = String(raw ?? '').trim();
  if (!text) throw new AiMessageError('Pesan tidak boleh kosong');
  if (text.length > AI_MESSAGE_MAX_LENGTH) throw new AiMessageError(`Pesan terlalu panjang (maks ${AI_MESSAGE_MAX_LENGTH} karakter)`);
  return text;
}