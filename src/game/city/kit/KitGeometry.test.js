import { expect, it } from 'vitest';
import { Group, Mesh, MeshStandardNodeMaterial, PlaneGeometry } from 'three/webgpu';
import { readShell } from './KitGeometry.js';

it( 'keeps every scenic surface separate from ordinary surfaces sharing its material', async () => {

	const scene = new Group();
	const room = new Group();
	room.name = 'scenery1';
	const privacy = new Group();
	privacy.name = 'ground-privacyw0';
	const mesh = ( key, x ) => {

		const material = new MeshStandardNodeMaterial();
		material.name = `cyberpunk/${key}/mid`;
		return new Mesh( new PlaneGeometry( 1, 1 ).translate( x, 0, 0 ), material );

	};
	room.add( mesh( 'paired-room-lit', 1 ), mesh( 'light-fixture', 2 ) );
	privacy.add( mesh( 'curtain', 3 ), mesh( 'window-glass-opaque', 4 ) );
	scene.add( room, privacy, mesh( 'light-fixture', 20 ), mesh( 'curtain', 30 ), mesh( 'window-glass-opaque', 40 ) );
	const materials = new Map();
	const catalog = key => {

		if ( ! materials.has( key ) ) materials.set( key, new MeshStandardNodeMaterial( { name: key } ) );
		return materials.get( key );

	};
	const factory = { resolver: { resolve: () => null }, build: catalog, variant: catalog };
	const shell = await readShell( scene, factory, { floors: [] }, { step: async () => {} } );
	const centers = surfaces => surfaces.map( ( { geometry, material } ) => {

		geometry.computeBoundingBox();
		return [ material.name, ( geometry.boundingBox.min.x + geometry.boundingBox.max.x ) / 2 ];

	} ).sort( ( a, b ) => a[ 1 ] - b[ 1 ] );

	expect( centers( shell.scenery ) ).toEqual( [
		[ 'cyberpunk/paired-room-lit/mid', 1 ], [ 'cyberpunk/light-fixture/mid', 2 ],
		[ 'cyberpunk/curtain/mid', 3 ], [ 'cyberpunk/window-glass-opaque/mid', 4 ]
	] );
	expect( centers( shell.surfaces ) ).toEqual( [
		[ 'cyberpunk/light-fixture/mid', 20 ], [ 'cyberpunk/curtain/mid', 30 ],
		[ 'cyberpunk/window-glass-opaque/mid', 40 ]
	] );
	expect( shell.scenery.filter( ( { geometry } ) => geometry.hasAttribute( 'scenicRadiance' ) ) ).toHaveLength( 1 );
	for ( const { geometry } of [ ...shell.scenery, ...shell.surfaces ] ) geometry.dispose();

} );
