import interior from '../investigation/fixtures/interior-incident.json';

/** Scene shapes the scenery tests share: a crime scene in the investigation fixture's measured room. */
export const drive = interior.props[ 0 ].missionAsset;

export function crimeScene( extra = {} ) {

	return {
		contractVersion: '1.0', sceneId: 'courier-found', questId: 'quest-missing-courier', seed: 4242, purpose: 'crime-scene',
		place: { kind: 'room', parcelId: 'p47', floor: 0, roomKinds: [ 'living' ] },
		actors: [ { actorId: 'courier', role: 'victim', identity: { kind: 'cast', roleId: 'courier' }, pose: 'death-a', placement: { zone: 'center' } } ],
		props: [
			{ propId: 'pool', kind: 'blood-pool', nearActorId: 'courier', size: { width: 1.45, height: 0.72 } },
			{ propId: 'drive', kind: 'mission-asset', assetId: drive.assetId, nearActorId: 'courier' }
		],
		activeWhen: { kind: 'stepDone', stepId: 'kill' },
		...extra
	};

}

export const frame = { location: interior.location, place: { parcelId: 'p47', floor: 0, roomId: 'f0-r1' }, anchor: null };
export const courier = [ { actorId: 'courier', npcId: 'npc-v', gender: 'female', appearanceSeed: 77 } ];
export const assets = { get: ( assetId ) => ( assetId === drive.assetId ? drive : null ) };

/** Parcel p5 of a generated small city: its lot, footprint and access point, the sidewalk and curb in front of it. */
export const SIDEWALK = [ [ 33.7, 110.5 ], [ 33.7, 160.5 ], [ 29.5, 160.5 ], [ 29.5, 110.5 ] ];
export const STREET_ATLAS = {
	parcels: [ {
		id: 'p5',
		lot: [ [ 33.7, 128.5 ], [ 57.7, 128.5 ], [ 57.7, 160.5 ], [ 33.7, 160.5 ] ],
		footprint: [ [ 36, 130.5 ], [ 55.5, 130.5 ], [ 55.5, 158.5 ], [ 36, 158.5 ] ],
		access: { edgeId: 'e12', point: [ 33.7, 144.5 ] }
	} ],
	volumetric: { ground: [
		{ surface: 'block', bottom: 0, top: 0.2, polygon: [ [ 33.7, 128.5 ], [ 57.7, 128.5 ], [ 57.7, 160.5 ], [ 33.7, 160.5 ] ] },
		{ surface: 'sidewalk', bottom: 0, top: 0.2, polygon: SIDEWALK },
		{ surface: 'curb', bottom: 0, top: 0.2, polygon: [ [ 29.5, 110.5 ], [ 29.5, 160.5 ], [ 29.3, 160.5 ], [ 29.3, 110.5 ] ] },
		{ surface: 'roadway', bottom: 0, top: 0, polygon: [ [ 14.8, 100 ], [ 28.8, 100 ], [ 28.8, 170 ], [ 14.8, 170 ] ] }
	] }
};
/** That street's lamp post in front of p5, as street dressing reserves it: the post, and its head overhead. */
export const LAMP = [
	{ footprint: [ [ 30.86, 143.96 ], [ 31.14, 143.96 ], [ 31.14, 144.24 ], [ 30.86, 144.24 ] ], bottom: 0.12, top: 6.095 },
	{ footprint: [ [ 30.3, 143.9 ], [ 31, 143.9 ], [ 31, 144.3 ], [ 30.3, 144.3 ] ], bottom: 5.8, top: 6.0 }
];
