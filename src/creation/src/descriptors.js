import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

export async function cityDescriptor( root, id, input, atlas, now ) {

	return {
		contractVersion: '1.0.0', id, name: input.name.trim(), size: input.size, seed: input.seed.trim(),
		generatedAt: now.toISOString(),
		districtCount: atlas.districts.length,
		buildings: atlas.parcels.map( ( parcel ) => ( {
			id: parcel.id, label: parcel.name ?? `${parcel.type.replaceAll( '_', ' ' )} ${parcel.id}`,
			type: parcel.type, eligible: true
		} ) ),
		world: {
			manifest: await resource( root, 'manifest.json', 'application/json' ),
			blueprint: await resource( root, 'blueprint.json', 'application/json' )
		}
	};

}

export async function gameDescriptor( root, id, city, atlas, manifest, definitions, now ) {

	const current = spawnLocation( atlas );
	const progress = definitions.map( ( definition, index ) => ( {
		id: definition.id,
		title: definition.title,
		objective: definition.steps[ 0 ]?.narrative?.playerHint ?? definition.premise,
		state: index === 0 ? 'active' : 'available',
		totalSteps: definition.steps.length,
		completedSteps: [],
		runtime: null
	} ) );
	const timestamp = now.toISOString();
	return {
		contractVersion: '1.0.0', id, name: `${city.name} Game`, cityId: city.id, size: city.size,
		theme: 'cyberpunk', selectedInteriors: manifest.interiors,
		questBundle: definitions.length ? await resource( root, 'quests/quest-bundle.json', 'application/json' ) : null,
		quests: progress.slice( 0, 1 ), sideJobs: progress.slice( 1 ),
		player: { position: current.position, heading: current.heading, inventory: [] },
		currentLocation: current.location,
		discoveredLocations: [ current.location ],
		save: { revision: 1, createdAt: timestamp, updatedAt: timestamp, playTimeSeconds: 0 }
	};

}

function spawnLocation( atlas ) {

	const centre = atlas.parcels.reduce( ( point, parcel ) => ( {
		x: point.x + parcel.access.point[ 0 ] / atlas.parcels.length,
		z: point.z + parcel.access.point[ 1 ] / atlas.parcels.length
	} ), { x: 0, z: 0 } );
	const parcel = atlas.parcels.reduce( ( best, candidate ) => {

		const distance = ( candidate.access.point[ 0 ] - centre.x ) ** 2 + ( candidate.access.point[ 1 ] - centre.z ) ** 2;
		return ! best || distance < best.distance ? { candidate, distance } : best;

	}, null ).candidate;
	return {
		position: { x: parcel.access.point[ 0 ], y: 0.15, z: parcel.access.point[ 1 ] },
		heading: 0,
		location: { id: parcel.id, name: parcel.name ?? `${parcel.type.replaceAll( '_', ' ' )} ${parcel.id}` }
	};

}

async function resource( root, uri, mediaType ) {

	const path = join( root, uri );
	const data = await readFile( path );
	return {
		uri, mediaType, byteSize: ( await stat( path ) ).size,
		checksum: `sha256:${createHash( 'sha256' ).update( data ).digest( 'hex' )}`
	};

}

