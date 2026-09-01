import * as THREE from 'three/webgpu';

const RESHUFFLE_INTERVAL = 0.25;

/**
 * A fixed pool of real point lights, moved every quarter second onto the
 * nearest registered glows. Lamps and neon signs are always visible through
 * their emissive maps; this is what makes a handful of them actually spill
 * light onto the wet road, at a cost that does not grow with the city.
 */
export class LightBudget {

	/** @param glows [{ position, color, intensity, distance }] */
	constructor( glows, count = 14 ) {

		this.glows = glows;
		this.group = new THREE.Group();
		this.group.name = 'light-budget';
		this.lights = [];
		this.timer = RESHUFFLE_INTERVAL;

		for ( let i = 0; i < count; i ++ ) {

			const light = new THREE.PointLight( 0xffffff, 0, 20, 2 );
			light.visible = false;
			this.lights.push( light );
			this.group.add( light );

		}

	}

	update( position, delta ) {

		this.timer += delta;

		if ( this.timer < RESHUFFLE_INTERVAL ) return;

		this.timer = 0;

		const near = this.glows
			.map( ( glow ) => ( { glow, d: glow.position.distanceToSquared( position ) } ) )
			.sort( ( a, b ) => a.d - b.d )
			.slice( 0, this.lights.length );

		for ( let i = 0; i < this.lights.length; i ++ ) {

			const light = this.lights[ i ];
			const pick = near[ i ];

			if ( ! pick ) {

				light.visible = false;
				continue;

			}

			light.position.copy( pick.glow.position );
			light.color.set( pick.glow.color );
			light.intensity = pick.glow.intensity;
			light.distance = pick.glow.distance;
			light.visible = true;

		}

	}

}
