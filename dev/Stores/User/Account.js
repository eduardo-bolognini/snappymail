import { addObservablesTo, koArrayWithDestroy } from 'External/ko';

export const MAILBOX_FILTER_KEY = 'easyMailMailboxFilter';

export const mailboxFilter = () => sessionStorage.getItem(MAILBOX_FILTER_KEY) || '';

export const AccountUserStore = koArrayWithDestroy();

addObservablesTo(AccountUserStore, {
	email: '',
	loading: false,
	allInboxes: !mailboxFilter()
});

export const setMailboxFilter = email => {
	email = String(email || '');
	if (email) {
		sessionStorage.setItem(MAILBOX_FILTER_KEY, email);
	} else {
		sessionStorage.removeItem(MAILBOX_FILTER_KEY);
	}
	AccountUserStore.allInboxes(!email);
};
