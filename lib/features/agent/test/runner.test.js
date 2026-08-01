/**
 * S30 (C2) — seam runner agent & pembersihan sesi.
 * Dipindah dari test/s27Coverage.test.js apa adanya.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentSessions } from '../core.js';
import { resetAgentSession, runAgentTask } from '../runner.js';

test('resetAgentSession membatalkan sesi yang ada dan aman untuk kunci tak dikenal', () => {
  const aborted = [];
  agentSessions.set('telegram:coverage', { abort: async () => aborted.push(true) });

  resetAgentSession('telegram:coverage');
  resetAgentSession('telegram:missing');

  assert.deepEqual(aborted, [true]);
  assert.equal(agentSessions.has('telegram:coverage'), false);
});

test('runAgentTask menolak pemanggilan tanpa sessionKey dan prompt', async () => {
  await assert.rejects(() => runAgentTask({}), /sessionKey dan prompt wajib/);
});
