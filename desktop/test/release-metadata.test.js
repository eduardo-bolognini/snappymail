const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const packageJson = require('../package.json');

test('Linux release metadata includes the deb maintainer email', () => {
	assert.equal(packageJson.author.name, 'Eduardo Bolognini');
	assert.match(packageJson.author.email, /^[^@\s]+@[^@\s]+\.[^@\s]+$/);
	assert.ok(packageJson.build.linux.target.includes('deb'));
});

test('release workflow creates one shared GitHub release before publishing targets', () => {
	const workflow = fs.readFileSync(path.join(
		__dirname,
		'..',
		'..',
		'.github',
		'workflows',
		'easymail-desktop-release.yml'
	), 'utf8');

	assert.match(workflow, /max-parallel: 1/);
	assert.match(workflow, /Ensure GitHub release exists/);
	assert.match(workflow, /gh release view "\$TAG"[\s\S]+gh release create "\$TAG"/);
});
