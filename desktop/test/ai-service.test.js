const assert = require('node:assert/strict');
const test = require('node:test');
const {
	AiService,
	ANALYSIS_SCHEMA,
	buildAnalysisBatches,
	composeChatPrompt,
	composePrompt,
	composeReasoningEffort,
	contactCard,
	corpusPrompt,
	normalizePluginCatalog,
	preSendReviewPrompt,
	recipientDirectorySuggestions,
	STYLE_EVIDENCE_SCHEMA,
	splitMessage
} = require('../ai-service');

test('compose prompt requires full threads, contact dossiers and a reviewable draft', () => {
	const prompt = composePrompt({
		action: 'command',
		instruction: 'Reply all with the updated schedule',
		context: {
			mode: 'replyAll',
			senderAccount: 'me@example.com',
			senderLocked: true,
			allowedSenders: [{ accountEmail: 'me@example.com', email: 'me@example.com' }],
			threadAnchor: { account: 'me@example.com', folder: 'INBOX', uid: 42 }
		}
	}, 'en');
	assert.match(prompt, /call get_thread and read the entire chronological thread/);
	assert.match(prompt, /resolve_recipients/);
	assert.match(prompt, /writing style for each person or group/);
	assert.match(prompt, /recurring words and phrases/);
	assert.match(prompt, /exact account, folder, and uid in sourceMessage/);
	assert.match(prompt, /Never paste quoted history into bodyHtml/);
	assert.match(prompt, /No email may be sent by Codex/);
	assert.match(prompt, /Budget reasoning time aggressively/);
	assert.match(prompt, /act immediately and do not over-analyze/);
	assert.match(prompt, /URL itself as the anchor text/);
	assert.match(prompt, /Never hide a link behind descriptive text/);
	assert.match(prompt, /Choose senderAccount and from only from allowedSenders/);
	assert.match(prompt, /"senderLocked":true/);
	assert.match(prompt, /"allowedSenders"/);
	assert.match(prompt, /"uid":42/);
});

test('compose reasoning scales with the actual mail task', () => {
	assert.equal(composeReasoningEffort({ action: 'recipients' }), 'low');
	assert.equal(composeReasoningEffort({ action: 'search' }), 'low');
	assert.equal(composeReasoningEffort({
		action: 'rewrite',
		context: { mode: 'new', bodyText: 'Ciao, confermo la riunione.' }
	}), 'low');
	assert.equal(composeReasoningEffort({
		action: 'chat',
		instruction: 'Correggi questo refuso',
		context: { mode: 'new' }
	}), 'low');
	assert.equal(composeReasoningEffort({
		action: 'chat',
		instruction: 'Rispondi grazie, ricevuto',
		context: { mode: 'reply', threadAnchor: { account: 'me@example.com', folder: 'INBOX', uid: 42 } }
	}), 'low');
	assert.equal(composeReasoningEffort({
		action: 'chat',
		instruction: 'Quale strategia mi consigli per rispondere?',
		context: { mode: 'new' }
	}), 'medium');
	assert.equal(composeReasoningEffort({
		action: 'chat',
		instruction: 'Conferma quale strategia è meglio seguire',
		context: { mode: 'new' }
	}), 'medium');
	assert.equal(composeReasoningEffort({
		action: 'delegate',
		instruction: 'Scrivi a Marta per confermare domani',
		context: { mode: 'new' }
	}), 'low');
	assert.equal(composeReasoningEffort({
		action: 'delegate',
		instruction: 'Scrivi una proposta dettagliata per rinegoziare le prossime fasi del progetto',
		context: { mode: 'new' }
	}), 'medium');
	assert.equal(composeReasoningEffort({
		action: 'command',
		instruction: 'Rispondi tenendo conto delle decisioni prese',
		context: { mode: 'replyAll', threadAnchor: { account: 'me@example.com', folder: 'INBOX', uid: 42 } }
	}), 'high');
	assert.equal(composeReasoningEffort({
		action: 'delegate',
		instruction: 'Trova e allega il contratto corretto',
		context: { mode: 'new' }
	}), 'high');
});

test('compose chat is multi-turn and can answer without changing the draft', () => {
	const prompt = composeChatPrompt({
		instruction: 'Secondo te e meglio rispondere a tutti?',
		history: [
			{ role: 'user', text: 'Dobbiamo confermare il programma.' },
			{ role: 'assistant', text: 'Ho letto il thread.' }
		],
		context: {
			mode: 'reply',
			subject: 'Programma',
			threadAnchor: { account: 'me@example.com', folder: 'INBOX', uid: 42 }
		}
	}, 'it');
	assert.match(prompt, /multi-turn email co-writer/);
	assert.match(prompt, /set applyDraft to false/);
	assert.match(prompt, /call get_thread and inspect the complete chronological thread/);
	assert.match(prompt, /return its exact account, folder, and uid in sourceMessage/);
	assert.match(prompt, /Use concrete styleEvidence/);
	assert.match(prompt, /Budget reasoning time aggressively/);
	assert.match(prompt, /Do not turn a simple correction/);
	assert.match(prompt, /URL must also be the anchor text/);
	assert.match(prompt, /Never hide it behind labels/);
	assert.match(prompt, /Do not reveal private chain-of-thought/);
	assert.match(prompt, /Dobbiamo confermare il programma/);
	assert.match(prompt, /"uid":42/);
});

test('compose chat forwards its activity id and keeps a trivial thread reply lightweight', async () => {
	let invocation;
	const service = {
		server: {
			runMailAgent: async (prompt, schema, options) => {
				invocation = { prompt, schema, options };
				return { ok: true };
			}
		}
	};
	const result = await AiService.prototype.composeChat.call(service, {
		requestId: 'chat-request-1',
		instruction: 'Rispondi dicendo che confermo',
		context: {
			mode: 'reply',
			threadAnchor: { account: 'me@example.com', folder: 'INBOX', uid: 42 }
		}
	}, 'it');
	assert.deepEqual(result, { ok: true });
	assert.equal(invocation.options.activityId, 'chat-request-1');
	assert.equal(invocation.options.effort, 'low');
	assert.equal(invocation.schema.required.includes('applyDraft'), true);
	assert.equal(invocation.schema.properties.draft.required.includes('sourceMessage'), true);
	assert.deepEqual(invocation.schema.properties.draft.properties.sourceMessage.type, ['object', 'null']);
	for (const field of ['replyTo', 'requestReadReceipt', 'requestDsn', 'requireTLS', 'markAsImportant', 'sign', 'encrypt']) {
		assert.equal(invocation.schema.properties.draft.required.includes(field), true);
	}
	assert.match(invocation.prompt, /delivery options/);
	assert.match(invocation.prompt, /Never enable signing or encryption unless the user asks/);
});

test('pre-send review is narrow, high-confidence and always uses low reasoning', async () => {
	const prompt = preSendReviewPrompt({
		context: {
			from: 'Eduardo <eduardo@example.com>',
			to: 'marta@example.com',
			subject: 'Contratto',
			bodyText: 'Ciao Marta, trovi il contratto in allegato.',
			attachments: []
		}
	}, 'it');
	assert.match(prompt, /fast final safety review/);
	assert.match(prompt, /concrete, high-confidence, serious problem/);
	assert.match(prompt, /promised attachment that is absent/);
	assert.match(prompt, /Avoid false positives/);

	let invocation;
	const service = {
		server: {
			runStructured: async (reviewPrompt, schema, options) => {
				invocation = { reviewPrompt, schema, options };
				return { safeToSend: true, summary: 'Nessun problema grave.', issues: [] };
			}
		}
	};
	const result = await AiService.prototype.reviewBeforeSend.call(service, {
		context: { to: 'marta@example.com', bodyText: 'Ciao Marta.' }
	}, 'it');
	assert.equal(result.safeToSend, true);
	assert.equal(invocation.options.effort, 'low');
	assert.equal(invocation.schema.properties.issues.maxItems, 3);
});

test('recipient directory returns matching contacts and expandable groups', () => {
	const state = {
		contacts: [{
			id: 'alice',
			name: 'Alice Rossi',
			email: 'alice@example.com',
			organization: 'Project Sport',
			groupIds: ['project-sport'],
			messageCount: 12
		}, {
			id: 'bob',
			name: 'Bob Bianchi',
			email: 'bob@example.com',
			groupIds: ['project-sport'],
			messageCount: 5
		}],
		groups: [{ id: 'project-sport', name: 'Project Sport', summary: 'Project team' }]
	};
	const byGroup = recipientDirectorySuggestions(state, 'project');
	assert.equal(byGroup[0].type, 'group');
	assert.equal(byGroup[0].members.length, 2);
	assert.ok(byGroup.some(item => 'contact' === item.type && 'alice@example.com' === item.email));
	const byPerson = recipientDirectorySuggestions(state, 'alice');
	assert.ok(byPerson.some(item => 'contact' === item.type && 'alice@example.com' === item.email));
	assert.ok(byPerson.some(item => 'group' === item.type && 'project-sport' === item.id));
	assert.deepEqual(recipientDirectorySuggestions(state, ''), []);
});

test('contact hover card exposes only compact dossier fields for the matching address', () => {
	const state = {
		contacts: [{
			id: 'alice', email: 'Alice@Example.com', name: 'Alice Rossi', organization: 'Project Sport',
			jobTitle: 'Coordinator', relationshipSummary: 'Operational project contact.',
			myWritingStyle: 'Direct and concise.', theirWritingStyle: 'Detailed and formal.',
			groupIds: ['project-sport'], messageCount: 12, notes: 'Private note not needed in hover.'
		}],
		groups: [{ id: 'project-sport', name: 'Project Sport', summary: 'Internal group detail.' }]
	};
	assert.deepEqual(contactCard(state, ' alice@example.com '), {
		id: 'alice', email: 'Alice@Example.com', name: 'Alice Rossi', organization: 'Project Sport',
		jobTitle: 'Coordinator', relationship: 'Operational project contact.',
		myWritingStyle: 'Direct and concise.', theirWritingStyle: 'Detailed and formal.',
		groups: ['Project Sport'], messageCount: 12
	});
	assert.equal(contactCard(state, 'unknown@example.com'), null);
});

const analysisResult = () => ({
	generalStyle: 'Direct.',
	generalTraits: [],
	styleEvidence: {
		tones: [], recurringWords: [], recurringPhrases: [], greetings: [], closings: [], sentencePatterns: [], examples: []
	},
	groups: [],
	contacts: []
});

test('analysis schema requires concrete style evidence for every voice', () => {
	assert.ok(ANALYSIS_SCHEMA.required.includes('styleEvidence'));
	assert.deepEqual(STYLE_EVIDENCE_SCHEMA.required, [
		'tones', 'recurringWords', 'recurringPhrases', 'greetings', 'closings', 'sentencePatterns', 'examples'
	]);
	const groupSchema = ANALYSIS_SCHEMA.properties.groups.items;
	const contactSchema = ANALYSIS_SCHEMA.properties.contacts.items;
	assert.ok(groupSchema.required.includes('myStyleEvidence'));
	assert.ok(groupSchema.required.includes('theirStyleEvidence'));
	assert.ok(contactSchema.required.includes('myStyleEvidence'));
	assert.ok(contactSchema.required.includes('theirStyleEvidence'));
	assert.equal(STYLE_EVIDENCE_SCHEMA.properties.examples.items.properties.text.maxLength, 280);
});

test('analysis prompt separates user writing from received contact messages', () => {
	const prompt = corpusPrompt({ periodMonths: 12, contacts: [], messages: [] }, 'en');
	assert.match(prompt, /senior relationship-intelligence analyst/);
	assert.match(prompt, /Use sent messages only to infer how the user writes/);
	assert.match(prompt, /Use received messages only to infer how the contact writes/);
	assert.match(prompt, /Never blend or swap the two voices/);
	assert.match(prompt, /Analyze every message and every numbered part/);
	assert.match(prompt, /Extract all useful contact information/);
	assert.match(prompt, /Never infer or output sensitive personal traits/);
	assert.match(prompt, /intelligent folder/);
	assert.match(prompt, /concrete linguistic evidence/);
	assert.match(prompt, /Never invent or paraphrase a style example/);
	assert.match(prompt, /general styleEvidence must use only sent messages/);
	assert.match(prompt, /myStyleEvidence must use only sent messages addressed to them/);
});

test('long message parts retain the complete body without sampling', () => {
	const body = 'a'.repeat(1200) + 'b'.repeat(1200) + 'c'.repeat(300),
		parts = splitMessage({ id: 'message-1', direction: 'sent', body }, 1000);
	assert.equal(parts.length, 3);
	assert.equal(parts.map(part => part.body).join(''), body);
	assert.deepEqual(parts.map(part => part.messagePart), [1, 2, 3]);
	assert.ok(parts.every(part => 3 === part.messageParts));
});

test('analysis batches retain every message and preserve thread order', () => {
	const messages = Array.from({ length: 181 }, (_value, index) => ({
		id: `message-${index + 1}`,
		direction: index % 2 ? 'received' : 'sent',
		body: `Body ${index + 1}`,
		sentAt: new Date(2026, 0, 1, 0, index).toISOString(),
		contacts: [{ email: 'person@example.com' }]
	}));
	const batches = buildAnalysisBatches({
		accountEmail: 'me@example.com',
		periodMonths: 12,
		contacts: [{ email: 'person@example.com' }],
		threads: [{ id: 'thread-1', subject: 'Project', contacts: [{ email: 'person@example.com' }], messages }]
	}, { maxChars: 100000, maxMessages: 40, maxMessageChars: 1000 });
	const analyzed = batches.flatMap(batch => batch.threads).flatMap(thread => thread.messages);

	assert.ok(batches.length > 1);
	assert.equal(analyzed.length, messages.length);
	assert.deepEqual(analyzed.map(message => message.id), messages.map(message => message.id));
	assert.deepEqual(analyzed.map(message => message.direction), messages.map(message => message.direction));
});

test('many batch analyses are consolidated hierarchically', async () => {
	let calls = 0;
	const options = [];
	const service = {
		server: {
			runStructured: async (_prompt, _schema, settings) => {
				calls += 1;
				options.push(settings);
				return analysisResult();
			}
		}
	};
	const result = await AiService.prototype.consolidateAnalyses.call(
		service,
		{ contacts: [] },
		Array.from({ length: 17 }, analysisResult),
		'en'
	);

	assert.deepEqual(result, analysisResult());
	assert.equal(calls, 3);
	assert.ok(options.every(settings => 'high' === settings.effort));
});

test('plugin catalog exposes safe metadata while retaining private install targets', () => {
	const result = normalizePluginCatalog({
		featuredPluginIds: ['calendar@official'],
		marketplaces: [{
			name: 'official',
			path: '/private/codex/marketplace.json',
			plugins: [{
				id: 'calendar@official',
				name: 'calendar',
				installed: false,
				enabled: true,
				installPolicy: 'AVAILABLE',
				availability: 'AVAILABLE',
				interface: {
					displayName: 'Calendar',
					shortDescription: 'Calendar tools',
					capabilities: ['Search', 'Create']
				}
			}]
		}]
	});

	assert.equal(result.plugins[0].displayName, 'Calendar');
	assert.equal(result.plugins[0].canInstall, true);
	assert.equal(result.plugins[0].featured, true);
	assert.equal(Object.hasOwn(result.plugins[0], 'marketplacePath'), false);
	assert.equal(result.targets.get('calendar@official').marketplacePath, '/private/codex/marketplace.json');
});

test('plugin installation resolves catalog targets and keeps authorization URLs in the main process', async () => {
	let installed = false;
	const requests = [],
		opened = [],
		catalog = () => ({
			marketplaces: [{
				name: 'openai-curated-remote',
				path: null,
				plugins: [{
					id: 'calendar@openai-curated-remote',
					name: 'calendar',
					installed,
					enabled: installed,
					installPolicy: 'AVAILABLE',
					availability: 'AVAILABLE',
					interface: { displayName: 'Calendar', capabilities: [] }
				}]
			}]
		}),
		service = {
			server: {
				start: async () => {},
				account: async () => ({ type: 'chatgpt' }),
				request: async (method, params) => {
					requests.push({ method, params });
					if ('plugin/list' === method) return catalog();
					if ('plugin/install' === method) {
						installed = true;
						return {
							appsNeedingAuth: [{
								id: 'calendar-app',
								name: 'Calendar',
								installUrl: 'https://example.com/oauth'
							}]
						};
					}
					throw new Error(`Unexpected request: ${method}`);
				}
			},
			pluginCatalog: new Map,
			pendingPluginAuth: new Map,
			openExternal: url => opened.push(url),
			listPlugins: AiService.prototype.listPlugins,
			pluginTarget: AiService.prototype.pluginTarget
		};

	await service.listPlugins();
	const response = await AiService.prototype.installPlugin.call(service, 'calendar@openai-curated-remote');
	const install = requests.find(request => 'plugin/install' === request.method);
	assert.deepEqual(install.params, {
		pluginName: 'calendar',
		remoteMarketplaceName: 'openai-curated-remote'
	});
	assert.equal(response.plugins[0].installed, true);
	assert.deepEqual(response.authApps, [{ id: 'calendar-app', name: 'Calendar', description: '' }]);
	assert.equal(Object.hasOwn(response.authApps[0], 'installUrl'), false);

	AiService.prototype.authorizePluginApp.call(service, 'calendar-app');
	assert.deepEqual(opened, ['https://example.com/oauth']);
});
