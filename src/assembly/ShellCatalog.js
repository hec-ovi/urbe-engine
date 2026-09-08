import { AssemblyError } from './RequestAssembler.js';
import { validateExteriorBlueprint } from './validators.js';

/** Source-derived massing and material bindings for distant shell rendering. */
export class ShellCatalog {

	constructor( seed ) {

		this.seed = seed;
		this.buildings = [];
		this.ids = new Set();

	}

	add( id, blueprint ) {

		const errors = validateExteriorBlueprint( blueprint );
		if ( errors.length ) fail( id, `Exterior blueprint ${errors[ 0 ].instancePath}: ${errors[ 0 ].message}` );
		if ( blueprint.buildingId !== id || this.ids.has( id ) ) fail( id, 'duplicate or mismatched shell identity' );
		const field = blueprint.facade?.materialPlan?.field;
		if ( ! field ) fail( id, 'missing published concrete material plan' );
		const floors = blueprint.floors.filter( floor => floor.index >= 0 ).sort( ( a, b ) => a.index - b.index );
		if ( ! floors.length ) fail( id, 'missing ground floor' );
		const bands = [];
		for ( const [ index, floor ] of floors.entries() ) {

			if ( floor.index !== index || ( index === 0 && floor.elevation !== 0 ) ) fail( id, 'noncontiguous authored floor indices' );
			const previous = bands.at( - 1 );
			if ( previous && Math.abs( previous.top - floor.elevation ) > 1e-6 ) fail( id, 'noncontiguous authored storey heights' );
			const material = floor.index === 0 ? blueprint.facade.groundMaterial ?? field : field;
			const top = floor.elevation + floor.height;
			if ( previous && sameOutline( previous.outline, floor.outline )
				&& previous.material.key === material.key && previous.material.variantId === material.variantId ) previous.top = top;
			else bands.push( { bottom: floor.elevation, top, outline: floor.outline, material: { ...material } } );

		}
		if ( Math.abs( bands.at( - 1 ).top - blueprint.roof.elevation ) > 1e-6 ) fail( id, 'roof elevation differs from the final authored storey' );
		if ( Math.abs( blueprint.bounds.height - blueprint.roof.elevation - blueprint.roof.parapetHeight ) > 1e-6 ) fail( id, 'published bounds differ from the roof and parapet height' );
		const ring = blueprint.bounds.footprint;
		const xs = ring.map( point => point[ 0 ] ), zs = ring.map( point => point[ 1 ] );
		const roofKeys = blueprint.materials.filter( key => key.split( '/' )[ 1 ] === 'roof' );
		const key = roofKeys[ 0 ], variantId = blueprint.materialVariants[ key ];
		if ( roofKeys.length !== 1 || ! variantId ) fail( id, 'missing unambiguous published roof material variant' );
		this.buildings.push( {
			id,
			bounds: { min: [ Math.min( ...xs ), 0, Math.min( ...zs ) ], max: [ Math.max( ...xs ), blueprint.bounds.height, Math.max( ...zs ) ] },
			center: [ xs.reduce( ( a, b ) => a + b, 0 ) / xs.length, 0, zs.reduce( ( a, b ) => a + b, 0 ) / zs.length ],
			floorCount: floors.length,
			basementCount: blueprint.floors.filter( floor => floor.index < 0 ).length,
			bands,
			roof: {
				elevation: blueprint.roof.elevation,
				outline: blueprint.roof.outline,
				parapetHeight: blueprint.roof.parapetHeight,
				material: { key, variantId },
				parapetMaterial: { ...field }
			}
		} );
		this.ids.add( id );

	}

	value() { return { version: '1.0.0', seed: this.seed, buildings: this.buildings }; }

}

function sameOutline( a, b ) {

	return a.length === b.length && a.every( ( point, index ) => point[ 0 ] === b[ index ][ 0 ] && point[ 1 ] === b[ index ][ 1 ] );

}

function fail( id, message ) { throw new AssemblyError( 'E_SHELL_CATALOG', `${id}: ${message}` ); }
