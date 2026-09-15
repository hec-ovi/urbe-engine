import { Color, Vector3 } from 'three/webgpu';

/** Authored room emitters enter the existing fixed light pool at their real positions. */
export function scenicLights( building ) {
	if ( building.hasInterior !== false ) return [];
	const fixtures = [];
	for ( const floor of building.blueprint.floors ?? [] ) {
		for ( const opening of floor.openings ?? [] ) {
			for ( const [ index, light ] of ( opening.scenery?.lights ?? [] ).entries() ) {
				if ( light.lumens <= 0 ) continue;
				fixtures.push( {
					id: `${building.parcelId}:${opening.id}:${index}`,
					position: new Vector3( ...light.position ), color: new Color( light.color ),
					lumens: light.lumens, range: light.range
				} );
			}
		}
	}
	return fixtures;
}
