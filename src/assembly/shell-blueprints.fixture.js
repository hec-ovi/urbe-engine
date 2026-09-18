import blueprints from './shell-blueprints.fixture.json';

/**
 * One standing shell per atlas parcel: the fixture's blueprint shape laid over the
 * parcel's own footprint, so a city test works on any blueprint the fixtures carry.
 */
export function shellBlueprint( parcel ) {

	const outline = () => parcel.footprint.map( point => [ ...point ] );
	const shell = structuredClone( blueprints.p1 );
	shell.buildingId = parcel.id;
	shell.seed = `assembly-connections:${parcel.id}`;
	shell.bounds.footprint = outline();
	shell.roof.outline = outline();
	for ( const floor of shell.floors ) floor.outline = outline();
	return shell;

}
