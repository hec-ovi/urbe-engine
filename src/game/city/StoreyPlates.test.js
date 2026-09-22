import { expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { interiorStoreys, cutPlate } from './StoreyPlates.js';

it.each( [ 0, - 90, 37 ] )( 'opens the rotated core and preserves every facade floor band at %s°', degrees => {
	const angle = degrees * Math.PI / 180;
	const world = ( x, z ) => [ 12 + x * Math.cos( angle ) - z * Math.sin( angle ), - 8 + x * Math.sin( angle ) + z * Math.cos( angle ) ];
	const [ cx, cz ] = world( 8, 5 );
	const source = {
		building: { floors: [ { index: 1, layout: 'middle', elevation: 4 } ] },
		layouts: { middle: { floor: { height: 4, coreAngleDeg: degrees,
			rooms: [ { polygon: [ world( 2, 2 ), world( 7, 2 ), world( 7, 8 ), world( 2, 8 ) ] } ],
			core: { stairs: [ { rect: { x: cx - 1, z: cz - 2, w: 2, d: 4 } } ] }
		}, placements: [] } }
	};
	const corners = [ world( 0, 0 ), world( 10, 0 ), world( 10, 10 ), world( 0, 10 ) ];
	const values = [ 0, 1, 2, 0, 2, 3 ].flatMap( i => [ corners[ i ][ 0 ], 4, corners[ i ][ 1 ] ] );
	const whole = new THREE.BufferGeometry().setAttribute( 'position', new THREE.Float32BufferAttribute( values, 3 ) );
	const rect = interiorStoreys( 'rotated', source ).get( 1 ).rect;
	const band = cutPlate( whole, rect );
	const material = new THREE.MeshBasicMaterial( { side: THREE.DoubleSide } );
	const mesh = new THREE.Mesh( band, material ); mesh.updateMatrixWorld();
	const hits = ( x, z ) => {
		const [ wx, wz ] = world( x, z );
		return new THREE.Raycaster( new THREE.Vector3( wx, 5, wz ), new THREE.Vector3( 0, - 1, 0 ), 0, 2 ).intersectObject( mesh ).length;
	};
	for ( const [ x, z ] of [ [ .5, 5 ], [ 9.5, 5 ], [ 5, 1 ], [ 5, 9 ] ] ) expect( hits( x, z ), `band ${x},${z}` ).toBeGreaterThan( 0 );
	expect( hits( 8, 5 ), 'open stair well' ).toBe( 0 );
	expect( hits( 5, 5 ), 'no duplicate room floor' ).toBe( 0 );
	whole.dispose(); band.dispose(); material.dispose();
} );
