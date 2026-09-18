import * as THREE from 'three/webgpu';

/**
 * How two buildings of the same family differ on the street. The tint
 * multiplies the piece's own albedo, so it can only shift a facade slightly
 * warm, slightly cool or slightly darker: it never invents a colour the
 * material does not have, and it costs one instance attribute rather than a
 * geometry of its own.
 */
const RANGES = {
	'balcony-grid': [ 0xc9c4ba, 0xfffaf0 ],
	'corporate-sectors': [ 0xc4c7cf, 0xf6f8ff ],
	'faceted-bays': [ 0xcdc9c2, 0xfffdf6 ],
	'mirror-frame': [ 0xbfc2c8, 0xf2f4f8 ],
	'mirror-shutters': [ 0xc8c2b6, 0xfdf6e8 ],
	'white-grid': [ 0xd2d0cb, 0xffffff ]
};
const DEFAULT_RANGE = [ 0xc8c8c8, 0xffffff ];

const _low = new THREE.Color();
const _high = new THREE.Color();

/** The instance colour one parcel wears, stable for its id across rebuilds. */
export function tintFor( family, parcelId, target = new THREE.Color() ) {

	const [ low, high ] = RANGES[ family ] ?? DEFAULT_RANGE;

	return target.copy( _low.setHex( low ) ).lerp( _high.setHex( high ), fraction( parcelId ) );

}

/** A parcel id spread evenly over [0,1). */
function fraction( parcelId ) {

	let hash = 2166136261;
	for ( let index = 0; index < parcelId.length; index ++ ) hash = Math.imul( hash ^ parcelId.charCodeAt( index ), 16777619 );

	return ( hash >>> 0 ) / 2 ** 32;

}
