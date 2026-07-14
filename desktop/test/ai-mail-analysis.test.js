const test = require('node:test');
const assert = require('node:assert/strict');

const observable = value => () => value;
const folder = (fullName, { subscribed = false, children = [], kolabType = null } = {}) => ({
	exists: true,
	fullName,
	selectable: observable(true),
	isSubscribed: observable(subscribed),
	kolabType: observable(kolabType),
	subFolders: observable(children)
});

test('received folder scan does not depend on the optional IMAP subscribed flag', async () => {
	const { collectReceivedFolderNames } = await import('../../dev/Common/AiMailAnalysis.js');
	const received = collectReceivedFolderNames([
		folder('INBOX'),
		folder('INBOX.Sent'),
		folder('Projects', {
			children: [folder('Projects.Customer', { subscribed: true })]
		}),
		folder('Contacts', { kolabType: 'contact' })
	], ['INBOX.Sent']);

	assert.ok(received.includes('INBOX'), 'INBOX must be analyzed when \\Subscribed is omitted');
	assert.ok(!received.includes('INBOX.Sent'), 'excluded system folders must not be analyzed');
	assert.ok(received.includes('Projects.Customer'), 'nested selectable mail folders must be analyzed');
	assert.ok(!received.includes('Contacts'), 'Kolab data folders must not be analyzed as mail');
});
