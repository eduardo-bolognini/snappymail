const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  LocalBackend,
  checkPortAvailable,
  requestRoot,
  runtimeArguments
} = require('../local-backend');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0 }, () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

test('checkPortAvailable accepts a free port and rejects an occupied port', async () => {
  const server = net.createServer();
  const port = await listen(server);
  await assert.rejects(checkPortAvailable(port), error => error.code === 'EADDRINUSE');
  await close(server);
  await checkPortAvailable(port);
});

test('requestRoot returns status and a bounded response body', async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/plain' });
    response.end('ready');
  });
  const port = await listen(server);
  const response = await requestRoot(`http://127.0.0.1:${port}`);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body, 'ready');
  await close(server);
});

test('local runtime disables response compression', () => {
  assert.deepEqual(runtimeArguments(38471, '/tmp/server'), [
    'php-server',
    '--no-compress',
    '--listen', '127.0.0.1:38471',
    '--root', '/tmp/server'
  ]);
});

test('development mode stages code separately from writable data', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snappymail-focus-'));
  const appPath = path.join(root, 'desktop');
  const sourceRoot = root;
  const userDataPath = path.join(root, 'user-data');
  fs.mkdirSync(path.join(appPath, 'server'), { recursive: true });
  fs.mkdirSync(path.join(appPath, 'domains'), { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, 'snappymail'), { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, 'plugins', 'login-autoconfig'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'index.php'), '<?php');
  fs.writeFileSync(path.join(appPath, 'server', 'include.php'), '<?php');
  fs.writeFileSync(path.join(sourceRoot, 'plugins', 'login-autoconfig', 'index.php'), '<?php');
  fs.writeFileSync(
    path.join(appPath, 'domains', 'provider.test.json'),
    JSON.stringify({ IMAP: { host: 'imap.provider.test' } })
  );

  const backend = new LocalBackend({
    appPath,
    isPackaged: false,
    resourcesPath: '',
    userDataPath
  });
  assert.equal(backend.runtimeEnvironment.SNAPPYMAIL_DESKTOP, '1');
  const domainsRoot = path.join(backend.dataRoot, '_data_', '_default_', 'domains');
  const cacheRoot = path.join(backend.dataRoot, '_data_', '_default_', 'cache');
	const configRoot = path.join(backend.dataRoot, '_data_', '_default_', 'configs');
  const localhostDomain = JSON.stringify({
    IMAP: { host: 'localhost' },
    SMTP: { host: 'localhost' }
  });
  fs.mkdirSync(domainsRoot, { recursive: true });
  fs.mkdirSync(cacheRoot, { recursive: true });
	fs.mkdirSync(configRoot, { recursive: true });
	fs.writeFileSync(
		path.join(configRoot, 'application.ini'),
		'[webmail]\ntitle = "SnappyMail Webmail"\nloading_description = "SnappyMail"\n\n[labs]\nuse_local_proxy_for_external_images = On\n\n[security]\ntitle = "Keep me"\n'
	);
  fs.writeFileSync(path.join(cacheRoot, 'stale-template'), 'old template');
  fs.writeFileSync(path.join(domainsRoot, 'default.json'), localhostDomain);
  fs.writeFileSync(path.join(domainsRoot, `${os.hostname().toLowerCase()}.json`), localhostDomain);
  fs.writeFileSync(path.join(domainsRoot, 'custom.test.json'), localhostDomain);
  backend.prepareData();

  assert.equal(
    fs.readFileSync(path.join(backend.serverRoot, 'index.php'), 'utf8'),
    fs.readFileSync(path.join(sourceRoot, 'index.php'), 'utf8')
  );
  assert.equal(
    fs.realpathSync(path.join(backend.serverRoot, 'snappymail')),
    fs.realpathSync(path.join(sourceRoot, 'snappymail'))
  );
  assert.ok(fs.existsSync(path.join(
    backend.dataRoot,
    '_data_',
    '_default_',
    'plugins',
    'login-autoconfig',
    'index.php'
  )));
  assert.equal(fs.existsSync(path.join(sourceRoot, 'data')), false);
  assert.equal(fs.existsSync(path.join(domainsRoot, 'default.json')), false);
  assert.equal(fs.existsSync(path.join(domainsRoot, `${os.hostname().toLowerCase()}.json`)), false);
  assert.equal(fs.existsSync(path.join(domainsRoot, 'custom.test.json')), true);
  assert.equal(fs.existsSync(cacheRoot), true);
  assert.deepEqual(fs.readdirSync(cacheRoot), []);
  assert.equal(fs.existsSync(path.join(domainsRoot, 'disabled')), true);
	assert.match(fs.readFileSync(path.join(configRoot, 'application.ini'), 'utf8'), /title = "EasyMail"\nloading_description = "EasyMail"/);
	assert.match(fs.readFileSync(path.join(configRoot, 'application.ini'), 'utf8'), /\[labs\]\nuse_local_proxy_for_external_images = Off/);
	assert.match(fs.readFileSync(path.join(configRoot, 'application.ini'), 'utf8'), /\[security\]\ntitle = "Keep me"/);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(domainsRoot, 'provider.test.json'), 'utf8')).IMAP.host,
    'imap.provider.test'
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test('packaged mode removes compiled templates from previous app versions', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snappymail-focus-packaged-'));
  const resourcesPath = path.join(root, 'resources');
  const userDataPath = path.join(root, 'user-data');
  const pluginRoot = path.join(resourcesPath, 'bootstrap-plugins', 'login-autoconfig');
  const cacheRoot = path.join(
    userDataPath,
    'snappymail-data',
    '_data_',
    '_default_',
    'cache'
  );
  fs.mkdirSync(pluginRoot, { recursive: true });
  fs.mkdirSync(cacheRoot, { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, 'index.php'), '<?php');
  fs.writeFileSync(
    path.join(cacheRoot, 'compiled-templates'),
    '<template id="PopupsCompose"><small class="sender-account-label"></small></template>'
  );

  const backend = new LocalBackend({
    appPath: path.join(root, 'app.asar'),
    isPackaged: true,
    resourcesPath,
    userDataPath
  });
  backend.prepareData();

  assert.equal(fs.existsSync(cacheRoot), true);
  assert.deepEqual(fs.readdirSync(cacheRoot), []);
  assert.ok(fs.existsSync(path.join(
    userDataPath,
    'snappymail-data',
    '_data_',
    '_default_',
    'plugins',
    'login-autoconfig',
    'index.php'
  )));
  fs.rmSync(root, { recursive: true, force: true });
});

test('desktop external images bypass the local PHP proxy after user consent', () => {
	const application = fs.readFileSync(path.join(
		__dirname,
		'..',
		'..',
		'snappymail',
		'v',
		'0.0.0',
		'app',
		'libraries',
		'RainLoop',
		'Config',
		'Application.php'
	), 'utf8');

	assert.match(application, /use_local_proxy_for_external_images' => array\(!\\getenv\('SNAPPYMAIL_DESKTOP'\)\)/);
	assert.match(application, /'view_images'\s*=> array\('ask'/);
});
