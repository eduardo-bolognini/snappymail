const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_MODEL = 'gpt-5.6-terra';
const MODEL_OPTIONS = Object.freeze([
  Object.freeze({ id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', profile: 'maximum', recommended: false }),
  Object.freeze({ id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', profile: 'balanced', recommended: true }),
  Object.freeze({ id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', profile: 'efficient', recommended: false })
]);
const MODEL_IDS = new Set(MODEL_OPTIONS.map(option => option.id));
const CONTACT_KINDS = new Set(['important', 'automatic', 'other']);

function normalizeModel(value) {
  return MODEL_IDS.has(value) ? value : DEFAULT_MODEL;
}

function defaultState() {
  return {
	version: 3,
    activeProviderId: 'openai-codex',
    providers: [{
      id: 'openai-codex',
      type: 'codex-app-server',
      name: 'Codex',
      model: DEFAULT_MODEL
    }],
    settings: {
      periodMonths: 12,
      autoAnalyzeNewContacts: true
    },
    profile: {
      generalStyle: '',
      traits: [],
		styleEvidence: emptyStyleEvidence(),
      updatedAt: null,
		analyzedMessages: 0,
		analyzedThreads: 0
    },
    contacts: [],
    groups: []
  };
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function contactId(email) {
  return crypto.createHash('sha256').update(normalizeEmail(email)).digest('hex').slice(0, 20);
}

function groupId(name) {
  return crypto.createHash('sha256').update(String(name || '').trim().toLowerCase()).digest('hex').slice(0, 16);
}

function inferContactKind(email, name = '') {
  const value = `${normalizeEmail(email)} ${String(name).toLowerCase()}`;
  return /(^|[._+\-])(no-?reply|do-?not-?reply|noreply|notifications?|alerts?|system|robot|mailer|billing|invoices?|support-bot|newsletter)([.@_+\-]|$)/i.test(value)
    ? 'automatic'
    : 'other';
}

function stringList(value) {
	return Array.isArray(value) ? [...new Set(value.map(String).map(item => item.trim()).filter(Boolean))] : [];
}

function emptyStyleEvidence() {
	return {
		tones: [],
		recurringWords: [],
		recurringPhrases: [],
		greetings: [],
		closings: [],
		sentencePatterns: [],
		examples: []
	};
}

function sanitizeStyleEvidence(value = {}) {
	return {
		tones: Array.isArray(value.tones) ? value.tones.map(item => ({
			label: String(item?.label || '').trim().slice(0, 80),
			description: String(item?.description || '').trim().slice(0, 500)
		})).filter(item => item.label && item.description).slice(0, 8) : [],
		recurringWords: stringList(value.recurringWords).slice(0, 20),
		recurringPhrases: stringList(value.recurringPhrases).slice(0, 15),
		greetings: stringList(value.greetings).slice(0, 10),
		closings: stringList(value.closings).slice(0, 10),
		sentencePatterns: stringList(value.sentencePatterns).slice(0, 10),
		examples: Array.isArray(value.examples) ? value.examples.map(item => ({
			text: String(item?.text || '').trim().slice(0, 280),
			context: String(item?.context || '').trim().slice(0, 160)
		})).filter(item => item.text).slice(0, 8) : []
	};
}

function sanitizeContactDetails(value) {
	return Array.isArray(value) ? value.map(item => ({
		label: String(item?.label || '').trim(),
		value: String(item?.value || '').trim(),
		source: String(item?.source || '').trim(),
		confidence: ['high', 'medium', 'low'].includes(item?.confidence) ? item.confidence : 'low'
	})).filter(item => item.label && item.value) : [];
}

function sanitizeGroup(group = {}) {
	const myWritingStyle = String(group.myWritingStyle || group.writingStyle || '').trim();
	return {
		id: group.id || groupId(group.name),
		name: String(group.name || '').trim(),
		summary: String(group.summary || '').trim(),
		memberProfile: String(group.memberProfile || '').trim(),
		relationshipContext: String(group.relationshipContext || '').trim(),
		myWritingStyle,
		theirWritingStyle: String(group.theirWritingStyle || '').trim(),
		myStyleEvidence: sanitizeStyleEvidence(group.myStyleEvidence),
		theirStyleEvidence: sanitizeStyleEvidence(group.theirStyleEvidence),
		communicationDynamics: String(group.communicationDynamics || '').trim(),
		topics: stringList(group.topics),
		recommendedApproach: String(group.recommendedApproach || '').trim(),
		writingStyle: myWritingStyle,
		updatedAt: group.updatedAt || null
	};
}

function sanitizeContact(contact) {
  const email = normalizeEmail(contact.email);
  if (!email) throw new Error('A contact email is required');
  const kind = CONTACT_KINDS.has(contact.kind) ? contact.kind : inferContactKind(email, contact.name);
	const myWritingStyle = String(contact.myWritingStyle || contact.writingStyle || '').trim();
  return {
    id: contact.id || contactId(email),
    email,
    name: String(contact.name || '').trim(),
    kind,
    notes: String(contact.notes || '').trim(),
    relationship: String(contact.relationship || '').trim(),
    groupIds: Array.isArray(contact.groupIds) ? [...new Set(contact.groupIds.map(String))] : [],
    messageCount: Math.max(0, Number(contact.messageCount) || 0),
    receivedMessageCount: Math.max(0, Number(contact.receivedMessageCount) || 0),
    firstContactAt: contact.firstContactAt || null,
    lastContactAt: contact.lastContactAt || null,
		summary: String(contact.summary || '').trim(),
		organization: String(contact.organization || '').trim(),
		jobTitle: String(contact.jobTitle || '').trim(),
		location: String(contact.location || '').trim(),
		contactDetails: sanitizeContactDetails(contact.contactDetails),
		relationshipSummary: String(contact.relationshipSummary || '').trim(),
		myWritingStyle,
		theirWritingStyle: String(contact.theirWritingStyle || '').trim(),
		myStyleEvidence: sanitizeStyleEvidence(contact.myStyleEvidence),
		theirStyleEvidence: sanitizeStyleEvidence(contact.theirStyleEvidence),
		communicationDynamics: String(contact.communicationDynamics || '').trim(),
		topics: stringList(contact.topics),
		facts: stringList(contact.facts),
		recommendedApproach: String(contact.recommendedApproach || '').trim(),
		writingStyle: myWritingStyle,
		styleTraits: stringList(contact.styleTraits),
    pendingAnalysis: Boolean(contact.pendingAnalysis),
    analyzedAt: contact.analyzedAt || null
  };
}

function sanitizeProviders(value) {
  const baseProvider = defaultState().providers[0];
  const providers = Array.isArray(value) ? value.map(provider => ({ ...provider })) : [];
  const codexProvider = providers.find(provider => provider.id === baseProvider.id);
  if (codexProvider) {
    Object.assign(codexProvider, {
      type: baseProvider.type,
      name: codexProvider.name || baseProvider.name,
      model: normalizeModel(codexProvider.model)
    });
  } else {
    providers.unshift({ ...baseProvider });
  }
  return providers;
}

class AiWorkspace {
  constructor(root) {
    this.root = root;
    this.codexHome = path.join(root, 'codex-home');
    this.runtimeRoot = path.join(root, 'runtime');
    this.statePath = path.join(root, 'workspace.json');
    this.prepare();
  }

  prepare() {
    fs.mkdirSync(this.codexHome, { recursive: true, mode: 0o700 });
    fs.mkdirSync(this.runtimeRoot, { recursive: true, mode: 0o700 });
    fs.chmodSync(this.root, 0o700);
    fs.chmodSync(this.codexHome, 0o700);
    fs.chmodSync(this.runtimeRoot, 0o700);

    if (!fs.existsSync(this.statePath)) this.write(defaultState());
    this.writeCodexConfig(this.getModel());
  }

  writeCodexConfig(model = DEFAULT_MODEL) {
    const mcpScript = path.join(__dirname, 'mail-mcp-server.js');
    const attachmentRoots = ['Desktop', 'Documents', 'Downloads']
      .map(name => path.join(os.homedir(), name))
      .filter(root => fs.existsSync(root));
    const mcpEnv = {
      ELECTRON_RUN_AS_NODE: '1',
      SNAPPY_MAIL_MCP_SOCKET: path.join(this.root, 'mail-mcp.sock'),
      SNAPPY_AI_WORKSPACE: this.statePath,
      SNAPPY_ATTACHMENT_ROOTS: JSON.stringify(attachmentRoots)
    };
    const mcpEnvToml = `{ ${Object.entries(mcpEnv)
      .map(([key, value]) => `${key} = ${JSON.stringify(value)}`)
      .join(', ')} }`;
    const config = [
      `model = "${normalizeModel(model)}"`,
      'model_reasoning_effort = "medium"',
      'approval_policy = "never"',
      'cli_auth_credentials_store = "file"',
      'default_permissions = "mail_analysis"',
      '',
      '[permissions.mail_analysis.filesystem]',
      '":minimal" = "read"',
      '":project_roots" = "read"',
      '',
      '[permissions.mail_analysis.network]',
      'enabled = false',
      '',
      '[analytics]',
      'enabled = false',
      '',
      '[mcp_servers.snappymail]',
      `command = ${JSON.stringify(process.execPath)}`,
      `args = [${JSON.stringify(mcpScript)}]`,
      `env = ${mcpEnvToml}`,
      'startup_timeout_sec = 20',
      'tool_timeout_sec = 180',
      ''
    ].join('\n');
    fs.writeFileSync(path.join(this.codexHome, 'config.toml'), config, { mode: 0o600 });
  }

  read() {
    try {
      const stored = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
      const base = defaultState();
      return {
        ...base,
        ...stored,
		version: base.version,
        settings: { ...base.settings, ...stored.settings },
        profile: {
			...base.profile,
			...stored.profile,
			styleEvidence: sanitizeStyleEvidence(stored.profile?.styleEvidence)
		},
        providers: sanitizeProviders(stored.providers),
        contacts: Array.isArray(stored.contacts) ? stored.contacts.map(sanitizeContact) : [],
		groups: Array.isArray(stored.groups) ? stored.groups.map(sanitizeGroup).filter(group => group.name) : []
      };
    } catch {
      const state = defaultState();
      this.write(state);
      return state;
    }
  }

  write(state) {
    const tempPath = `${this.statePath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tempPath, this.statePath);
    fs.chmodSync(this.statePath, 0o600);
    return state;
  }

  update(mutator) {
    const state = this.read();
    mutator(state);
    return this.write(state);
  }

  publicState() {
    return this.read();
  }

  getModel(state = this.read()) {
    const provider = (state.providers || []).find(item => item.id === state.activeProviderId)
      || (state.providers || []).find(item => item.id === 'openai-codex');
    return normalizeModel(provider?.model);
  }

  saveSettings(settings = {}) {
    if (Object.hasOwn(settings, 'model') && !MODEL_IDS.has(settings.model)) {
      throw new Error('Unsupported AI model');
    }
    const state = this.update(current => {
      if ([12, 36].includes(Number(settings.periodMonths))) {
        current.settings.periodMonths = Number(settings.periodMonths);
      }
      if (typeof settings.autoAnalyzeNewContacts === 'boolean') {
        current.settings.autoAnalyzeNewContacts = settings.autoAnalyzeNewContacts;
      }
      if (settings.model) {
        const provider = current.providers.find(item => item.id === 'openai-codex');
        if (provider) provider.model = settings.model;
      }
    });
    this.writeCodexConfig(this.getModel(state));
    return state;
  }

  observeContact(input, increment = true) {
    const email = normalizeEmail(input.email);
    if (!email) return { state: this.read(), contact: null, isNew: false };
    let contact;
    let isNew = false;
    const state = this.update(current => {
      contact = current.contacts.find(item => item.email === email);
      if (!contact) {
        isNew = true;
        contact = sanitizeContact({
          email,
          name: input.name,
          kind: inferContactKind(email, input.name),
          pendingAnalysis: true
        });
        current.contacts.push(contact);
      }
      if (!contact.name && input.name) contact.name = String(input.name).trim();
      if (increment) contact.messageCount += Math.max(1, Number(input.messageCount) || 1);
      if (input.sentAt) {
        contact.firstContactAt = contact.firstContactAt || input.sentAt;
        contact.lastContactAt = !contact.lastContactAt || input.sentAt > contact.lastContactAt
          ? input.sentAt
          : contact.lastContactAt;
      }
    });
    return { state, contact, isNew };
  }

  observeSent(message = {}) {
    const results = [];
    for (const recipient of message.recipients || []) {
      results.push(this.observeContact({ ...recipient, sentAt: message.sentAt }, true));
    }
    return {
      state: results.at(-1)?.state || this.read(),
      newContacts: results.filter(result => result.isNew).map(result => result.contact)
    };
  }

  registerCorpus(corpus = {}) {
    const summaries = new Map();
    for (const item of corpus.contacts || []) {
      const email = normalizeEmail(item.email);
      if (!email) continue;
      summaries.set(email, {
        email,
        name: item.name || '',
        messageCount: Math.max(0, Number(item.messageCount) || 0),
        receivedMessageCount: Math.max(0, Number(item.receivedMessageCount) || 0),
        firstContactAt: item.firstContactAt || null,
        lastContactAt: item.lastContactAt || null
      });
    }
    for (const message of corpus.messages || []) {
      for (const recipient of message.recipients || []) {
        const email = normalizeEmail(recipient.email);
        if (!email) continue;
        const current = summaries.get(email) || {
          email,
          name: recipient.name || '',
          messageCount: 0,
          firstContactAt: null,
          lastContactAt: null
        };
        current.name ||= recipient.name || '';
        if (!(corpus.contacts || []).length) current.messageCount += 1;
        current.firstContactAt = !current.firstContactAt || message.sentAt < current.firstContactAt
          ? message.sentAt
          : current.firstContactAt;
        current.lastContactAt = !current.lastContactAt || message.sentAt > current.lastContactAt
          ? message.sentAt
          : current.lastContactAt;
        summaries.set(email, current);
      }
    }
    for (const summary of summaries.values()) {
      this.observeContact(summary, false);
      this.update(state => {
        const contact = state.contacts.find(item => item.email === summary.email);
        if (!contact) return;
        contact.messageCount = Math.max(contact.messageCount, summary.messageCount);
        contact.receivedMessageCount = Math.max(contact.receivedMessageCount, summary.receivedMessageCount || 0);
        contact.firstContactAt = contact.firstContactAt || summary.firstContactAt;
        contact.lastContactAt = !contact.lastContactAt || summary.lastContactAt > contact.lastContactAt
          ? summary.lastContactAt
          : contact.lastContactAt;
      });
    }
    return this.read();
  }

  updateContact(contactIdValue, updates = {}) {
    return this.update(state => {
      const contact = state.contacts.find(item => item.id === contactIdValue);
      if (!contact) throw new Error('Contact not found');
      if (updates.name !== undefined) contact.name = String(updates.name).trim();
      if (updates.notes !== undefined) contact.notes = String(updates.notes).trim();
      if (updates.relationship !== undefined) contact.relationship = String(updates.relationship).trim();
      if (CONTACT_KINDS.has(updates.kind)) contact.kind = updates.kind;
      if (Array.isArray(updates.groupIds)) {
        const validIds = new Set(state.groups.map(group => group.id));
        contact.groupIds = [...new Set(updates.groupIds.filter(id => validIds.has(id)))];
      }
    });
  }

  addGroup(name) {
    const cleanName = String(name || '').trim();
    if (!cleanName) throw new Error('Group name is required');
    return this.update(state => {
      if (!state.groups.some(group => group.name.toLowerCase() === cleanName.toLowerCase())) {
		state.groups.push(sanitizeGroup({ name: cleanName }));
      }
    });
  }

  applyAnalysis(analysis = {}, metadata = {}) {
    const now = new Date().toISOString();
    return this.update(state => {
      if (analysis.generalStyle) state.profile.generalStyle = String(analysis.generalStyle).trim();
      if (Array.isArray(analysis.generalTraits)) state.profile.traits = analysis.generalTraits.map(String).filter(Boolean);
		if (analysis.styleEvidence) state.profile.styleEvidence = sanitizeStyleEvidence(analysis.styleEvidence);
      state.profile.updatedAt = now;
      state.profile.analyzedMessages = Number(metadata.analyzedMessages) || state.profile.analyzedMessages;
		state.profile.analyzedThreads = Number(metadata.analyzedThreads) || state.profile.analyzedThreads;

      const groupsByName = new Map(state.groups.map(group => [group.name.toLowerCase(), group]));
      for (const result of analysis.groups || []) {
        const name = String(result.name || '').trim();
        if (!name) continue;
        let group = groupsByName.get(name.toLowerCase());
        if (!group) {
			group = sanitizeGroup({ name });
          state.groups.push(group);
          groupsByName.set(name.toLowerCase(), group);
        }
		group.summary = String(result.summary || '').trim();
		group.memberProfile = String(result.memberProfile || '').trim();
		group.relationshipContext = String(result.relationshipContext || '').trim();
		group.myWritingStyle = String(result.myWritingStyle || '').trim();
		group.theirWritingStyle = String(result.theirWritingStyle || '').trim();
		group.myStyleEvidence = sanitizeStyleEvidence(result.myStyleEvidence);
		group.theirStyleEvidence = sanitizeStyleEvidence(result.theirStyleEvidence);
		group.communicationDynamics = String(result.communicationDynamics || '').trim();
		group.topics = stringList(result.topics);
		group.recommendedApproach = String(result.recommendedApproach || '').trim();
		group.writingStyle = group.myWritingStyle;
        group.updatedAt = now;
      }

      for (const result of analysis.contacts || []) {
        const email = normalizeEmail(result.email);
        if (!email) continue;
        let contact = state.contacts.find(item => item.email === email);
        if (!contact) {
          contact = sanitizeContact({ email, name: result.name, pendingAnalysis: false });
          state.contacts.push(contact);
        }
        if (result.name && !contact.name) contact.name = String(result.name).trim();
        if (CONTACT_KINDS.has(result.kind)) contact.kind = result.kind;
        contact.relationship = String(result.relationship || contact.relationship || '').trim();
		contact.summary = String(result.summary || '').trim();
		contact.organization = String(result.organization || '').trim();
		contact.jobTitle = String(result.jobTitle || '').trim();
		contact.location = String(result.location || '').trim();
		contact.contactDetails = sanitizeContactDetails(result.contactDetails);
		contact.relationshipSummary = String(result.relationshipSummary || '').trim();
		contact.myWritingStyle = String(result.myWritingStyle || '').trim();
		contact.theirWritingStyle = String(result.theirWritingStyle || '').trim();
		contact.myStyleEvidence = sanitizeStyleEvidence(result.myStyleEvidence);
		contact.theirStyleEvidence = sanitizeStyleEvidence(result.theirStyleEvidence);
		contact.communicationDynamics = String(result.communicationDynamics || '').trim();
		contact.topics = stringList(result.topics);
		contact.facts = stringList(result.facts);
		contact.recommendedApproach = String(result.recommendedApproach || '').trim();
		contact.writingStyle = contact.myWritingStyle;
		contact.styleTraits = stringList(result.styleTraits);
        contact.pendingAnalysis = false;
        contact.analyzedAt = now;
        const requestedGroups = (result.groups || []).map(name => groupsByName.get(String(name).toLowerCase())?.id).filter(Boolean);
        if (requestedGroups.length) contact.groupIds = [...new Set([...contact.groupIds, ...requestedGroups])];
      }
    });
  }
}

module.exports = {
  AiWorkspace,
  DEFAULT_MODEL,
  MODEL: DEFAULT_MODEL,
  MODEL_OPTIONS,
  contactId,
  defaultState,
  inferContactKind,
  normalizeModel,
  normalizeEmail,
  sanitizeStyleEvidence
};
