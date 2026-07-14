const assert = require('node:assert/strict');
const test = require('node:test');

const packageJson = require('../package.json');

test('Linux release metadata includes the deb maintainer email', () => {
	assert.equal(packageJson.author.name, 'Eduardo Bolognini');
	assert.match(packageJson.author.email, /^[^@\s]+@[^@\s]+\.[^@\s]+$/);
	assert.ok(packageJson.build.linux.target.includes('deb'));
});
