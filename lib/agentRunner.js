import { pool, initAgent, agentSessions, agentSessionPromises, agentSessionLastUsed } from './agent.js';
import { createAgentRun, completeAgentRun } from './agentRuns.js';
import { resolveAutonomyMode } from './actuator/index.js';

export const CRON_WEEKLY_SESSION_KEY = 'cron:weekly-plan';

export function resetAgentSession(sessionKey) {
  const session = agentSessions.get(sessionKey);
  if (session) {
    session.abort().catch(() => {});
  }
  agentSessions.delete(sessionKey);
  agentSessionLastUsed.delete(sessionKey);
  agentSessionPromises.delete(sessionKey);
}

export async function runAgentTask({
  sessionKey,
  source,
  triggerType = 'chat',
  prompt,
  autonomyMode = null,
  modelRef = null,
  resetSession = false,
} = {}) {
  if (!sessionKey || !prompt) {
    throw new Error('sessionKey dan prompt wajib untuk runAgentTask.');
  }

  const resolvedSource = source || (String(sessionKey).startsWith('cron:') ? 'cron' : 'web');
  const resolvedMode = autonomyMode || resolveAutonomyMode(resolvedSource);
  const resolvedModel = modelRef || process.env.AI_MODEL || null;

  if (resetSession) {
    resetAgentSession(sessionKey);
  }

  let runId = null;
  let fullText = '';

  try {
    const run = await createAgentRun(pool, {
      session_key: sessionKey,
      source: resolvedSource,
      autonomy_mode: resolvedMode,
      trigger_type: triggerType,
      user_prompt: prompt,
      model_ref: resolvedModel,
    });
    runId = run.id;

    const agentSession = await initAgent(sessionKey);
    const unsubscribe = agentSession.subscribe((event) => {
      if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') {
        fullText += event.assistantMessageEvent.delta;
      }
    });

    await agentSession.prompt(prompt);
    unsubscribe();

    await completeAgentRun(pool, runId, { status: 'completed' });
    runId = null;

    return {
      ok: true,
      sessionKey,
      source: resolvedSource,
      autonomyMode: resolvedMode,
      textLength: fullText.length,
      text: fullText,
    };
  } catch (err) {
    if (runId) {
      await completeAgentRun(pool, runId, { status: 'error', error_message: err.message }).catch(() => {});
    }
    throw err;
  }
}