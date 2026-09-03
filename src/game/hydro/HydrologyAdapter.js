import * as THREE from 'three/webgpu';
import { HydrologyBoundary } from './HydrologyBoundary.js';
import { HydrologyError } from './HydrologyError.js';
import { waterGeometries, triangleCount } from './HydrologyGeometry.js';
import { materialSource, waterMaterial } from './HydrologyMaterials.js';
import { validateHydrologySemantics } from './HydrologySemantics.js';

const STYLE = Object.freeze( {
	lagoon: { speed: 0.004, normalScale: 0.2, roughness: 0.22, environmentIntensity: 0.82 },
	river: { speed: 0.012, normalScale: 0.32, roughness: 0.18, environmentIntensity: 0.9 },
	'sea-coast': { speed: 0.008, normalScale: 0.42, roughness: 0.14, environmentIntensity: 1 }
} );

let sharedBoundary;

/**
 * Builds the optional Atlas hydrology field without touching host scene or physics state.
 * The later host owns adding `runtime.group` and consuming `runtime.handoff`.
 */
export class HydrologyAdapter {

	static build( blueprint, materials ) {

		if ( ! blueprint || typeof blueprint !== 'object' || Array.isArray( blueprint ) ) {

			throw new HydrologyError( 'E_HYDRO_INPUT', 'Hydrology requires an Atlas blueprint object' );

		}
		// A legacy blueprint creates nothing, resolves nothing and needs no runtime update.
		if ( ! Object.hasOwn( blueprint, 'hydrology' ) || blueprint.hydrology == null ) return null;

		const boundary = sharedBoundary ??= new HydrologyBoundary();
		const plan = boundary.input( 'hydrology-plan', blueprint.hydrology );
		validateHydrologySemantics( plan );
		const bindings = boundary.input( 'material-bindings', materials?.bindings );
		const factory = materials?.factory;
		const group = new THREE.Group();
		group.name = 'hydrology';
		const geometries = [];
		const animated = [];

		try {

			const sources = materialSources( plan, bindings, factory, boundary );
			const handoff = buildHandoff( plan, sources );
			for ( const body of plan.bodies ) {

				const source = sources.get( body.materialKey );
				const parameters = waterParameters( plan.seedId, body.type );
				const surfaceGeometry = waterGeometries( body.surfaces, body.elevation );
				geometries.push( surfaceGeometry );
				const surfaceMaterial = waterMaterial( source, parameters );
				animated.push( surfaceMaterial );
				const surface = new THREE.Mesh( surfaceGeometry, surfaceMaterial.material );
				surface.name = `hydrology:water:${body.id}`;
				surface.receiveShadow = true;
				group.add( surface );

				for ( const shoreline of body.shorelines ) {

					const bandGeometry = waterGeometries( shoreline.band, body.elevation );
					geometries.push( bandGeometry );
					const bandMaterial = waterMaterial( source, parameters, true );
					animated.push( bandMaterial );
					const band = new THREE.Mesh( bandGeometry, bandMaterial.material );
					band.name = `hydrology:shoreline:${shoreline.id}`;
					band.renderOrder = 1;
					band.receiveShadow = true;
					group.add( band );

				}

			}

			const summary = boundary.output( 'runtime-summary', {
				objects: group.children.length,
				triangles: geometries.reduce( ( count, geometry ) => count + triangleCount( geometry ), 0 ),
				waterSurfaces: handoff.waterSurfaces.length,
				shorelineBands: handoff.shorelineBands.length,
				groundExclusions: handoff.groundExclusions.length,
				crossings: handoff.crossings.length
			} );
			return runtime( group, handoff, summary, animated, geometries, boundary );

		} catch ( error ) {

			release( group, animated, geometries );
			throw error;

		}

	}

}

function materialSources( plan, bindings, factory, boundary ) {

	const sources = new Map();
	for ( const body of plan.bodies ) {

		if ( sources.has( body.materialKey ) ) continue;
		const binding = bindings[ body.materialKey ];
		if ( ! binding ) throw new HydrologyError( 'E_HYDRO_MATERIAL', `No material binding for ${body.materialKey}` );
		sources.set( body.materialKey, materialSource( factory, binding, boundary ) );

	}
	return sources;

}

function buildHandoff( plan, sources ) {

	const waterSurfaces = [];
	const shorelineBands = [];
	const groundExclusions = [];

	for ( const body of plan.bodies ) {

		const material = sources.get( body.materialKey ).binding;
		const parameters = waterParameters( plan.seedId, body.type );
		for ( let index = 0; index < body.surfaces.length; index ++ ) {

			const polygon = clonePolygon( body.surfaces[ index ] );
			const id = `${body.id}:surface:${index}`;
			waterSurfaces.push( renderRecord( id, body, polygon, material, parameters ) );
			groundExclusions.push( { id, waterBodyId: body.id, polygon: clonePolygon( polygon ), elevation: body.elevation } );

		}
		for ( const shoreline of body.shorelines ) {

			shoreline.band.forEach( ( polygon, index ) => shorelineBands.push( {
				...renderRecord( `${shoreline.id}:band:${index}`, body, clonePolygon( polygon ), material, parameters ),
				shorelineId: shoreline.id
			} ) );

		}

	}

	const handoff = {
		version: '1',
		seedId: plan.seedId,
		type: plan.type,
		waterSurfaces,
		shorelineBands,
		groundExclusions,
		crossings: plan.structures.map( ( crossing ) => ( { ...crossing, path: clonePolygon( crossing.path ) } ) )
	};
	return ( sharedBoundary ??= new HydrologyBoundary() ).output( 'handoff', handoff );

}

function renderRecord( id, body, polygon, material, parameters ) {

	return {
		id,
		waterBodyId: body.id,
		polygon,
		elevation: body.elevation,
		depth: body.depth,
		materialKey: body.materialKey,
		material: { ...material },
		motion: { ...parameters.motion, normalUvVelocity: [ ...parameters.motion.normalUvVelocity ] },
		reflection: { ...parameters.reflection }
	};

}

function waterParameters( seedId, type ) {

	const hash = Number.parseInt( seedId.slice( 6 ), 16 ) >>> 0;
	const phase = ( hash % 1_000_000 ) / 1_000_000;
	const angle = ( ( hash >>> 8 ) % 3600 ) * Math.PI / 1800;
	const profile = STYLE[ type ];
	return {
		motion: {
			phase,
			normalUvVelocity: [ round( Math.cos( angle ) * profile.speed ), round( Math.sin( angle ) * profile.speed ) ],
			normalScale: profile.normalScale
		},
		reflection: { ior: 1.333, roughness: profile.roughness, environmentIntensity: profile.environmentIntensity }
	};

}

function runtime( group, handoff, summary, animated, geometries, boundary ) {

	let disposed = false;
	const update = ( request ) => {

		if ( disposed ) throw new HydrologyError( 'E_HYDRO_DISPOSED', 'Hydrology runtime is disposed' );
		const { elapsedSeconds } = boundary.input( 'update', request );
		for ( const item of animated ) {

			item.normalMap.offset.set(
				wrap( item.motion.phase + item.motion.normalUvVelocity[ 0 ] * elapsedSeconds ),
				wrap( item.motion.phase + item.motion.normalUvVelocity[ 1 ] * elapsedSeconds )
			);
			item.normalMap.updateMatrix();

		}

	};
	update( { elapsedSeconds: 0 } );
	return {
		group,
		handoff,
		summary,
		update,
		dispose() {

			if ( disposed ) return;
			disposed = true;
			release( group, animated, geometries );

		}
	};

}

function release( group, animated, geometries ) {

	geometries.forEach( ( geometry ) => geometry.dispose() );
	animated.forEach( ( item ) => {

		item.normalMap.dispose();
		item.material.dispose();

	} );
	group.clear();

}

function clonePolygon( polygon ) {

	return polygon.map( ( point ) => [ point[ 0 ], point[ 1 ] ] );

}

function wrap( value ) {

	return ( value % 1 + 1 ) % 1;

}

function round( value ) {

	return Math.round( value * 1e9 ) / 1e9;

}
