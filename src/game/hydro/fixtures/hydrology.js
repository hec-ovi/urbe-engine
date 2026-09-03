import * as THREE from 'three/webgpu';

const KEYS = Object.freeze( {
	'water.lagoon': { key: 'cyberpunk/water-surface/high_rich', variantId: 'lagoon' },
	'water.river': { key: 'cyberpunk/water-surface/high_rich', variantId: 'river' },
	'water.sea-coast': { key: 'cyberpunk/water-surface/high_rich', variantId: 'sea-coast' }
} );

export const MATERIAL_BINDINGS_FIXTURE = KEYS;

export const HYDROLOGY_FIXTURES = [
	plan( 'lagoon', 'hydro-1234abcd', 10 ),
	plan( 'river', 'hydro-3456abcd', 60, true ),
	plan( 'sea-coast', 'hydro-5678abcd', 110 )
];

/** A materials-boundary double with complete tiled PBR entry data. */
export function materialsFixture( { unresolved = false, missingMaps = false, fallback = false } = {} ) {

	const trace = { resolved: [], built: [] };
	const entries = Object.fromEntries( Object.values( KEYS ).map( ( binding ) => [ binding.key, entry( binding.key, missingMaps ) ] ) );
	const resolver = {
		resolve( key ) {

			trace.resolved.push( key );
			return unresolved ? null : entries[ key ] ?? null;

		}
	};
	const factory = {
		resolver,
		build( key, variantId ) {

			trace.built.push( [ key, variantId ] );
			if ( fallback ) {

				const material = new THREE.MeshStandardMaterial();
				material.name = `unresolved:${key}`;
				return material;

			}
			const material = new THREE.MeshPhysicalMaterial( { roughness: 0.4, envMapIntensity: 0.5, ior: 1.5 } );
			material.name = key;
			material.normalMap = new THREE.Texture();
			return material;

		}
	};
	return { factory, bindings: KEYS, trace };

}

function plan( type, seedId, offset, crossings = false ) {

	const surface = rectangle( offset, 10, offset + 30, 40 );
	const bodyId = `hb-${type}`;
	return {
		seedId,
		type,
		bodies: [ {
			id: bodyId,
			type,
			surfaces: [ surface ],
			shorelines: [ { id: `hs-${type}`, path: surface.map( clone ), closed: true, band: bands( surface, 2 ) } ],
			elevation: - 0.35,
			depth: type === 'lagoon' ? 6 : type === 'river' ? 8 : 30,
			materialKey: `water.${type}`
		} ],
		structures: crossings ? [
			{
				id: 'hw-bridge', kind: 'bridge', network: 'street', refId: 'e7', waterBodyId: bodyId,
				path: [ [ offset + 4, 25 ], [ offset + 26, 25 ] ], width: 14, level: 0
			},
			{
				id: 'hw-tunnel', kind: 'tunnel', network: 'subway', refId: 'sl2', waterBodyId: bodyId,
				path: [ [ offset + 15, 14 ], [ offset + 15, 36 ] ], width: 7, level: - 12
			}
		] : []
	};

}

function rectangle( x0, z0, x1, z1 ) {

	return [ [ x0, z0 ], [ x1, z0 ], [ x1, z1 ], [ x0, z1 ] ];

}

function bands( ring, inset ) {

	const [ [ x0, z0 ], [ x1 ], , [ , z1 ] ] = ring;
	return [
		[ [ x0, z0 ], [ x1, z0 ], [ x1, z0 + inset ], [ x0, z0 + inset ] ],
		[ [ x1, z0 ], [ x1, z1 ], [ x1 - inset, z1 ], [ x1 - inset, z0 ] ],
		[ [ x1, z1 ], [ x0, z1 ], [ x0, z1 - inset ], [ x1, z1 - inset ] ],
		[ [ x0, z1 ], [ x0, z0 ], [ x0 + inset, z0 ], [ x0 + inset, z1 ] ]
	];

}

function entry( key, missingMaps ) {

	const variants = Object.values( KEYS ).filter( ( binding ) => binding.key === key ).map( ( binding ) => ( {
		id: binding.variantId,
		resolution: [ 256, 256 ],
		maps: missingMaps
			? { basecolor: 'assets/water/basecolor.png' }
			: {
				basecolor: 'assets/water/basecolor.png',
				normal: 'assets/water/normal.png',
				roughness: 'assets/water/roughness.png',
				metallic: 'assets/water/metallic.png'
			}
	} ) );
	return { key, alignment: 'tile', tiling: { worldSize: [ 8, 8 ] }, physical: {}, variants };

}

function clone( point ) {

	return [ point[ 0 ], point[ 1 ] ];

}
