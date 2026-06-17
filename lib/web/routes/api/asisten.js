import {
  pool,
  agentSessions,
  touchAgentSession,
  initAgent,
} from '../../../agent.js';
import { createAgentRun, completeAgentRun } from '../../../agentRuns.js';
import { resolveAutonomyMode } from '../../../actuator/index.js';
import { createRateLimiter } from '../../../rateLimit.js';
import { normalizeAiMessage, AiMessageError } from '../../../aiLimits.js';
import { requireLogin } from '../../middleware/auth.js';

const chatRateLimiter = createRateLimiter({
  limit: Number(process.env.WEB_AI_RATE_LIMIT) || 10,
  windowMs: Number(process.env.WEB_AI_RATE_WINDOW_MS) || 60000,
  keyFn: (req) => req.sessionID || String(req.session?.user?.id || req.ip),
}).middleware;

export function registerAsistenRoutes(app) {
  app.post('/api/asisten', requireLogin, chatRateLimiter, async (req, res) => {
    let message;
    try {
      message = normalizeAiMessage(req.body?.message);
    } catch (e) {
      if (e instanceof AiMessageError) return res.status(400).json({ error: e.message });
      throw e;
    }

    const sessionKey = req.sessionID || String(req.session.user.id);
    let agentSession = agentSessions.get(sessionKey);
    if (agentSession) touchAgentSession(sessionKey);
    console.log('[Chat] Request, agentReady:', Boolean(agentSession), 'session:', sessionKey);

    // SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    // Init agent untuk session user saat ini jika belum ada
    if (!agentSession) {
      console.log('[Chat] Initializing agent for session:', sessionKey);
      res.write(`data: ${JSON.stringify({ type: 'text', text: '⏳ Menyiapkan AI agent...\n' })}\n\n`);
      try {
        agentSession = await initAgent(sessionKey);
        console.log('[Chat] Agent initialized for session:', sessionKey);
        res.write(`data: ${JSON.stringify({ type: 'text', text: '✅ Agent siap!\n\n' })}\n\n`);
      } catch (err) {
        console.error('[Chat] Init error:', err.message);
        res.write(`data: ${JSON.stringify({ type: 'error', text: 'Gagal inisialisasi AI: ' + err.message })}\n\n`);
        return res.end();
      }
    }

    let done = false;
    let safetyTimeout = null;
    let agentRunId = null;

    try {
      const run = await createAgentRun(pool, {
        session_key: sessionKey,
        source: 'web',
        autonomy_mode: resolveAutonomyMode('web'),
        trigger_type: 'chat',
        user_prompt: message,
        model_ref: process.env.AI_MODEL || null,
      });
      agentRunId = run.id;
    } catch (err) {
      console.error('[Chat] createAgentRun error:', err.message);
    }

    const finishRun = async (status, errorMessage = null) => {
      if (!agentRunId) return;
      const runId = agentRunId;
      agentRunId = null;
      try {
        await completeAgentRun(pool, runId, { status, error_message: errorMessage });
      } catch (err) {
        console.error('[Chat] completeAgentRun error:', err.message);
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
          finishRun('completed').catch(() => {});
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
        console.warn('[Chat] Safety timeout (10 min) — closing SSE stream for session:', sessionKey);
        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
        unsubscribe();
        finish();
      }
    }, 10 * 60 * 1000);

    req.on('close', () => {
      unsubscribe();
      if (!done) {
        finishRun('aborted').catch(() => {});
        agentSession.abort().catch(() => {});
      }
      finish();
    });

    try {
      await agentSession.prompt(message);
    } catch (err) {
      if (!done) {
        finishRun('error', err.message).catch(() => {});
        res.write(`data: ${JSON.stringify({ type: 'error', text: err.message })}\n\n`);
        finish();
      }
    }
  });
}