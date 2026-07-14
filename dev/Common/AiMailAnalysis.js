export function collectReceivedFolderNames(collection, excludedNames = []) {
	const excluded = new Set(excludedNames.filter(Boolean)),
		folders = [];

	const collect = items => (items || []).forEach(folder => {
		// Some IMAP servers omit \Subscribed even for normal selectable folders.
		if (
			folder?.exists
			&& folder.selectable?.()
			&& !folder.kolabType?.()
			&& !excluded.has(folder.fullName)
		) {
			folders.push(folder.fullName);
		}

		const children = folder?.subFolders?.();
		children?.length && collect(children);
	});

	collect(collection);
	return [...new Set(folders)];
}
