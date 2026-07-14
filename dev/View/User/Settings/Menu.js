import { settings } from 'Common/Links';
import { mailbox } from 'Common/Links';
import { getFolderInboxName } from 'Common/Cache';
import { AbstractViewLeft } from 'Knoin/AbstractViews';

export class SettingsMenuUserView extends AbstractViewLeft {
	/**
	 * @param {Object} screen
	 */
	constructor(screen) {
		super();

		this.menu = screen.menu;
	}

	link(route) {
		return settings(route);
	}

	menuIcon(item) {
		return `g-icon--${({
			general: 'sliders',
			contacts: 'persons',
			accounts: 'envelope',
			filters: 'funnel',
			security: 'shield-check',
			folders: 'folder-open',
			themes: 'magic-wand'
		})[item?.route] || 'gear'}`;
	}

	backToInbox() {
		hasher.setHash(mailbox(getFolderInboxName()));
	}
}
