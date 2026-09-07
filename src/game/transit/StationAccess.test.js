import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { StationAccess } from './StationAccess.js';
import { Transit } from './Transit.js';
import { TransitJourneyBoundary } from './TransitJourneyBoundary.js';
import { stationCity } from './station.test-fixtures.js';
import { ObjectiveRouter } from '../routes/ObjectiveRouter.js';

describe( 'short station entrances', () => {

	it( 'projects player routes onto authored entrances without changing the source or unrelated walks', () => {

		const access = new StationAccess( stationCity() ), [ entry ] = access.entrances;
		const entrance = [ ...entry.origin ];
		const node = ( id, kind, x, y, z, ref ) => ( { id, kind, x, y, z, ...( ref ? { ref } : {} ) } );
		const nodes = [
			node( 'street', 'sidewalk', entrance[ 0 ] - 3.5, entry.top, entrance[ 1 ] ),
			node( 'corner', 'corner', entrance[ 0 ] - 3.5, entry.top, entrance[ 1 ] + 10 ),
			node( 'mouth', 'station-entrance', entrance[ 0 ], entry.top, entrance[ 1 ], 's0' ),
			node( 'stairs', 'station-access', entrance[ 0 ], - 6, entrance[ 1 ] + 3, 's0' ),
			node( 'handoff', 'station-handoff', entrance[ 0 ] - 8, - 12, entrance[ 1 ], 's0' ),
			node( 'platform', 'station', entrance[ 0 ] - 12, - 12, entrance[ 1 ], 's0' ),
			node( 'legacy', 'station', 100, - 12, 30, 's1' )
		];
		const edge = ( id, from, to, kind, stationId ) => ( {
			id, from, to, kind, path3: [ from, to ].map( id => { const n = nodes.find( n => n.id === id ); return [ n.x, n.y, n.z ]; } ),
			...( stationId ? { stationId } : {} )
		} );
		const network = { nodes, edges: [
			edge( 'street-walk', 'street', 'corner', 'sidewalk' ), edge( 'approach', 'street', 'mouth', 'access' ),
			edge( 'flight', 'mouth', 'stairs', 'stairs', 's0' ), edge( 'passage', 'stairs', 'handoff', 'passage', 's0' ),
			edge( 'platform-walk', 'handoff', 'platform', 'platform', 's0' ),
			edge( 'deep-shortcut', 'street', 'corner', 'passage', 's0' ), edge( 'legacy-access', 'corner', 'legacy', 'stairs', 's1' )
		] };
		const source = structuredClone( network );
		expect( () => new ObjectiveRouter( network ) ).not.toThrow();
		const projected = access.walk( network );
		expect( network ).toEqual( source );
		expect( projected.nodes ).toEqual( [ nodes[ 0 ], nodes[ 1 ], { ...nodes[ 2 ], kind: 'station' }, nodes[ 6 ] ] );
		expect( projected.edges ).toEqual( [ network.edges[ 0 ], network.edges[ 1 ], network.edges[ 6 ] ] );
		const route = new ObjectiveRouter( projected ).route( {
			from: [ nodes[ 0 ].x, nodes[ 0 ].y, nodes[ 0 ].z ], destination: { kind: 'station', id: 's0' }
		} );
		expect( route.edgeIds ).toEqual( [ 'approach' ] );
		expect( route.path3.at( - 1 ) ).toEqual( [ nodes[ 2 ].x, nodes[ 2 ].y, nodes[ 2 ].z ] );

	} );

	for ( const heading of [ 0, Math.PI / 3 ] ) it( `keeps a walkable stair, terminal and closed landing in a shaft rotated ${heading}`, () => {

		const atlas = stationCity( [ heading ] ), [ entry ] = new StationAccess( atlas ).entrances;
		expect( new TransitJourneyBoundary().valid( 'station-access', [ entry ] ) ).toBe( true );
		expect( entry.top ).toBe( 0.26 );
		expect( entry.treads ).toBeGreaterThan( 2 );
		expect( entry.floor ).toBeGreaterThan( - 3 );
		const material = new THREE.MeshStandardMaterial( { side: THREE.DoubleSide } );
		const built = [], factory = { build: key => { built.push( key ); return material; }, variant: key => { built.push( key ); return material; } };
		const transit = new Transit( { atlas, networks: null, factory } );
		const geometry = transit.colliders.get( 'transit:entrances' );
		const collider = new THREE.Mesh( geometry, material );
		const meshes = transit.group.getObjectByName( 'station-entrances' ).children;
		expect( meshes.length ).toBeLessThanOrEqual( 8 );
		expect( new Set( built ).size ).toBeGreaterThan( 1 );
		expect( transit.glows ).toHaveLength( 1 );
		expect( transit.glows[ 0 ] ).toMatchObject( { lumens: 700, range: 7 } );
		for ( const mesh of [ ...meshes, collider ] ) {

			const vertices = mesh.geometry.getAttribute( 'position' );
			for ( let index = 0; index < vertices.count; index ++ ) {

				const [ x, z ] = local( entry, [ vertices.getX( index ), 0, vertices.getZ( index ) ] );
				expect( x ).toBeGreaterThanOrEqual( - 1.5001 );
				expect( x ).toBeLessThanOrEqual( 1.5001 );
				expect( z ).toBeGreaterThanOrEqual( - 4.0001 );
				expect( z ).toBeLessThanOrEqual( 4.0001 );
				expect( vertices.getY( index ) ).toBeGreaterThanOrEqual( entry.floor - 0.1801 );

			}

		}
		// The published side approach reaches a level deck without a parapet blocking it.
		for ( const x of [ - 1.49, - 0.8, 0 ] ) expect( floorAt( collider, entry.point( x, 0, 0 ) ) ).toBeCloseTo( entry.top, 5 );
		const opening = new THREE.Raycaster( new THREE.Vector3( ...entry.point( - 2, entry.top + 0.4, 0 ) ),
			new THREE.Vector3( Math.cos( entry.heading ), 0, - Math.sin( entry.heading ) ), 0, 2 );
		expect( opening.intersectObject( collider ) ).toHaveLength( 0 );
		let previous = entry.top;
		for ( let tread = 0; tread < entry.treads; tread ++ ) {

			const height = floorAt( collider, entry.point( 0, 0, 0.45 + ( tread + 0.5 ) * 0.3 ) );
			expect( previous - height ).toBeGreaterThan( 0 );
			expect( previous - height ).toBeLessThanOrEqual( 0.18001 );
			previous = height;

		}
		expect( previous ).toBeCloseTo( entry.floor, 5 );
		// A player's landing footprint has floor support and headroom clear of the machine.
		const [ arrivalX, arrivalZ ] = local( entry, entry.arrival );
		for ( const dx of [ - 0.32, 0, 0.32 ] ) for ( const dz of [ - 0.32, 0, 0.32 ] ) {

			expect( floorAt( collider, entry.point( arrivalX + dx, 0, arrivalZ + dz ) ) ).toBeCloseTo( entry.floor, 5 );

		}
		const rear = new THREE.Raycaster( new THREE.Vector3( ...entry.point( 0.8, entry.floor + 0.7, arrivalZ ) ),
			new THREE.Vector3( Math.sin( entry.heading ), 0, Math.cos( entry.heading ) ), 0, 3 );
		const endWall = rear.intersectObject( collider )[ 0 ];
		expect( endWall ).toBeDefined();
		expect( local( entry, endWall.point.toArray() )[ 1 ] ).toBeCloseTo( 3.82, 4 );

	} );

} );

function local( entry, position ) {

	const x = position[ 0 ] - entry.origin[ 0 ], z = position[ 2 ] - entry.origin[ 1 ];
	return [ Math.cos( entry.heading ) * x - Math.sin( entry.heading ) * z, Math.sin( entry.heading ) * x + Math.cos( entry.heading ) * z ];

}

function floorAt( collider, point ) {

	const ray = new THREE.Raycaster( new THREE.Vector3( point[ 0 ], 4, point[ 2 ] ), new THREE.Vector3( 0, - 1, 0 ) );
	return ray.intersectObject( collider )[ 0 ]?.point.y;

}
