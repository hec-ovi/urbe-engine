import * as THREE from 'three/webgpu';
import { FillChannel } from './kit/FillChannel.js';

/**
 * The resident's own things in a home Interior authored as a scene (C8):
 * Interior publishes empty holders for them (`personal-*` placements: the name
 * card and mailbox on the landing by the door, the photo card tucked in the
 * monitor's frame, the coat hook inside the door), and this dresses each for
 * whoever the simulation houses there. The card and the mailbox take the
 * household's family name and the dwelling's number, the photo the face of
 * someone of the household (an established relative, else the resident), the
 * hook the work coat of the resident's trade. A home nobody established yet
 * keeps its number on the card and its hook bare.
 *
 * A home is a dwelling of the simulation (`floor:<index>/<unit>`, as
 * `Homes.js` names it); its residents are the established people whose
 * `home.apartment` is that dwelling.
 */

/** Work coats the hook takes, by the trade's category (Interior publishes them beside the holders). */
export const GARMENTS = {
	vendor: 'personal-c8-garment-vendor',
	worker: 'personal-c8-garment-worker',
	clinical: 'personal-c8-garment-clinical',
	authority: 'personal-c8-garment-authority',
	resident: 'personal-c8-garment-resident',
	street: 'personal-c8-garment-street',
	transit: 'personal-c8-garment-transit'
};

/** A placement the resident's layer dresses. */
export const isPersonal = ( id ) => typeof id === 'string' && id.startsWith( 'personal-' ) && ! id.includes( '-garment-' );

/** Where each holder's face lies in its module's frame: centre, size, the side it faces. */
const FACES = {
	'personal-c8-nameplate': { at: [ 0, .03, .0095 ], size: [ .14, .044 ], kind: 'name' },
	'personal-c8-mailbox': { at: [ 0, .1, .0825 ], size: [ .14, .04 ], kind: 'mail' },
	'personal-c8-photo': { at: [ 0, .05, .0009 ], size: [ .068, .098 ], kind: 'photo' }
};

export class HomeDressing {

	/**
	 * @param sim the simulation port: `findNPCs`, `getNPC`
	 * @param portraits the Portraits that pictures a person, or null
	 * @param roomLights the RoomLights the floor's materials are lit by
	 * @param categoryOf ( type ) => the type's category
	 */
	constructor( { sim, portraits = null, roomLights = null, categoryOf = () => null } ) {

		this.sim = sim;
		this.portraits = portraits;
		this.roomLights = roomLights;
		this.categoryOf = categoryOf;
		this.textures = new Map();

	}

	/** The established people living in a dwelling of a building, the eldest first. */
	residentsOf( parcelId, homeId ) {

		let people = [];
		try {

			people = this.sim?.findNPCs?.( { parcelId } ) ?? [];

		} catch {

			return [];

		}
		return people.filter( ( npc ) => npc?.home?.parcelId === parcelId && npc.home.apartment?.id === homeId && ! npc.flags?.dead )
			.sort( ( a, b ) => ( b.age ?? 0 ) - ( a.age ?? 0 ) || ( a.npcId < b.npcId ? - 1 : 1 ) );

	}

	/** What a dwelling shows of its household: the family name(s) on its card, its number, who is pictured, the trade's coat. */
	householdOf( parcelId, record, unit ) {

		const homeId = `floor:${record.floor}/${unit}`;
		const entrance = ( record.apartmentEntrances ?? [] ).find( ( one ) => one.unit === unit );
		const people = this.residentsOf( parcelId, homeId );
		const head = people[ 0 ] ?? null;
		const families = [ ...new Set( people.map( ( npc ) => npc.name?.family ).filter( Boolean ) ) ];
		// Someone of the family for the photo: a relative already known, else the sibling (or the
		// nearest kin) the simulation names, established for it, else the resident.
		const relative = head ? this.#relativeOf( head ) : null;
		const category = head ? this.categoryOf( head.type ) : null;
		return {
			homeId, number: entrance?.number ? String( entrance.number ) : null, people, head,
			name: families.length ? families.join( ' / ' ).toUpperCase() : null,
			initials: head ? `${head.name.given[ 0 ]}. ${head.name.family}` : null,
			pictured: relative?.npcId ?? head?.npcId ?? null,
			garment: category && GARMENTS[ category ] ? GARMENTS[ category ] : null
		};

	}

	#relativeOf( head ) {

		const family = head.family ?? [];
		const known = family.find( ( member ) => member.instantiated || this.#established( member.npcId ) );
		if ( known ) return known;
		const order = [ 'sibling', 'partner', 'child', 'parent', 'roommate' ];
		const kin = [ ...family ].sort( ( a, b ) => order.indexOf( a.relation ) - order.indexOf( b.relation ) )[ 0 ];
		if ( ! kin || typeof this.sim?.relative !== 'function' ) return null;
		try {

			this.sim.relative( kin.npcId );
			return kin;

		} catch {

			return null;

		}

	}

	#established( npcId ) {

		try {

			return !! this.sim?.getNPC?.( npcId );

		} catch {

			return false;

		}

	}

	/**
	 * Dresses one floor's personal holders: the labels and the photo as meshes
	 * of their own, lit by their room's fill, and the coats as module copies the
	 * floor puts in the shared draws.
	 *
	 * @returns `{ group, copies }`: the floor's own meshes, and copies shaped as InteriorStream's
	 */
	dress( parcelId, record, { fills = new Map(), shared = null, matrixOf, fillOf } ) {

		const group = new THREE.Group();
		group.name = `home-dressing:${record.id}`;
		const copies = [];
		const units = new Map( ( record.rooms ?? [] ).filter( ( room ) => room.unit ).map( ( room ) => [ room.id, room.unit ] ) );
		const households = new Map();
		for ( const placement of record.placements ?? [] ) {

			if ( ! isPersonal( placement.module ) ) continue;
			const unit = units.get( placement.room );
			if ( ! unit ) continue;
			if ( ! households.has( unit ) ) households.set( unit, this.householdOf( parcelId, record, unit ) );
			const home = households.get( unit );
			const matrix = matrixOf( placement, record.elevation );
			if ( placement.module === 'personal-c8-hook' ) {

				if ( home.garment ) copies.push( { placement, id: home.garment, matrix, uvRepeat: [ 1, 1 ], fill: fillOf( placement ) } );
				continue;

			}
			const face = FACES[ placement.module ];
			if ( ! face ) continue;
			const fill = fills.get( placement.room ) ?? shared;
			const mesh = face.kind === 'photo' ? this.#photo( home, face ) : this.#label( home, face );
			if ( ! mesh ) continue;
			mesh.applyMatrix4( matrix );
			mesh.matrixAutoUpdate = false;
			mesh.updateMatrix();
			if ( fill ) {

				const channel = new FillChannel( 1 );
				channel.set( 0, fill.clone() );
				channel.attach( mesh );
				mesh.userData.fillChannel = channel;

			}
			mesh.userData.home = home.homeId;
			group.add( mesh );

		}
		return { group, copies, households };

	}

	/** The card's or the mailbox's label: the family name over the number, typed on paper. */
	#label( home, face ) {

		const key = `${face.kind}|${home.name ?? ''}|${home.number ?? ''}`;
		let texture = this.textures.get( key );
		if ( ! texture ) {

			texture = labelTexture( face.kind, home );
			if ( ! texture ) return null;
			this.textures.set( key, texture );

		}
		return this.#plane( face, texture, key );

	}

	/** The photo card: the pictured person's face once Portraits has it, blank paper until then. */
	#photo( home, face ) {

		if ( ! home.pictured || ! this.portraits ) return null;
		const key = `photo|${home.pictured}`;
		let texture = this.textures.get( key );
		if ( ! texture ) {

			texture = new THREE.Texture();
			texture.colorSpace = THREE.SRGBColorSpace;
			this.textures.set( key, texture );
			Promise.resolve( this.portraits.portrait( { npcId: home.pictured } ) ).then( ( url ) => {

				if ( ! url ) return;
				const image = new Image();
				image.onload = () => { texture.image = printed( image ); texture.needsUpdate = true; };
				image.src = url;

			} ).catch( () => {} );

		}
		return this.#plane( face, texture, key );

	}

	#plane( face, texture, key ) {

		const geometry = new THREE.PlaneGeometry( face.size[ 0 ], face.size[ 1 ] );
		geometry.translate( face.at[ 0 ], face.at[ 1 ], face.at[ 2 ] );
		const base = new THREE.MeshStandardMaterial( { map: texture, roughness: .82, metalness: 0, name: `home-dressing:${key}` } );
		const material = this.roomLights?.materialFor ? this.roomLights.materialFor( `home-dressing/${key}`, base ) : base;
		return new THREE.Mesh( geometry, material );

	}

}

/** A typed label on off-white card: the family name large, the dwelling's number under it. */
function labelTexture( kind, home ) {

	if ( typeof document === 'undefined' ) return null;
	const canvas = document.createElement( 'canvas' );
	canvas.width = 512; canvas.height = 160;
	const g = canvas.getContext( '2d' );
	g.fillStyle = '#e4dfcf'; g.fillRect( 0, 0, 512, 160 );
	// a little grime and a hand-written edge, as a card left years in its holder
	g.fillStyle = 'rgba(80,70,50,0.18)'; g.fillRect( 0, 140, 512, 20 );
	g.fillStyle = '#1d1b18';
	g.textAlign = 'center';
	const name = home.name ?? ( kind === 'mail' ? 'OCCUPANT' : '' );
	g.font = `bold ${name.length > 12 ? 52 : 70}px "Liberation Sans Narrow", "Arial Narrow", sans-serif`;
	if ( name ) g.fillText( name, 256, 82 );
	g.font = '34px "DejaVu Sans Mono", monospace';
	g.fillStyle = '#4a4438';
	if ( home.number ) g.fillText( kind === 'mail' ? `APT ${home.number}` : `${home.initials ?? ''}${home.initials ? '  ·  ' : ''}${home.number}`, 256, 132 );
	const texture = new THREE.CanvasTexture( canvas );
	texture.colorSpace = THREE.SRGBColorSpace;
	return texture;

}

/** A portrait printed as a snapshot: a white border, the colours a little warm and faded. */
function printed( image ) {

	if ( typeof document === 'undefined' ) return image;
	const canvas = document.createElement( 'canvas' );
	canvas.width = 280; canvas.height = 400;
	const g = canvas.getContext( '2d' );
	g.fillStyle = '#efeadc'; g.fillRect( 0, 0, 280, 400 );
	const w = 250, h = 320, side = Math.min( image.width, image.height );
	g.drawImage( image, ( image.width - side ) / 2, ( image.height - side ) / 2, side, side * h / w, 15, 15, w, h );
	g.fillStyle = 'rgba(255,190,120,0.14)'; g.fillRect( 15, 15, w, h );
	return canvas;

}
