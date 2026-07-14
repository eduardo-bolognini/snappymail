import { AppUserStore } from 'Stores/User/App';
import { AccountUserStore, mailboxFilter, setMailboxFilter } from 'Stores/User/Account';
//import { FolderUserStore } from 'Stores/User/Folder';

import { ScopeMessageList, ScopeMessageView, ScopeSettings } from 'Common/Enums';
import { mailbox, settings } from 'Common/Links';
import { getFolderInboxName } from 'Common/Cache';

import { showScreenPopup } from 'Knoin/Knoin';
import { AbstractViewRight } from 'Knoin/AbstractViews';

import { KeyboardShortcutsHelpPopupView } from 'View/Popup/KeyboardShortcutsHelp';
import { AccountPopupView } from 'View/Popup/Account';
import { ContactsPopupView } from 'View/Popup/Contacts';
import { DesktopAIPopupView } from 'View/Popup/DesktopAI';

import { elementById, fireEvent, stopEvent, SettingsCapa, registerShortcut } from 'Common/Globals';

import Remote from 'Remote/User/Fetch';
import { getNotification } from 'Common/Translator';
//import { koComputable } from 'External/ko';
import { addObservablesTo } from 'External/ko';

export class SystemDropDownUserView extends AbstractViewRight {
	constructor() {
		super();

		this.allowAccounts = SettingsCapa('AdditionalAccounts');

		this.accountEmail = AccountUserStore.email;
		this.allInboxes = AccountUserStore.allInboxes;

		this.accounts = AccountUserStore;
		this.accountsLoading = AccountUserStore.loading;
/*
		this.accountsUnreadCount = : koComputable(() => 0);
		this.accountsUnreadCount = : koComputable(() => AccountUserStore().reduce((result, item) => result + item.count(), 0));
*/

		addObservablesTo(this, {
			currentAudio: '',
			desktopAIConnected: false
		});

		this.allowContacts = AppUserStore.allowContacts();
		this.desktopAIAvailable = Boolean(window.snappyDesktop?.ai);

		addEventListener('audio.stop', () => this.currentAudio(''));
		addEventListener('audio.start', e => this.currentAudio(e.detail));
	}

	stopPlay() {
		fireEvent('audio.api.stop');
	}

	accountClick(account, event) {
		let email = account?.email, previousFilter = mailboxFilter();
		if (email && (!event || 0 === event.button)) {
			stopEvent(event);
			setMailboxFilter(email);
			if (AccountUserStore.email() == email) {
				hasher.setHash(mailbox(getFolderInboxName()));
				rl.app.messageList.reload(true, true);
				return true;
			}
			AccountUserStore.loading(true);
			Remote.request('AccountSwitch',
				(iError/*, oData*/) => {
					if (iError) {
						setMailboxFilter(previousFilter);
						AccountUserStore.loading(false);
						alert('Account error: ' + getNotification(iError).replace('%EMAIL%', email));
						if (account.isAdditional()) {
							showScreenPopup(AccountPopupView, [account]);
						}
					} else {
/*						// Not working yet
						forEachObjectEntry(oData.Result, (key, value) => rl.settings.set(key, value));
//						MessageUserStore.message();
//						MessageUserStore.purgeCache();
						MessagelistUserStore([]);
//						FolderUserStore.folderList([]);
						loadFolders(value => {
							if (value) {
//								4. Change to INBOX = reload MessageList
//								MessagelistUserStore.setMessageList();
							}
						});
						AccountUserStore.loading(false);
*/
						rl.route.reload();
					}
				}, {Email:email}
			);
		}
		return true;
	}

	allInboxesClick(view, event) {
		stopEvent(event);
		setMailboxFilter('');
		hasher.setHash(mailbox(getFolderInboxName()));
		rl.app.messageList.reload(true, true);
		return true;
	}

	accountInitial(account) {
		return (account?.label?.() || account?.email || '?').trim().charAt(0).toUpperCase();
	}

	accountName() {
		const email = AccountUserStore.email();
		return AccountUserStore.find(account => account.email == email)?.label() || IDN.toUnicode(email);
	}

	settingsClick() {
		hasher.setHash(settings());
	}

	settingsHelp() {
		showScreenPopup(KeyboardShortcutsHelpPopupView);
	}

	addAccountClick() {
		this.allowAccounts && showScreenPopup(AccountPopupView);
	}

	contactsClick() {
		this.allowContacts && showScreenPopup(ContactsPopupView);
	}

	smartContactsClick() {
		this.desktopAIAvailable && showScreenPopup(DesktopAIPopupView, ['contacts']);
	}

	desktopAIClick() {
		this.desktopAIAvailable && showScreenPopup(DesktopAIPopupView);
	}

	async refreshDesktopAIStatus() {
		if (!this.desktopAIAvailable) return;
		try {
			const status = await window.snappyDesktop.ai.status();
			this.desktopAIConnected(Boolean(status?.connected));
		} catch {
			this.desktopAIConnected(false);
		}
	}

	logoutClick() {
		setMailboxFilter('');
		rl.app.logout();
	}

	onBuild(dom) {
		elementById('rl-left')?.prepend(dom);
		this.refreshDesktopAIStatus();
		window.snappyDesktop?.ai.onEvent(event => {
			if ('auth' === event.type) this.refreshDesktopAIStatus();
		});

		// shortcuts help
		registerShortcut('?,f1,help', '', [ScopeMessageList, ScopeMessageView, ScopeSettings], () => {
			if (!this.viewModelDom.hidden) {
				showScreenPopup(KeyboardShortcutsHelpPopupView);
				return false;
			}
		});
	}
}
