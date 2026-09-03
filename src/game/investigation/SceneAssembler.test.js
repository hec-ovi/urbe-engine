import { describe, expect, it } from 'vitest';
import interior from './fixtures/interior-incident.json';
import street from './fixtures/street-incident.json';
import { InvestigationError } from './InvestigationError.js';
import { SceneAssembler } from './SceneAssembler.js';

describe( 'SceneAssembler', () => {

	it( 'reproduces one authored interior scene exactly without inventing clues', () => {

		const assembler = new SceneAssembler();
		const first = assembler.assemble( interior );
		const second = assembler.assemble( structuredClone( interior ) );

		expect( second ).toEqual( first );
		expect( first.evidence.map( ( item ) => item.evidenceId ) ).toEqual( interior.evidence.map( ( item ) => item.evidenceId ) );
		expect( first.targets.map( ( target ) => target.entityId ) ).toEqual( [
			'courier-body', 'directional-blood-stain', 'dropped-access-card'
		] );
		expect( first.entities ).toHaveLength( interior.bodies.length + interior.props.length );
		expect( first.decals ).toHaveLength( interior.decals.length );

	} );

	it( 'keeps fitted entities outside blockers and entry clearances with exact ground contact', () => {

		const result = new SceneAssembler().assemble( interior );
		const blocked = interior.location.blockedZones[ 0 ];
		const entry = interior.location.entries[ 0 ];

		for ( const entity of result.entities ) {

			const local = {
				x: entity.footprint.center.x - interior.location.origin.x,
				z: entity.footprint.center.z - interior.location.origin.z
			};
			expect( rectsOverlap( { ...entity.footprint, center: local }, blocked, 0.12 ) ).toBe( false );
			expect( circleHitsRect( entry.position, entry.clearanceRadius, { ...entity.footprint, center: local } ) ).toBe( false );
			const expectedY = interior.location.origin.y - entity.asset.groundContact.y;
			expect( entity.transform.position.y ).toBeCloseTo( expectedY, 6 );

		}

		for ( let left = 0; left < result.entities.length; left ++ ) for ( let right = left + 1; right < result.entities.length; right ++ ) {

			const a = worldFootprintInLocalFrame( result.entities[ left ], interior.location );
			const b = worldFootprintInLocalFrame( result.entities[ right ], interior.location );
			expect( rectsOverlap( a, b, 0.12 ) ).toBe( false );

		}

	} );

	it( 'fits a PBR decal to its receiving surface with an explicit anti-flicker offset', () => {

		const result = new SceneAssembler().assemble( interior );
		const decal = result.decals[ 0 ];
		const source = interior.decals[ 0 ];

		expect( decal.material ).toEqual( source.material );
		expect( decal.offsetMeters ).toBe( 0.006 );
		expect( decal.transform.position.y ).toBeCloseTo( interior.location.origin.y + 0.006, 6 );
		expect( decal.transform.normal ).toEqual( { x: 0, y: 1, z: 0 } );
		expect( Math.abs( decal.transform.position.x - interior.location.origin.x ) + decal.width / 2 )
			.toBeLessThanOrEqual( interior.location.width / 2 + 1e-6 );
		expect( Math.abs( decal.transform.position.z - interior.location.origin.z ) + decal.height / 2 )
			.toBeLessThanOrEqual( interior.location.depth / 2 + 1e-6 );

	} );

	it( 'transforms street placements and approach points through the measured location frame', () => {

		const result = new SceneAssembler().assemble( street );

		expect( result.location ).toEqual( { kind: 'street', placeId: 'edge-service-9' } );
		for ( const target of result.targets ) {

			const local = worldToLocal( target.approachPoint, street.location );
			expect( Math.abs( local.x ) ).toBeLessThanOrEqual( street.location.width / 2 );
			expect( Math.abs( local.z ) ).toBeLessThanOrEqual( street.location.depth / 2 );

		}
		expect( result.decals[ 0 ].transform.uAxis ).toEqual( street.location.receivingSurfaces[ 0 ].uAxis );

	} );

	it( 'keeps both measured scene families valid across stable variation seeds', () => {

		for ( const fixture of [ interior, street ] ) {

			const variants = new Set();
			for ( let seed = 0; seed < 32; seed ++ ) {

				const request = structuredClone( fixture );
				request.seed = seed;
				let result;
				try {

					result = new SceneAssembler().assemble( request );

				} catch ( error ) {

					throw new Error( `${fixture.sceneId} seed ${seed}: ${error.message}` );

				}
				expect( result.seed ).toBe( seed );
				expect( result.targets ).toHaveLength( request.evidence.length );
				expect( result.targets.every( ( target ) => Number.isFinite( target.approachPoint.x ) && Number.isFinite( target.approachPoint.z ) ) ).toBe( true );
				variants.add( JSON.stringify( result.entities.map( ( entity ) => entity.transform ) ) );

			}
			expect( variants.size ).toBeGreaterThan( 1 );
		}

	} );

	it( 'rejects evidence without exactly one authored visual', () => {

		const missing = structuredClone( interior );
		delete missing.bodies[ 0 ].evidenceId;

		expect( () => new SceneAssembler().assemble( missing ) ).toThrowError( expect.objectContaining( {
			name: 'InvestigationError', code: 'E_INVESTIGATION_GEOMETRY'
		} ) );

		const duplicate = structuredClone( interior );
		duplicate.props[ 1 ].evidenceId = 'body-position';
		expect( () => new SceneAssembler().assemble( duplicate ) ).toThrow( /more than one visual/ );

	} );

	it( 'rejects crooked receiving frames and decals that cross a blocked surface region', () => {

		const crooked = structuredClone( interior );
		crooked.location.receivingSurfaces[ 0 ].uAxis = { x: 0.8, y: 0.2, z: 0 };
		expect( () => new SceneAssembler().assemble( crooked ) ).toThrow( /unit length/ );

		const cutout = structuredClone( interior );
		cutout.decals[ 0 ].nearEntityId = undefined;
		cutout.decals[ 0 ].localCenter = { x: 0, z: -3.2 };
		expect( () => new SceneAssembler().assemble( cutout ) ).toThrowError( expect.objectContaining( {
			code: 'E_INVESTIGATION_NO_FIT'
		} ) );

	} );

	it( 'fails closed when the measured location cannot fit an authored body', () => {

		const impossible = structuredClone( interior );
		impossible.bodies[ 0 ].dimensions.width = 8;
		impossible.bodies[ 0 ].dimensions.depth = 7;

		let failure;
		try {

			new SceneAssembler().assemble( impossible );

		} catch ( error ) {

			failure = error;

		}
		expect( failure ).toBeInstanceOf( InvestigationError );
		expect( failure.code ).toBe( 'E_INVESTIGATION_NO_FIT' );

	} );

	it( 'rejects off-contract scene requests at the boundary', () => {

		const invalid = structuredClone( street );
		invalid.location.unmeasuredGuess = true;

		expect( () => new SceneAssembler().assemble( invalid ) ).toThrowError( expect.objectContaining( {
			code: 'E_INVESTIGATION_INPUT'
		} ) );

	} );

} );

function rectsOverlap( left, right, gap ) {

	return Math.abs( left.center.x - right.center.x ) < ( left.width + right.width ) / 2 + gap &&
		Math.abs( left.center.z - right.center.z ) < ( left.depth + right.depth ) / 2 + gap;

}

function circleHitsRect( point, radius, rect ) {

	const x = Math.max( rect.center.x - rect.width / 2, Math.min( rect.center.x + rect.width / 2, point.x ) );
	const z = Math.max( rect.center.z - rect.depth / 2, Math.min( rect.center.z + rect.depth / 2, point.z ) );
	return Math.hypot( point.x - x, point.z - z ) < radius;

}

function worldFootprintInLocalFrame( entity, location ) {

	const center = worldToLocal( { x: entity.footprint.center.x, z: entity.footprint.center.z }, location );
	const quarter = Math.round( ( entity.footprint.yawRadians - location.yawRadians ) / ( Math.PI / 2 ) );
	const swap = Math.abs( quarter ) % 2 === 1;
	return {
		center,
		width: swap ? entity.footprint.depth : entity.footprint.width,
		depth: swap ? entity.footprint.width : entity.footprint.depth
	};

}

function worldToLocal( point, location ) {

	const x = point.x - location.origin.x;
	const z = point.z - location.origin.z;
	const cosine = Math.cos( location.yawRadians );
	const sine = Math.sin( location.yawRadians );
	return { x: x * cosine - z * sine, z: x * sine + z * cosine };

}
