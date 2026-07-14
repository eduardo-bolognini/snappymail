const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_PORT = 38471;

function checkPortAvailable(port) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once('error', reject);
    probe.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      probe.close(error => error ? reject(error) : resolve());
    });
  });
}

function requestRoot(serverUrl) {
  return new Promise((resolve, reject) => {
    const request = http.get(serverUrl, { timeout: 1000 }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        if (body.length < 8192) body += chunk;
      });
      response.on('end', () => resolve({ statusCode: response.statusCode, body }));
    });
    request.once('timeout', () => request.destroy(new Error('Timeout backend')));
    request.once('error', reject);
  });
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function runtimeArguments(port, serverRoot) {
  return [
    'php-server',
    '--no-compress',
    '--listen', `127.0.0.1:${port}`,
    '--root', serverRoot
  ];
}

class LocalBackend {
  constructor({ appPath, isPackaged, resourcesPath, userDataPath, onUnexpectedExit }) {
    this.appPath = appPath;
    this.isPackaged = isPackaged;
    this.resourcesPath = resourcesPath;
    this.userDataPath = userDataPath;
    this.dataRoot = path.join(userDataPath, 'snappymail-data');
    this.logPath = path.join(userDataPath, 'backend.log');
    this.port = Number.parseInt(process.env.SNAPPYMAIL_DESKTOP_PORT, 10) || DEFAULT_PORT;
    this.process = null;
    this.logStream = null;
    this.ready = false;
    this.stopping = false;
    this.onUnexpectedExit = onUnexpectedExit;
  }

  get isRunning() {
    return Boolean(this.process && this.process.exitCode === null && !this.process.killed);
  }

  get runtimePath() {
    const executable = process.platform === 'win32' ? 'frankenphp.exe' : 'frankenphp';
    return this.isPackaged
      ? path.join(this.resourcesPath, 'runtime', executable)
      : path.join(this.appPath, 'runtime', executable);
  }

  get serverRoot() {
    return this.isPackaged
      ? path.join(this.resourcesPath, 'server')
      : path.join(this.userDataPath, 'dev-server');
  }

  get bootstrapPluginRoot() {
    return this.isPackaged
      ? path.join(this.resourcesPath, 'bootstrap-plugins', 'login-autoconfig')
      : path.resolve(this.appPath, '..', 'plugins', 'login-autoconfig');
  }

  get bootstrapDomainsRoot() {
    return this.isPackaged
      ? path.join(this.resourcesPath, 'bootstrap-domains')
      : path.join(this.appPath, 'domains');
  }

  get runtimeEnvironment() {
    return {
      ...process.env,
      SERVER_ROOT: this.serverRoot,
      CADDY_GLOBAL_OPTIONS: 'admin off',
      SNAPPYMAIL_DESKTOP: '1',
      SNAPPYMAIL_DESKTOP_DATA: this.dataRoot,
      XDG_CONFIG_HOME: path.join(this.userDataPath, 'runtime-config'),
      XDG_DATA_HOME: path.join(this.userDataPath, 'runtime-data')
    };
  }

  prepareData() {
    fs.mkdirSync(this.dataRoot, { recursive: true, mode: 0o700 });
    if (!this.isPackaged) {
      this.prepareDevServer();
    }
    // Templates and localization are compiled into SnappyMail's persistent
    // cache. Clear it on every desktop start so an installed update cannot
    // render markup from the previous bundle.
    const cacheRoot = path.join(this.dataRoot, '_data_', '_default_', 'cache');
    fs.rmSync(cacheRoot, { recursive: true, force: true });
    fs.mkdirSync(cacheRoot, { recursive: true, mode: 0o700 });
    const pluginTarget = path.join(this.dataRoot, '_data_', '_default_', 'plugins', 'login-autoconfig');
    fs.mkdirSync(path.dirname(pluginTarget), { recursive: true, mode: 0o700 });
    fs.cpSync(this.bootstrapPluginRoot, pluginTarget, { recursive: true, force: true });
    this.prepareDesktopDomains();
		this.prepareDesktopConfiguration();
  }

	prepareDesktopConfiguration() {
		const configPath = path.join(this.dataRoot, '_data_', '_default_', 'configs', 'application.ini');
		if (!fs.existsSync(configPath)) return;
		const lines = fs.readFileSync(configPath, 'utf8').split(/\r?\n/);
		let section = '';
		let changed = false;
		const updated = lines.map(line => {
			const heading = line.match(/^\s*\[([^\]]+)\]\s*$/);
			if (heading) section = heading[1].trim().toLowerCase();
			if ('labs' === section && /^\s*use_local_proxy_for_external_images\s*=/.test(line)) {
				if (!/^\s*use_local_proxy_for_external_images\s*=\s*Off\s*$/.test(line)) changed = true;
				return 'use_local_proxy_for_external_images = Off';
			}
			if ('webmail' !== section) return line;
			if (/^\s*title\s*=\s*"(?:SnappyMail Webmail|SnappyMail Focus)"\s*$/.test(line)) {
				changed = true;
				return 'title = "EasyMail"';
			}
			if (/^\s*loading_description\s*=\s*"SnappyMail(?: Focus)?"\s*$/.test(line)) {
				changed = true;
				return 'loading_description = "EasyMail"';
			}
			return line;
		});
		if (changed) fs.writeFileSync(configPath, updated.join('\n'), { mode: 0o600 });
	}

  prepareDesktopDomains() {
    const domainsRoot = path.join(this.dataRoot, '_data_', '_default_', 'domains');
    fs.mkdirSync(domainsRoot, { recursive: true, mode: 0o700 });

    // SnappyMail's server setup seeds localhost wildcard domains. A desktop
    // client must discover the user's provider instead of treating localhost
    // as an IMAP server.
    fs.closeSync(fs.openSync(path.join(domainsRoot, 'disabled'), 'a', 0o600));
    const generatedNames = new Set(['default.json', `${os.hostname().toLowerCase()}.json`]);
    for (const name of generatedNames) {
      const filePath = path.join(domainsRoot, name);
      if (!fs.existsSync(filePath)) continue;
      try {
        const domain = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (domain.IMAP?.host === 'localhost' && domain.SMTP?.host === 'localhost') {
          fs.rmSync(filePath);
        }
      } catch {
        // Keep user-edited or non-JSON domain files untouched.
      }
    }

    if (fs.existsSync(this.bootstrapDomainsRoot)) {
      for (const name of fs.readdirSync(this.bootstrapDomainsRoot)) {
        if (!name.endsWith('.json')) continue;
        const target = path.join(domainsRoot, name);
        if (!fs.existsSync(target)) {
          fs.copyFileSync(path.join(this.bootstrapDomainsRoot, name), target);
        }
      }
    }
  }

  prepareDevServer() {
    const sourceRoot = path.resolve(this.appPath, '..');
    fs.rmSync(this.serverRoot, { recursive: true, force: true });
    fs.mkdirSync(this.serverRoot, { recursive: true, mode: 0o700 });
    fs.copyFileSync(path.join(sourceRoot, 'index.php'), path.join(this.serverRoot, 'index.php'));
    fs.symlinkSync(
      path.join(sourceRoot, 'snappymail'),
      path.join(this.serverRoot, 'snappymail'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    fs.copyFileSync(path.join(this.appPath, 'server', 'include.php'), path.join(this.serverRoot, 'include.php'));
  }

  async start() {
    if (!fs.existsSync(this.runtimePath)) {
      throw new Error(`Runtime PHP non trovato: ${this.runtimePath}. Esegui npm run runtime:prepare.`);
    }
    await checkPortAvailable(this.port).catch(error => {
      throw new Error(`La porta locale ${this.port} non è disponibile (${error.code || error.message}).`);
    });
    this.prepareData();
    this.ready = false;
    this.stopping = false;

    const serverUrl = `http://127.0.0.1:${this.port}`;
    this.logStream = fs.createWriteStream(this.logPath, { flags: 'a', mode: 0o600 });
    this.logStream.write(`\n[${new Date().toISOString()}] Starting local backend on ${serverUrl}\n`);

    this.process = spawn(
      this.runtimePath,
      runtimeArguments(this.port, this.serverRoot),
      {
        cwd: this.serverRoot,
        env: this.runtimeEnvironment,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      }
    );
    this.process.stdout.pipe(this.logStream, { end: false });
    this.process.stderr.pipe(this.logStream, { end: false });
    this.process.once('exit', code => {
      if (this.ready && !this.stopping) {
        this.onUnexpectedExit?.(new Error(`Il backend locale si e chiuso con codice ${code}.`));
      }
    });

    const exitError = new Promise((_, reject) => {
      this.process.once('error', reject);
      this.process.once('exit', code => {
        if (code !== 0) reject(new Error(`Il backend locale si è chiuso con codice ${code}.`));
      });
    });

    const ready = this.waitUntilReady(serverUrl);
    await Promise.race([ready, exitError]);
    this.ready = true;
    return serverUrl;
  }

  async waitUntilReady(serverUrl) {
    const deadline = Date.now() + 30000;
    let lastError;
    while (Date.now() < deadline) {
      try {
        const response = await requestRoot(serverUrl);
        if (/\[(?:202|301|302)\]/.test(response.body)) {
          const text = response.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          throw new Error(`Controllo runtime SnappyMail fallito: ${text}`);
        }
        if (response.statusCode && response.statusCode < 500) return;
        lastError = new Error(`HTTP ${response.statusCode}`);
      } catch (error) {
        lastError = error;
      }
      await delay(200);
    }
    throw new Error(`Il backend locale non è diventato disponibile: ${lastError?.message || 'timeout'}`);
  }

  async stop() {
    this.stopping = true;
    this.ready = false;
    const child = this.process;
    this.process = null;
    if (!child || child.exitCode !== null) {
      this.logStream?.end();
      return;
    }

    await new Promise(resolve => {
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 3000);
      child.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
      child.kill('SIGTERM');
    });
    this.logStream?.end();
  }
}

module.exports = { DEFAULT_PORT, LocalBackend, checkPortAvailable, requestRoot, runtimeArguments };
