import { koArrayWithDestroy, koComputable } from 'External/ko';
import { isArray } from 'Common/Utils';

export const IdentityUserStore = koArrayWithDestroy();

// Account-qualified identities used by the composer. This deliberately stays
// separate from IdentityUserStore, which belongs to the active account settings.
export const SenderIdentityUserStore = koArrayWithDestroy();

IdentityUserStore.loading = ko.observable(false).extend({ debounce: 100 });

/** Returns main (login) identity */
IdentityUserStore.main = koComputable(() => {
	const list = IdentityUserStore();
	return isArray(list) ? list.find(item => item && !item.id()) : null;
});
