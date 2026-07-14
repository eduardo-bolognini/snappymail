const { contextBridge, ipcRenderer } = require('electron');

const invoke = (method, payload) => ipcRenderer.invoke(`snappy-ai:${method}`, payload);

contextBridge.exposeInMainWorld('snappyDesktop', {
  mailMcp: {
    respond: payload => ipcRenderer.send('snappy-mail-mcp:response', payload),
    onRequest: callback => {
      const listener = (_event, value) => callback(value);
      ipcRenderer.on('snappy-mail-mcp:request', listener);
      return () => ipcRenderer.removeListener('snappy-mail-mcp:request', listener);
    }
  },
  ai: {
    status: () => invoke('status'),
    workspace: () => invoke('workspace'),
		recipientSuggestions: query => invoke('recipient-suggestions', { query }),
    loginApiKey: apiKey => invoke('login-api-key', { apiKey }),
    startDeviceLogin: () => invoke('login-device'),
    logout: () => invoke('logout'),
    saveSettings: settings => invoke('settings', settings),
		analyze: payload => invoke('analyze', payload),
		compose: payload => invoke('compose', payload),
		composeChat: payload => invoke('compose-chat', payload),
		reviewBeforeSend: payload => invoke('pre-send-review', payload),
		readAttachment: path => invoke('attachment-read', { path }),
		listPlugins: () => invoke('plugin-list'),
		installPlugin: id => invoke('plugin-install', { id }),
		uninstallPlugin: id => invoke('plugin-uninstall', { id }),
		authorizePluginApp: id => invoke('plugin-authorize', { id }),
    observeSent: payload => invoke('observe-sent', payload),
    updateContact: payload => invoke('contact-update', payload),
    addGroup: name => invoke('group-add', { name }),
    onEvent: callback => {
      const listener = (_event, value) => callback(value);
      ipcRenderer.on('snappy-ai:event', listener);
      return () => ipcRenderer.removeListener('snappy-ai:event', listener);
    }
  }
});
