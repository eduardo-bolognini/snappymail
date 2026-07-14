const aliases = {
	Sent: new Set([
		'inviata',
		'inviati',
		'posta inviata',
		'sent',
		'sent items',
		'sent messages'
	])
};

const normalizedName = value => String(value || '')
	.normalize('NFD')
	.replace(/[\u0300-\u036f]/g, '')
	.trim()
	.toLowerCase();

export const findSystemFolderByName = (folders, type) => {
	const names = aliases[type], matches = [];
	if (!names) return '';

	const collect = collection => collection.forEach(folder => {
		const selectable = typeof folder?.selectable === 'function'
			? folder.selectable()
			: folder?.selectable;
		const name = typeof folder?.name === 'function' ? folder.name() : folder?.name;
		if (folder?.exists !== false && selectable !== false && folder?.fullName && names.has(normalizedName(name))) {
			matches.push(folder.fullName);
		}
		const children = typeof folder?.subFolders === 'function' ? folder.subFolders() : folder?.subFolders;
		children?.length && collect(children);
	});

	collect(folders || []);
	return 1 === matches.length ? matches[0] : '';
};
