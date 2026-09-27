import { attribute, float, max, mix, normalView, smoothstep, uv, vec3, vec2 } from 'three/tsl';

/** Filtered weave: distant cloth stays matte instead of sparkling or moire. */
export function fabricDetail() {

	const p = uv().mul( 700 );
	const filter = p.fwidth().length().mul( 0.25 ).oneMinus().clamp();
	const thread = p.x.sin().mul( p.y.sin() ).mul( filter );
	return { thread, bump: vec2( p.x.cos().mul( p.y.sin() ), p.x.sin().mul( p.y.cos() ) ).mul( filter ) };

}

export function clothed( cut ) {

	const cloth = attribute( 'cloth', 'vec4' );
	return max( smoothstep( 0.2, 0.48, cloth.x ), max(
		float( 1 ).sub( smoothstep( cut.x.sub( 0.04 ), cut.x.add( 0.04 ), cloth.y ) ),
		float( 1 ).sub( smoothstep( cut.y.sub( 0.04 ), cut.y.add( 0.04 ), cloth.z ) ) ) );

}

/** Shared by VAT crowds, focused people and fallen rigs. */
export function dressSurface( material, cut, normal = normalView ) {

	const detail = fabricDetail();
	const fabric = clothed( cut );
	material.roughnessNode = mix( float( 0.86 ).add( detail.thread.mul( 0.015 ) ), float( 0.94 ).add( detail.thread.mul( 0.035 ) ), fabric );
	material.normalNode = normal.add( vec3( detail.bump.mul( fabric.mul( 0.018 ).add( 0.003 ) ), 0 ) ).normalize();

}
