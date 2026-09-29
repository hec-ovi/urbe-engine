import { float, mix, normalView, uv, vec3, vec2 } from 'three/tsl';

/** Filtered weave: distant cloth stays matte instead of sparkling or moire. */
export function fabricDetail() {

	const p = uv().mul( 700 );
	const filter = p.fwidth().length().mul( 0.25 ).oneMinus().clamp();
	const thread = p.x.sin().mul( p.y.sin() ).mul( filter );
	return { thread, bump: vec2( p.x.cos().mul( p.y.sin() ), p.x.sin().mul( p.y.cos() ) ).mul( filter ) };

}

/**
 * Shared by the VAT crowd's painted clothes: matte skin and a rougher weave
 * where cloth is, with a fine thread relief.
 *
 * @param fabric how much of the surface is cloth, 0 to 1
 */
export function dressSurface( material, fabric, normal = normalView ) {

	const detail = fabricDetail();
	material.roughnessNode = mix( float( 0.86 ).add( detail.thread.mul( 0.015 ) ), float( 0.94 ).add( detail.thread.mul( 0.035 ) ), fabric );
	material.normalNode = normal.add( vec3( detail.bump.mul( fabric.mul( 0.018 ).add( 0.003 ) ), 0 ) ).normalize();

}
