import { clamp, float, floor, min, select, vec2 } from 'three/tsl';

export function decal( s, p ) {
	const base = s.scan ? scan( s ) : s.map( 'basecolor' );
	return { colorNode: base.rgb, opacityNode: base.a.mul( p.opacity ), roughnessNode: float( p.roughness ) };
}

/**
 * One quad, four scan cells. The placement's UV transform lands its own cell of
 * the shared atlas on the quad, so the whole part of the coordinate picks the
 * image and the fraction reads inside it.
 */
function scan( s ) {
	const cells = s.scan.cells;
	const u = s.scan.uv.x.mul( cells.length ).toConst();
	const cell = clamp( floor( u ), 0, cells.length - 1 ).toConst();
	const coordinates = vec2( min( u.sub( cell ), 1 ), s.scan.uv.y );

	let sample = cells[ 0 ]( coordinates );
	for ( let index = 1; index < cells.length; index ++ ) sample = select( cell.equal( float( index ) ), cells[ index ]( coordinates ), sample );

	return sample;
}
