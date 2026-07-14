const assert = require('node:assert/strict');
const test = require('node:test');
const {
  installNotificationPermissionHandlers,
  isTrustedAppOrigin
} = require('../notification-permissions');

test('notification permission accepts only the EasyMail local origin', () => {
  const backendUrl = 'http://127.0.0.1:38471/';
  assert.equal(isTrustedAppOrigin(backendUrl, 'http://127.0.0.1:38471/inbox'), true);
  assert.equal(isTrustedAppOrigin(backendUrl, 'https://example.com'), false);
  assert.equal(isTrustedAppOrigin(backendUrl, '', { getURL: () => `${backendUrl}#/mailbox` }), true);
});

test('permission handlers grant notifications and reject unrelated permissions', () => {
  const handlers = {};
  const electronSession = {
    setPermissionRequestHandler: handler => { handlers.request = handler; },
    setPermissionCheckHandler: handler => { handlers.check = handler; }
  };
  installNotificationPermissionHandlers(electronSession, () => 'http://127.0.0.1:38471');

  let requestResult;
  handlers.request(
    { getURL: () => 'http://127.0.0.1:38471/' },
    'notifications',
    value => { requestResult = value; },
    { requestingUrl: 'http://127.0.0.1:38471/' }
  );
  assert.equal(requestResult, true);
  assert.equal(handlers.check(null, 'notifications', 'https://example.com'), false);
  assert.equal(handlers.check(null, 'media', 'http://127.0.0.1:38471'), false);
});
