function readOrigin(value) {
  try {
    return new URL(String(value || '')).origin;
  } catch {
    return '';
  }
}

function isTrustedAppOrigin(backendUrl, requestingOrigin, webContents) {
  const trustedOrigin = readOrigin(backendUrl);
  if (!trustedOrigin) return false;
  return [requestingOrigin, webContents?.getURL?.()]
    .some(value => readOrigin(value) === trustedOrigin);
}

function installNotificationPermissionHandlers(electronSession, getBackendUrl) {
  electronSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(permission === 'notifications' && isTrustedAppOrigin(
      getBackendUrl(),
      details?.requestingUrl,
      webContents
    ));
  });

  electronSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => (
    permission === 'notifications'
    && isTrustedAppOrigin(getBackendUrl(), requestingOrigin, webContents)
  ));
}

module.exports = { installNotificationPermissionHandlers, isTrustedAppOrigin };
