const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { CodexAppServer, parseStructuredText, resolveCodexBinary, unpackedPath } = require('../codex-app-server');

test('structured Codex output accepts JSON and fenced JSON', () => {
  assert.deepEqual(parseStructuredText('{"ok":true}'), { ok: true });
  assert.deepEqual(parseStructuredText('```json\n{"ok":true}\n```'), { ok: true });
  assert.throws(() => parseStructuredText('not json'), /invalid structured analysis/);
});

test('packaged binary paths are redirected outside the asar archive', () => {
  assert.equal(
    unpackedPath(path.join('/tmp', 'app.asar', 'node_modules', 'codex')),
    path.join('/tmp', 'app.asar.unpacked', 'node_modules', 'codex')
  );
});

test('the bundled Codex binary resolves for the current platform', () => {
  assert.match(resolveCodexBinary(), /codex(?:\.exe)?$/);
});

test('structured turns inherit the configured permission profile without a legacy sandbox payload', async () => {
  const server = new CodexAppServer({
    codexHome: '/tmp/codex-home',
    runtimeRoot: '/tmp/runtime',
    getModel: () => 'gpt-5.6-sol'
  });
  const requests = [];
  server.start = async () => {};
  server.account = async () => ({ type: 'chatgpt' });
  server.request = async (method, params) => {
    requests.push({ method, params });
    if (method === 'thread/start') return { thread: { id: 'thread-1' } };
    if (method === 'turn/start') {
      queueMicrotask(() => {
        server.handleNotification('item/completed', {
          threadId: 'thread-1',
          item: { type: 'agentMessage', text: '{"ok":true}' }
        });
        server.handleNotification('turn/completed', {
          threadId: 'thread-1',
          turn: { status: 'completed' }
        });
      });
      return {};
    }
    throw new Error(`Unexpected request: ${method}`);
  };

  const result = await server.runStructured('Return JSON.', {
    type: 'object',
    properties: { ok: { type: 'boolean' } }
  }, { effort: 'high' });
  const thread = requests.find(request => request.method === 'thread/start');
  const turn = requests.find(request => request.method === 'turn/start');

  assert.deepEqual(result, { ok: true });
  assert.equal(thread.params.model, 'gpt-5.6-sol');
  assert.equal(turn.params.model, 'gpt-5.6-sol');
  assert.equal(turn.params.effort, 'high');
  assert.equal(Object.hasOwn(turn.params, 'sandboxPolicy'), false);
  assert.doesNotMatch(JSON.stringify(turn.params), /readOnly|permissionProfile/);
});

test('mail agent enables only reviewable read-only mail drafting instructions', async () => {
	const server = new CodexAppServer({ codexHome: '/tmp/codex-home', runtimeRoot: '/tmp/runtime' });
	const requests = [];
	server.start = async () => {};
	server.account = async () => ({ type: 'chatgpt' });
	server.request = async (method, params) => {
		requests.push({ method, params });
		if ('thread/start' === method) return { thread: { id: 'mail-thread' } };
		if ('turn/start' === method) {
			queueMicrotask(() => {
				server.handleNotification('item/completed', {
					threadId: 'mail-thread', item: { type: 'agentMessage', text: '{"ok":true}' }
				});
				server.handleNotification('turn/completed', {
					threadId: 'mail-thread', turn: { status: 'completed' }
				});
			});
			return {};
		}
		throw new Error(`Unexpected request: ${method}`);
	};

	assert.deepEqual(await server.runMailAgent('Draft it.', { type: 'object' }), { ok: true });
	const thread = requests.find(request => 'thread/start' === request.method);
	assert.match(thread.params.baseInstructions, /read-only snappymail MCP tools/);
	assert.match(thread.params.baseInstructions, /Never send, save, delete, move, or modify mail/);
	assert.equal(thread.params.serviceName, 'snappymail_focus_compose');
	const turn = requests.find(request => 'turn/start' === request.method);
	assert.equal(turn.params.effort, 'medium');
});

test('mail agent emits only sanitized live activity for the requesting chat', async () => {
	const server = new CodexAppServer({ codexHome: '/tmp/codex-home', runtimeRoot: '/tmp/runtime' }),
		activity = [];
	server.start = async () => {};
	server.account = async () => ({ type: 'chatgpt' });
	server.on('activity', event => activity.push(event));
	server.request = async (method) => {
		if ('thread/start' === method) return { thread: { id: 'mail-thread' } };
		if ('turn/start' === method) {
			queueMicrotask(() => {
				server.handleNotification('item/started', {
					threadId: 'mail-thread',
					item: { type: 'mcpToolCall', toolName: 'get_thread', arguments: { private: 'content' } }
				});
				server.handleNotification('item/completed', {
					threadId: 'mail-thread', item: { type: 'agentMessage', text: '{"ok":true}' }
				});
				server.handleNotification('turn/completed', {
					threadId: 'mail-thread', turn: { status: 'completed' }
				});
			});
			return {};
		}
		throw new Error(`Unexpected request: ${method}`);
	};

	await server.runMailAgent('Draft it.', { type: 'object' }, { activityId: 'chat-1' });
	assert.equal(activity[0].activityId, 'chat-1');
	assert.equal(activity[0].itemType, 'mcpToolCall');
	assert.equal(activity[0].toolName, 'get_thread');
	assert.equal(JSON.stringify(activity).includes('private'), false);
	assert.equal(activity.at(-1).phase, 'completed');
});
