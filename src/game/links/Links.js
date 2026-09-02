import * as THREE from 'three/webgpu';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { cutPlanes } from './Apertures.js';
import { framesAlong } from './PathFrames.js';
import { openDeck, rectShell, roundTube } from './Sweep.js';

// One material per kind of thing, never per link: an air duct is sheet metal,
// a skybridge and a service tunnel are the same cast concrete, a wire is
// insulated cable. Three keys is three draw calls for every link in the city.
const KEYS = {
	'ac-tube': 'cyberpunk/metal/mid',
	bridge: 'cyberpunk/concrete/mid',
	tunnel: 'cyberpunk/concrete/mid',
	wire: 'cyberpunk/rubber/mid'
};
/** A 10 cm cable read from metres away; more sides would be invisible. */
const WIRE_SIDES = 5;
/** A parapet a person cannot go over, which is what stops a walk off a deck. */
export const RAILING = 1.1;

/**
 * Every inter-building link the connections box published, as geometry and as
 * something to stand on: bridges as open decks between two railings, tunnels
 * and AC tubes as closed boxes you walk through (and over, on a tube), and the
 * wires strung across the streets.
 *
 * Each link is swept from its own centerline and cross section, and its two
 * ends are sliced by the planes of the apertures it terminates on, so the end
 * face is the hole the facade was carved with rather than a square cut near it.
 *
 * The whole city merges by material, not by link: the skyline already spends
 * its submission budget on buildings, and a draw call per bridge would put
 * a hundred more on top of it for a few thousand triangles.
 */
export class Links {

	/**
	 * @param connections the connections document (`links` and `apertures`)
	 * @param factory PbrMaterialFactory
	 */
	constructor( connections, factory ) {

		this.links = connections.links;
		this.planes = cutPlanes( connections.apertures );
		this.factory = factory;

	}

	/** @returns { group, colliderGeometry, triangles, drawCalls } */
	build() {

		const byKey = new Map();
		const solid = [];

		for ( const link of this.links ) {

			const key = KEYS[ link.kind ];

			if ( ! key ) continue;

			const geometry = this.#sweep( link );

			if ( ! byKey.has( key ) ) byKey.set( key, [] );

			byKey.get( key ).push( geometry );

			// The shell is one surface, so walking through a bridge and walking
			// over a tube are the same triangles. A link that is walkable in
			// neither sense is not solid at all: a wire is something to look at.
			if ( link.walkable.inside || link.walkable.over ) solid.push( positionsOnly( geometry ) );

		}

		const group = new THREE.Group();
		group.name = 'links';
		let triangles = 0;

		for ( const [ key, geometries ] of byKey ) {

			const merged = BufferGeometryUtils.mergeGeometries( geometries, false );
			geometries.forEach( ( geometry ) => geometry.dispose() );
			triangles += merged.getAttribute( 'position' ).count / 3;

			const mesh = new THREE.Mesh( merged, this.#material( key ) );
			mesh.name = `links:${key}`;
			mesh.castShadow = true;
			mesh.receiveShadow = true;
			group.add( mesh );

		}

		return {
			group,
			colliderGeometry: solid.length ? BufferGeometryUtils.mergeGeometries( solid, false ) : null,
			triangles,
			drawCalls: byKey.size
		};

	}

	/**
	 * A link's geometry from its centerline and section. Both ends take the
	 * plane of their own aperture; a wire's anchor is a mounting footprint
	 * rather than a hole, but its plane is still the facade, so the cable meets
	 * the wall flush.
	 */
	#sweep( link ) {

		const { shape, width, height } = link.crossSection;
		const frames = framesAlong( link.path, {
			first: this.planes.get( link.a.apertureId ),
			last: this.planes.get( link.b.apertureId )
		} );

		if ( shape !== 'rect' ) return roundTube( frames, width / 2, WIRE_SIDES );

		// A bridge is an open crossing in the air, a tube is a duct: the first
		// is a deck between two railings, the second a closed box.
		return link.kind === 'bridge'
			? openDeck( frames, width, height, RAILING )
			: rectShell( frames, width, height );

	}

	/**
	 * A shell has no inside and no outside, so it is drawn from both: standing
	 * on an AC tube and standing in it look at the same triangles. The wire is
	 * a closed tube and keeps its back faces culled.
	 */
	#material( key ) {

		return key === KEYS.wire
			? this.factory.build( key )
			: this.factory.variant( key, { side: THREE.DoubleSide } );

	}

}

/** What the physics world needs and nothing else. */
function positionsOnly( geometry ) {

	const copy = new THREE.BufferGeometry();
	copy.setAttribute( 'position', geometry.getAttribute( 'position' ).clone() );

	return copy;

}
