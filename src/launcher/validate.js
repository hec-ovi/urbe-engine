function object( value, name ) {

	if ( ! value || typeof value !== 'object' || Array.isArray( value ) ) throw new TypeError( `${ name } must be an object.` );
	return value;

}

function text( value, name ) {

	if ( typeof value !== 'string' || value.trim() === '' ) throw new TypeError( `${ name } must be a non-empty string.` );
	return value;

}

function integer( value, name, min = 0, max = Number.MAX_SAFE_INTEGER ) {

	if ( ! Number.isInteger( value ) || value < min || value > max ) throw new TypeError( `${ name } must be an integer from ${ min } to ${ max }.` );
	return value;

}

function keys( value, allowed, name ) {

	const unknown = Object.keys( value ).find( ( key ) => ! allowed.includes( key ) );
	if ( unknown ) throw new TypeError( `${ name } contains unsupported field ${ unknown }.` );
	return value;

}

function optionalText( value, name ) {

	if ( value !== undefined && typeof value !== 'string' ) throw new TypeError( `${ name } must be a string.` );

}

function optionalCount( value, name ) {

	if ( value !== undefined ) integer( value, name );

}

function namedItems( value, name ) {

	if ( value === undefined ) return;
	if ( ! Array.isArray( value ) ) throw new TypeError( `${ name } must be an array.` );
	value.forEach( ( item, index ) => {

		if ( typeof item === 'string' ) return text( item, `${ name }[${ index }]` );
		object( item, `${ name }[${ index }]` );
		text( item.name, `${ name }[${ index }].name` );

	} );

}

function ids( value, name, min = 0 ) {

	if ( ! Array.isArray( value ) || value.length < min ) throw new TypeError( `${ name } must contain at least ${ min } ids.` );
	value.forEach( ( id, index ) => text( id, `${ name }[${ index }]` ) );
	if ( new Set( value ).size !== value.length ) throw new TypeError( `${ name } must contain unique ids.` );
	return value;

}

function city( value, name = 'city' ) {

	object( value, name );
	keys( value, [ 'id', 'name', 'seed', 'size', 'status', 'buildings', 'buildingCount', 'interiorCount', 'districts', 'summary', 'availableBuildings' ], name );
	text( value.id, `${ name }.id` );
	text( value.name, `${ name }.name` );
	optionalText( value.seed, `${ name }.seed` );
	optionalText( value.summary, `${ name }.summary` );
	if ( value.size !== undefined && ! [ 'small', 'medium', 'large' ].includes( value.size ) ) throw new TypeError( `${ name }.size is invalid.` );
	if ( value.status !== undefined && ! [ 'ready', 'building', 'failed' ].includes( value.status ) ) throw new TypeError( `${ name }.status is invalid.` );
	for ( const field of [ 'buildings', 'buildingCount', 'interiorCount', 'districts' ] ) optionalCount( value[ field ], `${ name }.${ field }` );
	if ( value.availableBuildings !== undefined ) {

		if ( ! Array.isArray( value.availableBuildings ) ) throw new TypeError( `${ name }.availableBuildings must be an array.` );
		value.availableBuildings.forEach( ( building, index ) => {

			const at = `${ name }.availableBuildings[${ index }]`;
			object( building, at );
			keys( building, [ 'id', 'label', 'type', 'eligible' ], at );
			text( building.id, `${ at }.id` );
			optionalText( building.label, `${ at }.label` );
			optionalText( building.type, `${ at }.type` );
			if ( building.eligible !== undefined && typeof building.eligible !== 'boolean' ) throw new TypeError( `${ at }.eligible must be a boolean.` );

		} );

	}
	return value;

}

function game( value, name = 'game' ) {

	object( value, name );
	keys( value, [ 'id', 'name', 'cityName', 'theme', 'playable', 'mainSteps', 'sideJobs', 'interiors', 'inventoryCount', 'locationCount', 'location', 'position', 'activeQuest', 'inventory', 'locations' ], name );
	text( value.id, `${ name }.id` );
	text( value.name, `${ name }.name` );
	for ( const field of [ 'cityName', 'theme', 'location' ] ) optionalText( value[ field ], `${ name }.${ field }` );
	if ( value.playable !== undefined && typeof value.playable !== 'boolean' ) throw new TypeError( `${ name }.playable must be a boolean.` );
	for ( const field of [ 'mainSteps', 'sideJobs', 'interiors', 'inventoryCount', 'locationCount' ] ) optionalCount( value[ field ], `${ name }.${ field }` );
	if ( value.position !== undefined ) {

		if ( ! Array.isArray( value.position ) || value.position.length !== 3 || value.position.some( ( coordinate ) => ! Number.isFinite( coordinate ) ) ) throw new TypeError( `${ name }.position must contain three finite numbers.` );

	}
	if ( value.activeQuest !== undefined ) {

		object( value.activeQuest, `${ name }.activeQuest` );
		keys( value.activeQuest, [ 'title', 'objective' ], `${ name }.activeQuest` );
		if ( typeof value.activeQuest.title !== 'string' || typeof value.activeQuest.objective !== 'string' ) throw new TypeError( `${ name }.activeQuest must contain title and objective strings.` );

	}
	namedItems( value.inventory, `${ name }.inventory` );
	namedItems( value.locations, `${ name }.locations` );
	return value;

}

export function catalog( value ) {

	object( value, 'catalog' );
	keys( value, [ 'games', 'cities' ], 'catalog' );
	if ( ! Array.isArray( value.games ) || ! Array.isArray( value.cities ) ) throw new TypeError( 'catalog.games and catalog.cities must be arrays.' );
	value.games.forEach( ( value, index ) => game( value, `catalog.games[${ index }]` ) );
	value.cities.forEach( ( value, index ) => city( value, `catalog.cities[${ index }]` ) );
	return value;

}

export function continueResult( value ) {

	object( value, 'continue result' );
	keys( value, [ 'playUrl' ], 'continue result' );
	text( value.playUrl, 'continue result.playUrl' );
	return value;

}

export function cityInput( value ) {

	object( value, 'city input' );
	keys( value, [ 'name', 'seed', 'size' ], 'city input' );
	text( value.name, 'city input.name' );
	text( value.seed, 'city input.seed' );
	if ( ! [ 'small', 'medium', 'large' ].includes( value.size ) ) throw new TypeError( 'city input.size must be small, medium or large.' );
	return value;

}

export function cityResult( value ) {

	object( value, 'city result' );
	keys( value, [ 'city', 'catalog' ], 'city result' );
	city( value.city, 'city result.city' );
	if ( value.catalog !== undefined ) catalog( value.catalog );
	return value;

}

export function instancesInput( value ) {

	object( value, 'instances input' );
	keys( value, [ 'cityId', 'mode', 'count', 'buildingIds' ], 'instances input' );
	text( value.cityId, 'instances input.cityId' );
	if ( ! [ 'automatic', 'manual' ].includes( value.mode ) ) throw new TypeError( 'instances input.mode must be automatic or manual.' );
	integer( value.count, 'instances input.count', 1, 24 );
	ids( value.buildingIds, 'instances input.buildingIds' );
	if ( value.mode === 'manual' && value.buildingIds.length !== value.count ) throw new TypeError( 'manual instances count must equal the selected building count.' );
	return value;

}

export function instancesResult( value ) {

	object( value, 'instances result' );
	keys( value, [ 'instances' ], 'instances result' );
	object( value.instances, 'instances result.instances' );
	keys( value.instances, [ 'ids', 'count' ], 'instances result.instances' );
	ids( value.instances.ids, 'instances result.instances.ids', 1 );
	if ( value.instances.count !== undefined ) integer( value.instances.count, 'instances result.instances.count', 1, 24 );
	return value;

}

export function questsInput( value ) {

	object( value, 'quests input' );
	keys( value, [ 'cityId', 'interiorIds', 'mainBrief', 'sideJobs' ], 'quests input' );
	text( value.cityId, 'quests input.cityId' );
	ids( value.interiorIds, 'quests input.interiorIds', 1 );
	if ( typeof value.mainBrief !== 'string' ) throw new TypeError( 'quests input.mainBrief must be a string.' );
	integer( value.sideJobs, 'quests input.sideJobs', 0, 24 );
	return value;

}

export function questsResult( value ) {

	object( value, 'quests result' );
	keys( value, [ 'quests' ], 'quests result' );
	object( value.quests, 'quests result.quests' );
	keys( value.quests, [ 'id', 'mainSteps', 'sideJobs' ], 'quests result.quests' );
	text( value.quests.id, 'quests result.quests.id' );
	integer( value.quests.mainSteps, 'quests result.quests.mainSteps' );
	integer( value.quests.sideJobs, 'quests result.quests.sideJobs' );
	return value;

}

export function gameInput( value ) {

	object( value, 'game input' );
	keys( value, [ 'cityId', 'interiorIds', 'questId' ], 'game input' );
	text( value.cityId, 'game input.cityId' );
	ids( value.interiorIds, 'game input.interiorIds', 1 );
	text( value.questId, 'game input.questId' );
	return value;

}

export function gameResult( value ) {

	object( value, 'game result' );
	keys( value, [ 'game', 'catalog' ], 'game result' );
	game( value.game, 'game result.game' );
	if ( value.catalog !== undefined ) catalog( value.catalog );
	return value;

}

export function jsonDocument( value, name ) {

	object( value, name );
	JSON.stringify( value );
	return value;

}
