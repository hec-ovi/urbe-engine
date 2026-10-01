import { ClampToEdgeWrapping, DataTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, RGBAFormat, UnsignedByteType } from 'three/webgpu';
import { dFdx, dFdy, dot, float, floor, fract, luminance, mix, select, texture, vec2, vec3 } from 'three/tsl';
import { DECAL_GRID, DECAL_ROWS } from './DetailMasks.js';
import { pack } from './DetailPack.js';

/** The Materials binding that names the published masks. */
export const DETAIL_BINDING = 'surface-detail';
const READY = Symbol.for( 'urbe.texture-ready' );

/**
 * Where each mask lives: its packed field and channel, and the binding mask
 * that replaces the stand-in. `world` masks are read in world metres, the
 * rest in a slab's own 0..1 UV.
 */
export const LAYOUT = Object.freeze( {
	smudge: { field: 'masks', channel: 'r', binding: 'smudge', world: true },
	fingerprint: { field: 'masks', channel: 'g', binding: 'fingerprint', world: true },
	macro: { field: 'masks', channel: 'b', binding: 'macro', world: true },
	edge: { field: 'masks', channel: 'a', binding: null, world: true },
	scuff: { field: 'frames', channel: 'r', binding: 'edge', world: false },
	chips: { field: 'frames', channel: 'g', binding: 'edgeChips', world: false },
	streaks: { field: 'frames', channel: 'b', binding: 'dirtStreaks', world: true }
} );
export const ROLES = Object.freeze( [ ...Object.keys( LAYOUT ), 'decals' ] );
/** Metres one repeat of each procedural world mask covers. */
export const PROCEDURAL_SIZE = Object.freeze( { smudge: 4.1, fingerprint: 0.31, macro: 2.4, edge: 1.15, streaks: 2 } );
const CHANNELS = [ 'r', 'g', 'b', 'a' ];
const DECAL_CELL = 128;

/**
 * The textures the surface-detail layer samples: two packed RGBA fields and
 * a stain atlas.
 *
 * `masks` holds the world-space masks (smudge, fingerprint, macro dirt and
 * edge breakup), `frames` the slab masks (scuffs and chips along a 0..1 UV
 * border) and the rain streaks. A mask the Materials `surface-detail`
 * binding publishes is read from its map; every other one from the
 * procedural stand-in drawn from a fixed seed. Both are packed on a worker
 * before any material that samples them is prepared, so the layer costs
 * three texture units at most, whatever it reads, and no shader changes
 * under a running city.
 */
export class SurfaceDetail {

	/**
	 * @param roles per role `{ texture, channel, size? }`, and `decals: { texture, grid, rows }`
	 * @param resources `{ texture, ready }` for every texture the roles read
	 * @param source per role, `procedural` or the catalog `key#variant` it reads
	 */
	constructor( roles, resources, source = {} ) {

		for ( const role of ROLES ) if ( ! roles[ role ]?.texture?.isTexture ) throw new Error( `surface detail: no ${role} texture` );
		this.roles = roles;
		this.resources = Object.freeze( resources.map( ( resource ) => Object.freeze( { ...resource } ) ) );
		this.source = source;
		this.ready = Promise.all( this.resources.map( ( resource ) => resource.ready ) ).then( () => {} );

	}

	/**
	 * The stand-ins alone, or the binding's masks and atlas where it names them.
	 *
	 * @param binding the Materials `surface-detail` binding, or null
	 * @param baseUrl where the binding's `themes/` paths are served
	 * @param mapTexture `(key, variantId, map, { srgb, wrap }) => { texture, ready }` for the atlas
	 * @param open makes the packing worker, or answers null to pack in place (procedural only)
	 * @param size the packed fields' side in pixels
	 */
	static load( { binding = null, baseUrl = '/materials', mapTexture = null, open = openWorker, anisotropy = 4, size = 512 } = {} ) {

		const named = ( role ) => {

			const mask = LAYOUT[ role ].binding && binding?.masks?.[ LAYOUT[ role ].binding ];
			const file = mask && binding.textures?.[ mask.texture ];
			return file?.path?.startsWith( 'themes/' ) ? { mask, url: absolute( `${baseUrl}/${file.path.slice( 'themes/'.length )}` ) } : null;

		};
		const fields = { masks: dataTexture( 'surface-detail:masks', size, anisotropy ), frames: dataTexture( 'surface-detail:frames', size, anisotropy ) };
		const urls = { masks: [ null, null, null, null ], frames: [ null, null, null, null ] };
		const roles = {}, source = {};
		for ( const [ role, { field, channel, world } ] of Object.entries( LAYOUT ) ) {

			const found = named( role );
			if ( found ) urls[ field ][ CHANNELS.indexOf( channel ) ] = found.url;
			const repeat = found?.mask.worldSize ?? [ PROCEDURAL_SIZE[ role ], PROCEDURAL_SIZE[ role ] ];
			roles[ role ] = { texture: fields[ field ], channel, ...( world ? { size: repeat } : {} ) };
			source[ role ] = found ? `${found.mask.key}#${found.mask.variant}` : 'procedural';

		}

		const atlas = binding?.atlas;
		const published = mapTexture && atlas?.columns === DECAL_GRID && atlas?.rows === DECAL_GRID && atlas.key && atlas.variant;
		const decals = published
			? mapTexture( atlas.key, atlas.variant, 'basecolor', { srgb: true, wrap: 'clamp' } )
			: { texture: dataTexture( 'surface-detail:decals', DECAL_CELL * DECAL_GRID, anisotropy ), ready: null };
		decals.texture.wrapS = decals.texture.wrapT = ClampToEdgeWrapping;
		roles.decals = { texture: decals.texture, grid: DECAL_GRID, rows: DECAL_ROWS };
		source.decals = published ? `${atlas.key}#${atlas.variant}` : 'procedural';

		const packed = run( open, { size, cell: DECAL_CELL, masks: urls.masks, frames: urls.frames, decals: ! published } ).then( ( answer ) => {

			fields.masks.image.data = answer.masks;
			fields.frames.image.data = answer.frames;
			fields.masks.needsUpdate = fields.frames.needsUpdate = true;
			if ( ! published ) {

				decals.texture.image.data = answer.decals;
				decals.texture.needsUpdate = true;

			}
			// What the worker could not read stays procedural, and says so.
			for ( const [ role, { field, channel } ] of Object.entries( LAYOUT ) ) {

				if ( answer.read[ field ][ CHANNELS.indexOf( channel ) ] !== 'catalog' ) source[ role ] = 'procedural';

			}
			for ( const failure of answer.failed ) console.warn( `surface detail: ${failure}; that mask is procedural` );

		} );
		fields.masks[ READY ] = fields.frames[ READY ] = packed;
		const resources = [ { texture: fields.masks, ready: packed }, { texture: fields.frames, ready: packed } ];
		if ( published ) resources.push( decals );
		else {

			decals.texture[ READY ] = packed;
			resources.push( { texture: decals.texture, ready: packed } );

		}

		return new SurfaceDetail( roles, resources, source );

	}

	/**
	 * One world mask at world metres `q`, 0..1; `stretch` reads it that many
	 * times larger (the macro dirt read at city scale).
	 */
	sample( role, q, stretch = 1 ) {

		const { texture: map, channel, size } = this.roles[ role ];

		return texture( map, q.div( vec2( size[ 0 ] * stretch, size[ 1 ] * stretch ) ) )[ channel ];

	}

	/** One slab mask at a slab's own 0..1 UV. */
	frame( role, uv ) {

		const { texture: map, channel } = this.roles[ role ];

		return texture( map, uv )[ channel ];

	}

	/**
	 * A sparse stain scattered over world metres `q`: the plane is cut into
	 * square cells of `cell` metres, and a hash of each cell decides whether it
	 * wears a mark, which atlas cell of `cells` it wears, flipped or turned,
	 * and at what size. A mark never leaves its cell, so a crack or a tyre mark
	 * is a placed artifact, never one repeated per slab.
	 *
	 * @param cells `[row, first column, columns]` runs of the atlas to draw from, equally likely
	 * @param presence the share of cells that carry a mark, a number or a node
	 * @returns `{ color, alpha, roughness }` nodes
	 */
	decal( q, { cell, presence, cells, seed = 0 } ) {

		const { texture: atlas, grid, rows: kinds } = this.roles.decals;
		const g = q.div( cell ).toConst();
		const id = floor( g );
		const pick = hash32( id.add( seed ) ).toConst();
		const turn = hash32( id.add( seed + 41.7 ) ).toConst();
		const present = pick.x.lessThan( presence );

		// Which run, then which column of it.
		const choice = floor( pick.y.mul( cells.length ) ).toConst();
		const along = pick.z;
		const at = ( [ row, first, count ] ) => [ float( row ), floor( along.mul( count ) ).add( first ), float( kinds[ row ].roughness ), float( kinds[ row ].tone ), float( kinds[ row ].saturation ) ];
		let [ row, column, roughness, tone, saturation ] = at( cells[ 0 ] );
		for ( let index = 1; index < cells.length; index ++ ) {

			const [ r, c, rough, shade, colour ] = at( cells[ index ] );
			const chosen = choice.equal( index );
			row = select( chosen, r, row );
			column = select( chosen, c, column );
			roughness = select( chosen, rough, roughness );
			tone = select( chosen, shade, tone );
			saturation = select( chosen, colour, saturation );

		}

		let local = fract( g );
		local = select( turn.x.greaterThan( 0.5 ), vec2( local.x.oneMinus(), local.y ), local );
		local = select( turn.y.greaterThan( 0.5 ), local.yx, local );
		const scale = turn.z.mul( 0.35 ).add( 0.65 );
		local = local.sub( 0.5 ).div( scale ).add( 0.5 ).toConst();
		const inside = local.x.greaterThan( 0 ).and( local.x.lessThan( 1 ) ).and( local.y.greaterThan( 0 ) ).and( local.y.lessThan( 1 ) );

		// A cell's coordinates jump at its border, so the atlas is read at the
		// footprint of the continuous plane rather than across that jump.
		const footprint = scale.mul( grid );
		const mark = texture( atlas, vec2( column.add( local.x.clamp( 0, 1 ) ), row.add( local.y.clamp( 0, 1 ) ) ).div( grid ) )
			.grad( dFdx( g ).div( footprint ), dFdy( g ).div( footprint ) ).toConst();

		const color = mix( vec3( luminance( mark.rgb ) ), mark.rgb, saturation ).mul( tone );

		return { color, alpha: select( present.and( inside ), mark.a, float( 0 ) ), roughness };

	}

}

/**
 * Dave Hoskins' hash32: three values in [0, 1) from a cell index, stable in
 * 32 bit floats for cells tens of kilometres out.
 */
export function hash32( p ) {

	let p3 = fract( vec3( p.x, p.y, p.x ).mul( vec3( 0.1031, 0.103, 0.0973 ) ) );
	p3 = p3.add( dot( p3, p3.yxz.add( 33.33 ) ) );

	return fract( vec3( p3.x, p3.x, p3.y ).add( vec3( p3.y, p3.z, p3.z ) ).mul( vec3( p3.z, p3.y, p3.x ) ) );

}

function dataTexture( name, size, anisotropy ) {

	const map = new DataTexture( new Uint8Array( size * size * 4 ), size, size, RGBAFormat, UnsignedByteType );
	Object.assign( map, {
		name, colorSpace: NoColorSpace, flipY: false, wrapS: RepeatWrapping, wrapT: RepeatWrapping,
		magFilter: LinearFilter, minFilter: LinearMipmapLinearFilter, generateMipmaps: true, anisotropy
	} );

	return map;

}

function absolute( url ) {

	return typeof location === 'undefined' ? url : new URL( url, location.href ).href;

}

/** The packed fields, from the worker where there is one, else drawn here from the stand-ins alone. */
async function run( open, request ) {

	let worker = null;
	try {

		worker = open();

	} catch ( error ) {

		console.warn( `surface detail: ${error.message}; packing the masks on the main thread` );

	}
	if ( worker ) {

		const answer = await new Promise( ( resolve ) => {

			worker.onmessage = ( { data } ) => resolve( data );
			worker.onerror = ( event ) => {

				event.preventDefault?.();
				resolve( { error: event.message ?? 'the worker failed' } );

			};
			worker.postMessage( request );

		} );
		worker.terminate();
		if ( ! answer.error ) return answer;
		console.warn( `surface detail: ${answer.error}; packing the masks on the main thread` );

	}

	return pack( request, null );

}

function openWorker() {

	return typeof Worker === 'undefined' ? null : new Worker( new URL( './DetailMasks.worker.js', import.meta.url ), { type: 'module' } );

}
