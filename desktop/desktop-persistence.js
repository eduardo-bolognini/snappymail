const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');

const AUTH_COOKIE_NAMES = ['smaccount', 'smadditional', 'smsession'];
const DEFAULT_WINDOW = { width: 1440, height: 920 };

function isAuthCookie(name) {
  return AUTH_COOKIE_NAMES.some(base => name === base || name.startsWith(`${base}~`));
}

function persistedCookie(cookie, origin, expirationDate) {
  const details = {
    url: new URL(cookie.path || '/', origin).toString(),
    name: cookie.name,
    value: cookie.value,
    path: cookie.path || '/',
    secure: Boolean(cookie.secure),
    httpOnly: Boolean(cookie.httpOnly),
    expirationDate
  };
  if (cookie.sameSite && cookie.sameSite !== 'unspecified') details.sameSite = cookie.sameSite;
  return details;
}

async function installPersistentSessionCookies(electronSession, origin, options = {}) {
  const jar = electronSession.cookies;
  const now = options.now || (() => Date.now() / 1000);
  const lifetimeSeconds = (options.days || 365) * 24 * 60 * 60;
  let disposed = false;

  const persist = async cookie => {
    if (disposed || !cookie?.value || !isAuthCookie(cookie.name)) return;
    if (cookie.expirationDate && cookie.expirationDate > now() + 24 * 60 * 60) return;
    await jar.set(persistedCookie(cookie, origin, now() + lifetimeSeconds));
  };
  const changed = (_event, cookie, _cause, removed) => {
    if (!removed) persist(cookie).catch(error => options.onError?.(error));
  };

  jar.on('changed', changed);
  for (const cookie of await jar.get({ url: origin })) await persist(cookie);

  return () => {
    disposed = true;
    jar.removeListener('changed', changed);
  };
}

function validBounds(value) {
  return value
    && [value.x, value.y, value.width, value.height].every(Number.isFinite)
    && value.width >= 940
    && value.height >= 640;
}

function intersects(left, right) {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

function fitBoundsToDisplays(bounds, displays = []) {
  if (!validBounds(bounds)) return null;
  if (!displays.length || displays.some(display => intersects(bounds, display.workArea))) return bounds;
  const workArea = displays[0].workArea;
  const width = Math.min(bounds.width, workArea.width);
  const height = Math.min(bounds.height, workArea.height);
  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    width,
    height
  };
}

class DesktopStateStore extends EventEmitter {
  constructor(filePath, getDisplays = () => []) {
    super();
    this.filePath = filePath;
    this.getDisplays = getDisplays;
    this.state = this.read();
    this.timer = null;
    this.navigationWindows = new WeakSet();
  }

  read() {
    try {
      const state = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      return state && typeof state === 'object' ? state : {};
    } catch {
      return {};
    }
  }

  hasWindowBounds() {
    return Boolean(fitBoundsToDisplays(this.state.window?.bounds, this.getDisplays()));
  }

  windowOptions() {
    return fitBoundsToDisplays(this.state.window?.bounds, this.getDisplays()) || null;
  }

  mailUrl(serverUrl) {
    const url = new URL('/', serverUrl);
    if (typeof this.state.route === 'string' && this.state.route.startsWith('#/')) {
      url.hash = this.state.route.slice(1);
    }
    return url.toString();
  }

  rememberRoute(value, allowedOrigin) {
    try {
      const url = new URL(value);
      if (url.origin !== allowedOrigin || !url.hash.startsWith('#/')) return false;
      this.state.route = url.hash.slice(0, 2048);
      this.scheduleSave();
      return true;
    } catch {
      return false;
    }
  }

  captureWindow(window) {
    if (!window || window.isDestroyed()) return;
    const bounds = window.getNormalBounds?.() || window.getBounds();
    this.state.window = {
      bounds: validBounds(bounds) ? bounds : DEFAULT_WINDOW,
      maximized: window.isMaximized(),
      fullscreen: window.isFullScreen(),
      zoomFactor: window.webContents?.getZoomFactor?.() || 1
    };
  }

  bindWindow(window) {
    const save = () => {
      this.captureWindow(window);
      this.scheduleSave();
    };
    ['resize', 'move', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']
      .forEach(event => window.on(event, save));
    window.on('close', () => {
      this.captureWindow(window);
      this.save();
    });
  }

  bindNavigation(window, allowedOrigin) {
    if (this.navigationWindows.has(window)) return;
    this.navigationWindows.add(window);
    const remember = (_event, url) => this.rememberRoute(url, allowedOrigin);
    window.webContents.on('did-navigate', remember);
    window.webContents.on('did-navigate-in-page', remember);
    window.webContents.on('did-finish-load', () => {
      const zoomFactor = Number(this.state.window?.zoomFactor) || 1;
      window.webContents.setZoomFactor(zoomFactor);
    });
  }

  restoreWindowMode(window) {
    if (this.state.window?.maximized) window.maximize();
    if (this.state.window?.fullscreen) window.setFullScreen(true);
  }

  scheduleSave() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.save(), 200);
  }

  save() {
    clearTimeout(this.timer);
    this.timer = null;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
    this.emit('saved', this.state);
  }
}

module.exports = {
  AUTH_COOKIE_NAMES,
  DesktopStateStore,
  fitBoundsToDisplays,
  installPersistentSessionCookies,
  isAuthCookie,
  persistedCookie
};
