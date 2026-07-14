const { app, BrowserWindow, Menu, Notification, dialog, ipcMain, screen, session, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AiService } = require('./ai-service');
const { AutoUpdateManager } = require('./auto-update');
const { DesktopStateStore, installPersistentSessionCookies } = require('./desktop-persistence');
const { LocalBackend } = require('./local-backend');
const { MailMcpBridge } = require('./mail-mcp-bridge');
const { installNotificationPermissionHandlers } = require('./notification-permissions');
const { exitAfterCleanup, isUsableWindow } = require('./window-lifecycle');

let activeWindow;
let backend;
let backendUrl;
let aiService;
let mailMcpBridge;
let updateManager;
let desktopState;
let removeCookiePersistence;
let quitting = false;

const APP_ID = 'com.eduardobolognini.snappymail.focus';

const attachmentRoots = ['Desktop', 'Documents', 'Downloads']
  .map(name => path.join(os.homedir(), name));

async function readAttachment(value) {
  const realPath = await fs.promises.realpath(String(value || ''));
  const allowed = attachmentRoots.some(root => {
    const relative = path.relative(root, realPath);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  });
  if (!allowed) throw new Error('Attachment path is outside the allowed folders');
  const stat = await fs.promises.stat(realPath);
  if (!stat.isFile()) throw new Error('Attachment path is not a file');
  if (stat.size > 50 * 1024 * 1024) throw new Error('Attachment is larger than 50 MB');
  return {
    name: path.basename(realPath),
    size: stat.size,
    data: (await fs.promises.readFile(realPath)).toString('base64')
  };
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();
if (hasLock && process.platform === 'win32') app.setAppUserModelId(APP_ID);

function baseWindowOptions(extra = {}) {
  return {
    width: 1440,
    height: 920,
    minWidth: 940,
    minHeight: 640,
    backgroundColor: '#f6f6f4',
    ...extra
  };
}

function openExternal(value) {
  try {
    const url = new URL(value);
    if (['http:', 'https:', 'mailto:'].includes(url.protocol)) shell.openExternal(url.toString());
  } catch {
    // Invalid URLs are ignored instead of reaching the OS shell.
  }
}

function createLoadingWindow() {
  const restoredBounds = desktopState?.windowOptions();
  const window = new BrowserWindow(baseWindowOptions({
    ...(restoredBounds || {
      width: 560,
      height: 380,
      minWidth: 560,
      minHeight: 380
    }),
    maximizable: false,
    resizable: false,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js')
    }
  }));
  activeWindow = window;
  desktopState?.bindWindow(window);
  window.loadFile(path.join(__dirname, 'loading', 'index.html'));
  window.once('ready-to-show', () => {
    if (!window.isDestroyed()) {
      window.show();
      desktopState?.restoreWindowMode(window);
    }
  });
  window.once('closed', () => {
    if (activeWindow === window) activeWindow = null;
  });
  return window;
}

function loadMail(window, serverUrl) {
  const allowedOrigin = new URL(serverUrl).origin;
  window.setResizable(true);
  window.setMaximizable(true);
  window.setMinimumSize(940, 640);
  if (!desktopState?.hasWindowBounds()) window.setSize(1440, 920, true);
  desktopState?.restoreWindowMode(window);
  desktopState?.bindNavigation(window, allowedOrigin);

  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, target) => {
    try {
      if (new URL(target).origin === allowedOrigin) return;
    } catch {
      // Block malformed navigation targets.
    }
    event.preventDefault();
    openExternal(target);
  });

  window.webContents.on('context-menu', (_event, params) => {
    if (!params.isEditable) return;
    Menu.buildFromTemplate([
      { role: 'cut', enabled: params.editFlags.canCut },
      { role: 'copy', enabled: params.editFlags.canCopy },
      { role: 'paste', enabled: params.editFlags.canPaste },
      { type: 'separator' },
      { role: 'selectAll', enabled: params.editFlags.canSelectAll }
    ]).popup({ window });
  });

  window.loadURL(desktopState?.mailUrl(serverUrl) || serverUrl);
}

function showApplicationWindow() {
  if (isUsableWindow(activeWindow)) {
    if (activeWindow.isMinimized()) activeWindow.restore();
    activeWindow.show();
    activeWindow.focus();
    return;
  }

  const window = createLoadingWindow();
  if (backendUrl) loadMail(window, backendUrl);
}

function installMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Apri dati locali',
          click: () => backend && shell.openPath(backend.dataRoot)
        },
        {
          label: 'Controlla aggiornamenti…',
          enabled: app.isPackaged,
          click: () => updateManager?.check({ manual: true })
        },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'Vista',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function stopApplicationServices() {
  desktopState?.captureWindow(activeWindow);
  desktopState?.save();
  removeCookiePersistence?.();
  removeCookiePersistence = null;
  return Promise.allSettled([
    backend?.stop(),
    aiService?.stop(),
    mailMcpBridge?.stop(),
    session.defaultSession.cookies.flushStore()
  ]);
}

function handleBackendExit(error) {
  if (quitting) return;
  dialog.showErrorBox(
    'Backend locale interrotto',
    `${error.message}\n\nLog backend: ${backend.logPath}`
  );
  quitting = true;
  updateManager?.stop();
  stopApplicationServices().finally(() => app.quit());
}

function registerMailMcpHandlers() {
  ipcMain.removeAllListeners('snappy-mail-mcp:response');
  ipcMain.on('snappy-mail-mcp:response', (event, payload) => {
    if (!backendUrl) return;
    try {
      if (new URL(event.senderFrame.url).origin !== new URL(backendUrl).origin) return;
    } catch {
      return;
    }
    mailMcpBridge?.respond(payload);
  });
}

function registerAiHandlers() {
  const handlers = {
    status: () => aiService.status(),
    workspace: () => aiService.getWorkspace(),
		'recipient-suggestions': payload => aiService.recipientSuggestions(payload?.query),
    'login-api-key': payload => aiService.loginApiKey(payload?.apiKey),
    'login-device': () => aiService.startDeviceLogin(),
    logout: () => aiService.logout(),
    settings: payload => aiService.saveSettings(payload),
		analyze: payload => aiService.analyzeCorpus(payload?.corpus, payload?.locale),
		compose: payload => aiService.compose(payload, payload?.locale),
		'compose-chat': payload => aiService.composeChat(payload, payload?.locale),
		'pre-send-review': payload => aiService.reviewBeforeSend(payload, payload?.locale),
		'attachment-read': payload => readAttachment(payload?.path),
		'plugin-list': () => aiService.listPlugins(),
		'plugin-install': payload => aiService.installPlugin(payload?.id),
		'plugin-uninstall': payload => aiService.uninstallPlugin(payload?.id),
		'plugin-authorize': payload => aiService.authorizePluginApp(payload?.id),
    'observe-sent': payload => aiService.observeSent(payload?.message, payload?.locale),
    'contact-update': payload => aiService.updateContact(payload?.id, payload?.updates),
    'group-add': payload => aiService.addGroup(payload?.name)
  };

  for (const [name, handler] of Object.entries(handlers)) {
    const channel = `snappy-ai:${name}`;
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (event, payload) => {
      if (!backendUrl) throw new Error('The local mail service is not ready');
      let senderOrigin;
      try {
        senderOrigin = new URL(event.senderFrame.url).origin;
      } catch {
        throw new Error('Invalid AI request origin');
      }
      if (senderOrigin !== new URL(backendUrl).origin) throw new Error('AI request origin is not allowed');
      return handler(payload);
    });
  }
}

async function startApplication() {
  desktopState = new DesktopStateStore(
    path.join(app.getPath('userData'), 'desktop-state.json'),
    () => screen.getAllDisplays()
  );
  createLoadingWindow();
  const aiRoot = path.join(app.getPath('userData'), 'ai-workspace');
  mailMcpBridge = new MailMcpBridge({
    socketPath: path.join(aiRoot, 'mail-mcp.sock'),
    getWindow: () => activeWindow
  });
  aiService = new AiService({
    root: aiRoot,
    openExternal
  });
  aiService.on('event', value => {
    if (isUsableWindow(activeWindow)) activeWindow.webContents.send('snappy-ai:event', value);
  });
  registerAiHandlers();
  registerMailMcpHandlers();
  backend = new LocalBackend({
    appPath: app.getAppPath(),
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    userDataPath: app.getPath('userData'),
    onUnexpectedExit: handleBackendExit
  });

  try {
    await mailMcpBridge.start();
    backendUrl = await backend.start();
    removeCookiePersistence = await installPersistentSessionCookies(
      session.defaultSession,
      new URL(backendUrl).origin,
      { onError: error => console.error('Cannot persist EasyMail session', error) }
    );
    await Promise.all([
      session.defaultSession.clearCache(),
      session.defaultSession.clearStorageData({
        storages: ['serviceworkers', 'cachestorage']
      })
    ]);
    if (isUsableWindow(activeWindow)) loadMail(activeWindow, backendUrl);
  } catch (error) {
    dialog.showErrorBox(
      'EasyMail non può avviarsi',
      `${error.message}\n\nLog backend: ${backend.logPath}`
    );
    quitting = true;
    updateManager?.stop();
    await stopApplicationServices();
    app.quit();
  }
}

if (hasLock) {
  app.on('second-instance', showApplicationWindow);

  app.whenReady().then(() => {
    installNotificationPermissionHandlers(session.defaultSession, () => backendUrl);
    updateManager = new AutoUpdateManager({
      app,
      autoUpdater,
      Notification,
      getWindow: () => activeWindow,
      beforeInstall: async () => {
        quitting = true;
        updateManager?.stop();
        await stopApplicationServices();
      }
    });
    updateManager.start();
    installMenu();
    startApplication();

    app.on('activate', () => {
      showApplicationWindow();
    });
  });

  app.on('before-quit', event => {
    if (quitting) return;
    if (!backend?.isRunning && !aiService) return;
    event.preventDefault();
    quitting = true;
    updateManager?.stop();
    exitAfterCleanup(app, stopApplicationServices);
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
