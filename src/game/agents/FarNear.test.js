import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { CharacterPoser } from './CharacterPoser.js';
import { characterParts, crowdBuilds, crowdEase, vatBytes } from './CharacterAssets.js';
import { CharacterAnimations } from './CharacterAnimations.js';
import { transferredClip } from './LayeredClips.js';
import { VatBaker } from './VatBaker.js';
import { CROWD_MODELS } from './CharacterCatalog.js';
import { BodyShapes } from './avatar/BodyShape.js';
import { whole } from './avatar/Steps.js';
import { GARMENTS, HEIGHT_LIMITS, SLOTS, personRecipe } from './avatar/Recipe.js';
import { appearance, lookOf } from './Appearance.js';
import { BUILD_LEVELS, BUILD_STEP, EASE_COVERS, EASE_ROWS, easeLane, packLook, presenceLane, wornEase } from './CrowdLook.js';
import { SOURCE_PRESENT, animationLibrary, sourceGltf, sourceLoaders } from './avatar/SourceAssets.test-fixtures.js';

/*
 * A person seen from afar is a crowd body: the bare baked body, their build
 * and their clothes' ease along its normal, at their height. Within a few
 * metres they are a rig in fitted garment shells. The two must be one figure,
 * or a person puts on bulk as the player walks up to them.
 */

const CLIP = 'Idle_Loop';
/** People of each body measured against their rig. */
const PEOPLE = 10;
/** Silhouette cells, in metres. */
const CELL = 0.005;
/** Heights, as shares of the figure's, a width is read at. */
const BANDS = { chest: 0.73, waist: 0.63, hips: 0.54, thigh: 0.44, calf: 0.18 };

/** The pose lane's garments as the vertex stage reads them back of the float it is (CrowdLook.easeNode). */
function wornLanes( lane ) {

	const code = Math.floor( Math.fround( lane ) / 2 );
	return SLOTS.map( ( slot, index ) => {

		const worn = Math.floor( code / 16 ** index ) % 16;
		return worn ? easeLane( slot, GARMENTS[ slot ][ worn - 1 ] ) : - 1;

	} );

}

describe( 'a crowd person\'s clothes in their pose lane', () => {

	it( 'gives every garment of the wardrobe its own lane of the ease rows', () => {

		const lanes = SLOTS.flatMap( ( slot ) => GARMENTS[ slot ].map( ( id ) => easeLane( slot, id ) ) );
		expect( new Set( lanes ).size ).toBe( lanes.length );
		expect( Math.min( ...lanes ) ).toBe( 0 );
		expect( Math.max( ...lanes ) ).toBeLessThan( EASE_ROWS * 4 );
		for ( const slot of SLOTS ) {

			expect( easeLane( slot, 'none' ) ).toBe( - 1 );
			// A slot's code is four bits, 0 for none.
			expect( GARMENTS[ slot ].length ).toBeLessThan( 16 );

		}

	} );

	it( 'carries the garments worn above the coverage, both read back exactly from the float lane', () => {

		for ( let seed = 0; seed < 300; seed ++ ) {

			const look = appearance( { gender: seed % 2 ? 'male' : 'female', appearanceSeed: seed * 2654435761 >>> 0 } );
			for ( const presence of [ 0, 0.25, 0.6, 0.999, 1 ] ) {

				const lane = presenceLane( presence, packLook( look ) );
				expect( lane ).toBeLessThan( 2 ** 13 );
				expect( Math.abs( ( Math.fround( lane ) % 2 ) - presence ) ).toBeLessThan( 1e-3 );
				expect( wornLanes( lane ) ).toEqual( SLOTS.map( ( slot ) => easeLane( slot, look.recipe.outfit[ slot ] ) ) );

			}

		}
		// Coverage stays within 0 to 1 whatever is asked, and a bare person wears nothing.
		const bare = lookOf( { ...personRecipe( { gender: 'male', appearanceSeed: 1 } ), outfit: { top: 'none', pants: 'none', footwear: 'none' } } );
		expect( presenceLane( 1.4, packLook( bare ) ) ).toBe( 1 );
		expect( presenceLane( - 1, packLook( bare ) ) ).toBe( 0 );

	} );

	it( 'counts a body\'s ease rows in what its pose buffers hold on the GPU', () => {

		const baked = { rows: 300, vertexCount: 1000, builds: new Float32Array( 4000 ) };
		const head = { rows: 300 };
		for ( const [ storage, scalar ] of [ [ true, 4 ], [ false, 2 ] ] ) {

			expect( vatBytes( { ...baked, ease: new Float32Array( EASE_ROWS * 4000 ) }, head, storage ) - vatBytes( baked, head, storage ) ).toBe( EASE_ROWS * 1000 * 4 * scalar );

		}

	} );

	it( 'layers the worn garments\' ease as the fitted shells layer', () => {

		const [ top, pants, boots ] = [ 0.02, 0.012, 0.015 ];
		// Bare skin takes none; one garment alone its own.
		expect( wornEase( 0, 0, 0, 0 ) ).toBe( 0 );
		expect( wornEase( top, 0, 0, 0 ) ).toBe( top );
		expect( wornEase( 0, pants, 0, 1 ) ).toBe( pants );
		// Boots over the trousers' legs, even where the trousers stand further off.
		expect( wornEase( 0, pants, EASE_COVERS, 0 ) ).toBeCloseTo( EASE_COVERS, 9 );
		expect( wornEase( 0, pants, boots, 0 ) ).toBeCloseTo( boots, 9 );
		// A top worn out over the trousers' seat stands off theirs by its own ease.
		expect( wornEase( top, pants, 0, 0 ) ).toBeCloseTo( top + pants, 9 );
		// A tucked top goes under their waistband, and shows only above it.
		expect( wornEase( top, pants, 0, 1 ) ).toBeCloseTo( pants, 9 );
		expect( wornEase( top, 0, 0, 1 ) ).toBe( top );

	} );

} );

/** The crowd's body in one frame of a clip, baked as CharacterAssets bakes it, with its builds and ease. */
async function crowdBody( model, animation ) {

	const gltf = await sourceGltf( model.file );
	const root = gltf.scene;
	const { body } = characterParts( root );
	const motions = new CharacterAnimations( root, animation.scene );
	const clip = transferredClip( animation.animations, motions, CLIP );
	const [ baked ] = await VatBaker.bake( root, [ body ], [ clip ], null, [ { frames: 1 } ] );
	const builds = crowdBuilds( whole( BodyShapes.measure( root ) ), baked.vertexCount );
	const ease = whole( crowdEase( body, baked.vertexCount ) );
	return { baked, builds, ease, index: Array.from( body.geometry.index.array ) };

}

/**
 * What the crowd's vertex stage draws for a look in the clip's first frame
 * (CrowdMesh): each vertex out along its posed normal by the person's builds
 * and their worn garments' ease layered (CrowdLook.wornEase), read back from
 * the instance lanes, then stretched up from the feet to the person's height.
 */
function crowdPerson( { baked, builds, ease, index }, look ) {

	const pack = packLook( look );
	const middle = ( BUILD_LEVELS - 1 ) / 2;
	const amounts = [ pack.builds % 16, Math.floor( pack.builds / 16 ) % 16, Math.floor( pack.builds / 256 ) ].map( ( step ) => ( step - middle ) * BUILD_STEP );
	const stature = HEIGHT_LIMITS[ 0 ] + Math.floor( pack.figure / ( 65536 * 8 ) ) / 31 * ( HEIGHT_LIMITS[ 1 ] - HEIGHT_LIMITS[ 0 ] );
	const worn = wornLanes( presenceLane( 1, pack ) );
	const tucked = Math.floor( pack.figure / ( 65536 * 4 ) ) % 2;
	const count = baked.vertexCount;
	const of = ( lane, vertex ) => ( lane < 0 ? 0 : ease[ ( Math.floor( lane / 4 ) * count + vertex ) * 4 + lane % 4 ] );
	const positions = new Float32Array( count * 3 );
	for ( let i = 0; i < count; i ++ ) {

		const nx = baked.normal[ i * 4 ], ny = baked.normal[ i * 4 + 1 ], nz = baked.normal[ i * 4 + 2 ];
		const length = Math.hypot( nx, ny, nz ) || 1;
		const clothes = wornEase( of( worn[ 0 ], i ), of( worn[ 1 ], i ), of( worn[ 2 ], i ), tucked );
		const out = builds[ i * 4 ] * amounts[ 0 ] + builds[ i * 4 + 1 ] * amounts[ 1 ] + builds[ i * 4 + 2 ] * amounts[ 2 ] + clothes;
		positions[ i * 3 ] = baked.position[ i * 4 ] + nx / length * out;
		positions[ i * 3 + 1 ] = ( baked.position[ i * 4 + 1 ] + ny / length * out ) * stature;
		positions[ i * 3 + 2 ] = baked.position[ i * 4 + 2 ] + nz / length * out;

	}
	return [ { positions, index } ];

}

/** Every skinned surface the dressed rig draws, its visible body and garment shells, posed in world space; eyes and brows left out, and hair, which both draw alike. */
function rigSurfaces( root ) {

	root.updateMatrixWorld( true );
	const surfaces = [];
	const point = new THREE.Vector3();
	root.traverse( ( mesh ) => {

		if ( ! mesh.isSkinnedMesh || /eye|brow|hair/i.test( mesh.name ) ) return;
		mesh.skeleton.update();
		const count = mesh.geometry.getAttribute( 'position' ).count;
		const positions = new Float32Array( count * 3 );
		for ( let i = 0; i < count; i ++ ) mesh.getVertexPosition( i, point ).applyMatrix4( mesh.matrixWorld ).toArray( positions, i * 3 );
		const index = mesh.geometry.index ? Array.from( mesh.geometry.index.array ) : Array.from( { length: count }, ( _, i ) => i );
		surfaces.push( { positions, index } );

	} );
	return surfaces;

}

/** Front (x, y) and side (z, y) silhouettes rasterised at CELL: their areas and widths at the BANDS. */
function silhouette( surfaces ) {

	let top = - Infinity, bottom = Infinity;
	for ( const { positions } of surfaces ) for ( let i = 1; i < positions.length; i += 3 ) {

		top = Math.max( top, positions[ i ] );
		bottom = Math.min( bottom, positions[ i ] );

	}
	const result = { height: top - bottom };
	for ( const [ view, axis ] of [ [ 'front', 0 ], [ 'side', 2 ] ] ) {

		const cells = new Set();
		for ( const { positions, index } of surfaces ) for ( let t = 0; t < index.length; t += 3 ) {

			const [ a, b, c ] = [ index[ t ] * 3, index[ t + 1 ] * 3, index[ t + 2 ] * 3 ];
			fill( cells, positions[ a + axis ], positions[ a + 1 ], positions[ b + axis ], positions[ b + 1 ], positions[ c + axis ], positions[ c + 1 ] );

		}
		const rows = new Map();
		for ( const key of cells ) {

			const y = key % 4096;
			rows.set( y, ( rows.get( y ) ?? 0 ) + 1 );

		}
		result[ view ] = { area: cells.size * CELL * CELL };
		for ( const [ band, share ] of Object.entries( BANDS ) ) {

			// The mean filled width over a centimetre either side of the band.
			const y = Math.floor( ( bottom + share * ( top - bottom ) ) / CELL ) + 2048;
			let sum = 0;
			for ( let row = y - 2; row <= y + 2; row ++ ) sum += ( rows.get( row ) ?? 0 ) * CELL;
			result[ view ][ band ] = sum / 5;

		}

	}
	return result;

}

/** Every cell whose centre a triangle covers, keyed x * 4096 + y about a 2048-cell offset. */
function fill( cells, ax, ay, bx, by, cx, cy ) {

	const area = ( bx - ax ) * ( cy - ay ) - ( cx - ax ) * ( by - ay );
	if ( Math.abs( area ) < 1e-12 ) return;
	const minX = Math.floor( Math.min( ax, bx, cx ) / CELL ), maxX = Math.floor( Math.max( ax, bx, cx ) / CELL );
	const minY = Math.floor( Math.min( ay, by, cy ) / CELL ), maxY = Math.floor( Math.max( ay, by, cy ) / CELL );
	for ( let x = minX; x <= maxX; x ++ ) for ( let y = minY; y <= maxY; y ++ ) {

		const px = ( x + 0.5 ) * CELL, py = ( y + 0.5 ) * CELL;
		const w0 = ( ( bx - px ) * ( cy - py ) - ( cx - px ) * ( by - py ) ) / area;
		const w1 = ( ( cx - px ) * ( ay - py ) - ( ax - px ) * ( cy - py ) ) / area;
		if ( w0 >= - 1e-6 && w1 >= - 1e-6 && 1 - w0 - w1 >= - 1e-6 ) cells.add( ( x + 2048 ) * 4096 + y + 2048 );

	}

}

const mean = ( values ) => values.reduce( ( sum, value ) => sum + value, 0 ) / values.length;

describe.skipIf( ! SOURCE_PRESENT )( 'a person far and near', () => {

	it( 'gives every garment the ease its fitted shell stands off the crowd body\'s skin, outward only, and none to the eyes', async () => {

		const gltf = await sourceGltf( CROWD_MODELS[ 0 ].file );
		const { body, eyes } = characterParts( gltf.scene );
		const count = body.geometry.getAttribute( 'position' ).count;
		const total = count + eyes.geometry.getAttribute( 'position' ).count;
		const ease = whole( crowdEase( body, total ) );
		expect( ease.length ).toBe( EASE_ROWS * total * 4 );
		expect( ease.every( ( value ) => value >= 0 && value < 0.12 ) ).toBe( true );
		const lane = ( slot, id ) => {

			const at = easeLane( slot, id );
			return Array.from( { length: total }, ( _, vertex ) => ease[ ( Math.floor( at / 4 ) * total + vertex ) * 4 + at % 4 ] );

		};
		for ( const slot of SLOTS ) for ( const id of GARMENTS[ slot ] ) {

			const values = lane( slot, id );
			const covered = values.slice( 0, count ).filter( ( value ) => value > 0 );
			// Whatever it covers says so, however close it fits.
			expect( Math.min( ...covered ), id ).toBeGreaterThanOrEqual( EASE_COVERS );
			// Each garment covers hundreds of the body's vertices, by a few millimetres to a few centimetres.
			expect( covered.length, id ).toBeGreaterThan( 300 );
			expect( mean( covered ), id ).toBeGreaterThan( 0.003 );
			expect( mean( covered ), id ).toBeLessThan( 0.04 );
			expect( values.slice( count ).every( ( value ) => value === 0 ), id ).toBe( true );

		}
		// A bomber stands further off than a tee.
		expect( mean( lane( 'top', 'jacket-bomber' ) ) ).toBeGreaterThan( mean( lane( 'top', 'top-tee' ) ) );

	}, 120000 );

	it( 'draws a crowd person the size and shape of their close rig, front and side', async () => {

		const animation = await animationLibrary();
		const poser = new CharacterPoser( { animation, ...sourceLoaders } );
		const front = [], side = [], widths = {};
		for ( const model of CROWD_MODELS ) {

			const crowd = await crowdBody( model, animation );
			for ( let n = 0; n < PEOPLE; n ++ ) {

				const seed = ( n * 2654435761 + ( model.gender === 'male' ? 7 : 11 ) ) >>> 0;
				const recipe = personRecipe( { gender: model.gender, appearanceSeed: seed } );
				const far = silhouette( crowdPerson( crowd, lookOf( recipe ) ) );
				const root = await poser.pose( recipe, CLIP, 0 );
				const near = silhouette( rigSurfaces( root ) );
				poser.release( root );
				const who = `${model.gender} ${seed} in ${SLOTS.map( ( slot ) => recipe.outfit[ slot ] ).join( ', ' )} at ${recipe.shape.height}`;
				front.push( near.front.area / far.front.area );
				side.push( near.side.area / far.side.area );
				// Nobody changes size by more than a twentieth as the rig takes over.
				expect( Math.abs( near.front.area / far.front.area - 1 ), who ).toBeLessThan( 0.05 );
				expect( Math.abs( near.side.area / far.side.area - 1 ), who ).toBeLessThan( 0.05 );
				expect( Math.abs( near.height / far.height - 1 ), who ).toBeLessThan( 0.02 );
				for ( const band of Object.keys( BANDS ) ) {

					( widths[ `front ${band}` ] ??= [] ).push( near.front[ band ] - far.front[ band ] );
					( widths[ `side ${band}` ] ??= [] ).push( near.side[ band ] - far.side[ band ] );

				}

			}

		}
		// Before the crowd wore its clothes' ease the rig was a fifth larger
		// (front 1.206, side 1.197) and 10 cm wider at the waist.
		expect( Math.abs( mean( front ) - 1 ) ).toBeLessThan( 0.03 );
		expect( Math.abs( mean( side ) - 1 ) ).toBeLessThan( 0.03 );
		for ( const [ band, values ] of Object.entries( widths ) ) expect( Math.abs( mean( values ) ), band ).toBeLessThan( 0.02 );

	}, 600000 );

} );
