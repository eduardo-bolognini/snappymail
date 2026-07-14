const assert = require('node:assert/strict');
const test = require('node:test');
const { exitAfterCleanup, isUsableWindow } = require('../window-lifecycle');

test('destroyed Electron windows are not reused', () => {
  assert.equal(isUsableWindow(null), false);
  assert.equal(isUsableWindow({ isDestroyed: () => true }), false);
  assert.equal(isUsableWindow({ isDestroyed: () => false }), true);
});

test('a prevented Electron quit exits only after asynchronous cleanup', async () => {
  const events = [];
  const app = { exit: code => events.push(`exit:${code}`) };

  await exitAfterCleanup(app, async () => {
    events.push('cleanup');
  });

  assert.deepEqual(events, ['cleanup', 'exit:0']);
});
