const fs = require('node:fs');
const net = require('node:net');
const { randomUUID } = require('node:crypto');

const ALLOWED_METHODS = new Set(['mailboxes', 'search', 'message']);

class MailMcpBridge {
  constructor({ socketPath, getWindow } = {}) {
    this.socketPath = socketPath;
    this.getWindow = getWindow;
    this.server = null;
    this.pending = new Map();
  }

  async start() {
    if (this.server) return;
    try {
      fs.unlinkSync(this.socketPath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    this.server = net.createServer(socket => {
      let buffer = '';
      socket.setEncoding('utf8');
      socket.on('data', chunk => {
        buffer += chunk;
        if (buffer.length > 256 * 1024) {
          socket.destroy(new Error('Mail MCP request is too large'));
          return;
        }
        const newline = buffer.indexOf('\n');
        if (newline < 0) return;
        const line = buffer.slice(0, newline);
        buffer = '';
        this.handleRequest(socket, line);
      });
    });

    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.socketPath, () => {
        this.server.off('error', reject);
        fs.chmodSync(this.socketPath, 0o600);
        resolve();
      });
    });
  }

  handleRequest(socket, line) {
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      socket.end(`${JSON.stringify({ error: 'Invalid Mail MCP request' })}\n`);
      return;
    }
    if (!ALLOWED_METHODS.has(request.method)) {
      socket.end(`${JSON.stringify({ id: request.id, error: 'Mail MCP method is not allowed' })}\n`);
      return;
    }

    const window = this.getWindow?.();
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
      socket.end(`${JSON.stringify({ id: request.id, error: 'Mail interface is not ready' })}\n`);
      return;
    }

    const bridgeId = randomUUID();
    const timer = setTimeout(() => {
      this.pending.delete(bridgeId);
      socket.end(`${JSON.stringify({ id: request.id, error: 'Mail request timed out' })}\n`);
    }, 120000);
    this.pending.set(bridgeId, { socket, requestId: request.id, timer });
    window.webContents.send('snappy-mail-mcp:request', {
      id: bridgeId,
      method: request.method,
      params: request.params || {}
    });
  }

  respond(payload = {}) {
    const pending = this.pending.get(payload.id);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pending.delete(payload.id);
    pending.socket.end(`${JSON.stringify({
      id: pending.requestId,
      result: payload.result,
      error: payload.error || undefined
    })}\n`);
    return true;
  }

  async stop() {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.socket.destroy();
    }
    this.pending.clear();
    const server = this.server;
    this.server = null;
    if (server) await new Promise(resolve => server.close(resolve));
    try {
      fs.unlinkSync(this.socketPath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

module.exports = { MailMcpBridge, ALLOWED_METHODS };
