import { Color, Vector3 } from 'three/webgpu';

/** Static room light, evaluated from its authored fixtures without a camera position. */
export class ScenicIrradiance {
	constructor( blueprint ) {
		this.rooms = [];
		for ( const floor of blueprint.floors ?? [] ) for ( const opening of floor.openings ?? [] ) {
			const room = opening.scenery;
			if ( ! room?.lights?.length ) continue;
			const lights = room.lights.map( light => ( { ...light, position: new Vector3( ...light.position ), color: new Color( light.color ) } ) );
			const center = lights.reduce( ( sum, light ) => sum.add( light.position ), new Vector3() ).multiplyScalar( 1 / lights.length );
			this.rooms.push( { bottom: floor.elevation, top: floor.elevation + floor.height, state: room.state, lights, center } );
		}
	}

	roomAt( position, state ) {
		let nearest = null, distance = Infinity;
		for ( const room of this.rooms ) {
			if ( room.state !== state || position.y < room.bottom - 0.01 || position.y > room.top + 0.01 ) continue;
			const d = ( position.x - room.center.x ) ** 2 + ( position.z - room.center.z ) ** 2;
			if ( d < distance ) { nearest = room; distance = d; }
		}
		return nearest;
	}

	sample( room, position, normal ) {
		const result = [ 0, 0, 0 ];
		for ( const light of room.lights ) {
			if ( light.lumens <= 0 ) continue;
			const dx = light.position.x - position.x, dy = light.position.y - position.y, dz = light.position.z - position.z;
			const d2 = dx * dx + dy * dy + dz * dz, distance = Math.sqrt( d2 );
			if ( distance >= light.range ) continue;
			const fade = ( 1 - ( distance / light.range ) ** 4 ) ** 2;
			const receiver = Math.max( 0, ( normal.x * dx + normal.y * dy + normal.z * dz ) / Math.max( distance, 0.01 ) );
			const downward = Math.max( 0, dy / Math.max( distance, 0.01 ) );
			const direct = light.lumens * downward * receiver * fade / ( Math.PI * Math.max( d2, 0.09 ) );
			// A diffuse floor return provides broad ceiling fill, without upward lamp emission.
			const bounceDistance = dx * dx + dz * dz + ( position.y - room.bottom ) ** 2 + 4;
			const bounce = light.lumens * 0.12 / ( Math.PI * bounceDistance );
			const radiance = ( direct + bounce ) / Math.PI;
			result[ 0 ] += light.color.r * radiance;
			result[ 1 ] += light.color.g * radiance;
			result[ 2 ] += light.color.b * radiance;
		}
		return result;
	}
}
