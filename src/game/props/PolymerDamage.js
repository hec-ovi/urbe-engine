import * as THREE from 'three/webgpu';

/** One continuous deformation keeps walls, ribs and fitted panels joined. */
export class PolymerDamage {
	constructor( spec ) { this.size = spec.size; this.damage = spec.damage; }
	point( source, target ) {
		const [ w, h, d ] = this.size, { dent, twist, sag, taper } = this.damage;
		const u = source.x / ( w / 2 ), v = source.z / ( d / 2 );
		const level = THREE.MathUtils.clamp( source.y / h, 0, 1.2 );
		const shrink = 1 - taper * ( 1 - Math.min( 1, level ) );
		const angle = twist * level, c = Math.cos( angle ), s = Math.sin( angle );
		const frontDent = dent * Math.exp( - ( ( u - 0.3 ) ** 2 ) / 0.4 - ( level - 0.58 ) ** 2 / 0.13 ) * Math.max( 0, v ) ** 2;
		const x = source.x * shrink, z = source.z * shrink - frontDent;
		const y = source.y - sag * level ** 3 * Math.exp( - ( ( u - 0.7 ) ** 2 ) / 0.5 - ( v - 0.6 ) ** 2 / 0.6 );
		return target.set( x * c + z * s, y, - x * s + z * c );
	}
	apply( geometry ) {
		const positions = geometry.attributes.position, normals = geometry.attributes.normal;
		const p = new THREE.Vector3(), n = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
		const sample = new THREE.Vector3(), plus = new THREE.Vector3(), minus = new THREE.Vector3();
		const da = new THREE.Vector3(), db = new THREE.Vector3(), moved = new THREE.Vector3();
		const epsilon = 1e-4;
		for ( let i = 0; i < positions.count; i ++ ) {
			p.fromBufferAttribute( positions, i ); n.fromBufferAttribute( normals, i );
			a.set( Math.abs( n.y ) < 0.9 ? 0 : 1, Math.abs( n.y ) < 0.9 ? 1 : 0, 0 ).cross( n ).normalize(); b.crossVectors( n, a );
			for ( const [ tangent, delta ] of [ [ a, da ], [ b, db ] ] ) {
				this.point( sample.copy( p ).addScaledVector( tangent, epsilon ), plus );
				this.point( sample.copy( p ).addScaledVector( tangent, - epsilon ), minus );
				delta.subVectors( plus, minus );
			}
			n.crossVectors( da, db ).normalize(); this.point( p, moved );
			positions.setXYZ( i, moved.x, moved.y, moved.z ); normals.setXYZ( i, n.x, n.y, n.z );
		}
		return geometry;
	}
}
