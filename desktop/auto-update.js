const DEFAULT_INITIAL_DELAY_MS = 15_000;
const DEFAULT_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

class AutoUpdateManager {
  constructor({
    app,
    autoUpdater,
    Notification,
    beforeInstall = async () => {},
    getWindow = () => null,
    logger = console,
    initialDelayMs = DEFAULT_INITIAL_DELAY_MS,
    checkIntervalMs = DEFAULT_CHECK_INTERVAL_MS
  }) {
    this.app = app;
    this.autoUpdater = autoUpdater;
    this.Notification = Notification;
    this.beforeInstall = beforeInstall;
    this.getWindow = getWindow;
    this.logger = logger;
    this.initialDelayMs = initialDelayMs;
    this.checkIntervalMs = checkIntervalMs;
    this.notifications = new Set();
    this.notifiedVersions = new Set();
    this.started = false;
    this.checking = false;
    this.downloading = false;
    this.manualCheck = false;
    this.installing = false;
    this.initialTimer = null;
    this.intervalTimer = null;
  }

  start() {
    if (this.started || !this.app.isPackaged) return false;
    this.started = true;
    this.autoUpdater.autoDownload = true;
    this.autoUpdater.autoInstallOnAppQuit = true;
    this.autoUpdater.allowPrerelease = false;
    this.registerEvents();

    this.initialTimer = setTimeout(() => {
      this.check();
      this.intervalTimer = setInterval(() => this.check(), this.checkIntervalMs);
      this.intervalTimer.unref?.();
    }, this.initialDelayMs);
    this.initialTimer.unref?.();
    return true;
  }

  registerEvents() {
    this.autoUpdater.on('update-available', info => {
      this.checking = false;
      this.downloading = true;
      this.manualCheck = false;
      const version = String(info?.version || '').trim();
      if (!version || !this.notifiedVersions.has(version)) {
        if (version) this.notifiedVersions.add(version);
        this.notify({
          title: 'Aggiornamento EasyMail disponibile',
          body: version
            ? `La versione ${version} viene scaricata in background.`
            : 'La nuova versione viene scaricata in background.'
        });
      }
      this.sendStatus('available', { version });
    });

    this.autoUpdater.on('update-not-available', info => {
      const wasManual = this.manualCheck;
      this.resetCheckState();
      if (wasManual) {
        this.notify({
          title: 'EasyMail è aggiornato',
          body: `Stai usando la versione più recente (${info?.version || this.app.getVersion()}).`
        });
      }
      this.sendStatus('not-available', { version: info?.version || this.app.getVersion() });
    });

    this.autoUpdater.on('download-progress', progress => {
      this.sendStatus('downloading', {
        percent: Math.max(0, Math.min(100, Math.round(Number(progress?.percent) || 0)))
      });
    });

    this.autoUpdater.on('update-downloaded', info => {
      this.resetCheckState();
      const version = String(info?.version || '').trim();
      this.notify({
        title: 'Aggiornamento EasyMail pronto',
        body: version
          ? `La versione ${version} verrà installata alla chiusura. Clicca per riavviare ora.`
          : 'L’aggiornamento verrà installato alla chiusura. Clicca per riavviare ora.',
        onClick: () => this.install()
      });
      this.sendStatus('downloaded', { version });
    });

    this.autoUpdater.on('error', error => this.handleError(error));
  }

  async check({ manual = false } = {}) {
    if (!this.started || this.checking || this.downloading || this.installing) return false;
    this.checking = true;
    this.manualCheck = manual;
    this.sendStatus('checking');
    try {
      await this.autoUpdater.checkForUpdates();
      return true;
    } catch (error) {
      this.handleError(error);
      return false;
    }
  }

  async install() {
    if (this.installing) return false;
    this.installing = true;
    try {
      await this.beforeInstall();
      this.autoUpdater.quitAndInstall(false, true);
      return true;
    } catch (error) {
      this.installing = false;
      this.logger.error?.('EasyMail update installation failed', error);
      this.notify({
        title: 'Aggiornamento non installato',
        body: 'Chiudi e riapri EasyMail per completare l’aggiornamento.'
      });
      return false;
    }
  }

  handleError(error) {
    const wasManual = this.manualCheck;
    this.resetCheckState();
    this.logger.error?.('EasyMail update check failed', error);
    if (wasManual) {
      this.notify({
        title: 'Controllo aggiornamenti non riuscito',
        body: 'Verifica la connessione e riprova più tardi.'
      });
    }
    this.sendStatus('error');
  }

  resetCheckState() {
    this.checking = false;
    this.downloading = false;
    this.manualCheck = false;
  }

  sendStatus(type, details = {}) {
    const window = this.getWindow();
    if (!window || window.isDestroyed?.()) return;
    window.webContents?.send('easymail:update-status', { type, ...details });
  }

  notify({ title, body, onClick }) {
    if (!this.Notification?.isSupported?.()) return false;
    const notification = new this.Notification({ title, body });
    const dispose = () => this.notifications.delete(notification);
    notification.once?.('close', dispose);
    notification.once?.('failed', dispose);
    if (onClick) notification.on?.('click', onClick);
    this.notifications.add(notification);
    notification.show();
    return true;
  }

  stop() {
    if (this.initialTimer) clearTimeout(this.initialTimer);
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    this.initialTimer = null;
    this.intervalTimer = null;
  }
}

module.exports = {
  AutoUpdateManager,
  DEFAULT_CHECK_INTERVAL_MS,
  DEFAULT_INITIAL_DELAY_MS
};
