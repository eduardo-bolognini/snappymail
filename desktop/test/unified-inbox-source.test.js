const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('backend exposes a session-safe aggregate Inbox action', () => {
  const source = read('snappymail/v/0.0.0/app/libraries/RainLoop/Actions/Accounts.php');

  assert.match(source, /public function DoUnifiedInbox\(\): array/);
  assert.match(source, /aiMailClient\(\$sEmail\)/);
  assert.match(source, /sFolderName = 'INBOX'/);
  assert.match(source, /\['account'\] = \$oAccount->Email\(\)/);
  assert.match(source, /\\usort\(\$aMessages/);
  assert.match(source, /'failedAccounts'/);
});

test('sidebar models all inboxes as the default view and accounts as filters', () => {
  const store = read('dev/Stores/User/Account.js');
  const view = read('dev/View/User/SystemDropDown.js');
  const template = read('snappymail/v/0.0.0/app/templates/Views/User/SystemDropDown.html');

  assert.match(store, /allInboxes: !mailboxFilter\(\)/);
  assert.match(store, /MAILBOX_FILTER_KEY/);
  assert.match(view, /allInboxesClick/);
  assert.match(view, /setMailboxFilter/);
  assert.match(template, /sidebar-all-inboxes/);
  assert.match(template, /SETTINGS_ACCOUNTS\/ALL_INBOXES/);
  assert.match(template, /aria-current/);
});

test('message list loads aggregate results and preserves source account identity', () => {
  const store = read('dev/Stores/User/Messagelist.js');
  const model = read('dev/Model/Message.js');
  const view = read('dev/View/User/MailBox/MessageList.js');
  const template = read('snappymail/v/0.0.0/app/templates/Views/User/MailMessageList.html');
  const utils = read('dev/Common/UtilsUser.js');
  const remote = read('dev/Remote/User/Fetch.js');
  const raw = read('snappymail/v/0.0.0/app/libraries/RainLoop/Actions/Raw.php');

  assert.match(store, /request\('UnifiedInbox'/);
  assert.match(store, /AccountUserStore\.allInboxes\(\)/);
  assert.match(store, /collection\.failedAccounts/);
  assert.match(store, /reloadRequestId/);
  assert.match(store, /abort\('UnifiedInbox'/);
  assert.match(model, /account: ''/);
  assert.match(view, /openUnifiedMessage/);
  assert.match(view, /message\.account \+ '\/'/);
  assert.doesNotMatch(view, /openUnifiedMessage[\s\S]{0,900}AccountSwitch/);
  assert.doesNotMatch(template, /message-account-badge/);
  assert.match(utils, /Remote\.accountMessage/);
  assert.match(remote, /accountMessage\(/);
  assert.match(raw, /aiMailClient\(\$sRequestedAccount\)/);
});

test('account-qualified identity and failed filter restoration prevent cross-account drift', () => {
  const collection = read('dev/Model/MessageCollection.js');
  const view = read('dev/View/User/SystemDropDown.js');

  assert.match(collection, /msg\.account === message\.account/);
  assert.match(view, /previousFilter = mailboxFilter\(\)/);
  assert.match(view, /setMailboxFilter\(previousFilter\)/);
});

test('composer exposes account-qualified senders and sends without switching the mailbox', () => {
  const accounts = read('snappymail/v/0.0.0/app/libraries/RainLoop/Actions/Accounts.php');
  const messages = read('snappymail/v/0.0.0/app/libraries/RainLoop/Actions/Messages.php');
  const identities = read('dev/Stores/User/Identity.js');
  const compose = read('dev/View/Popup/Compose.js');
  const template = read('snappymail/v/0.0.0/app/templates/Views/User/PopupsCompose.html');
  const ai = read('desktop/ai-service.js');

  assert.match(accounts, /'SenderIdentities'/);
	assert.match(identities, /SenderIdentityUserStore/);
	assert.match(compose, /senderAccount/);
	assert.match(compose, /senderManuallySelected/);
	assert.match(compose, /optText:.*accountName.*accountEmail/);
	assert.match(template, /compose-identity-picker/);
	assert.doesNotMatch(template, /hidden: allowIdentities/);
	assert.match(template, /compose-recipient-field/);
	assert.match(template, /foreach: identitiesOptions/);
	assert.match(messages, /GetActionParam\('senderAccount'/);
  assert.match(messages, /aiMailClient\(\$sSenderAccount\)/);
  assert.match(ai, /allowedSenders/);
  assert.match(ai, /senderLocked/);
});

test('recipient groups expand independently from the browser datalist input type', () => {
	const addresses = read('dev/Component/EmailAddresses.js');
	const compose = read('dev/View/Popup/Compose.js');

	assert.match(addresses, /input: \(\) => \{[\s\S]{0,260}if \(self\._selectSuggestion\(\)\) return;/);
	assert.match(addresses, /suggestion\.addresses/);
	assert.match(addresses, /addresses\.join\(', '\)/);
	assert.match(addresses, /item\.insertValue, item\.label/);
	assert.match(compose, /'group' === item\.type/);
	assert.match(compose, /addresses\s*\n\s*\}\);/);
});

test('mail addresses expose a dossier hover card in reading and composition', () => {
	const component = read('dev/Common/ContactHoverCard.js');
	const addresses = read('dev/Component/EmailAddresses.js');
	const message = read('snappymail/v/0.0.0/app/templates/Views/User/MailMessageView.html');
	const preload = read('desktop/preload.js');

	assert.match(component, /a\[href\^="mailto:"\]/);
	assert.match(component, /window\.snappyDesktop\?\.ai\?\.contactCard/);
	assert.match(addresses, /'data-contact-email':v\.obj\.email/);
	assert.match(message, /to\.toString\(false, true\)/);
	assert.match(preload, /contactCard: email => invoke\('contact-card'/);
});

test('unified Inbox actions are contextual and archive or spam through the source account', () => {
	const accounts = read('snappymail/v/0.0.0/app/libraries/RainLoop/Actions/Accounts.php');
	const view = read('dev/View/User/MailBox/MessageList.js');
	const template = read('snappymail/v/0.0.0/app/templates/Views/User/MailMessageList.html');

	assert.match(accounts, /public function DoUnifiedMessageMove\(\): array/);
	assert.match(accounts, /MessageMove\(\$sFolder, \$sDestination, \$oUids\)/);
	assert.match(view, /Remote\.request\('UnifiedMessageMove'/);
	assert.match(template, /hasSelection.*hasCheckedOrSelected/);
	assert.match(template, /visible: !unifiedInbox\(\), command: moveCommand/);
});

test('dropdown affordances use icon chevrons rather than text triangles', () => {
	const templates = [
		'MailMessageList.html', 'MailMessageView.html', 'PopupsCompose.html', 'PopupsContacts.html'
	].map(file => read(`snappymail/v/0.0.0/app/templates/Views/User/${file}`)).join('\n');

	assert.doesNotMatch(templates, />\s*▼\s*</);
	assert.match(templates, /g-icon--chevron-down/);
	const forms = read('vendors/bootstrap/less/forms.less');
	assert.doesNotMatch(forms, /PHN2ZyB4bWxucz0n/);
	assert.match(forms, /M2\.97 5\.47/);
});
