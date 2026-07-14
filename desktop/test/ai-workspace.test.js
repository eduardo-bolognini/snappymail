const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { AiWorkspace, MODEL_OPTIONS, inferContactKind } = require('../ai-workspace');

const styleEvidence = (text = 'Ti aggiorno appena ho conferma.') => ({
  tones: [{ label: 'Direct and collaborative', description: 'States the next step clearly without sounding abrupt.' }],
  recurringWords: ['conferma'],
  recurringPhrases: ['ti aggiorno'],
  greetings: ['Ciao'],
  closings: ['Grazie'],
  sentencePatterns: ['Context first, then one explicit next step.'],
  examples: [{ text, context: 'Project update' }]
});

test('AI workspace creates an isolated Codex home and private state', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snappymail-ai-'));
  const workspace = new AiWorkspace(root);
  const config = fs.readFileSync(path.join(workspace.codexHome, 'config.toml'), 'utf8');

  assert.match(config, /model = "gpt-5\.6-terra"/);
  assert.match(config, /model_reasoning_effort = "medium"/);
  assert.match(config, /cli_auth_credentials_store = "file"/);
  assert.match(config, /default_permissions = "mail_analysis"/);
  assert.match(config, /\[permissions\.mail_analysis\.filesystem\]/);
  assert.match(config, /":project_roots" = "read"/);
	assert.match(config, /\[mcp_servers\.snappymail\]/);
	assert.match(config, /mail-mcp-server\.js/);
	assert.match(config, /SNAPPY_MAIL_MCP_SOCKET/);
	assert.match(config, /SNAPPY_ATTACHMENT_ROOTS/);
  assert.doesNotMatch(config, /readOnly|sandbox_mode/);
  assert.equal(fs.statSync(root).mode & 0o777, 0o700);
  assert.equal(fs.statSync(workspace.statePath).mode & 0o777, 0o600);
  assert.equal(workspace.publicState().activeProviderId, 'openai-codex');
  fs.rmSync(root, { recursive: true, force: true });
});

test('supported model selection persists and updates the isolated Codex config', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snappymail-ai-'));
  const workspace = new AiWorkspace(root);

  assert.deepEqual(MODEL_OPTIONS.map(option => option.id), [
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'gpt-5.6-luna'
  ]);
  workspace.saveSettings({ model: 'gpt-5.6-sol' });

  assert.equal(workspace.getModel(), 'gpt-5.6-sol');
  assert.equal(workspace.publicState().providers[0].model, 'gpt-5.6-sol');
  assert.match(
    fs.readFileSync(path.join(workspace.codexHome, 'config.toml'), 'utf8'),
    /model = "gpt-5\.6-sol"/
  );
  assert.throws(() => workspace.saveSettings({ model: 'unknown-model' }), /Unsupported AI model/);
  assert.equal(new AiWorkspace(root).getModel(), 'gpt-5.6-sol');

  fs.rmSync(root, { recursive: true, force: true });
});

test('contacts are classified, grouped and enriched without storing message bodies', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snappymail-ai-'));
  const workspace = new AiWorkspace(root);
  const observed = workspace.observeSent({
    sentAt: '2026-07-13T10:00:00.000Z',
    subject: 'Private subject',
    body: 'Private body',
    recipients: [
      { email: 'person@example.com', name: 'Person' },
      { email: 'no-reply@service.example', name: 'Alerts' }
    ]
  });

  assert.equal(observed.newContacts.length, 2);
  assert.equal(observed.state.contacts.find(contact => contact.email === 'no-reply@service.example').kind, 'automatic');
  assert.doesNotMatch(fs.readFileSync(workspace.statePath, 'utf8'), /Private body|Private subject/);

  workspace.applyAnalysis({
    generalStyle: 'Direct and warm.',
    generalTraits: ['concise'],
    styleEvidence: styleEvidence(),
    groups: [{
      name: 'Clients',
      summary: 'Active client relationships.',
      memberProfile: 'Decision makers and operational contacts.',
      relationshipContext: 'Ongoing delivery work.',
      myWritingStyle: 'Clear, warm and precise.',
      theirWritingStyle: 'Practical and deadline-oriented.',
      myStyleEvidence: styleEvidence('Vi mando il documento entro domani.'),
      theirStyleEvidence: styleEvidence('Attendiamo il documento per procedere.'),
      communicationDynamics: 'The user proposes and clients confirm.',
      topics: ['Delivery', 'Planning'],
      recommendedApproach: 'Lead with status and the next decision.'
    }],
    contacts: [{
      email: 'person@example.com',
      name: 'Person',
      kind: 'important',
      relationship: 'Client',
      summary: 'Primary client contact for delivery work.',
      organization: 'Example Ltd',
      jobTitle: 'Operations Director',
      location: 'Milan',
      contactDetails: [{
        label: 'Phone',
        value: '+39 02 000000',
        source: 'Email signature',
        confidence: 'high'
      }],
      relationshipSummary: 'A direct and established working relationship.',
      myWritingStyle: 'Friendly, detailed and precise.',
      theirWritingStyle: 'Concise and action-oriented.',
      myStyleEvidence: styleEvidence('Ti aggiorno appena ho la conferma finale.'),
      theirStyleEvidence: styleEvidence('Confermo, procediamo pure.'),
      communicationDynamics: 'Fast exchanges around decisions and delivery.',
      topics: ['Launch', 'Deadlines'],
      facts: ['Prefers written delivery confirmations.'],
      recommendedApproach: 'Open with progress, then request one clear decision.',
      groups: ['Clients'],
      styleTraits: ['friendly']
    }]
  }, { analyzedMessages: 4, analyzedThreads: 2 });

  const state = workspace.publicState();
  const person = state.contacts.find(contact => contact.email === 'person@example.com');
  const group = state.groups[0];
  assert.equal(state.version, 3);
  assert.equal(person.kind, 'important');
  assert.equal(person.myWritingStyle, 'Friendly, detailed and precise.');
  assert.equal(person.theirWritingStyle, 'Concise and action-oriented.');
  assert.equal(person.myStyleEvidence.recurringPhrases[0], 'ti aggiorno');
  assert.equal(person.theirStyleEvidence.examples[0].text, 'Confermo, procediamo pure.');
  assert.equal(person.contactDetails[0].value, '+39 02 000000');
  assert.equal(person.organization, 'Example Ltd');
  assert.equal(group.myWritingStyle, 'Clear, warm and precise.');
  assert.equal(group.theirWritingStyle, 'Practical and deadline-oriented.');
  assert.equal(group.myStyleEvidence.examples[0].text, 'Vi mando il documento entro domani.');
  assert.equal(state.profile.styleEvidence.examples[0].context, 'Project update');
  assert.deepEqual(person.groupIds, [state.groups[0].id]);
  assert.equal(state.profile.analyzedMessages, 4);
	assert.equal(state.profile.analyzedThreads, 2);
  fs.rmSync(root, { recursive: true, force: true });
});

test('legacy writing styles migrate into directional dossiers', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snappymail-ai-'));
  const workspace = new AiWorkspace(root);
  const state = workspace.publicState();
  state.version = 1;
  state.contacts = [{ email: 'person@example.com', writingStyle: 'Legacy contact style.' }];
  state.groups = [{ name: 'Legacy group', writingStyle: 'Legacy group style.' }];
  workspace.write(state);

  const migrated = workspace.publicState();
  assert.equal(migrated.version, 3);
  assert.equal(migrated.contacts[0].myWritingStyle, 'Legacy contact style.');
  assert.equal(migrated.groups[0].myWritingStyle, 'Legacy group style.');
  assert.deepEqual(migrated.profile.styleEvidence.examples, []);
  assert.deepEqual(migrated.contacts[0].myStyleEvidence.recurringWords, []);
  fs.rmSync(root, { recursive: true, force: true });
});

test('corpus registration keeps sent and received counts for known contacts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snappymail-ai-'));
  const workspace = new AiWorkspace(root);
  workspace.registerCorpus({
    contacts: [{
      email: 'person@example.com',
      name: 'Person',
      messageCount: 8,
      receivedMessageCount: 5,
      firstContactAt: '2025-01-01T00:00:00.000Z',
      lastContactAt: '2026-01-01T00:00:00.000Z'
    }],
    messages: []
  });
  const contact = workspace.publicState().contacts[0];
  assert.equal(contact.messageCount, 8);
  assert.equal(contact.receivedMessageCount, 5);
  fs.rmSync(root, { recursive: true, force: true });
});

test('automatic contact heuristic leaves real addresses editable as other', () => {
  assert.equal(inferContactKind('notifications@example.com'), 'automatic');
  assert.equal(inferContactKind('maria.rossi@example.com'), 'other');
});
