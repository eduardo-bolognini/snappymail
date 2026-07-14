import ko from 'ko';

import {
	Notifications,
	UploadErrorCode
} from 'Common/Enums';

import {
	ComposeType,
	FolderType
} from 'Common/EnumsUser';

import { pInt, isArray, arrayLength, b64Encode } from 'Common/Utils';
import { encodeHtml, htmlToPlain } from 'Common/Html';
import { HtmlEditor } from 'Common/HtmlEditor';
import { koArrayWithDestroy, addObservablesTo, addComputablesTo, addSubscribablesTo } from 'External/ko';

import { UNUSED_OPTION_VALUE } from 'Common/Consts';
import { folderInformation } from 'Common/Folders';
import { serverRequest } from 'Common/Links';
import { i18n, getNotification, getUploadErrorDescByCode, timestampToString } from 'Common/Translator';
import { setFolderETag } from 'Common/Cache';
import { SettingsCapa, SettingsGet, elementById, addShortcut, createElement } from 'Common/Globals';
//import { exitFullscreen, isFullscreen, toggleFullscreen } from 'Common/Fullscreen';

import { AppUserStore } from 'Stores/User/App';
import { SettingsUserStore } from 'Stores/User/Settings';
import { IdentityUserStore, SenderIdentityUserStore } from 'Stores/User/Identity';
import { AccountUserStore } from 'Stores/User/Account';
import { FolderUserStore } from 'Stores/User/Folder';
import { LanguageStore } from 'Stores/Language';

import { PgpUserStore } from 'Stores/User/Pgp';
import { OpenPGPUserStore } from 'Stores/User/OpenPGP';
import { GnuPGUserStore } from 'Stores/User/GnuPG';
import { MailvelopeUserStore } from 'Stores/User/Mailvelope';
//import { OpenPgpImportPopupView } from 'View/Popup/OpenPgpImport';
import { SMimeUserStore } from 'Stores/User/SMime';
import { Passphrases } from 'Storage/Passphrases';

import { MessageUserStore } from 'Stores/User/Message';
import { MessagelistUserStore } from 'Stores/User/Messagelist';

import Remote from 'Remote/User/Fetch';

import { ComposeAttachmentModel } from 'Model/ComposeAttachment';
import { EmailModel } from 'Model/Email';
import { IdentityModel } from 'Model/Identity';
import { MessageModel } from 'Model/Message';
import { MimeHeaderAutocryptModel } from 'Model/MimeHeaderAutocrypt';
import { addressparser } from 'Mime/Address';

import { decorateKoCommands, showScreenPopup } from 'Knoin/Knoin';
import { AbstractViewPopup } from 'Knoin/AbstractViews';

import { FolderSystemPopupView } from 'View/Popup/FolderSystem';
import { AskPopupView } from 'View/Popup/Ask';
import { ContactsPopupView } from 'View/Popup/Contacts';

/*
import { ThemeStore } from 'Stores/Theme';

let alreadyFullscreen;
*/
let oLastMessage;

const
	ScopeCompose = 'Compose',
	AiPendingComposeKey = 'snappymail-ai-pending-compose',

	tpl = createElement('template'),

	aiComposeType = mode => ({
		new: ComposeType.Empty,
		reply: ComposeType.Reply,
		replyAll: ComposeType.ReplyAll,
		forward: ComposeType.Forward
	}[mode] || ComposeType.Empty),

	aiSourceMessage = source => source
		&& String(source.account || '').trim()
		&& String(source.folder || '').trim()
		&& 0 < Number(source.uid)
		? {
			account: String(source.account).trim(),
			folder: String(source.folder).trim(),
			uid: Number(source.uid)
		}
		: null,

	base64_encode = text => text ? b64Encode(text).match(/.{1,76}/g).join('\r\n') : '',

	getEmail = value => addressparser(value)[0]?.email || false,
	looksLikeEmailAddress = value => /^(?:[^<>]+<)?[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?$/.test(String(value || '').trim()),

	draftAddressLine = list => (list || []).filter(item => item?.email).map(item =>
		(new EmailModel(String(item.email), String(item.name || ''))).toLine()
	).join(', '),

	fileFromBase64 = (data, name) => {
		const binary = atob(data), bytes = new Uint8Array(binary.length);
		for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
		return new File([bytes], name);
	},

	/**
	 * @param {Array} aList
	 * @param {boolean} bFriendly
	 * @returns {string}
	 */
	emailArrayToStringLineHelper = (aList, bFriendly) =>
		aList.filter(item => item.email).map(item => item.toLine(bFriendly)).join(', '),

	reloadDraftFolder = () => {
		const draftsFolder = FolderUserStore.draftsFolder();
		if (draftsFolder && UNUSED_OPTION_VALUE !== draftsFolder) {
			setFolderETag(draftsFolder, '');
			if (FolderUserStore.currentFolderFullName() === draftsFolder) {
				MessagelistUserStore.reload(true);
			} else {
				folderInformation(draftsFolder);
			}
		}
	},

	findIdentity = (addresses, accountEmail = '') => {
		addresses = addresses.map(item => item.email);
		const account = String(accountEmail || '').toLowerCase();
		return SenderIdentityUserStore.find(item =>
			(!account || String(item.accountEmail || '').toLowerCase() === account)
			&& addresses.includes(item.email)
		);
	},

	/**
	 * @param {Function} fKoValue
	 * @param {Array} emails
	 */
	addEmailsTo = (fKoValue, emails) => {
		if (arrayLength(emails)) {
			const value = fKoValue().trim(),
				values = emails.map(item => item ? item.toLine() : null)
					.validUnique();

			fKoValue(value + (value ? ', ' :  '') + values.join(', ').trim());
		}
	},

	isPlainEditor = () => 'Plain' === SettingsUserStore.editorDefaultType(),

	/**
	 * @param {string} prefix
	 * @param {string} subject
	 * @returns {string}
	 */
	replySubjectAdd = (prefix, subject) => {
		prefix = prefix.toUpperCase().trim();
		subject = subject.replace(/\s+/g, ' ').trim();

		let drop = false,
			re = 'RE' === prefix,
			fwd = 'FWD' === prefix;

		const parts = [],
			prefixIsRe = !fwd;

		if (subject) {
			subject.split(':').forEach(part => {
				const trimmedPart = part.trim();
				if (!drop && (/^(RE|FWD)$/i.test(trimmedPart) || /^(RE|FWD)[[(][\d]+[\])]$/i.test(trimmedPart))) {
					if (!re) {
						re = !!/^RE/i.test(trimmedPart);
					}

					if (!fwd) {
						fwd = !!/^FWD/i.test(trimmedPart);
					}
				} else {
					parts.push(part);
					drop = true;
				}
			});
		}

		if (prefixIsRe) {
			re = false;
		} else {
			fwd = false;
		}

		return ((prefixIsRe ? 'Re: ' : 'Fwd: ') + (re ? 'Re: ' : '')
			+ (fwd ? 'Fwd: ' : '') + parts.join(':').trim()).trim();
	};

ko.extenders.toggleSubscribe = (target, options) => {
	target.subscribe(options[1], options[0], 'beforeChange');
	target.subscribe(options[2], options[0]);
	return target;
};

class MimePart {
	constructor() {
		this.headers = {};
		this.body = '';
		this.boundary = '';
		this.children = [];
	}

	toString() {
		const hasSub = this.children.length,
			boundary = this.boundary || (this.boundary = 'part' + Jua.randomId()),
			headers = this.headers;
		if (hasSub && !headers['Content-Type'].includes(boundary)) {
			headers['Content-Type'] += `; boundary="${boundary}"`;
		}
		let result = Object.entries(headers).map(([key, value]) => `${key}: ${value}`).join('\r\n') + '\r\n';
		if (this.body) {
			result += '\r\n' + this.body.replace(/\r?\n/g, '\r\n');
		}
		if (hasSub) {
			this.children.forEach(part => result += '\r\n--' + boundary + '\r\n' + part);
			result += '\r\n--' + boundary + '--\r\n';
		}
		return result;
	}
}

function loadAiSourceMessage(source) {
	source = aiSourceMessage(source);
	if (!source) return Promise.reject(new Error(i18n('COMPOSE/AI_SOURCE_MESSAGE_ERROR')));
	return new Promise((resolve, reject) => {
		Remote.request('AiGetMessage', (error, data) => {
			const message = !error && MessageModel.reviveFromJson(data?.Result);
			if (message) {
				resolve(message);
			} else {
				reject(new Error(data?.messageAdditional || data?.message
					|| (error ? getNotification(error) : i18n('COMPOSE/AI_SOURCE_MESSAGE_ERROR'))));
			}
		}, source, 120000);
	});
}

export class ComposePopupView extends AbstractViewPopup {
	static restorePendingAiCompose() {
		let pending;
		try {
			pending = JSON.parse(sessionStorage.getItem(AiPendingComposeKey) || 'null');
		} catch {
			sessionStorage.removeItem(AiPendingComposeKey);
			return false;
		}
		const source = aiSourceMessage(pending?.draft?.sourceMessage);
		if (!source || source.account.toLowerCase() !== AccountUserStore.email().toLowerCase()) return false;
		loadAiSourceMessage(source).then(message => {
			sessionStorage.removeItem(AiPendingComposeKey);
			rl.app.showMessageComposer([
				aiComposeType(pending.draft.mode),
				message,
				null,
				null,
				null,
				null,
				null,
				{
					restoreDraft: pending.draft,
					restoreChat: pending.chatMessages,
					restoreMessage: pending.responseMessage
				}
			]);
		}).catch(error => {
			sessionStorage.removeItem(AiPendingComposeKey);
			console.error(error);
		});
		return true;
	}

	constructor() {
		super('Compose');

		const fEmailOutInHelper = (context, identity, name, isIn) => {
			const identityEmail = context && identity?.[name]();
			if (identityEmail && (isIn ? true : context[name]())) {
				let list = context[name]().trim().split(',');

				list = list.filter(email => {
					email = email.trim();
					return email && identityEmail.trim() !== email;
				});

				isIn && list.push(identityEmail);

				context[name](list.join(','));
			}
		};

		this.oEditor = null;

		this.sLastFocusedField = 'to';

		this.allowContacts = AppUserStore.allowContacts();
		this.allowIdentities = SettingsCapa('Identities');
		this.allowSpellcheck = SettingsUserStore.allowSpellcheck;

		addObservablesTo(this, {
			// bootstrap dropdown
			identitiesMenu: null,

			from: '',
			to: '',
			cc: '',
			bcc: '',
			replyTo: '',

			subject: '',

			isHtml: false,

			requestDsn: false,
			requestReadReceipt: false,
			requireTLS: false,
			markAsImportant: false,

			sendError: false,
			sendSuccessButSaveError: false,
			savedError: false,

			sendErrorDesc: '',
			savedErrorDesc: '',

			savedTime: 0,

			emptyToError: false,

			attachmentsInProcessError: false,
			attachmentsInErrorError: false,

			showCc: false,
			showBcc: false,
			showReplyTo: false,

			doSign: false,
			doEncrypt: false,

			draftsFolder: '',
			draftUid: 0,
			sending: false,
			saving: false,
			preSendActive: false,
			preSendSeconds: 0,
			preSendAlert: null,
			minimized: false,

			viewArea: 'body',

			attacheMultipleAllowed: false,
			addAttachmentEnabled: false,

			editorArea: null, // initDom
			aiCommandInput: null,
			aiChatInputDom: null,
			aiChatMessagesDom: null,
			aiInstruction: '',
			aiBusy: false,
			aiError: '',
			aiSummary: '',
			aiSendWithoutConfirmation: false,
			aiJustApplied: false,
			aiDelegationMode: false,
			aiChatInput: '',
			aiChatBusy: false,
			aiChatActivity: '',
			aiChatElapsedSeconds: 0,
			aiChatRequestId: '',
			senderAccount: AccountUserStore.email(),
			senderManuallySelected: false,

			currentIdentity: SenderIdentityUserStore()[0] || IdentityUserStore()[0]
		});
		this.aiChatMessages = ko.observableArray([]);

		// Used by ko.bindingHandlers.emailsTags
		['to','cc','bcc'].forEach(name => {
			this[name].focused = ko.observable(false);
			this[name].focused.subscribe(value => value && (this.sLastFocusedField = name));
		});

		this.attachments = koArrayWithDestroy();
		this.encryptOptions = koArrayWithDestroy();
		this.signOptions = koArrayWithDestroy();

		this.dragAndDropOver = ko.observable(false).extend({ debounce: 1 });
		this.dragAndDropVisible = ko.observable(false).extend({ debounce: 1 });

		this.currentIdentity.extend({
			toggleSubscribe: [
				this,
				(identity) => {
					fEmailOutInHelper(this, identity, 'bcc');
					fEmailOutInHelper(this, identity, 'replyTo');
				},
				(identity) => {
					fEmailOutInHelper(this, identity, 'bcc', true);
					fEmailOutInHelper(this, identity, 'replyTo', true);
				}
			]
		});

		this.doClose = this.doClose.debounce(200);

		this.iTimer = 0;
		this.aiChatTimer = 0;
		this.preSendTimer = 0;
		this.preSendRequestId = 0;
		this.preSendReviewPassed = false;
		this.preSendFingerprint = '';
		this.minimizedDock = null;
		this.aiComposeType = ComposeType.Empty;
		this.aiQuotedHtml = '';
		this.toAiCommand = command => this.aiRecipientCommand('to', command);
		this.ccAiCommand = command => this.aiRecipientCommand('cc', command);
		this.bccAiCommand = command => this.aiRecipientCommand('bcc', command);

		addComputablesTo(this, {
			aiCanRun: () => !this.aiBusy() && Boolean(this.aiInstruction().trim()),
			aiChatCanSend: () => !this.aiChatBusy() && Boolean(this.aiChatInput().trim()),
			aiChatElapsedText: () => {
				const seconds = this.aiChatElapsedSeconds();
				return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
			},
			aiCommandPlaceholder: () => [ComposeType.Reply, ComposeType.ReplyAll, ComposeType.Forward]
				.includes(this.aiComposeType)
				? i18n('COMPOSE/AI_REPLY_PLACEHOLDER')
				: i18n('COMPOSE/AI_COMMAND_PLACEHOLDER'),
			preSendLabel: () => 0 < this.preSendSeconds()
				? i18n('COMPOSE/AI_PRE_SEND_COUNTDOWN', { COUNT: this.preSendSeconds() })
				: i18n('COMPOSE/AI_PRE_SEND_CHECKING'),
			sendButtonSuccess: () => !this.sendError() && !this.sendSuccessButSaveError(),

			savedTimeText: () =>
				this.savedTime() ? i18n('COMPOSE/SAVED_TIME', { TIME: this.savedTime().format('LT') }) : '',

			emptyToErrorTooltip: () => (this.emptyToError() ? i18n('COMPOSE/EMPTY_TO_ERROR_DESC') : ''),

			attachmentsErrorTooltip: () => {
				let result = '';
				switch (true) {
					case this.attachmentsInProcessError():
						result = i18n('COMPOSE/ATTACHMENTS_UPLOAD_ERROR_DESC');
						break;
					case this.attachmentsInErrorError():
						result = i18n('COMPOSE/ATTACHMENTS_ERROR_DESC');
						break;
					// no default
				}
				return result;
			},

			attachmentsInProcess: () => this.attachments.filter(item => item && !item.complete()),
			attachmentsInError: () => this.attachments.filter(item => item?.error()),

			attachmentsCount: () => this.attachments().length,
			attachmentsInErrorCount: () => this.attachmentsInError.length,
			attachmentsInProcessCount: () => this.attachmentsInProcess.length,
			isDraft: () => this.draftsFolder() && this.draftUid(),

			canEncrypt: () => this.encryptOptions().length,
			canMailvelope: () => this.encryptOptions.includes('Mailvelope'),
			canSign: () => this.signOptions().length,

			encryptOptionsText: () => this.encryptOptions().join(', '),
			signOptionsText: () => this.signOptions().map(o => o[0]).join(', '),

			identitiesOptions: () =>
				SenderIdentityUserStore.map(item => ({
					item: item,
					optValue: `${item.accountEmail}:${item.id()}`,
					optText: `${item.toString()} · ${item.accountName || item.accountEmail}`
				})),
			senderAccountLabel: () => {
				const identity = this.currentIdentity();
				return identity?.accountName || identity?.accountEmail || this.senderAccount();
			},

			canBeSentOrSaved: () => !this.sending() && !this.saving() && !this.preSendActive()
		});

		addSubscribablesTo(this, {
			sendError: value => !value && this.sendErrorDesc(''),

			savedError: value => !value && this.savedErrorDesc(''),

			sendSuccessButSaveError: value => !value && this.savedErrorDesc(''),

			currentIdentity: value => {
				if (value) {
					this.senderAccount(value.accountEmail || AccountUserStore.email());
					this.from(value.toString());
					this.doEncrypt(value.pgpEncrypt() || SettingsUserStore.pgpEncrypt());
					this.doSign(value.pgpSign() || SettingsUserStore.pgpSign());
				}
			},

			from: () => {
				this.initSign();
				this.initEncrypt();
			},

			cc: value => {
				if (false === this.showCc() && value.length) {
					this.showCc(true);
				}
				this.initEncrypt();
			},

			bcc: value => {
				if (false === this.showBcc() && value.length) {
					this.showBcc(true);
				}
				this.initEncrypt();
			},

			replyTo: value => {
				if (false === this.showReplyTo() && value.length) {
					this.showReplyTo(true);
				}
			},

			attachmentsInErrorCount: value => {
				if (0 === value) {
					this.attachmentsInErrorError(false);
				}
			},

			to: value => {
				if (this.emptyToError() && value.length) {
					this.emptyToError(false);
				}
				this.initEncrypt();
			},

			attachmentsInProcess: value => {
				if (this.attachmentsInProcessError() && arrayLength(value)) {
					this.attachmentsInProcessError(false);
				}
			},

			viewArea: value => {
				if (!this.mailvelope && 'mailvelope' == value) {
					/**
					 * Creates an iframe with an editor for a new encrypted mail.
					 * The iframe will be injected into the container identified by selector.
					 * https://mailvelope.github.io/mailvelope/Editor.html
					 */
					let armored = oLastMessage && oLastMessage.body.classList.contains('mailvelope'),
						text = armored ? oLastMessage.plain() : this.oEditor.getData(),
						draft = this.isDraft(),
						encrypted = PgpUserStore.isEncrypted(text),
						size = SettingsGet('phpUploadSizes')['post_max_size'],
						quota = pInt(size);
					switch (size.slice(-1)) {
						case 'G': quota *= 1024; // fallthrough
						case 'M': quota *= 1024; // fallthrough
						case 'K': quota *= 1024;
					}
					// Issue: can't select signing key
//					this.doSign(this.doSign() || confirm('Sign this message?'));
					mailvelope.createEditorContainer('#mailvelope-editor', PgpUserStore.mailvelopeKeyring, {
						// https://mailvelope.github.io/mailvelope/global.html#EditorContainerOptions
						quota: Math.max(2048, (quota / 1024)) - 48, // (text + attachments) limit in kilobytes
						armoredDraft: (encrypted && draft) ? text : '', // Ascii Armored PGP Text Block
						predefinedText: encrypted ? '' : (this.oEditor.isHtml() ? htmlToPlain(text) : text),
						quotedMail: (encrypted && !draft) ? text : '', // Ascii Armored PGP Text Block mail that should be quoted
/*
						quotedMailIndent: true, // if true the quoted mail will be indented (default: true)
						quotedMailHeader: '', // header to be added before the quoted mail
						keepAttachments: false, // add attachments of quotedMail to editor (default: false)
						// Issue: can't select signing key
						signMsg: this.doSign()
*/
					}).then(editor => this.mailvelope = editor);
				}
			}
		});

		decorateKoCommands(this, {
			sendCommand: self => self.canBeSentOrSaved(),
			saveCommand: self => self.canBeSentOrSaved(),
			deleteCommand: self => self.isDraft(),
			skipCommand: self => self.canBeSentOrSaved(),
			contactsCommand: self => self.allowContacts
		});

		this.from(IdentityUserStore()[0].toString());
	}

	sentFolder()
	{
		let sSentFolder = this.currentIdentity()?.sentFolder?.() || FolderUserStore.sentFolder();
		if (SettingsUserStore.replySameFolder()) {
			if (
				3 === arrayLength(this.aDraftInfo) &&
				this.aDraftInfo[2]?.length
			) {
				sSentFolder = this.aDraftInfo[2];
			}
		}
		return UNUSED_OPTION_VALUE === sSentFolder ? null : sSentFolder;
	}

	validateSend() {
		this.attachmentsInProcessError(false);
		this.attachmentsInErrorError(false);
		this.emptyToError(false);

		if (this.attachmentsInProcess().length) {
			this.attachmentsInProcessError(true);
			this.attachmentsArea();
		} else if (this.attachmentsInError().length) {
			this.attachmentsInErrorError(true);
			this.attachmentsArea();
		}

		if (!this.to().trim() && !this.cc().trim() && !this.bcc().trim()) {
			this.emptyToError(true);
		}

		return !this.emptyToError() && !this.attachmentsInErrorError() && !this.attachmentsInProcessError();
	}

	preSendContext() {
		return {
			...this.aiContext(),
			attachments: this.attachments()
				.filter(item => item?.complete?.() && item?.enabled?.())
				.map(item => ({
					name: String(item.fileName?.() || ''),
					type: String(item.mimeType?.() || ''),
					size: Number(item.size?.() || 0)
				}))
		};
	}

	preSendDraftFingerprint() {
		return JSON.stringify(this.preSendContext());
	}

	cancelPreSend(clearAlert = true) {
		clearInterval(this.preSendTimer);
		this.preSendTimer = 0;
		this.preSendRequestId += 1;
		this.preSendReviewPassed = false;
		this.preSendFingerprint = '';
		this.preSendActive(false);
		this.preSendSeconds(0);
		if (clearAlert) this.preSendAlert(null);
	}

	dismissPreSendAlert() {
		this.preSendAlert(null);
	}

	retryPreSendReview() {
		this.preSendAlert(null);
		this.sendCommand();
	}

	forceSendAfterReview() {
		this.cancelPreSend();
		this.sendNow();
	}

	finishPreSendReview(requestId) {
		if (!this.preSendActive() || requestId !== this.preSendRequestId
			|| !this.preSendReviewPassed || 0 < this.preSendSeconds()) return;
		if (this.preSendFingerprint !== this.preSendDraftFingerprint()) {
			this.cancelPreSend(false);
			this.preSendAlert({
				type: 'changed',
				title: i18n('COMPOSE/AI_PRE_SEND_CHANGED_TITLE'),
				summary: i18n('COMPOSE/AI_PRE_SEND_CHANGED'),
				issues: []
			});
			return;
		}
		this.cancelPreSend(false);
		this.preSendAlert(null);
		this.sendNow();
	}

	startPreSendReview() {
		this.cancelPreSend();
		this.preSendActive(true);
		this.preSendSeconds(5);
		this.preSendFingerprint = this.preSendDraftFingerprint();
		const requestId = ++this.preSendRequestId;
		this.preSendTimer = setInterval(() => {
			if (requestId !== this.preSendRequestId) return;
			this.preSendSeconds(Math.max(0, this.preSendSeconds() - 1));
			if (0 === this.preSendSeconds()) {
				clearInterval(this.preSendTimer);
				this.preSendTimer = 0;
				this.finishPreSendReview(requestId);
			}
		}, 1000);

		Promise.resolve().then(() => {
			if (!window.snappyDesktop?.ai?.reviewBeforeSend) throw new Error('Pre-send review is unavailable');
			return window.snappyDesktop.ai.reviewBeforeSend({
				context: this.preSendContext(),
				locale: LanguageStore.language()
			});
		}).then(result => {
			if (!this.preSendActive() || requestId !== this.preSendRequestId) return;
			if (true !== result?.safeToSend) {
				const issues = (Array.isArray(result?.issues) ? result.issues : []).slice(0, 3).map(issue => ({
					field: String(issue?.field || 'other'),
					title: String(issue?.title || ''),
					detail: String(issue?.detail || '')
				}));
				this.cancelPreSend(false);
				this.preSendAlert({
					type: 'issue',
					title: i18n('COMPOSE/AI_PRE_SEND_ALERT_TITLE'),
					summary: String(result?.summary || i18n('COMPOSE/AI_PRE_SEND_ALERT_SUMMARY')),
					issues
				});
				return;
			}
			this.preSendReviewPassed = true;
			this.finishPreSendReview(requestId);
		}).catch(error => {
			if (!this.preSendActive() || requestId !== this.preSendRequestId) return;
			console.warn('Codex pre-send review failed', error);
			this.cancelPreSend(false);
			this.preSendAlert({
				type: 'error',
				title: i18n('COMPOSE/AI_PRE_SEND_ERROR_TITLE'),
				summary: i18n('COMPOSE/AI_PRE_SEND_ERROR'),
				issues: []
			});
		});
	}

	sendCommand() {
		if (!this.validateSend()) return;
		if ('' === this.sentFolder()) {
			showScreenPopup(FolderSystemPopupView, [FolderType.Sent]);
			return;
		}
		this.startPreSendReview();
	}

	sendNow() {
		if (!this.validateSend()) return;

		if (!this.emptyToError() && !this.attachmentsInErrorError() && !this.attachmentsInProcessError()) {
			const sSentFolder = this.sentFolder();
			if ('' === sSentFolder) {
				showScreenPopup(FolderSystemPopupView, [FolderType.Sent]);
			} else {
				const sendError = e => {
					console.error(e);
					this.sendError(true);
					this.sendErrorDesc(e);
					this.sending(false);
				};
				const sendFailed = (iError, data) => {
					this.sendError(true);
					this.sendErrorDesc(
						getNotification(iError, data?.message, Notifications.CantSendMessage)
						+ "\n" + (data?.messageAdditional || data?.message)
					);
				};
				try {
					this.sendError(false);
					this.sending(true);

					const sendMessage = params => {
						const recipientMap = new Map;
						[params.to, params.cc, params.bcc].filter(Boolean).forEach(value => {
							addressparser(value).forEach(item => {
								const email = String(item.email || '').trim().toLowerCase();
								if (email && !recipientMap.has(email)) {
									recipientMap.set(email, { email, name: String(item.name || '').trim() });
								}
							});
						});
						const aiObservation = {
							accountEmail: this.senderAccount(),
							recipients: [...recipientMap.values()],
							subject: params.subject || '',
							body: params.plain || htmlToPlain(this.oEditor.getData() || ''),
							sentAt: new Date().toISOString()
						};
						Remote.request('SendMessage',
							(iError, data) => {
								this.sending(false);
								if (iError) {
/*
									if (Notifications.AuthError === iError && !params.auth) {
										AskPopupView.password('SMTP login', 'retry', 3).then(result => {
											if (result) {
												this.sending(true);
												params.auth = result;
												sendMessage(params);
											} else {
												sendFailed(iError, data);
											}
										});
									} else
*/
									if (Notifications.CantSaveMessage === iError) {
										this.sendSuccessButSaveError(true);
										let msg = i18n('COMPOSE/SAVED_ERROR_ON_SEND');
										if (data?.messageAdditional) {
											msg = msg + "\n" + data?.messageAdditional;
										}
										this.savedErrorDesc(msg);
									} else {
										this.sendError(true);
										sendFailed(iError, data);
										// Remove remembered passphrase as it could be wrong
										let key = ('S/MIME' === params.sign) ? this.currentIdentity() : null;
										params.signFingerprint
										&& this.signOptions.forEach(option => ('GnuPG' === option[0]) && (key = option[1]));
										key && Passphrases.delete(key);
									}
								} else {
									window.snappyDesktop?.ai.observeSent({
										locale: LanguageStore.language(),
										message: aiObservation
									}).catch(error => console.warn('Codex contact observation failed', error));
									if (arrayLength(this.aDraftInfo) > 0) {
										const flag = {
											'reply': '\\answered',
											'forward': '$forwarded'
										}[this.aDraftInfo[0]];
										if (flag) {
											const aFlags = oLastMessage.flags();
											if (aFlags.indexOf(flag) === -1) {
												aFlags.push(flag);
												oLastMessage.flags(aFlags);
											}
										}
									}
									this.close();
								}
								setFolderETag(this.draftsFolder(), '');
								setFolderETag(params.saveFolder, '');
								if (3 === arrayLength(this.aDraftInfo)) {
									setFolderETag(this.aDraftInfo[2], '');
								}
								reloadDraftFolder();
							},
							params,
							30000
						);
					};

					this.getMessageRequestParams(sSentFolder)
					.then(sendMessage)
					.catch(sendError);
				} catch (e) {
					sendError(e);
				}
			}
		}
	}

	saveCommand() {
		if (!this.saving() && !this.sending()) {
			if (FolderUserStore.draftsFolderNotEnabled()) {
				showScreenPopup(FolderSystemPopupView, [FolderType.Drafts]);
			} else {
				this.savedError(false);
				this.saving(true);
				this.autosaveStart();
				this.getMessageRequestParams(FolderUserStore.draftsFolder(), 1).then(params => {
					Remote.request('SaveMessage',
						(iError, oData) => {
							let result = false;

							this.saving(false);

							if (!iError) {
								if (oData.Result.folder && oData.Result.uid) {
									result = true;

									if (this.bFromDraft) {
										const message = MessageUserStore.message();
										if (message && this.draftsFolder() === message.folder && this.draftUid() == message.uid) {
											MessageUserStore.message(null);
										}
									}

									this.draftsFolder(oData.Result.folder);
									this.draftUid(oData.Result.uid);

									this.savedTime(new Date);

									if (this.bFromDraft) {
										setFolderETag(this.draftsFolder(), '');
									}
									setFolderETag(FolderUserStore.draftsFolder(), '');
								}
							}

							if (!result) {
								this.savedError(true);
								this.savedErrorDesc(getNotification(Notifications.CantSaveMessage));
							}

							reloadDraftFolder();
						},
						params,
						200000
					);
				}).catch(e => {
					this.saving(false);
					this.savedError(true);
					this.savedErrorDesc(getNotification(Notifications.CantSaveMessage) + ': ' + e);
				});
			}
		}
	}

	deleteCommand() {
		AskPopupView.hidden()
		&& showScreenPopup(AskPopupView, [
			i18n('POPUPS_ASK/DESC_WANT_DELETE_MESSAGES'),
			() => {
				const
					sFromFolderFullName = this.draftsFolder(),
					oUids = new Set([this.draftUid()]);
				MessagelistUserStore.moveMessages(sFromFolderFullName, oUids);
				this.close();
			}
		]);
	}

	onClose() {
		this.skipCommand();
		return false;
	}

	skipCommand() {
		ComposePopupView.inEdit(true);

		if (!FolderUserStore.draftsFolderNotEnabled() && SettingsUserStore.allowDraftAutosave()) {
			this.saveCommand();
		}

		this.doClose();
	}

	minimizeCommand() {
		if (!this.canBeSentOrSaved()) return;
		ComposePopupView.inEdit(true);
		this.minimized(true);
		if (!FolderUserStore.draftsFolderNotEnabled() && SettingsUserStore.allowDraftAutosave()) {
			this.saveCommand();
		}
		this.close();
	}

	restoreMinimized() {
		if (!this.minimized()) return;
		this.minimized(false);
		showScreenPopup(ComposePopupView);
	}

	buildMinimizedDock() {
		if (this.minimizedDock) return;
		const dock = createElement('button', {
			class: 'compose-minimized-dock',
			type: 'button'
		});
		dock.hidden = true;
		dock.innerHTML = '<span class="compose-minimized-icon g-icon g-icon--envelope" aria-hidden="true"></span>'
			+ '<span class="compose-minimized-copy"><strong></strong><small></small></span>'
			+ '<span class="compose-minimized-restore g-icon g-icon--chevron-up" aria-hidden="true"></span>';
		dock.title = i18n('ACCESSIBILITY/LABEL_OPEN_COMPOSE_POPUP');
		dock.setAttribute('aria-label', dock.title);
		dock.addEventListener('click', () => this.restoreMinimized());
		document.body.append(dock);
		this.minimizedDock = dock;

		const update = () => {
			dock.hidden = !this.minimized();
			dock.querySelector('strong').textContent = this.subject().trim()
				|| i18n('FOLDER_LIST/BUTTON_NEW_MESSAGE');
			dock.querySelector('small').textContent = this.to().trim()
				|| i18n('COMPOSE/EMPTY_TO_ERROR_DESC');
		};
		[this.minimized, this.subject, this.to].forEach(observable => observable.subscribe(update));
		update();
	}

	contactsCommand() {
		if (this.allowContacts) {
			this.skipCommand();
			setTimeout(() => {
				showScreenPopup(ContactsPopupView, [true, this.sLastFocusedField]);
			}, 200);
		}
	}

	autosaveStart() {
		clearTimeout(this.iTimer);
		this.iTimer = setTimeout(()=>{
			if (this.modalVisible()
				&& !FolderUserStore.draftsFolderNotEnabled()
				&& SettingsUserStore.allowDraftAutosave()
				&& !this.isEmptyForm(false)
				&& !this.savedError()
			) {
				this.saveCommand();
			}

			this.autosaveStart();
		}, 60000);
	}

	// getAutocomplete
	emailsSource(value, fResponse) {
		const cleanValue = String(value || '').trim(),
			codexFallback = () => ({
				value: `/${cleanValue.replace(/^\/+/, '')}`,
				label: i18n('COMPOSE/AI_RECIPIENT_CODEX'),
				command: cleanValue
			});
		if (cleanValue.startsWith('/')) {
			fResponse([codexFallback()]);
			return;
		}
		const snappyContacts = new Promise(resolve => {
			Remote.abort('Suggestions').request('Suggestions',
				(iError, data) => resolve(!iError && isArray(data.Result) ? data.Result : []),
				{ Query: value }
			);
		}),
			aiDirectory = window.snappyDesktop?.ai?.recipientSuggestions
				? window.snappyDesktop.ai.recipientSuggestions(value).catch(() => [])
				: Promise.resolve([]);

		Promise.all([snappyContacts, aiDirectory]).then(([contacts, directory]) => {
			const suggestions = [],
				seenEmails = new Set,
				addContact = (email, name, label = '') => {
					email = String(email || '').trim();
					const key = email.toLowerCase();
					if (!email || seenEmails.has(key)) return;
					seenEmails.add(key);
					const line = (new EmailModel(email, String(name || ''))).toLine();
					suggestions.push({ value: line, insertValue: line, label: String(label || '') });
				};

			(directory || []).filter(item => 'group' === item.type).forEach(group => {
				const addresses = [], groupEmails = new Set;
				(group.members || []).forEach(member => {
					const email = String(member?.email || '').trim(), key = email.toLowerCase();
					if (!email || groupEmails.has(key)) return;
					groupEmails.add(key);
					addresses.push((new EmailModel(email, String(member.name || ''))).toLine());
				});
				if (addresses.length) suggestions.push({
					value: i18n('COMPOSE/AI_RECIPIENT_GROUP', { NAME: group.name }),
					label: i18n('COMPOSE/AI_RECIPIENT_GROUP_MEMBERS', { COUNT: addresses.length }),
					addresses
				});
			});

			(directory || []).filter(item => 'contact' === item.type).forEach(contact =>
				addContact(contact.email, contact.name, contact.organization)
			);
			contacts.forEach(contact => contact?.[0] && addContact(contact[0], contact[1]));
			if (!suggestions.length && !looksLikeEmailAddress(cleanValue)) suggestions.push(codexFallback());
			fResponse(suggestions.slice(0, 30));
		});
	}

	selectIdentity(identity) {
		identity = identity?.item;
		if (identity) {
			this.senderManuallySelected(true);
			this.currentIdentity(identity);
			this.setSignature(identity);
		}
	}

	focusAiCommand() {
		setTimeout(() => this.aiChatInputDom()?.focus(), 0);
	}

	aiChatKeydown(_view, event) {
		if ('Enter' === event.key && !event.shiftKey) {
			event.preventDefault();
			this.sendAiChat();
			return false;
		}
		return true;
	}

	aiChatMessage(role, text, system = false) {
		return {
			id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
			role,
			text: String(text || ''),
			system,
			time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
		};
	}

	resetAiChat() {
		clearInterval(this.aiChatTimer);
		this.aiChatTimer = 0;
		this.aiChatInput('');
		this.aiChatBusy(false);
		this.aiChatActivity('');
		this.aiChatElapsedSeconds(0);
		this.aiChatRequestId('');
		this.aiChatMessages([
			this.aiChatMessage('assistant', i18n('COMPOSE/AI_CHAT_WELCOME'), true)
		]);
	}

	scrollAiChat() {
		setTimeout(() => {
			const dom = this.aiChatMessagesDom();
			if (dom) dom.scrollTop = dom.scrollHeight;
		}, 0);
	}

	aiChatActivityLabel(activity = {}) {
		const type = String(activity.itemType || '').toLowerCase(),
			tool = String(activity.toolName || '').toLowerCase();
		if (tool.includes('get_thread')) return i18n('COMPOSE/AI_CHAT_ACTIVITY_THREAD');
		if (tool.includes('search_conversations') || tool.includes('list_mailboxes')) {
			return i18n('COMPOSE/AI_CHAT_ACTIVITY_MAIL');
		}
		if (tool.includes('contact') || tool.includes('recipient')) return i18n('COMPOSE/AI_CHAT_ACTIVITY_CONTACTS');
		if (tool.includes('attachment')) return i18n('COMPOSE/AI_CHAT_ACTIVITY_ATTACHMENTS');
		if (type.includes('mcp')) return i18n('COMPOSE/AI_CHAT_ACTIVITY_CONTEXT');
		if (type.includes('agentmessage')) return i18n('COMPOSE/AI_CHAT_ACTIVITY_DRAFT');
		return i18n('COMPOSE/AI_CHAT_ACTIVITY_REASONING');
	}

	async sendAiChat(initialInstruction = '') {
		const instruction = String(initialInstruction || this.aiChatInput()).trim();
		if (!instruction || this.aiChatBusy()) return;
		if (!window.snappyDesktop?.ai?.composeChat) {
			this.aiError(i18n('COMPOSE/AI_DESKTOP_REQUIRED'));
			return;
		}
		const history = this.aiChatMessages()
			.filter(item => !item.system)
			.map(item => ({ role: item.role, text: item.text }));
		this.aiChatMessages.push(this.aiChatMessage('user', instruction));
		this.aiChatInput('');
		this.aiChatBusy(true);
		this.aiError('');
		this.aiSummary('');
		this.aiChatActivity(i18n('COMPOSE/AI_CHAT_ACTIVITY_REASONING'));
		this.aiChatElapsedSeconds(0);
		const requestId = window.crypto?.randomUUID?.()
			|| `${Date.now()}-${Math.random().toString(36).slice(2)}`,
			startedAt = Date.now();
		this.aiChatRequestId(requestId);
		clearInterval(this.aiChatTimer);
		this.aiChatTimer = setInterval(() => {
			this.aiChatElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
		}, 1000);
		this.scrollAiChat();
		try {
			const response = await window.snappyDesktop.ai.composeChat({
				instruction,
				history,
				context: this.aiContext(),
				requestId,
				locale: LanguageStore.language()
			});
			const draftApplied = response.applyDraft
				? await this.applyAiDraft(response.draft, { responseMessage: response.message })
				: false;
			const message = String(response.message || response.summary || i18n('COMPOSE/AI_CHAT_DRAFT_UPDATED'));
			this.aiChatMessages.push(this.aiChatMessage('assistant', message));
			this.aiSummary(String(response.summary || ''));
			if (draftApplied && this.aiSendWithoutConfirmation()) {
				await this.waitForAiAttachments();
				this.sendCommand();
			}
		} catch (error) {
			const message = error.message || String(error);
			this.aiError(message);
			this.aiChatMessages.push(this.aiChatMessage('assistant', message));
		} finally {
			clearInterval(this.aiChatTimer);
			this.aiChatTimer = 0;
			this.aiChatElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
			this.aiChatActivity('');
			this.aiChatBusy(false);
			this.scrollAiChat();
		}
	}

	aiCommandKeydown(_view, event) {
		if ('Enter' === event.key && !event.shiftKey) {
			event.preventDefault();
			this.submitAiCommand();
			return false;
		}
		return true;
	}

	fromAiKeydown(_view, event) {
		const value = this.from().trim();
		if ('Enter' === event.key && value.startsWith('/')) {
			event.preventDefault();
			this.from(this.currentIdentity()?.toString() || '');
			this.aiRecipientCommand('from', value.slice(1).trim());
			return false;
		}
		return true;
	}

	aiRecipientCommand(field, instruction) {
		if (!instruction) return;
		this.aiInstruction(instruction);
		this.aiDelegationMode(false);
		this.runAiAssist('recipients', `${field.toUpperCase()}: ${instruction}`);
	}

	aiContext() {
		const bodyHtml = this.oEditor?.getData() || '';
		return {
			mode: {
				[ComposeType.Reply]: 'reply',
				[ComposeType.ReplyAll]: 'replyAll',
				[ComposeType.Forward]: 'forward'
			}[this.aiComposeType] || 'new',
			accountEmail: this.senderAccount(),
			senderAccount: this.senderAccount(),
			senderLocked: this.senderManuallySelected(),
			allowedSenders: SenderIdentityUserStore().map(identity => ({
				accountEmail: identity.accountEmail,
				accountName: identity.accountName,
				email: identity.email,
				name: identity.name,
				identityId: identity.id()
			})),
			from: this.from(),
			to: this.to(),
			cc: this.cc(),
			bcc: this.bcc(),
			replyTo: this.replyTo(),
			requestReadReceipt: this.requestReadReceipt(),
			requestDsn: this.requestDsn(),
			requireTLS: this.requireTLS(),
			markAsImportant: this.markAsImportant(),
			sign: this.doSign(),
			encrypt: this.doEncrypt(),
			subject: this.subject(),
			bodyHtml,
			bodyText: htmlToPlain(bodyHtml),
			threadAnchor: oLastMessage ? {
				account: oLastMessage.account || AccountUserStore.email(),
				folder: oLastMessage.folder,
				uid: oLastMessage.uid
			} : null
		};
	}

	async loadAiAttachments(attachments = []) {
		for (const attachment of attachments) {
			const loaded = await window.snappyDesktop.ai.readAttachment(attachment.path),
				file = fileFromBase64(loaded.data, loaded.name);
			this.oJua.addFile({ fileName: loaded.name, size: loaded.size, file });
		}
	}

	async waitForAiAttachments() {
		const started = Date.now();
		while (this.attachmentsInProcess().length && Date.now() - started < 120000) {
			await new Promise(resolve => setTimeout(resolve, 150));
		}
		if (this.attachmentsInProcess().length) throw new Error(i18n('COMPOSE/AI_ATTACHMENT_TIMEOUT'));
		if (this.attachmentsInError().length) throw new Error(i18n('COMPOSE/AI_ATTACHMENT_ERROR'));
	}

	async switchAiSourceAccount(source, draft, responseMessage) {
		sessionStorage.setItem(AiPendingComposeKey, JSON.stringify({
			draft,
			responseMessage: String(responseMessage || draft.summary || ''),
			chatMessages: this.aiChatMessages()
		}));
		return new Promise((resolve, reject) => {
			Remote.request('AccountSwitch', error => {
				if (error) {
					sessionStorage.removeItem(AiPendingComposeKey);
					reject(new Error(i18n('COMPOSE/AI_ACCOUNT_SWITCH_ERROR')));
					return;
				}
				ComposePopupView.inEdit(true);
				this.close();
				setTimeout(() => rl.route.reload(), 20);
				resolve(false);
			}, { Email: source.account });
		});
	}

	async applyAiDraft(draft, options = {}) {
		const mode = aiComposeType(draft.mode),
			usesSource = [ComposeType.Reply, ComposeType.ReplyAll, ComposeType.Forward].includes(mode),
			source = aiSourceMessage(draft.sourceMessage);
		if (!options.sourceAlreadyApplied && source) {
			this.initOnShow({ mode, message: await loadAiSourceMessage(source) }, true);
		} else if (!options.sourceAlreadyApplied && usesSource && oLastMessage && mode !== this.aiComposeType) {
			this.initOnShow({ mode, message: oLastMessage }, true);
		} else if (usesSource && !oLastMessage) {
			throw new Error(i18n('COMPOSE/AI_SOURCE_MESSAGE_ERROR'));
		}
		this.aiComposeType = mode;
		const requestedAccount = String(draft.senderAccount || '').toLowerCase(),
			requestedEmail = String(draft.from?.email || '').toLowerCase(),
			identity = SenderIdentityUserStore.find(item =>
				(!requestedAccount || String(item.accountEmail || '').toLowerCase() === requestedAccount)
				&& (!requestedEmail || String(item.email || '').toLowerCase() === requestedEmail)
			);
		if (identity && !this.senderManuallySelected()) this.currentIdentity(identity);
		this.to(draftAddressLine(draft.to));
		this.cc(draftAddressLine(draft.cc));
		this.bcc(draftAddressLine(draft.bcc));
		this.showCc(Boolean(this.cc()));
		this.showBcc(Boolean(this.bcc()));
		if (Array.isArray(draft.replyTo)) {
			this.replyTo(draftAddressLine(draft.replyTo));
			this.showReplyTo(Boolean(this.replyTo()));
		}
		if ('boolean' === typeof draft.requestReadReceipt) this.requestReadReceipt(draft.requestReadReceipt);
		if ('boolean' === typeof draft.requestDsn) this.requestDsn(draft.requestDsn);
		if ('boolean' === typeof draft.requireTLS) this.requireTLS(draft.requireTLS);
		if ('boolean' === typeof draft.markAsImportant) this.markAsImportant(draft.markAsImportant);
		if ('boolean' === typeof draft.sign) this.doSign(draft.sign && this.canSign());
		if ('boolean' === typeof draft.encrypt) this.doEncrypt(draft.encrypt && this.canEncrypt());
		this.subject(String(draft.subject || ''));
		this.editor(editor => {
			editor.setHtml(`${draft.bodyHtml || encodeHtml(draft.bodyText || '')}${this.aiQuotedHtml || ''}`);
			if (draft.includeSignature) this.setSignature(this.currentIdentity(), this.aiComposeType);
		});
		await this.loadAiAttachments(draft.attachments);
		this.aiSummary(String(draft.summary || ''));
		this.aiJustApplied(true);
		setTimeout(() => this.aiJustApplied(false), 700);
		return true;
	}

	async runAiAssist(action, instruction) {
		if (this.aiBusy()) return;
		if (!window.snappyDesktop?.ai?.compose) {
			this.aiError(i18n('COMPOSE/AI_DESKTOP_REQUIRED'));
			return;
		}
		this.aiBusy(true);
		this.aiError('');
		this.aiSummary('');
		try {
			const draft = await window.snappyDesktop.ai.compose({
				action,
				instruction: instruction || '',
				context: this.aiContext(),
				locale: LanguageStore.language()
			});
			const draftApplied = await this.applyAiDraft(draft);
			this.aiDelegationMode(false);
			if (draftApplied && this.aiSendWithoutConfirmation()) {
				await this.waitForAiAttachments();
				this.sendCommand();
			}
		} catch (error) {
			this.aiError(error.message || String(error));
		} finally {
			this.aiBusy(false);
		}
	}

	submitAiCommand() {
		const instruction = this.aiInstruction().trim();
		if (instruction) this.runAiAssist(this.aiDelegationMode() ? 'delegate' : 'command', instruction);
	}

	rewriteWithAi() {
		this.runAiAssist('rewrite', this.aiInstruction().trim());
	}

	onHide() {
		// Stop autosave
		clearTimeout(this.iTimer);
		clearInterval(this.aiChatTimer);
		this.cancelPreSend();

		ComposePopupView.inEdit() || this.reset();

		this.to.focused(false);

//		alreadyFullscreen || exitFullscreen();
	}

	dropMailvelope() {
		if (this.mailvelope) {
			elementById('mailvelope-editor').textContent = '';
			this.mailvelope = null;
		}
	}

	editor(fOnInit) {
		if (fOnInit && this.editorArea()) {
			if (this.oEditor) {
				fOnInit(this.oEditor);
			} else {
				// setTimeout(() => {
				this.oEditor = new HtmlEditor(
					this.editorArea(),
					() => fOnInit(this.oEditor),
					bHtml => this.isHtml(!!bHtml)
				);
				// }, 1000);
			}
		}
	}

	setSignature(identity, msgComposeType) {
		if (identity && ComposeType.Draft !== msgComposeType && ComposeType.EditAsNew !== msgComposeType) {
			this.editor(editor => {
				let signature = identity.signature() || '',
					isHtml = signature.startsWith(':HTML:'),
					fromLine = oLastMessage ? emailArrayToStringLineHelper(oLastMessage.from, true) : '';
				if (fromLine) {
					signature = signature.replace(/{{FROM-FULL}}/g, fromLine);
					if (!fromLine.includes(' ') && 0 < fromLine.indexOf('@')) {
						fromLine = fromLine.replace(/@\S+/, '');
					}
					signature = signature.replace(/{{FROM}}/g, fromLine);
				}
				signature = (isHtml ? signature.slice(6) : signature)
					.replace(/\r/g, '')
					.replace(/\s{1,2}?{{FROM}}/g, '')
					.replace(/\s{1,2}?{{FROM-FULL}}/g, '')
					.replace(/{{DATE}}/g, new Date().format({dateStyle: 'full', timeStyle: 'short'}))
					.replace(/{{TIME}}/g, new Date().format('LT'))
					.replace(/{{MOMENT:[^}]+}}/g, '');
				signature.length && editor.setSignature(signature, isHtml, !!identity.signatureInsertBefore());
			});
		}
	}

	/**
	 * @param {string=} type = ComposeType.Empty
	 * @param {?MessageModel|Array=} oMessageOrArray = null
	 * @param {Array=} aToEmails = null
	 * @param {Array=} aCcEmails = null
	 * @param {Array=} aBccEmails = null
	 * @param {string=} sCustomSubject = null
	 * @param {string=} sCustomPlainText = null
	 */
	onShow(type, oMessageOrArray, aToEmails, aCcEmails, aBccEmails, sCustomSubject, sCustomPlainText, aiOptions) {
		this.minimized(false);
		// Auto-send is an explicit, one-draft consent and never carries across openings.
		this.aiSendWithoutConfirmation(false);
		this.autosaveStart();

		this.viewModelDom.dataset.wysiwyg = SettingsUserStore.editorDefaultType();

		let options = {
			mode: type || ComposeType.Empty,
			to:  aToEmails,
			cc:  aCcEmails,
			bcc: aBccEmails,
			subject: sCustomSubject,
			text: sCustomPlainText
		};
		if (1 < arrayLength(oMessageOrArray)) {
			options.messages = oMessageOrArray;
		} else {
			options.message = isArray(oMessageOrArray) ? oMessageOrArray[0] : oMessageOrArray;
		}

		if (ComposePopupView.inEdit()) {
			if (ComposeType.Empty !== options.mode) {
				showScreenPopup(AskPopupView, [
					i18n('COMPOSE/DISCARD_UNSAVED_DATA'),
					() => this.initOnShow(options),
					null,
					false
				]);
			} else {
				addEmailsTo(this.to, aToEmails);
				addEmailsTo(this.cc, aCcEmails);
				addEmailsTo(this.bcc, aBccEmails);

				if (sCustomSubject && !this.subject()) {
					this.subject(sCustomSubject);
				}
			}
		} else {
			this.initOnShow(options);
		}

		ComposePopupView.inEdit(false);
		setTimeout(() => {
			if (aiOptions?.restoreDraft) {
				if (Array.isArray(aiOptions.restoreChat)) this.aiChatMessages(aiOptions.restoreChat);
				this.applyAiDraft(aiOptions.restoreDraft, { sourceAlreadyApplied: true }).then(() => {
					if (aiOptions.restoreMessage) {
						this.aiChatMessages.push(this.aiChatMessage('assistant', aiOptions.restoreMessage));
					}
					this.scrollAiChat();
				}).catch(error => {
					this.aiError(error.message || String(error));
				});
			} else if (aiOptions?.instruction) {
				this.sendAiChat(aiOptions.instruction);
			} else if (aiOptions?.delegate) {
				this.focusAiCommand();
			}
		}, 180);
		// Chrome bug #298
//		alreadyFullscreen = isFullscreen();
//		alreadyFullscreen || (ThemeStore.isMobile() && toggleFullscreen());
	}

	/**
	 * @param {object} options
	 */
	initOnShow(options, preserveAiSession = false) {

		const
//			excludeEmail = new Set(),
			excludeEmail = {},
			mEmail = AccountUserStore.email();

		oLastMessage = options.message;

		if (mEmail) {
//			excludeEmail.add(mEmail);
			excludeEmail[mEmail] = true;
		}

		this.reset(preserveAiSession);
		this.aiComposeType = options.mode;

		let identity = null;
		if (oLastMessage) {
			switch (options.mode) {
				case ComposeType.Reply:
				case ComposeType.ReplyAll:
				case ComposeType.Forward:
				case ComposeType.ForwardAsAttachment:
					identity = findIdentity(oLastMessage.to.concat(oLastMessage.cc, oLastMessage.bcc), oLastMessage.account)
						|| findIdentity(oLastMessage.from, oLastMessage.account)
						/* || findIdentity(oLastMessage.deliveredTo)*/;
					break;
				case ComposeType.Draft:
					identity = findIdentity(oLastMessage.from.concat(oLastMessage.replyTo), oLastMessage.account);
					break;
				// no default
//				case ComposeType.Empty:
			}
		}
		// Set from custom email
		if (!identity
			&& oLastMessage && (ComposeType.Reply === options.mode || ComposeType.ReplyAll === options.mode)
			&& 1 === oLastMessage.to.length
//			&& mEmail.includes(oLastMessage.to[0].domain)
		) {
			identity = new IdentityModel;
			identity.name = oLastMessage.to[0].name;
			identity.email = oLastMessage.to[0].email;
		}
		identity = identity
			|| SenderIdentityUserStore.find(item => item.accountEmail === AccountUserStore.email())
			|| SenderIdentityUserStore()[0]
			|| IdentityUserStore()[0];
		if (identity) {
//			excludeEmail.add(identity.email);
			excludeEmail[identity.email] = true;
		}

		if (arrayLength(options.to)) {
			this.to(emailArrayToStringLineHelper(options.to));
		}

		if (arrayLength(options.cc)) {
			this.cc(emailArrayToStringLineHelper(options.cc));
		}

		if (arrayLength(options.bcc)) {
			this.bcc(emailArrayToStringLineHelper(options.bcc));
		}

		if (options.mode && oLastMessage) {
			let usePlain,
				sCc = '',
				sDate = timestampToString(oLastMessage.dateTimestamp(), 'FULL'),
				sSubject = oLastMessage.subject(),
				sText = '',
				aDraftInfo = oLastMessage.draftInfo;

			switch (options.mode) {
				case ComposeType.Reply:
				case ComposeType.ReplyAll: {
//					if (1 == oLastMessage.to.length) {
//						setTimeout(() => this.from(emailArrayToStringLineHelper(oLastMessage.to)), 1);
//					}
					if (ComposeType.Reply === options.mode) {
						this.to(emailArrayToStringLineHelper(oLastMessage.replyEmails(excludeEmail)));
					} else {
						let parts = oLastMessage.replyAllEmails(excludeEmail);
						this.to(emailArrayToStringLineHelper(parts[0]));
						this.cc(emailArrayToStringLineHelper(parts[1]));
					}
					this.subject(replySubjectAdd('Re', sSubject));
					this.prepareMessageAttachments(oLastMessage, options.mode);
					this.aDraftInfo = ['reply', oLastMessage.uid, oLastMessage.folder];
					this.sInReplyTo = oLastMessage.messageId;
					this.sReferences = (oLastMessage.references + ' ' + oLastMessage.messageId).trim();
					oLastMessage.headers().valuesByName('autocrypt').forEach(value => {
						let autocrypt = new MimeHeaderAutocryptModel(value);
						if (autocrypt.addr && autocrypt.keydata) {
							PgpUserStore.hasPublicKeyForEmails([autocrypt.addr])
							|| PgpUserStore.importKey(autocrypt.pem(), true, true)
//							|| showScreenPopup(OpenPgpImportPopupView, [autocrypt.pem()])
						}
					});
				} break;

				case ComposeType.Forward:
				case ComposeType.ForwardAsAttachment:
					this.subject(replySubjectAdd('Fwd', sSubject));
					this.prepareMessageAttachments(oLastMessage, options.mode);
					this.aDraftInfo = ['forward', oLastMessage.uid, oLastMessage.folder];
					this.sInReplyTo = oLastMessage.messageId;
					this.sReferences = (oLastMessage.references + ' ' + oLastMessage.messageId).trim();
					break;

				case ComposeType.Draft:
					this.bFromDraft = true;
					this.draftsFolder(oLastMessage.folder);
					this.draftUid(oLastMessage.uid);
					// fallthrough
				case ComposeType.EditAsNew:
					this.to(emailArrayToStringLineHelper(oLastMessage.to));
					this.cc(emailArrayToStringLineHelper(oLastMessage.cc));
					this.bcc(emailArrayToStringLineHelper(oLastMessage.bcc));
					this.replyTo(emailArrayToStringLineHelper(oLastMessage.replyTo));
					this.subject(sSubject);
					this.prepareMessageAttachments(oLastMessage, options.mode);
					this.aDraftInfo = 3 === arrayLength(aDraftInfo) ? aDraftInfo : null;
					this.sInReplyTo = oLastMessage.inReplyTo;
					this.sReferences = oLastMessage.references;
					break;

//				case ComposeType.Empty:
//					break;
				// no default
			}

			// https://github.com/the-djmaze/snappymail/issues/491
			tpl.innerHTML = oLastMessage.bodyAsHTML();
			tpl.content.querySelectorAll('img').forEach(img => {
				img.src || img.dataset.xSrc || img.replaceWith(img.alt || img.title)
			});
			sText = tpl.innerHTML.trim();

			switch (options.mode) {
				case ComposeType.Reply:
				case ComposeType.ReplyAll:
					sText = '<br><br><p>'
						+ i18n('COMPOSE/REPLY_MESSAGE_TITLE', { DATETIME: sDate, EMAIL: oLastMessage.from.toString(false, true) })
						+ ':</p><blockquote>'
						+ sText.trim()
						+ '</blockquote>';
					break;

				case ComposeType.Forward:
					sCc = oLastMessage.cc.toString(false, true);
					sText = '<br><br><p>' + i18n('COMPOSE/FORWARD_MESSAGE_TOP_TITLE') + '</p><div>'
						+ i18n('GLOBAL/FROM') + ': ' + oLastMessage.from.toString(false, true)
						+ '<br>'
						+ i18n('GLOBAL/TO') + ': ' + oLastMessage.to.toString(false, true)
						+ (sCc.length ? '<br>' + i18n('GLOBAL/CC') + ': ' + sCc : '')
						+ '<br>'
						+ i18n('COMPOSE/FORWARD_MESSAGE_TOP_SENT')
						+ ': '
						+ encodeHtml(sDate)
						+ '<br>'
						+ i18n('GLOBAL/SUBJECT')
						+ ': '
						+ encodeHtml(sSubject)
						+ '<br><br>'
						+ sText.trim()
						+ '</div>';
					break;

				case ComposeType.ForwardAsAttachment:
					sText = '';
					break;

				default:
					usePlain = PgpUserStore.isEncrypted(sText) || isPlainEditor() || !oLastMessage.isHtml();
					if (usePlain) {
						sText = oLastMessage.plain();
					}
			}

			this.editor(editor => {
				if ([ComposeType.Reply, ComposeType.ReplyAll, ComposeType.Forward].includes(options.mode)) {
					this.aiQuotedHtml = sText;
				}
				usePlain ? (editor.modePlain() | editor.setPlain(sText)) : editor.setHtml(sText);
				this.setSignature(identity, options.mode);
				this.setFocusInPopup();
			});
		} else if (ComposeType.Empty === options.mode) {
			this.subject(null != options.subject ? '' + options.subject : '');
			this.editor(editor => {
				editor.setHtml(options.text ? '' + options.text : '');
				isPlainEditor() && editor.modePlain();
				this.setSignature(identity);
				this.setFocusInPopup();
			});
		} else if (options.messages) {
			options.messages.forEach(item => this.addMessageAsAttachment(item));
			this.editor(editor => {
				isPlainEditor() ? editor.setPlain('') : editor.setHtml('');
				this.setSignature(identity, options.mode);
				this.setFocusInPopup();
			});
		} else {
			this.setFocusInPopup();
		}

		// item.cId item.isInline item.isLinked
		const downloads = this.attachments.filter(item => item && !item.tempName()).map(item => item.id);
		if (arrayLength(downloads)) {
			Remote.request('MessageUploadAttachments',
				(iError, oData) => {
					const result = oData?.Result;
					downloads.forEach((id, index) => {
						const attachment = this.getAttachmentById(id);
						if (attachment) {
							attachment
								.waiting(false)
								.uploading(false)
								.complete(true);
							if (iError || !result?.[index]) {
								attachment.error(getUploadErrorDescByCode(UploadErrorCode.NoFileUploaded));
							} else {
								attachment.tempName(result[index].tempName);
								attachment.type(result[index].mimeType);
							}
						}
					});
				},
				{
					attachments: downloads
				},
				999000
			);
		}

		this.currentIdentity(identity);
	}

	setFocusInPopup() {
		setTimeout(() => {
			if (!this.to()) {
				this.to.focused(true);
			} else if (!this.subject()) {
				this.viewModelDom.querySelector('input[name="subject"]').focus();
			} else {
				this.oEditor?.focus();
			}
		}, 100);
	}

	doClose() {
		if (AskPopupView.hidden()) {
			if (ComposePopupView.inEdit() || (this.isEmptyForm() && !this.draftUid())) {
				this.close();
			} else {
				showScreenPopup(AskPopupView, [
					i18n('POPUPS_ASK/DESC_WANT_CLOSE_THIS_WINDOW'),
					() => this.close()
				]);
			}
		}
	}

	onBuild(dom) {
		this.buildMinimizedDock();
		// initUploader
		const oJua = new Jua({
				action: serverRequest('Upload'),
				clickElement: dom.querySelector('#composeUploadButton'),
				dragAndDropElement: dom.querySelector('.b-attachment-place')
			}),
			attachmentSizeLimit = pInt(SettingsGet('attachmentLimit'));
		this.oJua = oJua;

		oJua
			.on('onDragEnter', () => {
				this.dragAndDropOver(true);
			})
			.on('onDragLeave', () => {
				this.dragAndDropOver(false);
			})
			.on('onBodyDragEnter', () => {
				this.attachmentsArea();
				this.dragAndDropVisible(true);
			})
			.on('onBodyDragLeave', () => {
				this.dragAndDropVisible(false);
			})
			.on('onProgress', (id, loaded, total) => {
				let item = this.getAttachmentById(id);
				if (item) {
					item.progress(Math.floor((loaded / total) * 100));
				}
			})
			.on('onSelect', (sId, oData) => {
				this.dragAndDropOver(false);

				const
					size = pInt(oData.size, null),
					attachment = new ComposeAttachmentModel(
						sId,
						oData.fileName ? oData.fileName.toString() : '',
						size
					);

				this.addAttachment(attachment, 1, oJua);

				if (0 < size && 0 < attachmentSizeLimit && attachmentSizeLimit < size) {
					attachment
						.waiting(false)
						.uploading(true)
						.complete(true)
						.error(i18n('UPLOAD/ERROR_FILE_IS_TOO_BIG'));

					return false;
				}

				return true;
			})
			.on('onStart', id => {
				let item = this.getAttachmentById(id);
				if (item) {
					item
						.waiting(false)
						.uploading(true)
						.complete(false);
				}
			})
			.on('onComplete', (id, result, data) => {
				const attachment = this.getAttachmentById(id),
					response = data?.Result || {},
					errorCode = response.code,
					attachmentJson = result && response.Attachment;

				let error = '';
				if (null != errorCode) {
					error = getUploadErrorDescByCode(errorCode);
				} else if (!attachmentJson) {
					error = i18n('UPLOAD/ERROR_UNKNOWN');
				}

				if (attachment) {
					if (error) {
						attachment
							.waiting(false)
							.uploading(false)
							.complete(true)
							.error(error + '\n' + response.message);
					} else if (attachmentJson) {
						attachment
							.waiting(false)
							.uploading(false)
							.complete(true);
						attachment.fileName(attachmentJson.name);
						attachment.size(attachmentJson.size ? pInt(attachmentJson.size) : 0);
						attachment.tempName(attachmentJson.tempName ? attachmentJson.tempName : '');
						attachment.isInline = false;
						attachment.type(attachmentJson.mimeType);
					}
				}
			});

		this.addAttachmentEnabled(true);

		window.snappyDesktop?.ai?.onEvent?.(event => {
			if ('activity' !== event?.type || event.data?.activityId !== this.aiChatRequestId()) return;
			if ('completed' !== event.data.phase) {
				this.aiChatActivity(this.aiChatActivityLabel(event.data));
			}
		});

		addShortcut('q', 'meta', ScopeCompose, ()=>false);
		addShortcut('w', 'meta', ScopeCompose, ()=>false);

		addShortcut('m', 'meta', ScopeCompose, () => {
			this.identitiesMenu().ddBtn.toggle();
			return false;
		});

		addShortcut('arrowdown', 'meta', ScopeCompose, () => {
			this.skipCommand();
			return false;
		});

		addShortcut('s', 'meta', ScopeCompose, () => {
			this.focusAiCommand();
			return false;
		});
		addShortcut('save', '', ScopeCompose, () => {
			this.saveCommand();
			return false;
		});

		addShortcut('enter', 'meta', ScopeCompose, () => {
//			if (SettingsUserStore.allowCtrlEnterOnCompose()) {
				this.sendCommand();
				return false;
//			}
		});
		addShortcut('mailsend', '', ScopeCompose, () => {
			this.sendCommand();
			return false;
		});

		addShortcut('escape,close', 'shift', ScopeCompose, () => {
			this.doClose();
			return false;
		});

		this.editor(editor => editor[isPlainEditor()?'modePlain':'modeWysiwyg']());
	}

	/**
	 * @param {string} id
	 * @returns {?Object}
	 */
	getAttachmentById(id) {
		return this.attachments.find(item => item && id === item.id);
	}

	/**
	 * @param {MessageModel} message
	 */
	addMessageAsAttachment(message) {
		if (message) {
			const attachment = new ComposeAttachmentModel(
				message.requestHash,
				message.subject() /*+ '-' + Jua.randomId()*/ + '.eml',
				message.size
			);
			attachment.fromMessage = true;
			attachment.complete(true);
			this.addAttachment(attachment);
		}
	}

	addAttachment(attachment, view, oJua) {
		oJua || attachment.waiting(false).uploading(true);
		attachment.cancel = () => {
			this.attachments.remove(attachment);
			oJua?.cancel(attachment.id);
		};
		this.attachments.push(attachment);
		view && this.attachmentsArea();
	}

	/**
	 * @param {string} id
	 * @param {string} name
	 * @param {number} size
	 * @returns {ComposeAttachmentModel}
	 */
	addAttachmentHelper(id, name, size) {
		const attachment = new ComposeAttachmentModel(id, name, size);
		this.addAttachment(attachment, 1);
		return attachment;
	}

	/**
	 * @param {MessageModel} message
	 * @param {string} type
	 */
	prepareMessageAttachments(message, type) {
		if (message) {
			let reply = [ComposeType.Reply, ComposeType.ReplyAll].includes(type);
			if (reply || [ComposeType.Forward, ComposeType.Draft, ComposeType.EditAsNew].includes(type)) {
				// item instanceof AttachmentModel
				message.attachments.forEach(item => {
					if (!reply || item.isLinked()) {
						const attachment = new ComposeAttachmentModel(
							item.download,
							item.fileName,
							item.estimatedSize,
							item.isInline(),
							item.isLinked(),
							item.cId,
							item.contentLocation
						);
						attachment.fromMessage = true;
						attachment.type(item.mimeType);
						this.addAttachment(attachment);
					}
				});
			} else if (ComposeType.ForwardAsAttachment === type) {
				this.addMessageAsAttachment(message);
			}
		}
	}

	/**
	 * @param {boolean=} includeAttachmentInProgress = true
	 * @returns {boolean}
	 */
	isEmptyForm(includeAttachmentInProgress = true) {
		const withoutAttachment = includeAttachmentInProgress
			? !this.attachments.length
			: !this.attachments.some(item => item?.complete());

		return (
			!this.to.length &&
			!this.cc.length &&
			!this.bcc.length &&
			!this.replyTo.length &&
			!this.subject.length &&
			withoutAttachment &&
			(!this.oEditor || !this.oEditor.getData())
		);
	}

	reset(preserveAiSession = false) {
		this.minimized(false);
		this.cancelPreSend();
		if (!preserveAiSession) this.senderManuallySelected(false);
		this.to('');
		this.cc('');
		this.bcc('');
		this.replyTo('');
		this.subject('');
		if (!preserveAiSession) {
			this.aiInstruction('');
			this.aiBusy(false);
			this.aiError('');
			this.aiSummary('');
			this.aiSendWithoutConfirmation(false);
			this.aiJustApplied(false);
			this.aiDelegationMode(false);
			this.resetAiChat();
		}
		this.aiQuotedHtml = '';

		this.requestDsn(SettingsUserStore.requestDsn());
		this.requestReadReceipt(SettingsUserStore.requestReadReceipt());
		this.requireTLS(SettingsUserStore.requireTLS());
		this.markAsImportant(false);

		this.bodyArea();

		this.aDraftInfo = null;
		this.sInReplyTo = '';
		this.bFromDraft = false;
		this.sReferences = '';

		this.sendError(false);
		this.sendSuccessButSaveError(false);
		this.savedError(false);
		this.savedTime(0);
		this.emptyToError(false);
		this.attachmentsInProcessError(false);

		this.showCc(false);
		this.showBcc(false);
		this.showReplyTo(false);

		this.doSign(SettingsUserStore.pgpSign());
		this.doEncrypt(SettingsUserStore.pgpEncrypt());

		this.attachments([]);

		this.dragAndDropOver(false);
		this.dragAndDropVisible(false);

		this.draftsFolder('');
		this.draftUid(0);

		this.sending(false);
		this.saving(false);

		this.oEditor?.clear();

		this.dropMailvelope();
	}

	attachmentsArea() {
		this.viewArea('attachments');
	}
	bodyArea() {
		this.viewArea('body');
	}

	allRecipients() {
		return [
				// From/sender is also recipient (Sent mailbox)
//				this.currentIdentity().email,
				this.from(),
				this.to(),
				this.cc(),
				this.bcc()
			].join(',').split(',').map(value => getEmail(value.trim())).validUnique();
	}

	/**
	 * Checks if signing a message is possible with from email address.
	 * And sets all that can.
	 */
	initSign() {
		let options = [],
			identity = this.currentIdentity(),
			email = getEmail(this.from()),
			key = OpenPGPUserStore.getPrivateKeyFor(email, 1);
		key && options.push(['OpenPGP', key]);
		key = GnuPGUserStore.getPrivateKeyFor(email, 1);
		key && options.push(['GnuPG', key]);
		identity.smimeKeyValid() && identity.smimeCertificateValid() && identity.email === email
			&& options.push(['S/MIME']);
		console.dir({signOptions: options});
		this.signOptions(options);
	}

	async initEncrypt() {
		const recipients = this.allRecipients(),
			options = [];

		if (recipients.length) {
			GnuPGUserStore.hasPublicKeyForEmails(recipients)
			&& options.push('GnuPG');

			OpenPGPUserStore.hasPublicKeyForEmails(recipients)
			&& options.push('OpenPGP');

			const count = recipients.length,
				identity = this.currentIdentity(),
				from = (identity.smimeKey() && identity.smimeCertificate()) ? identity.email : null;
			count
				&& count === recipients.filter(email =>
					email == from
					|| SMimeUserStore.find(certificate => email == certificate.emailAddress && certificate.smimeencrypt)
				).length
				&& options.push('S/MIME');

			if (await MailvelopeUserStore.hasPublicKeyForEmails(recipients)) {
				options.push('Mailvelope');
			} else {
				'mailvelope' === this.viewArea() && this.bodyArea();
//				this.dropMailvelope();
			}
		}

		console.dir({encryptOptions:options});
		this.encryptOptions(options);
	}

	async getMessageRequestParams(sSaveFolder, draft)
	{
		let Text = this.oEditor.getData().trim(),
			l,
			hasAttachments = 0;

		// Prepare ComposeAttachmentModel attachments
		const attachments = {};
		this.attachments.forEach(item => {
			if (item?.complete() && item?.tempName() && item?.enabled()) {
				++hasAttachments;
				attachments[item.tempName()] = {
					name: item.fileName(),
					inline: item.isInline,
					cId: item.cId,
					location: item.contentLocation,
					type: item.mimeType()
				};
			}
		});
/*
		let sToAddress = this.to();

		if (/".*" <.*,.*>/g.test(sToAddress)) {
			sToAddress = sToAddress.match(/<.*>/g)[0].replace(/[<>]/g, '');
		}
*/
		const
			identity = this.currentIdentity(),
			params = {
				identityID: identity.id(),
				senderAccount: this.senderAccount(),
				messageFolder: this.draftsFolder(),
				messageUid: this.draftUid(),
				saveFolder: sSaveFolder,
				from: this.from(),
				to: this.to(),
				cc: this.cc(),
				bcc: this.bcc(),
				replyTo: this.replyTo(),
				subject: this.subject(),
				draftInfo: this.aDraftInfo,
				inReplyTo: this.sInReplyTo,
				references: this.sReferences,
				markAsImportant: this.markAsImportant() ? 1 : 0,
				attachments: attachments,
				// Only used at send, not at save:
				dsn: this.requestDsn() ? 1 : 0,
				requireTLS: this.requireTLS() ? 1 : 0,
				readReceiptRequest: this.requestReadReceipt() ? 1 : 0,
				autocrypt: [],
				/**
				 * Basic support for Linked Data (Structured Email)
				 * https://json-ld.org/
				 * https://structured.email/
				 **/
				linkedData: []
			},
			recipients = draft ? [identity.email] : this.allRecipients(),
			signOptions = !draft && this.doSign() && this.signOptions(),
			encryptOptions = this.doEncrypt() && this.encryptOptions(),
			isHtml = this.oEditor.isHtml();

		if (isHtml) {
			tpl.innerHTML = Text;
			tpl.content.querySelectorAll('img').forEach(img => {
				if (img.dataset.xSrc) {
					img.src = img.dataset.xSrc;
					img.removeAttribute('data-x-src')
				}
			});
			Text = tpl.innerHTML.trim();

			do {
				l = Text.length;
				Text = Text
					// Remove Microsoft Office styling
					.replace(/(<[^>]+[;"'])\s*mso-[a-z-]+\s*:[^;"']+/gi, '$1')
					// Remove hubspot data-hs- attributes
					.replace(/(<[^>]+)\s+data-hs-[a-z-]+=("[^"]+"|'[^']+')/gi, '$1');
			} while (l != Text.length)
			params.html = Text;
			params.plain = htmlToPlain(Text);
		} else {
			params.plain = Text;
		}

		if (this.mailvelope && 'mailvelope' === this.viewArea()) {
			params.encrypted = draft
				? await this.mailvelope.createDraft()
				: await this.mailvelope.encrypt(recipients);
/*
			Object.entries(PgpUserStore.getPublicKeyOfEmails(recipients) || {}).forEach(([k,v]) =>
				params.autocrypt.push({addr:k, keydata:v.replace(/-----(BEGIN|END) PGP PUBLIC KEY BLOCK-----/g).trim()})
			);
*/
		} else if (signOptions.length || encryptOptions.length) {
			if (!draft && !hasAttachments && !Text.length) {
				throw i18n('COMPOSE/ERROR_EMPTY_BODY');
			}
			let data = new MimePart;
			data.headers['Content-Type'] = 'text/'+(isHtml?'html':'plain')+'; charset="utf-8"';
			data.headers['Content-Transfer-Encoding'] = 'base64';
			data.body = base64_encode(Text);
			if (isHtml) {
				const alternative = new MimePart, plain = new MimePart;
				alternative.headers['Content-Type'] = 'multipart/alternative';
				plain.headers['Content-Type'] = 'text/plain; charset="utf-8"';
				plain.headers['Content-Transfer-Encoding'] = 'base64';
				plain.body = base64_encode(params.plain);
				// First add plain
				alternative.children.push(plain);
				// Now add HTML
				alternative.children.push(data);
				data = alternative;
			}
			let isSigned = false;
			for (let i = 0; i < signOptions.length; ++i) {
				if ('OpenPGP' == signOptions[i][0]) {
					try {
						// Doesn't sign attachments
						let signed = new MimePart;
						signed.headers['Content-Type'] =
							'multipart/signed; micalg="pgp-sha256"; protocol="application/pgp-signature"';
						signed.headers['Content-Transfer-Encoding'] = '7Bit';
						signed.children.push(data);
						let signature = new MimePart;
						signature.headers['Content-Type'] = 'application/pgp-signature; name="signature.asc"';
						signature.headers['Content-Transfer-Encoding'] = '7Bit';
						signature.body = await OpenPGPUserStore.sign(data.toString(), signOptions[i][1], 1);
						signed.children.push(signature);
						isSigned = true;
						params.html = params.plain = '';
						params.signed = signed.toString();
						params.boundary = signed.boundary;
						data = signed;
/*
						Object.entries(PgpUserStore.getPublicKeyOfEmails([getEmail(this.from())]) || {})
						.forEach(([k,v]) => params.publicKey = v);
*/
						break;
					} catch (e) {
						console.error(e);
					}
				} else if ('GnuPG' == signOptions[i][0]) {
					// TODO: sign in PHP fails
					let pass = await GnuPGUserStore.sign(signOptions[i][1]);
					if (null != pass) {
//						params.signData = data.toString();
						params.signFingerprint = signOptions[i][1].fingerprint;
						params.signPassphrase = pass;
//						params.attachPublicKey = false;
						isSigned = true;
						break;
					}
				} else if ('S/MIME' == signOptions[i][0]) {
					// TODO: sign in PHP fails
					params.sign = 'S/MIME';
//					params.signCertificate = identity.smimeCertificate();
//					params.signPrivateKey = identity.smimeKey();
//					params.attachCertificate = false;
					if (identity.smimeKeyEncrypted()) {
						const pass = await Passphrases.ask(identity,
							i18n('SMIME/PRIVATE_KEY_OF', {EMAIL: identity.email}),
							'CRYPTO/SIGN'
						);
						if (null != pass) {
							params.signPassphrase = pass.password;
							pass.remember && Passphrases.handle(identity, pass.password);
							isSigned = true;
						}
					}
				}
			}
			if (signOptions.length && !isSigned) {
				throw 'Signing failed';
			}

			if (encryptOptions.length) {
				const autocrypt = () =>
					Object.entries(PgpUserStore.getPublicKeyOfEmails(recipients) || {}).forEach(([k,v]) =>
						params.autocrypt.push({
							addr: k,
							keydata: v.replace(/-----(BEGIN|END) PGP PUBLIC KEY BLOCK-----/g, '').trim()
						})
					);
				for (let i = 0; i < encryptOptions.length; ++i) {
					if ('OpenPGP' == encryptOptions[i]) {
						// Doesn't encrypt attachments
						params.encrypted = await OpenPGPUserStore.encrypt(data.toString(), recipients);
						params.signed = '';
						autocrypt();
						break;
					}
					if ('GnuPG' == encryptOptions[i]) {
						// Does encrypt attachments
						params.encryptFingerprints = JSON.stringify(GnuPGUserStore.getPublicKeyFingerprints(recipients));
						autocrypt();
						break;
					}
					if ('S/MIME' == encryptOptions[i]) {
						params.encryptCertificates = [identity.smimeCertificate()];
						SMimeUserStore.forEach(certificate => {
							certificate.emailAddress != identity.email
							&& recipients.includes(certificate.emailAddress)
							&& params.encryptCertificates.push(certificate.id)
						});
						break;
					}
					// We skip Mailvelope as it has its own window
				}
			}
		}

		return params;
	}
}

/**
 * When view is closed and reopened, fill it with previous data.
 * This, for example, happens when opening Contacts view to select recipients
 */
ComposePopupView.inEdit = ko.observable(false);
