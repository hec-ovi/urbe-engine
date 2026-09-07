import { randomUUID } from 'node:crypto';
import templates from '../city-templates.json' with { type: 'json' };
import { CreationError } from './CreationError.js';

export class CityTemplate {

	constructor( input ) {

		const template = templates[ input.size ];
		this.input = {
			...input,
			name: input.name?.trim() ?? `${template.label} city ${randomUUID().slice( 0, 8 )}`,
			seed: input.seed?.trim() ?? randomUUID()
		};
		if ( ! this.input.name || ! this.input.seed ) throw new CreationError( 'E_INVALID_REQUEST', 'Name and seed must contain text when supplied' );
		this.args = template.args;

	}

	command( blueprint ) {

		return [ 'run', 'generate', '--', '--seed', this.input.seed, '--out', blueprint, ...this.args ];

	}

}
