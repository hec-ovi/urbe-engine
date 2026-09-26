import { randomUUID } from 'node:crypto';
import templates from '../city-templates.json' with { type: 'json' };
import { CreationError } from './CreationError.js';

export class CityTemplate {

	/** Refuses what the schema cannot say: a blank name or seed, and a district range that runs backwards. */
	static check( input ) {

		if ( input.name?.trim() === '' || input.seed?.trim() === '' ) throw new CreationError( 'E_INVALID_REQUEST', 'Name and seed must contain text when supplied' );
		const [ min, max ] = input.districtCount ?? [];
		if ( min > max ) throw new CreationError( 'E_INVALID_REQUEST', 'districtCount must be [min, max] with min <= max' );

	}

	constructor( input ) {

		CityTemplate.check( input );
		const template = templates[ input.size ];
		this.input = {
			...input,
			name: input.name?.trim() ?? `${template.label} city ${randomUUID().slice( 0, 8 )}`,
			seed: input.seed?.trim() ?? randomUUID()
		};
		this.args = template.args;
		/** The Atlas parameters asked for, handed to Atlas unchanged; the plan must record them. */
		this.params = input.districtCount ? { districtCount: input.districtCount } : {};

	}

	command( blueprint ) {

		const { districtCount } = this.params;
		return [
			'run', 'generate', '--', '--seed', this.input.seed, '--out', blueprint, ...this.args,
			...( districtCount ? [ '--district-count', districtCount.join( ',' ) ] : [] )
		];

	}

}
