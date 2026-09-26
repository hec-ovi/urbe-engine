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
