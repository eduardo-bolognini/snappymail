import { doc, createElement } from 'Common/Globals';
import { i18n } from 'Common/Translator';

const cache = new Map;
let card, activeTarget, showTimer, hideTimer, requestId = 0;

const cleanEmail = value => {
	value = String(value || '').trim();
	if (value.toLowerCase().startsWith('mailto:')) value = value.slice(7).split('?')[0];
	try { value = decodeURIComponent(value); } catch {
		// Keep malformed legacy mailto values readable instead of hiding the card.
	}
	return value.replace(/^.*<([^>]+)>.*$/, '$1').trim().toLowerCase();
};

const initials = (name, email) => String(name || email || '?')
	.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();

const addText = (parent, className, value) => {
	if (!value) return;
	const element = createElement('div', { class: className });
	element.textContent = value;
	parent.append(element);
};

const row = (label, value) => {
	if (!value) return null;
	const element = createElement('div', { class: 'contact-hover-card__row' }),
		labelElement = createElement('span', { class: 'contact-hover-card__label' }),
		valueElement = createElement('span', { class: 'contact-hover-card__value' });
	labelElement.textContent = label;
	valueElement.textContent = value;
	element.append(labelElement, valueElement);
	return element;
};

const render = (data, fallback) => {
	card.textContent = '';
	const header = createElement('div', { class: 'contact-hover-card__header' }),
		avatar = createElement('span', { class: 'contact-hover-card__avatar' }),
		identity = createElement('div', { class: 'contact-hover-card__identity' }),
		name = data?.name || fallback.name || fallback.email,
		email = data?.email || fallback.email;
	avatar.textContent = initials(name, email);
	addText(identity, 'contact-hover-card__name', name);
	addText(identity, 'contact-hover-card__email', email);
	header.append(avatar, identity);
	card.append(header);

	const role = [data?.jobTitle, data?.organization].filter(Boolean).join(' · ');
	addText(card, 'contact-hover-card__role', role);
	const details = createElement('div', { class: 'contact-hover-card__details' });
	[
		row(i18n('CONTACT_CARD/RELATIONSHIP'), data?.relationship),
		row(i18n('CONTACT_CARD/GROUPS'), data?.groups?.join(', ')),
		row(i18n('CONTACT_CARD/YOUR_STYLE'), data?.myWritingStyle),
		row(i18n('CONTACT_CARD/THEIR_STYLE'), data?.theirWritingStyle)
	].filter(Boolean).forEach(element => details.append(element));
	if (details.children.length) card.append(details);
	card.classList.toggle('contact-hover-card--basic', !details.children.length && !role);
};

const position = target => {
	const rect = target.getBoundingClientRect(), gap = 10,
		width = Math.min(340, doc.documentElement.clientWidth - 24);
	card.style.width = `${width}px`;
	card.hidden = false;
	const height = card.offsetHeight,
		left = Math.max(12, Math.min(rect.left, doc.documentElement.clientWidth - width - 12)),
		top = rect.bottom + gap + height <= doc.documentElement.clientHeight
			? rect.bottom + gap
			: Math.max(12, rect.top - height - gap);
	card.style.left = `${left}px`;
	card.style.top = `${top}px`;
};

const contactTarget = target => target?.closest?.('[data-contact-email], a[href^="mailto:"]');

const targetData = target => ({
	email: cleanEmail(target.dataset.contactEmail || target.getAttribute('href')),
	name: String(target.dataset.contactName || target.textContent || '').trim()
});

const show = target => {
	const fallback = targetData(target);
	if (!fallback.email || !fallback.email.includes('@')) return;
	activeTarget = target;
	render(null, fallback);
	position(target);
	const currentRequest = ++requestId;
	let request = cache.get(fallback.email);
	if (!request) {
		request = window.snappyDesktop?.ai?.contactCard
			? window.snappyDesktop.ai.contactCard(fallback.email).catch(() => null)
			: Promise.resolve(null);
		cache.set(fallback.email, request);
	}
	request.then(data => {
		if (currentRequest !== requestId || activeTarget !== target) return;
		render(data, fallback);
		position(target);
	});
};

const hide = () => {
	activeTarget = null;
	requestId++;
	if (card) card.hidden = true;
};

export function installContactHoverCard() {
	if (card) return;
	card = createElement('aside', {
		class: 'contact-hover-card',
		role: 'tooltip',
		hidden: 'hidden'
	});
	doc.body.append(card);

	doc.addEventListener('pointerover', event => {
		const target = contactTarget(event.target);
		if (!target || target === activeTarget) return;
		clearTimeout(hideTimer);
		clearTimeout(showTimer);
		showTimer = setTimeout(() => show(target), 260);
	});
	doc.addEventListener('pointerout', event => {
		const target = contactTarget(event.target);
		if (!target || target.contains(event.relatedTarget)) return;
		clearTimeout(showTimer);
		hideTimer = setTimeout(hide, 100);
	});
	doc.addEventListener('focusin', event => {
		const target = contactTarget(event.target);
		if (target) show(target);
	});
	doc.addEventListener('focusout', event => {
		if (contactTarget(event.target)) hide();
	});
}
