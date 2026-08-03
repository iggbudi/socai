// S34 (D1) — fake seams for the pi-coding-agent SDK primitives used by
// lib/features/agent/core.js. Lets tests exercise real model-selection, tool-wiring, and
// tool-execution logic without a network call to the coding-agent SDK.
export function fakeSession(overrides = {}) {
  return {
    id: 'fake-session',
    abort: async () => {},
    ...overrides,
  };
}

export function createFakeAgentSdk({ models = {}, session = fakeSession() } = {}) {
  const calls = { modelRuntimeCreate: [], createAgentSession: [], resourceLoaderFactory: [] };

  const deps = {
    modelRuntimeCreate: async (opts) => {
      calls.modelRuntimeCreate.push(opts);
      return {
        getModel: (provider, modelId) => models[`${provider}/${modelId}`] || null,
      };
    },
    createAgentSession: async (options) => {
      calls.createAgentSession.push(options);
      return { session };
    },
    sessionManagerFactory: () => ({ kind: 'fake-in-memory' }),
    resourceLoaderFactory: (opts) => {
      calls.resourceLoaderFactory.push(opts);
      return { reload: async () => {} };
    },
    getAgentDir: () => '/fake/agent/dir',
    fetchFn: async () => ({ json: async () => ({}) }),
  };

  return { calls, deps, session };
}

export function fakePool(handlers = {}) {
  return {
    query: async (sql, params) => {
      for (const [pattern, handler] of Object.entries(handlers)) {
        if (sql.includes(pattern)) return handler(sql, params);
      }
      return { rows: [] };
    },
  };
}

export function findTool(customTools, name) {
  const tool = customTools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool not found: ${name}`);
  return tool;
}
