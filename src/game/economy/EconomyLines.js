import standard from './lines.md?raw';
import { CompanionLines } from '../companion/CompanionLines.js';

/** Every key the economy lines hold. */
export const KEYS = Object.freeze( [
	'notice-paid', 'notice-received', 'notice-given', 'notice-wage', 'notice-wage-text', 'notice-wage-weeks-text', 'notice-shift', 'notice-reward',
	'notice-fare', 'notice-lifted-credits', 'notice-lifted-thing', 'notice-bribe-refused', 'notice-cannot-afford',
	'label-hand', 'label-credits', 'label-pay', 'label-buy', 'label-sell', 'label-sell-item', 'label-back', 'prompt-lift', 'prompt-buy',
	'say-thing', 'say-credits', 'say-pay', 'say-buy', 'say-sell',
	'accept-thing', 'refuse-thing-hostile', 'refuse-thing-wary', 'refuse-thing-neutral', 'accept-credits', 'refuse-credits-hostile', 'refuse-credits-wary',
	'refuse-bribe', 'accept-bribe', 'sold', 'bought', 'refuse-buy', 'refuse-serve', 'thanks-paid'
] );
/** The values a line may name. */
const NAMES = new Set( [ 'amount', 'name', 'item', 'what', 'price', 'credits', 'gross', 'fee', 'net', 'weeks' ] );

/** The notices, labels and lines of credits and things changing hands ([lines.md](lines.md) by default), read as the companion's lines are. */
export function economyLines( markdown = standard ) {

	return new CompanionLines( markdown, { keys: KEYS, names: NAMES } );

}
