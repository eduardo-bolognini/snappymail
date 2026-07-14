function isUsableWindow(window) {
  return Boolean(window && !window.isDestroyed());
}

async function exitAfterCleanup(app, cleanup) {
  try {
    await cleanup();
  } finally {
    app.exit(0);
  }
}

module.exports = { exitAfterCleanup, isUsableWindow };
