import { addObservablesTo } from 'External/ko';
import { Notifications } from 'Common/Enums';
import { getNotification } from 'Common/Translator';
import { loadAccountsAndIdentities } from 'Common/UtilsUser';

import Remote from 'Remote/User/Fetch';

import { AbstractViewPopup } from 'Knoin/AbstractViews';

export class AccountPopupView extends AbstractViewPopup {
	constructor() {
		super('Account');

		addObservablesTo(this, {
			isNew: true,

			name: '',
			email: '',
			password: '',
			manualConfig: false,
			imapHost: '',
			imapPort: 993,
			imapType: '1',
			smtpHost: '',
			smtpPort: 465,
			smtpType: '1',

			submitRequest: false,
			submitError: '',
			submitErrorAdditional: ''
		});
	}

	hideError() {
		this.submitError('');
	}

	toggleManualConfig() {
		this.manualConfig(!this.manualConfig());
		this.hideError();
	}

	submitForm(form) {
		if (!this.submitRequest() && form.reportValidity()) {
			const data = new FormData(form);
			data.set('new', this.isNew() ? 1 : 0);
			data.set('DesktopManualConfig', this.manualConfig() ? 1 : 0);
			this.submitRequest(true);
			Remote.request('AccountSetup', (iError, data) => {
					this.submitRequest(false);
					if (iError) {
						if (Notifications.DomainNotAllowed == iError) {
							this.manualConfig(true);
						}
						this.submitError(getNotification(iError));
						this.submitErrorAdditional(data?.messageAdditional);
					} else {
						loadAccountsAndIdentities();
						this.close();
					}
				}, data
			);
		}
	}

	onHide() {
		this.password('');
		this.submitRequest(false);
		this.submitError('');
		this.submitErrorAdditional('');
		this.manualConfig(false);
	}

	onShow(account) {
		let edit = account?.isAdditional();
		this.isNew(!edit);
		this.name(edit ? account.name : '');
		this.email(edit ? account.email : '');
		this.manualConfig(false);
	}
}
