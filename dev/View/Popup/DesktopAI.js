import { addComputablesTo, addObservablesTo } from 'External/ko';

import { htmlToPlain } from 'Common/Html';
import { collectReceivedFolderNames } from 'Common/AiMailAnalysis';
import { i18n, getNotification } from 'Common/Translator';
import { AccountUserStore } from 'Stores/User/Account';
import { FolderUserStore } from 'Stores/User/Folder';
import { LanguageStore } from 'Stores/Language';

import Remote from 'Remote/User/Fetch';

import { AbstractViewPopup } from 'Knoin/AbstractViews';

const PAGE_SIZE = 500;
const DEFAULT_MODEL_OPTIONS = [
	{ id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', profile: 'maximum' },
	{ id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', profile: 'balanced', recommended: true },
	{ id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', profile: 'efficient' }
];
const MODEL_COPY = {
	'gpt-5.6-sol': ['DESKTOP_AI/MODEL_SOL_NAME', 'DESKTOP_AI/MODEL_SOL_HINT'],
	'gpt-5.6-terra': ['DESKTOP_AI/MODEL_TERRA_NAME', 'DESKTOP_AI/MODEL_TERRA_HINT'],
	'gpt-5.6-luna': ['DESKTOP_AI/MODEL_LUNA_NAME', 'DESKTOP_AI/MODEL_LUNA_HINT']
};

function localizedModelOptions(options) {
	return (Array.isArray(options) && options.length ? options : DEFAULT_MODEL_OPTIONS).map(option => ({
		...option,
		name: i18n(MODEL_COPY[option.id]?.[0] || '') || option.name || option.id,
		description: i18n(MODEL_COPY[option.id]?.[1] || '')
	}));
}

function remoteRequest(action, params, timeout = 60000) {
	return new Promise((resolve, reject) => {
		Remote.request(action, (error, data) => {
			if (error) {
				reject(new Error(data?.message || getNotification(error)));
			} else {
				resolve(data?.Result);
			}
		}, params, timeout);
	});
}

function recipientList(message) {
	const unique = new Map;
	['to', 'cc', 'bcc'].forEach(field => {
		(message[field] || []).forEach(item => {
			const email = String(item?.email || '').trim().toLowerCase();
			if (email && !unique.has(email)) unique.set(email, { email, name: String(item?.name || '').trim() });
		});
	});
	return [...unique.values()];
}

function senderList(message) {
	const unique = new Map;
	(message.from || []).forEach(item => {
		const email = String(item?.email || '').trim().toLowerCase();
		if (email && !unique.has(email)) unique.set(email, { email, name: String(item?.name || '').trim() });
	});
	return [...unique.values()];
}

function analysisContacts(message) {
	return message.analysisContacts || recipientList(message);
}

function messageDate(message) {
	const timestamp = Number(message.dateTimestamp) || 0;
	return timestamp ? new Date(timestamp * 1000).toISOString() : new Date().toISOString();
}

function monthsAgo(months) {
	const date = new Date;
	date.setMonth(date.getMonth() - months);
	return date.toISOString().slice(0, 10);
}

function messageIds(value) {
	const text = String(value || '').trim(),
		matches = text.match(/<[^<>]+>/g) || text.split(/\s+/);
	return [...new Set(matches
		.map(id => id.replace(/^[\s<]+|[\s>]+$/g, '').trim().toLowerCase())
		.filter(Boolean))];
}

function messageId(message) {
	return messageIds(message.messageId)[0] || '';
}

function subjectKey(value) {
	return String(value || '')
		.replace(/^\s*((re|r|fw|fwd|i|inoltro)\s*:\s*)+/i, '')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

function classifyMessage(message, accountEmail, sentFolder) {
	const account = String(accountEmail || '').trim().toLowerCase(),
		isSent = message.folder === sentFolder || senderList(message).some(sender => sender.email === account);
	message.analysisDirection = isSent ? 'sent' : 'received';
	message.analysisContacts = (isSent ? recipientList(message) : senderList(message))
		.filter(contact => contact.email !== account);
	return message;
}

function uniqueMessages(messages) {
	const unique = new Map;
	for (const message of messages) {
		const id = messageId(message),
			key = id ? `id:${id}` : `mailbox:${message.folder}:${message.uid}`,
			current = unique.get(key);
		if (!current || ('sent' === message.analysisDirection && 'sent' !== current.analysisDirection)) {
			unique.set(key, message);
		}
	}
	return [...unique.values()];
}

function conversationThreads(messages, contactEmails) {
	const parent = messages.map((_message, index) => index),
		anchors = new Map;
	const find = index => {
		while (parent[index] !== index) {
			parent[index] = parent[parent[index]];
			index = parent[index];
		}
		return index;
	};
	const union = (left, right) => {
		left = find(left);
		right = find(right);
		if (left !== right) parent[right] = left;
	};

	messages.forEach((message, index) => {
		let ids = [
			...messageIds(message.messageId),
			...messageIds(message.inReplyTo),
			...messageIds(message.references)
		];
		ids = [...new Set(ids)].map(id => `id:${id}`);
		if (!ids.length) {
			const subject = subjectKey(message.subject);
			ids = subject ? analysisContacts(message).map(contact => `subject:${subject}:${contact.email}`) : [];
		}
		ids.forEach(id => {
			if (anchors.has(id)) union(index, anchors.get(id));
			else anchors.set(id, index);
		});
	});

	const grouped = new Map;
	messages.forEach((message, index) => {
		const root = find(index);
		if (!grouped.has(root)) grouped.set(root, []);
		grouped.get(root).push(message);
	});

	return [...grouped.values()]
		.filter(thread => thread.some(message =>
			analysisContacts(message).some(contact => contactEmails.has(contact.email))))
		.map((thread, index) => {
			thread.sort((left, right) => Number(left.dateTimestamp) - Number(right.dateTimestamp));
			const contacts = new Map;
			thread.forEach(message => analysisContacts(message).forEach(contact => {
				if (contactEmails.has(contact.email) && !contacts.has(contact.email)) contacts.set(contact.email, contact);
			}));
			return {
				id: messageId(thread[0]) || `conversation-${index + 1}`,
				subject: String(thread.find(message => message.subject)?.subject || ''),
				contacts: [...contacts.values()],
				headers: thread
			};
		})
		.sort((left, right) => Number(left.headers[0]?.dateTimestamp) - Number(right.headers[0]?.dateTimestamp));
}

export class DesktopAIPopupView extends AbstractViewPopup {
	constructor() {
		super('DesktopAI');

		addObservablesTo(this, {
			section: 'setup',
			workspaceState: null,
			connected: false,
			available: true,
			accountLabel: '',
			model: 'gpt-5.6-terra',
			modelOptions: [],
			savingSettings: false,
			authMode: 'chatgpt',
			apiKey: '',
			showApiKey: false,
			deviceCode: '',
			deviceUrl: '',
			busy: false,
			analyzing: false,
			statusMessage: '',
			analysisStage: 'idle',
			analysisCurrent: 0,
			analysisTotal: 0,
			analysisElapsedSeconds: 0,
			errorMessage: '',
			pluginCatalog: [],
			pluginCatalogLoaded: false,
			pluginsLoading: false,
			pluginBusyId: '',
			pluginView: 'installed',
			pluginSearch: '',
			pluginAuthApps: [],
			pluginStatusMessage: '',
			periodMonths: 12,
			autoAnalyzeNewContacts: true,
				contactFilter: 'important',
				contactSearch: '',
				selectedGroupId: '',
				selectedContactId: '',
			editName: '',
			editKind: 'other',
			editRelationship: '',
			editNotes: '',
			editGroupIds: [],
			newGroupName: ''
		});

		this.desktopAvailable = Boolean(window.snappyDesktop?.ai);
		this.i18n = i18n;
		this.analysisTimer = 0;
		this.analysisStartedAt = 0;
		this.selectContact = this.selectContact.bind(this);
		this.selectGroup = this.selectGroup.bind(this);

		addComputablesTo(this, {
			contacts: () => this.workspaceState()?.contacts || [],
			groups: () => this.workspaceState()?.groups || [],
			profile: () => this.workspaceState()?.profile || {},
			plugins: () => this.pluginCatalog() || [],
			installedPluginCount: () => this.plugins().filter(plugin => plugin.installed).length,
			availablePluginCount: () => this.plugins().filter(plugin => plugin.canInstall).length,
			visiblePlugins: () => {
				const search = this.pluginSearch().trim().toLowerCase(),
					installedOnly = 'installed' === this.pluginView(),
					plugins = this.plugins().filter(plugin => {
						if (installedOnly && !plugin.installed) return false;
						if (!search) return true;
						return [
							plugin.displayName,
							plugin.description,
							plugin.developerName,
							plugin.category,
							...(plugin.capabilities || [])
						].join(' ').toLowerCase().includes(search);
					});
				return plugins.slice(0, search || installedOnly ? 120 : 60);
			},
				filteredContacts: () => {
					const filter = this.contactFilter(),
						search = this.contactSearch().trim().toLowerCase(),
						groupId = this.selectedGroupId();
					return this.contacts()
						.filter(contact => ('all' === filter || contact.kind === filter)
							&& (!groupId || (contact.groupIds || []).includes(groupId))
							&& (!search || `${contact.name} ${contact.email} ${contact.relationship}`.toLowerCase().includes(search)))
						.sort((a, b) => b.messageCount - a.messageCount || (a.name || a.email).localeCompare(b.name || b.email));
				},
				selectedContact: () => this.contacts().find(contact => contact.id === this.selectedContactId()) || null,
				selectedGroup: () => this.groups().find(group => group.id === this.selectedGroupId()) || null,
				groupMembers: () => {
					const groupId = this.selectedGroupId();
					return groupId ? this.contacts().filter(contact => (contact.groupIds || []).includes(groupId)) : [];
				},
			importantCount: () => this.contacts().filter(contact => 'important' === contact.kind).length,
			automaticCount: () => this.contacts().filter(contact => 'automatic' === contact.kind).length,
			otherCount: () => this.contacts().filter(contact => 'other' === contact.kind).length,
			analysisPercent: () => {
				const total = this.analysisTotal(), current = this.analysisCurrent();
				if ('complete' === this.analysisStage()) return 100;
				return total ? Math.max(6, Math.min(96, Math.round(current / total * 100))) : 10;
			},
			analysisProgressWidth: () => `${this.analysisPercent()}%`,
			analysisProgressDetail: () => {
				const stage = this.analysisStage(), total = this.analysisTotal();
				if ('analyzing' === stage && total) return i18n('DESKTOP_AI/ANALYSIS_BATCH', {
					CURRENT: Math.min(this.analysisCurrent() + 1, total),
					TOTAL: total
				});
				if ('consolidating' === stage) return i18n('DESKTOP_AI/ANALYSIS_CONSOLIDATING');
				return i18n('DESKTOP_AI/ANALYSIS_PREPARING');
			},
			analysisElapsedText: () => {
				const seconds = this.analysisElapsedSeconds(),
					minutes = Math.floor(seconds / 60),
					remainder = String(seconds % 60).padStart(2, '0');
				return i18n('DESKTOP_AI/ANALYSIS_ELAPSED', { TIME: `${minutes}:${remainder}` });
			},
			modelDescription: () => this.modelOptions().find(option => option.id === this.model())?.description || '',
			analysisReady: () => this.connected() && !this.busy() && !this.analyzing()
		});
	}

	async beforeShow(initialSection = '') {
		this.errorMessage('');
		if (['setup', 'overview', 'contacts', 'style'].includes(initialSection)) {
			this.section(initialSection);
		}
		if ('contacts' === initialSection) {
			this.contactFilter('all');
			this.selectedGroupId('');
		}
		if (!this.desktopAvailable) {
			this.available(false);
			this.errorMessage(i18n('DESKTOP_AI/ERROR_DESKTOP_ONLY'));
			return;
		}
		await this.refresh();
	}

	onBuild() {
		window.snappyDesktop?.ai.onEvent(event => {
			if ('auth' === event.type) this.refresh();
			if ('workspace' === event.type) this.applyWorkspace(event.data);
			if ('progress' === event.type) this.applyAnalysisProgress(event.data);
			if ('error' === event.type) {
				this.errorMessage(event.data?.message || i18n('DESKTOP_AI/ERROR_GENERIC'));
				this.analyzing(false);
				this.stopAnalysisTimer();
			}
		});
	}

	startAnalysisTimer() {
		clearInterval(this.analysisTimer);
		this.analysisStartedAt = Date.now();
		this.analysisElapsedSeconds(0);
		this.analysisTimer = setInterval(() => {
			this.analysisElapsedSeconds(Math.floor((Date.now() - this.analysisStartedAt) / 1000));
		}, 1000);
	}

	stopAnalysisTimer() {
		clearInterval(this.analysisTimer);
		this.analysisTimer = 0;
	}

	applyAnalysisProgress(progress = {}) {
		const stage = String(progress.stage || 'analyzing'),
			current = Math.max(0, Number(progress.current) || 0),
			total = Math.max(0, Number(progress.total) || 0);
		this.analysisStage(stage);
		this.analysisCurrent(current);
		this.analysisTotal(total);
		if ('complete' === stage) {
			this.analyzing(false);
			this.stopAnalysisTimer();
			return;
		}
		if (!this.analyzing()) {
			this.analyzing(true);
			this.startAnalysisTimer();
		}
		this.statusMessage('consolidating' === stage
			? i18n('DESKTOP_AI/ANALYSIS_CONSOLIDATING')
			: i18n('DESKTOP_AI/ANALYZING_CODEX'));
	}

	async refresh() {
		this.busy(true);
		try {
			const [status, workspace] = await Promise.all([
				window.snappyDesktop.ai.status(),
				window.snappyDesktop.ai.workspace()
			]);
			this.available(status.available);
			this.connected(status.connected);
			this.modelOptions(localizedModelOptions(status.models));
			this.model(status.model || 'gpt-5.6-terra');
			this.accountLabel(
				status.account?.email || ('apiKey' === status.account?.type ? i18n('DESKTOP_AI/API_KEY_ACCOUNT') : '')
			);
			status.error && this.errorMessage(status.error);
			this.applyWorkspace(workspace);
			if (status.connected && 'setup' === this.section()) this.section('overview');
		} catch (error) {
			this.errorMessage(error.message);
		} finally {
			this.busy(false);
		}
	}

	applyWorkspace(workspace) {
		if (!workspace) return;
		this.workspaceState(workspace);
		this.periodMonths(workspace.settings?.periodMonths || 12);
		this.autoAnalyzeNewContacts(workspace.settings?.autoAnalyzeNewContacts !== false);
		const provider = (workspace.providers || []).find(item => item.id === workspace.activeProviderId);
		if (provider?.model) this.model(provider.model);
		const selected = this.contacts().find(contact => contact.id === this.selectedContactId());
		if (selected) this.populateContact(selected);
	}

	setSection(value) {
		this.section(value);
		this.errorMessage('');
		if ('setup' === value && this.connected() && !this.pluginCatalogLoaded()) this.loadPlugins();
	}

	applyPluginCatalog(result) {
		this.pluginCatalog(result?.plugins || []);
		this.pluginAuthApps(result?.authApps || []);
		this.pluginCatalogLoaded(true);
		const marketplaceError = result?.marketplaceErrors?.find(Boolean);
		if (marketplaceError) this.errorMessage(marketplaceError);
	}

	async loadPlugins() {
		if (!this.connected() || this.pluginsLoading()) return;
		this.pluginsLoading(true);
		try {
			this.applyPluginCatalog(await window.snappyDesktop.ai.listPlugins());
		} catch (error) {
			this.errorMessage(error.message);
		} finally {
			this.pluginsLoading(false);
		}
	}

	async installPlugin(plugin) {
		if (!plugin?.id || this.pluginBusyId()) return;
		this.pluginBusyId(plugin.id);
		this.errorMessage('');
		try {
			const result = await window.snappyDesktop.ai.installPlugin(plugin.id);
			this.applyPluginCatalog(result);
			this.pluginStatusMessage(i18n(
				result?.authApps?.length ? 'DESKTOP_AI/PLUGIN_AUTH_REQUIRED_STATUS' : 'DESKTOP_AI/PLUGIN_CONNECTED_STATUS',
				{ NAME: plugin.displayName }
			));
		} catch (error) {
			this.errorMessage(error.message);
		} finally {
			this.pluginBusyId('');
		}
	}

	async uninstallPlugin(plugin) {
		if (!plugin?.id || this.pluginBusyId()) return;
		this.pluginBusyId(plugin.id);
		this.errorMessage('');
		try {
			this.applyPluginCatalog(await window.snappyDesktop.ai.uninstallPlugin(plugin.id));
			this.pluginStatusMessage(i18n('DESKTOP_AI/PLUGIN_REMOVED_STATUS', { NAME: plugin.displayName }));
		} catch (error) {
			this.errorMessage(error.message);
		} finally {
			this.pluginBusyId('');
		}
	}

	async authorizePluginApp(app) {
		try {
			await window.snappyDesktop.ai.authorizePluginApp(app.id);
			this.pluginStatusMessage(i18n('DESKTOP_AI/PLUGIN_AUTH_OPENED_STATUS', { NAME: app.name }));
		} catch (error) {
			this.errorMessage(error.message);
		}
	}

	async loginApiKey() {
		if (!this.apiKey().trim()) return;
		this.busy(true);
		this.errorMessage('');
		try {
			await window.snappyDesktop.ai.loginApiKey(this.apiKey());
			this.apiKey('');
			await this.refresh();
		} catch (error) {
			this.errorMessage(error.message);
		} finally {
			this.busy(false);
		}
	}

	async startDeviceLogin() {
		this.busy(true);
		this.errorMessage('');
		try {
			const result = await window.snappyDesktop.ai.startDeviceLogin();
			this.deviceCode(result.userCode || '');
			this.deviceUrl(result.verificationUrl || '');
			this.statusMessage(i18n('DESKTOP_AI/DEVICE_WAITING'));
		} catch (error) {
			this.errorMessage(error.message);
		} finally {
			this.busy(false);
		}
	}

	copyDeviceCode() {
		navigator.clipboard?.writeText(this.deviceCode());
	}

	async logout() {
		this.busy(true);
		try {
			await window.snappyDesktop.ai.logout();
			this.connected(false);
			this.accountLabel('');
			this.deviceCode('');
			this.section('setup');
		} catch (error) {
			this.errorMessage(error.message);
		} finally {
			this.busy(false);
		}
	}

	async saveSettings() {
		if (this.savingSettings()) return false;
		this.savingSettings(true);
		this.errorMessage('');
		try {
			const workspace = await window.snappyDesktop.ai.saveSettings({
				periodMonths: Number(this.periodMonths()),
				autoAnalyzeNewContacts: Boolean(this.autoAnalyzeNewContacts()),
				model: this.model()
			});
			this.applyWorkspace(workspace);
			return true;
		} catch (error) {
			this.errorMessage(error.message);
			return false;
		} finally {
			this.savingSettings(false);
		}
	}

	async saveModel() {
		if (await this.saveSettings()) this.statusMessage(i18n('DESKTOP_AI/MODEL_UPDATED'));
	}

	async loadFolderHeaders(folder, statusKey) {
		const messages = [],
			search = `since=${monthsAgo(Number(this.periodMonths()))}`;
		let offset = 0,
			total = Infinity;
		while (offset < total) {
			this.statusMessage(i18n(statusKey, { COUNT: offset }));
			const result = await remoteRequest('MessageList', {
				folder,
				offset,
				limit: PAGE_SIZE,
				search,
				sort: '',
				uidNext: 0,
				useThreads: 0,
				threadUid: 0
			});
			const page = result?.['@Collection'] || [];
			total = Number(result?.totalEmails ?? page.length);
			messages.push(...page);
			if (!page.length || page.length < PAGE_SIZE) break;
			offset += page.length;
		}
		return messages;
	}

	async loadSentHeaders() {
		const folder = FolderUserStore.sentFolder();
		if (!folder) throw new Error(i18n('DESKTOP_AI/ERROR_SENT_FOLDER'));
		const messages = await this.loadFolderHeaders(folder, 'DESKTOP_AI/SCANNING_SENT');
		messages.forEach(message => {
			message.analysisDirection = 'sent';
			message.analysisContacts = recipientList(message);
		});
		return messages;
	}

	receivedFolders() {
		return collectReceivedFolderNames(FolderUserStore.folderList(), [
			FolderUserStore.sentFolder(),
			FolderUserStore.draftsFolder(),
			FolderUserStore.spamFolder(),
			FolderUserStore.trashFolder()
		]);
	}

	async loadOtherHeaders() {
		const messages = [],
			folders = this.receivedFolders();
		for (let index = 0; index < folders.length; index++) {
			this.statusMessage(i18n('DESKTOP_AI/SCANNING_RECEIVED_FOLDER', {
				CURRENT: index + 1,
				TOTAL: folders.length
			}));
			let headers;
			try {
				headers = await this.loadFolderHeaders(folders[index], 'DESKTOP_AI/SCANNING_RECEIVED');
			} catch (error) {
				console.warn(`Cannot scan received folder ${folders[index]}`, error);
				continue;
			}
			messages.push(...headers);
		}
		return messages;
	}

	contactSummaries(sentMessages, receivedMessages = []) {
		const summaries = new Map;
		sentMessages.forEach(message => recipientList(message).forEach(recipient => {
			const sentAt = messageDate(message),
				current = summaries.get(recipient.email) || {
					email: recipient.email,
					name: recipient.name,
					messageCount: 0,
					firstContactAt: sentAt,
					lastContactAt: sentAt
				};
			current.name ||= recipient.name;
			current.messageCount += 1;
			if (sentAt < current.firstContactAt) current.firstContactAt = sentAt;
			if (sentAt > current.lastContactAt) current.lastContactAt = sentAt;
			summaries.set(recipient.email, current);
		}));
		receivedMessages.forEach(message => analysisContacts(message).forEach(sender => {
			const current = summaries.get(sender.email);
			if (current) current.receivedMessageCount = (current.receivedMessageCount || 0) + 1;
		}));
		return [...summaries.values()];
	}

	async loadConversationBodies(threads) {
		const total = threads.reduce((count, thread) => count + thread.headers.length, 0);
		let current = 0;
		const conversations = [];
		for (const thread of threads) {
			const messages = [];
			for (const header of thread.headers) {
				current += 1;
				this.statusMessage(i18n('DESKTOP_AI/SCANNING_BODIES', { CURRENT: current, TOTAL: total }));
				let body = String(header.preview || '');
				try {
					const full = await remoteRequest('Message', { folder: header.folder, uid: header.uid });
					body = String(full?.plain || (full?.html ? htmlToPlain(full.html) : '') || body);
				} catch {
					// Keep the preview so one unavailable message does not discard the rest of its thread.
				}
				messages.push({
					id: messageId(header) || `${header.folder}:${header.uid}`,
					direction: header.analysisDirection || 'received',
					subject: String(header.subject || '').slice(0, 500),
					body: body.trim(),
					sentAt: messageDate(header),
					from: senderList(header),
					to: recipientList(header),
					contacts: analysisContacts(header),
					inReplyTo: messageIds(header.inReplyTo),
					references: messageIds(header.references)
				});
			}
			conversations.push({
				id: thread.id,
				subject: thread.subject,
				contacts: thread.contacts,
				messages
			});
		}
		return conversations;
	}

	async analyze() {
		this.analyzing(true);
		this.analysisStage('preparing');
		this.analysisCurrent(0);
		this.analysisTotal(0);
		this.startAnalysisTimer();
		this.errorMessage('');
		try {
			await this.saveSettings();
			const accountEmail = AccountUserStore.email(),
				sentFolder = FolderUserStore.sentFolder(),
				sentHeaders = await this.loadSentHeaders();
			if (!sentHeaders.length) throw new Error(i18n('DESKTOP_AI/ERROR_NO_MESSAGES'));
			const sentContacts = this.contactSummaries(sentHeaders),
				contactEmails = new Set(sentContacts.map(contact => contact.email)),
				otherHeaders = await this.loadOtherHeaders(),
				allHeaders = uniqueMessages([...sentHeaders, ...otherHeaders]
					.map(message => classifyMessage(message, accountEmail, sentFolder))),
				threadHeaders = conversationThreads(allHeaders, contactEmails),
				matchedHeaders = threadHeaders.flatMap(thread => thread.headers),
				matchedSent = matchedHeaders.filter(message => 'sent' === message.analysisDirection),
				receivedHeaders = matchedHeaders.filter(message => 'received' === message.analysisDirection),
				contacts = this.contactSummaries(matchedSent, receivedHeaders),
				threads = await this.loadConversationBodies(threadHeaders);
			this.statusMessage(i18n('DESKTOP_AI/ANALYZING_CODEX'));
			const workspace = await window.snappyDesktop.ai.analyze({
				locale: LanguageStore.language(),
				corpus: {
					accountEmail,
					periodMonths: Number(this.periodMonths()),
					totalMatched: matchedHeaders.length,
					contacts,
					threads
				}
			});
				this.applyWorkspace(workspace);
				this.statusMessage(i18n('DESKTOP_AI/ANALYSIS_COMPLETE', {
					CONTACTS: contacts.length,
					THREADS: threads.length,
					SENT: matchedSent.length,
					RECEIVED: receivedHeaders.length
				}));
			this.section('style');
		} catch (error) {
			this.errorMessage(error.message);
		} finally {
			this.analyzing(false);
			this.stopAnalysisTimer();
		}
	}

	selectContact(contact) {
		this.selectedContactId(contact.id);
		this.populateContact(contact);
	}

	selectGroup(group) {
		this.selectedGroupId(group.id);
		this.selectedContactId('');
		this.contactFilter('all');
	}

	selectAllContacts() {
		this.selectedGroupId('');
		this.selectedContactId('');
	}

	groupMemberCount(groupId) {
		return this.contacts().filter(contact => (contact.groupIds || []).includes(groupId)).length;
	}

	populateContact(contact) {
		this.editName(contact.name || '');
		this.editKind(contact.kind || 'other');
		this.editRelationship(contact.relationship || '');
		this.editNotes(contact.notes || '');
		this.editGroupIds([...(contact.groupIds || [])]);
	}

	async saveContact() {
		const id = this.selectedContactId();
		if (!id) return;
		this.busy(true);
		try {
			const workspace = await window.snappyDesktop.ai.updateContact({
				id,
				updates: {
					name: this.editName(),
					kind: this.editKind(),
					relationship: this.editRelationship(),
					notes: this.editNotes(),
					groupIds: this.editGroupIds()
				}
			});
			this.applyWorkspace(workspace);
		} catch (error) {
			this.errorMessage(error.message);
		} finally {
			this.busy(false);
		}
	}

	async addGroup() {
		const name = this.newGroupName().trim();
		if (!name) return;
		try {
			const workspace = await window.snappyDesktop.ai.addGroup(name);
			this.newGroupName('');
			this.applyWorkspace(workspace);
			const group = this.groups().find(item => item.name.toLowerCase() === name.toLowerCase());
			if (group) this.selectGroup(group);
		} catch (error) {
			this.errorMessage(error.message);
		}
	}

	contactKindLabel(kind) {
		return i18n(`DESKTOP_AI/KIND_${String(kind).toUpperCase()}`);
	}

	confidenceLabel(confidence) {
		return i18n(`DESKTOP_AI/CONFIDENCE_${String(confidence || 'low').toUpperCase()}`);
	}

	hasStyleEvidence(evidence = {}) {
		return ['tones', 'recurringWords', 'recurringPhrases', 'greetings', 'closings', 'sentencePatterns', 'examples']
			.some(key => Array.isArray(evidence[key]) && evidence[key].length);
	}

	styleTokens(evidence = {}) {
		return [
			...(evidence.recurringWords || []).map(value => ({ value, phrase: false })),
			...(evidence.recurringPhrases || []).map(value => ({ value, phrase: true }))
		];
	}

	stylePatternSections(evidence = {}) {
		return [
			{ label: i18n('DESKTOP_AI/GREETINGS'), values: evidence.greetings || [] },
			{ label: i18n('DESKTOP_AI/CLOSINGS'), values: evidence.closings || [] },
			{ label: i18n('DESKTOP_AI/SENTENCE_PATTERNS'), values: evidence.sentencePatterns || [] }
		].filter(section => section.values.length);
	}

	groupNames(contact) {
		const ids = new Set(contact.groupIds || []);
		return this.groups().filter(group => ids.has(group.id)).map(group => group.name).join(', ');
	}
}
