const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  DesktopStateStore,
  fitBoundsToDisplays,
  installPersistentSessionCookies
} = require('../desktop-persistence');

class CookieJar extends EventEmitter {
  constructor(cookies = []) {
    super();
    this.cookies = cookies;
    this.setCalls = [];
  }

  async get() {
    return this.cookies;
  }

  async set(details) {
    this.setCalls.push(details);
    const cookie = { ...details, session: false };
    this.cookies = this.cookies.filter(item => item.name !== details.name).concat(cookie);
    this.emit('changed', {}, cookie, 'explicit', false);
  }
}

test('authenticated desktop cookies survive a complete app restart', async () => {
  const jar = new CookieJar([
    { name: 'smaccount', value: 'encrypted-account', path: '/', httpOnly: true },
    { name: 'theme', value: 'light', path: '/' }
  ]);
  const remove = await installPersistentSessionCookies(
    { cookies: jar },
    'http://127.0.0.1:38471',
    { now: () => 1000, days: 365 }
  );

  assert.equal(jar.setCalls.length, 1);
  assert.equal(jar.setCalls[0].name, 'smaccount');
  assert.equal(jar.setCalls[0].expirationDate, 31537000);
  assert.equal(jar.setCalls.some(cookie => cookie.name === 'theme'), false);
  remove();
});

test('window geometry and mailbox route are restored from private desktop state', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'easymail-state-'));
  const filePath = path.join(root, 'desktop-state.json');
  const displays = [{ workArea: { x: 0, y: 0, width: 1728, height: 1117 } }];
  const store = new DesktopStateStore(filePath, () => displays);
  store.state.window = {
    bounds: { x: 120, y: 80, width: 1400, height: 900 },
    maximized: false,
    fullscreen: false,
    zoomFactor: 1.1
  };
  assert.equal(
    store.rememberRoute('http://127.0.0.1:38471/#/mailbox/INBOX/m42', 'http://127.0.0.1:38471'),
    true
  );
  store.save();

  const restored = new DesktopStateStore(filePath, () => displays);
  assert.deepEqual(restored.windowOptions(), { x: 120, y: 80, width: 1400, height: 900 });
  assert.equal(restored.mailUrl('http://127.0.0.1:38471'), 'http://127.0.0.1:38471/#/mailbox/INBOX/m42');
  fs.rmSync(root, { recursive: true, force: true });
});

test('window bounds are recentered when a disconnected display is no longer available', () => {
  assert.deepEqual(fitBoundsToDisplays(
    { x: 2400, y: 120, width: 1200, height: 800 },
    [{ workArea: { x: 0, y: 0, width: 1728, height: 1117 } }]
  ), { x: 264, y: 159, width: 1200, height: 800 });
});
