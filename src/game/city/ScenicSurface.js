import { BufferGeometry, Float32BufferAttribute, MeshBasicNodeMaterial, Vector3 } from 'three/webgpu';
import { attribute, texture, vec3 } from 'three/tsl';
import { nightLevel } from '../light/NightSwitch.js';
import { ScenicIrradiance } from './ScenicIrradiance.js';

/** Bakes receiver illumination on a metre grid while retaining surface positions and UVs. */
export class ScenicSurface {
	static supports( key ) { return key.split( '/' )[ 1 ]?.startsWith( 'paired-room-' ); }

	constructor( blueprint ) { this.field = new ScenicIrradiance( blueprint ); }

	bake( source, key, fallback = 1 ) {
		const state = /(?:-|\/)(dark|dim)(?:\/|$)/.exec( key )?.[ 1 ] ?? 'lit';
		const position = source.getAttribute( 'position' ), normal = source.getAttribute( 'normal' ), uv = source.getAttribute( 'uv' );
		const data = { position: [], normal: [], uv: [], scenicRadiance: [] };
		for ( let offset = 0; offset < position.count; offset += 3 ) {
			const points = [ 0, 1, 2 ].map( i => new Vector3().fromBufferAttribute( position, offset + i ) );
			const center = points.reduce( ( sum, point ) => sum.add( point ), new Vector3() ).multiplyScalar( 1 / 3 );
			const room = this.field.roomAt( center, state );
			const n = new Vector3().fromBufferAttribute( normal, offset ).normalize();
			const steps = room ? Math.max( 1, Math.ceil( Math.max( points[ 0 ].distanceTo( points[ 1 ] ), points[ 1 ].distanceTo( points[ 2 ] ), points[ 2 ].distanceTo( points[ 0 ] ) ) ) ) : 1;
			const vertex = ( i, j ) => {
				const weights = [ 1 - ( i + j ) / steps, i / steps, j / steps ];
				const p = new Vector3(), tex = [ 0, 0 ];
				for ( let v = 0; v < 3; v++ ) {
					p.addScaledVector( points[ v ], weights[ v ] );
					tex[ 0 ] += uv.getX( offset + v ) * weights[ v ]; tex[ 1 ] += uv.getY( offset + v ) * weights[ v ];
				}
				data.position.push( p.x, p.y, p.z ); data.normal.push( n.x, n.y, n.z ); data.uv.push( ...tex );
				data.scenicRadiance.push( ...( room ? this.field.sample( room, p, n ) : [ fallback, fallback, fallback ] ) );
			};
			for ( let i = 0; i < steps; i++ ) for ( let j = 0; j < steps - i; j++ ) {
				vertex( i, j ); vertex( i + 1, j ); vertex( i, j + 1 );
				if ( i + j < steps - 1 ) { vertex( i + 1, j ); vertex( i + 1, j + 1 ); vertex( i, j + 1 ); }
			}
		}
		const result = new BufferGeometry();
		for ( const [ name, values ] of Object.entries( data ) ) result.setAttribute( name, new Float32BufferAttribute( values, name === 'uv' ? 2 : 3 ) );
		source.dispose();
		return result;
	}

	static material( catalog ) {
		const material = new MeshBasicNodeMaterial( { side: catalog.side, fog: true } );
		material.name = catalog.name;
		material.map = catalog.map;
		material.colorNode = vec3( 0 );
		const albedo = catalog.map ? texture( catalog.map ).rgb : vec3( catalog.color.r, catalog.color.g, catalog.color.b );
		material.emissiveNode = albedo.mul( attribute( 'scenicRadiance', 'vec3' ) ).mul( nightLevel );
		material.userData.ownedScenicMaterial = true;
		return material;
	}
}
