import { pool } from '../../shared/db.js';
import { agentSessions, touchAgentSession, initAgent } from './core.js';
import { createAgentRun, completeAgentRun, listAgentRuns } from './runs.js';
import { resolveAutonomyMode } from './actuator/index.js';
import { createRateLimiter } from '../../shared/rateLimit.js';
import { normalizeAiMessage, AiMessageError } from './aiLimits.js';
import { requireLogin } from '../auth/requireLogin.js';
import { requestLogger } from '../../shared/logger.js';

const chatRateLimiter = createRateLimiter({
  limit: Number(process.env.WEB_AI_RATE_LIMIT) || 10,
  windowMs: Number(process.env.WEB_AI_RATE_WINDOW_MS) || 60000,
  keyFn: (req) => req.sessionID || String(req.session?.user?.id || req.ip),
}).middleware;

export async function handleAsistenChat(
  req,
  res,
  {
    dbPool = pool,
    initAgentFn = initAgent,
    sessions = agentSessions,
    touchSession = touchAgentSession,
    safetyTimeoutMs = 10 * 60 * 1000,
  } = {},
) {
  let message;
  try {
    message = normalizeAiMessage(req.body?.message);
  } catch (e) {
    if (e instanceof AiMessageError) return res.status(400).json({ error: e.message });
    throw e;
  }

  const sessionKey = req.sessionID || String(req.session.user.id);
  let agentSession = sessions.get(sessionKey);
  if (agentSession) touchSession(sessionKey);
  const log = requestLogger(req, 'agent.chat');
  log.info({ agentReady: Boolean(agentSession), sessionKey }, 'Chat request');

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  // Init agent untuk session user saat ini jika belum ada
  if (!agentSession) {
    log.info({ sessionKey }, 'Initializing agent');
    res.write(`data: ${JSON.stringify({ type: 'text', text: '⏳ Menyiapkan AI agent...\n' })}\n\n`);
    try {
      agentSession = await initAgentFn(sessionKey);
      log.info({ sessionKey }, 'Agent initialized');
      res.write(`data: ${JSON.stringify({ type: 'text', text: '✅ Agent siap!\n\n' })}\n\n`);
    } catch (err) {
      log.error({ err, sessionKey }, 'Agent initialization error');
      res.write(
        `data: ${JSON.stringify({ type: 'error', text: 'Gagal inisialisasi AI: ' + err.message })}\n\n`,
      );
      return res.end();
    }
  }

  let done = false;
  let safetyTimeout = null;
  let agentRunId = null;

  try {
    const run = await createAgentRun(dbPool, {
      session_key: sessionKey,
      source: 'web',
      autonomy_mode: resolveAutonomyMode('web'),
      trigger_type: 'chat',
      user_prompt: message,
      model_ref: process.env.AI_MODEL || null,
    });
    agentRunId = run.id;
  } catch (err) {
    log.error({ err, sessionKey }, 'createAgentRun error');
  }

  const finishRun = async (status, errorMessage = null) => {
    if (!agentRunId) return;
    const runId = agentRunId;
    agentRunId = null;
    try {
      await completeAgentRun(dbPool, runId, { status, error_message: errorMessage });
    } catch (err) {
      log.error({ err, runId }, 'completeAgentRun error');
    }
  };

  const finish = () => {
    if (!done) {
      done = true;
      if (safetyTimeout) clearTimeout(safetyTimeout);
      res.end();
    }
  };

  const unsubscribe = agentSession.subscribe((event) => {
    try {
      if (event.type === 'message_update') {
        if (event.assistantMessageEvent.type === 'text_delta') {
          res.write(`data: ${JSON.stringify({ type: 'text', text: event.assistantMessageEvent.delta })}\n\n`);
        }
      } else if (event.type === 'agent_end') {
        finishRun('completed');
        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
        unsubscribe();
        finish();
      }
    } catch (e) {
      // response might be closed
    }
  });

  safetyTimeout = setTimeout(() => {
    if (!done) {
      log.warn({ sessionKey }, 'Safety timeout; closing SSE stream');
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      unsubscribe();
      finish();
    }
  }, safetyTimeoutMs);

  req.on('close', () => {
    unsubscribe();
    if (!done) {
      finishRun('aborted');
      agentSession.abort().catch(() => {});
    }
    finish();
  });

  try {
    await agentSession.prompt(message);
  } catch (err) {
    if (!done) {
      finishRun('error', err.message);
      res.write(`data: ${JSON.stringify({ type: 'error', text: err.message })}\n\n`);
      finish();
    }
  }
}

export function registerAsistenRoutes(app, deps = {}) {
  const {
    dbPool = pool,
    initAgent: initAgentFn = initAgent,
    sessions = agentSessions,
    requireAuth = requireLogin,
    rateLimiter = chatRateLimiter,
    safetyTimeoutMs = 10 * 60 * 1000,
  } = deps;

  app.post('/api/asisten', requireAuth, rateLimiter, (req, res) =>
    handleAsistenChat(req, res, { dbPool, initAgentFn, sessions, safetyTimeoutMs }),
  );
}

export function registerAgentRunsRoutes(app, deps = {}) {
  const { dbPool = pool, requireAuth = requireLogin } = deps;
  app.get('/api/agent/runs', requireAuth, async (req, res) => {
    try {
      const limit = req.query.limit;
      const sessionKey = req.sessionID || String(req.session?.user?.id);
      const runs = await listAgentRuns(dbPool, { limit, session_key: sessionKey });
      res.json(runs);
    } catch (err) {
      requestLogger(req, 'agent.runs').error({ err }, 'GET /api/agent/runs error');
      res.status(500).json({ error: 'Gagal mengambil data agent runs' });
    }
  });
}
