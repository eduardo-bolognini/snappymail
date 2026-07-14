const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { MailMcpBridge } = require('../mail-mcp-bridge');

test('mail MCP bridge forwards only read-only methods to the renderer', async () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snappy-mail-mcp-')),
		socketPath = path.join(root, 'mail.sock');
	let bridge;
	const window = {
		isDestroyed: () => false,
		webContents: {
			isDestroyed: () => false,
			send: (_channel, request) => bridge.respond({ id: request.id, result: { messages: [{ uid: 7 }] } })
		}
	};
	bridge = new MailMcpBridge({ socketPath, getWindow: () => window });
	await bridge.start();

	const response = await new Promise((resolve, reject) => {
		const socket = net.createConnection(socketPath);
		let value = '';
		socket.setEncoding('utf8');
		socket.once('connect', () => socket.write('{"id":1,"method":"search","params":{}}\n'));
		socket.on('data', chunk => value += chunk);
		socket.once('end', () => resolve(JSON.parse(value)));
		socket.once('error', reject);
	});
	assert.deepEqual(response.result.messages, [{ uid: 7 }]);

	await bridge.stop();
	fs.rmSync(root, { recursive: true, force: true });
});
