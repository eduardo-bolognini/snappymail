const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { AutoUpdateManager } = require('../auto-update');

class FakeUpdater extends EventEmitter {
  constructor() {
    super();
    this.checks = 0;
    this.installs = 0;
  }

  async checkForUpdates() {
    this.checks += 1;
  }

  quitAndInstall() {
    this.installs += 1;
  }
}

class FakeNotification extends EventEmitter {
  static instances = [];

  static isSupported() {
    return true;
  }

  constructor(options) {
    super();
    this.options = options;
    this.shown = false;
    FakeNotification.instances.push(this);
  }

  show() {
    this.shown = true;
  }
}

function createManager(overrides = {}) {
  FakeNotification.instances = [];
  const updater = new FakeUpdater();
  const manager = new AutoUpdateManager({
    app: { isPackaged: true, getVersion: () => '0.1.0' },
    autoUpdater: updater,
    Notification: FakeNotification,
    initialDelayMs: 60_000,
    checkIntervalMs: 60_000,
    logger: { error() {} },
    ...overrides
  });
  return { manager, updater };
}

test('automatic updates remain disabled in development', () => {
  const { manager } = createManager({
    app: { isPackaged: false, getVersion: () => '0.1.0' }
  });
  assert.equal(manager.start(), false);
  assert.equal(manager.started, false);
});

test('packaged builds download updates and report availability', async () => {
  const { manager, updater } = createManager();
  assert.equal(manager.start(), true);
  assert.equal(updater.autoDownload, true);
  assert.equal(updater.autoInstallOnAppQuit, true);

  assert.equal(await manager.check(), true);
  assert.equal(updater.checks, 1);
  updater.emit('update-available', { version: '0.2.0' });

  assert.equal(manager.downloading, true);
  assert.equal(FakeNotification.instances.length, 1);
  assert.match(FakeNotification.instances[0].options.body, /0\.2\.0/);
  manager.stop();
});

test('downloaded update installs after notification click', async () => {
  let prepared = false;
  const { manager, updater } = createManager({
    beforeInstall: async () => { prepared = true; }
  });
  manager.start();
  updater.emit('update-downloaded', { version: '0.2.0' });

  const notification = FakeNotification.instances[0];
  notification.emit('click');
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(prepared, true);
  assert.equal(updater.installs, 1);
  manager.stop();
});

test('manual checks notify when EasyMail is already current', async () => {
  const { manager, updater } = createManager();
  manager.start();
  await manager.check({ manual: true });
  updater.emit('update-not-available', { version: '0.1.0' });

  assert.equal(FakeNotification.instances.length, 1);
  assert.equal(FakeNotification.instances[0].options.title, 'EasyMail è aggiornato');
  manager.stop();
});
