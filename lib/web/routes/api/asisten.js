import {
  agentSessions,
  touchAgentSession,
  initAgent,
} from '../../../agent.js';
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
    const finish = () => {
      if (!done) { done = true; res.end(); }
    };

    const unsubscribe = agentSession.subscribe((event) => {
      try {
        if (event.type === 'message_update') {
          if (event.assistantMessageEvent.type === 'text_delta') {
            res.write(`data: ${JSON.stringify({ type: 'text', text: event.assistantMessageEvent.delta })}\n\n`);
          }
        } else if (event.type === 'agent_end') {
          res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
          unsubscribe();
          finish();
        }
      } catch (e) {
        // response might be closed
      }
    });

    req.on('close', () => {
      unsubscribe();
      if (!done) agentSession.abort().catch(() => {});
      finish();
    });

    try {
      await agentSession.prompt(message);
      // Ensure done if agent_end didn't fire
      setTimeout(() => {
        if (!done) {
          res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
          finish();
        }
      }, 500);
    } catch (err) {
      if (!done) {
        res.write(`data: ${JSON.stringify({ type: 'error', text: err.message })}\n\n`);
        finish();
      }
    }
  });
}