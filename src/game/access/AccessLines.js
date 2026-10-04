import standard from './lines.md?raw';
import { CompanionLines } from '../companion/CompanionLines.js';

/** Every key the access lines hold. */
const KEYS = [
	'label-access', 'ask-home', 'ask-staff', 'ask-service', 'ask-security', 'ask-homes', 'accept-card', 'refuse-card-hostile', 'refuse-card-wary', 'refuse-card-neutral', 'refuse-card-unavailable',
	'notice-card', 'notice-lifted', 'notice-caught', 'caught', 'prompt-locked', 'prompt-lift', 'prompt-closed', 'notice-closed'
];

/** The access asks' labels, what people say and the notices ([lines.md](lines.md) by default), read as the companion's lines are. */
export function accessLines( markdown = standard ) {

	return new CompanionLines( markdown, { keys: KEYS } );

}
