/*
 * Carried over from the NPC Studio (codex_npcs, src/clothing/lower.js): the
 * trouser, shorts and footwear patterns of the shared skinned-shell builder.
 * Positions and offsets are shares of body height, so the same shapes follow
 * every body and edited proportions; the panels own the colour patterns.
 */
export const PANTS = [
	{
		id: 'pants-tech',
		label: 'Metro tech trousers',
		category: 'pants',
		priority: 10,
		waistHeight: 0.625,
		includes: ( ctx ) => trousers( ctx, 0.625 ),
		prepare: fitTrouserSeat,
		offset( ctx ) {

			const knee = band( ctx.y, 0.255, 0.333, 0.022 ) * positive( ctx.nz );
			return 0.0048 + knee * 0.0025 + band( ctx.y, 0.055, 0.094, 0.012 ) * 0.0012;

		}
	},
	{
		id: 'pants-patrol',
		label: 'Patrol field trousers',
		category: 'pants',
		priority: 10,
		waistHeight: 0.625,
		includes: ( ctx ) => trousers( ctx, 0.625 ),
		prepare: fitTrouserSeat,
		offset( ctx ) {

			const pocket = band( ctx.y, 0.366, 0.474, 0.022 ) * smoothstep( 0.22, 0.75, outside( ctx ) );
			const knee = band( ctx.y, 0.252, 0.337, 0.025 ) * positive( ctx.nz );
			return 0.0075 + pocket * 0.007 + knee * 0.004;

		},
		shape( ctx, out ) {

			// A little extra ease below the seat sets these apart from the slim fit.
			const ease = band( ctx.y, 0.105, 0.49, 0.06 ) * 0.0025;
			out[ 0 ] += ctx.nx * ease;
			out[ 2 ] += ctx.nz * ease;

		}
	},
	{
		id: 'pants-office',
		label: 'Executive tailored trousers',
		category: 'pants',
		priority: 10,
		waistHeight: 0.63,
		includes: ( ctx ) => trousers( ctx, 0.63 ),
		prepare: fitTrouserSeat,
		offset( ctx ) {

			// The narrow ankle and calf fill out into the straighter fall of woven trousers.
			const lowerLeg = 1 - smoothstep( 0.15, 0.36, ctx.y );
			return 0.006 + lowerLeg * 0.008;

		},
		shape( ctx, out ) {

			const drape = ( 1 - smoothstep( 0.1, 0.28, ctx.y ) ) * 0.003;
			out[ 0 ] += ctx.nx * drape;
			out[ 2 ] += ctx.nz * drape;

		}
	},
	{
		id: 'pants-leggings',
		label: 'Contour leggings',
		category: 'pants',
		priority: 10,
		waistHeight: 0.63,
		includes: ( ctx ) => trousers( ctx, 0.63 ) && ctx.y > 0.063,
		prepare: fitTrouserSeat,
		offset( ctx ) {

			return 0.0033 + band( ctx.y, 0.603, 0.633, 0.008 ) * 0.0012;

		}
	},
	{
		id: 'pants-chinos',
		label: 'Rolled-hem chinos',
		category: 'pants',
		priority: 10,
		waistHeight: 0.625,
		includes: ( ctx ) => trousers( ctx, 0.625 ) && ctx.y > 0.08,
		prepare: fitTrouserSeat,
		offset( ctx ) {

			const straightLeg = 1 - smoothstep( 0.16, 0.4, ctx.y );
			const roll = band( ctx.y, 0.077, 0.111, 0.009 );
			return 0.0065 + straightLeg * 0.0045 + roll * 0.004;

		},
		shape( ctx, out ) {

			const ease = band( ctx.y, 0.1, 0.49, 0.055 ) * 0.003;
			out[ 0 ] += ctx.nx * ease;
			out[ 2 ] += ctx.nz * ease;

		}
	},
	{
		id: 'pants-cargo',
		label: 'Utility cargo trousers',
		category: 'pants',
		priority: 10,
		waistHeight: 0.625,
		includes: ( ctx ) => trousers( ctx, 0.625 ) && ctx.y > 0.063,
		prepare: fitTrouserSeat,
		offset( ctx ) {

			const pocket = band( ctx.y, 0.365, 0.465, 0.015 ) * smoothstep( 0.28, 0.78, outside( ctx ) );
			const leg = band( ctx.y, 0.068, 0.49, 0.065 );
			return 0.0085 + leg * 0.0055 + pocket * 0.011;

		},
		shape( ctx, out ) {

			const leg = band( ctx.y, 0.09, 0.485, 0.075 );
			out[ 0 ] += ctx.nx * leg * 0.003;
			out[ 2 ] += ctx.nz * leg * 0.002;

		}
	},
	{
		id: 'pants-shorts',
		label: 'City walking shorts',
		category: 'pants',
		priority: 10,
		waistHeight: 0.625,
		includes: ( ctx ) => trousers( ctx, 0.625 ) && ctx.y > 0.355,
		prepare: fitTrouserSeat,
		offset( ctx ) {

			const hem = band( ctx.y, 0.35, 0.385, 0.009 );
			return 0.009 + hem * 0.004;

		},
		shape( ctx, out ) {

			const opening = 1 - smoothstep( 0.38, 0.49, ctx.y );
			out[ 0 ] += ctx.nx * opening * 0.004;
			out[ 2 ] += ctx.nz * opening * 0.004;

		}
	},
	{
		id: 'pants-joggers',
		label: 'Cuffed everyday joggers',
		category: 'pants',
		priority: 10,
		waistHeight: 0.625,
		includes: ( ctx ) => trousers( ctx, 0.625 ) && ctx.y > 0.066,
		prepare: fitTrouserSeat,
		offset( ctx ) {

			const thigh = band( ctx.y, 0.2, 0.515, 0.1 );
			const calf = band( ctx.y, 0.095, 0.3, 0.065 );
			const cuff = band( ctx.y, 0.063, 0.103, 0.011 );
			return 0.004 + thigh * 0.009 + calf * 0.003 + cuff * 0.002;

		},
		shape( ctx, out ) {

			const upperLeg = band( ctx.y, 0.255, 0.485, 0.085 ) * 0.0025;
			out[ 0 ] += ctx.nx * upperLeg;
			out[ 2 ] += ctx.nz * upperLeg;

		}
	}
];

export const FOOTWEAR = [
	{
		id: 'boots-patrol',
		label: 'Patrol weather boots',
		category: 'footwear',
		priority: 30,
		includes: ( ctx ) => footwear( ctx, 0.19 ),
		offset: bootOffset,
		shape( ctx, out ) {

			shoeShape( ctx, out, bootOffset( ctx ), 0.034, 0.011, 0.0032 );
			const cuff = band( ctx.y, 0.166, 0.192, 0.012 ) * 0.002;
			out[ 0 ] += ctx.nx * cuff;
			out[ 2 ] += ctx.nz * cuff;

		},
		normal( ctx, out ) {

			shoeNormal( ctx, out, 0.034, 0.011, 0.0032 );

		}
	},
	{
		id: 'shoes-city',
		label: 'City leather shoes',
		category: 'footwear',
		priority: 30,
		includes: ( ctx ) => footwear( ctx, 0.079 ),
		offset: shoeOffset,
		shape( ctx, out ) {

			const offset = shoeOffset( ctx );
			shoeShape( ctx, out, offset, 0.027, 0.007, 0.0018 );
			// Long ankle triangles cross the cut at different heights: a level
			// collar keeps the shoe's opening clean even with bare legs.
			out[ 1 ] += ( 0.079 - ctx.y - ctx.ny * offset - out[ 1 ] ) * smoothstep( 0.054, 0.064, ctx.y );

		},
		normal( ctx, out ) {

			shoeNormal( ctx, out, 0.027, 0.007, 0.0018 );

		}
	},
	{
		id: 'sneakers-low',
		label: 'Low court sneakers',
		category: 'footwear',
		priority: 30,
		includes: ( ctx ) => footwear( ctx, 0.094 ),
		prepare: fitStyledFootwear,
		shoeProfile: { top: 0.094, base: 0.0068, shaft: 0.001, collar: 0.003, toeHeight: 0.04, toeExtension: 0.004, weltWidth: 0.0036 },
		offset( ctx ) {

			return styledFootwearOffset( ctx, this.shoeProfile );

		}
	},
	{
		id: 'sneakers-high',
		label: 'High court sneakers',
		category: 'footwear',
		priority: 30,
		includes: ( ctx ) => footwear( ctx, 0.151 ),
		prepare: fitStyledFootwear,
		shoeProfile: { top: 0.151, base: 0.0075, shaft: 0.0025, collar: 0.0033, toeHeight: 0.043, toeExtension: 0.005, weltWidth: 0.004 },
		offset( ctx ) {

			return styledFootwearOffset( ctx, this.shoeProfile );

		}
	},
	{
		id: 'boots-chelsea',
		label: 'Chelsea ankle boots',
		category: 'footwear',
		priority: 30,
		includes: ( ctx ) => footwear( ctx, 0.143 ),
		prepare: fitStyledFootwear,
		shoeProfile: { top: 0.143, base: 0.0058, shaft: 0.001, collar: 0.0013, toeHeight: 0.031, toeExtension: 0.004, weltWidth: 0.0025 },
		offset( ctx ) {

			return styledFootwearOffset( ctx, this.shoeProfile );

		}
	},
	{
		id: 'boots-tall',
		label: 'Tall city boots',
		category: 'footwear',
		priority: 30,
		includes: ( ctx ) => footwear( ctx, 0.287 ),
		prepare: fitStyledFootwear,
		shoeProfile: { top: 0.287, base: 0.009, shaft: 0.004, collar: 0.0028, toeHeight: 0.035, toeExtension: 0.005, weltWidth: 0.0033 },
		offset( ctx ) {

			return styledFootwearOffset( ctx, this.shoeProfile );

		}
	}
];

/**
 * Where each lower garment covers, for a body that paints it on (the crowd):
 * the trousers' hem and waist and the footwear's top, as shares of the body's
 * height.
 */
export const PANTS_CUTS = Object.fromEntries( PANTS.map( ( pattern ) => [ pattern.id, {
	hem: { 'pants-leggings': 0.063, 'pants-chinos': 0.08, 'pants-cargo': 0.063, 'pants-shorts': 0.355, 'pants-joggers': 0.066 }[ pattern.id ] ?? 0.055,
	waist: pattern.waistHeight
} ] ) );
export const FOOTWEAR_CUTS = {
	'boots-patrol': { top: 0.19 },
	'shoes-city': { top: 0.079 },
	'sneakers-low': { top: 0.094 },
	'sneakers-high': { top: 0.151 },
	'boots-chelsea': { top: 0.143 },
	'boots-tall': { top: 0.287 }
};

/** The body-derived foot envelope and its source skin weights, for every styled cut. */
function fitStyledFootwear( contexts ) {

	const profile = this.shoeProfile;
	const offsetFor = ( ctx ) => styledFootwearOffset( ctx, profile );
	const toeHeights = { l: 0, r: 0 };
	for ( const ctx of contexts ) {

		if ( ctx.y > 0.05 || ctx.weight( 'foot' ) < 0.45 || ctx.z < ( ctx.footToeZ ?? 0.074 ) * 0.52 ) continue;
		toeHeights[ ctx.side ] = Math.max( toeHeights[ ctx.side ], ctx.y );

	}
	const toeFor = ( ctx ) => styledToeEnvelope( ctx, profile, toeHeights[ ctx.side ] || 0.025 );
	return {
		offset: offsetFor,
		shape( ctx, out ) {

			const offset = offsetFor( ctx );
			const sole = 1 - smoothstep( 0.012, 0.032, ctx.y );
			out[ 0 ] += ctx.nx * profile.weltWidth * sole;
			out[ 2 ] += ctx.nz * profile.weltWidth * sole;
			const cap = toeFor( ctx );
			out[ 0 ] += ( cap.point[ 0 ] - ctx.x - ctx.nx * offset - out[ 0 ] ) * cap.amount;
			out[ 1 ] += ( cap.point[ 1 ] - ctx.y - ctx.ny * offset - out[ 1 ] ) * cap.amount;
			out[ 2 ] += ( cap.point[ 2 ] - ctx.z - ctx.nz * offset - out[ 2 ] ) * cap.amount;
			out[ 1 ] -= ( ctx.y + ctx.ny * offset + out[ 1 ] ) * soleBottom( ctx );
			out[ 1 ] += Math.max( 0, - ctx.y - ctx.ny * offset - out[ 1 ] );
			// A padded collar is part of the same shell, its inner rim closed too:
			// the long source ankle triangles level off before the boundary pass.
			const collar = smoothstep( profile.top - 0.025, profile.top - 0.008, ctx.y );
			out[ 1 ] += ( profile.top - ctx.y - ctx.ny * offset - out[ 1 ] ) * collar;

		},
		normal( ctx, out ) {

			const cap = toeFor( ctx );
			for ( let axis = 0; axis < 3; axis ++ ) out[ axis ] += ( cap.normal[ axis ] - out[ axis ] ) * cap.amount;
			const bottom = soleBottom( ctx );
			out[ 0 ] *= 1 - bottom;
			out[ 1 ] += ( - 1 - out[ 1 ] ) * bottom;
			out[ 2 ] *= 1 - bottom;

		}
	};

}

function styledFootwearOffset( ctx, profile ) {

	const shaft = band( ctx.y, 0.042, profile.top + 0.002, 0.022 );
	const collar = band( ctx.y, profile.top - 0.025, profile.top + 0.006, 0.009 );
	return profile.base + shaft * profile.shaft + collar * profile.collar;

}

function styledToeEnvelope( ctx, profile, sourceHeight ) {

	const centerX = ctx.footCenterX ?? ( ctx.x < 0 ? - 0.064 : 0.064 );
	const sourceWidth = Math.max( 0.014, ctx.footHalfWidth ?? 0.033 );
	const sourceRadiusY = Math.max( 0.007, sourceHeight / 2 );
	const centerZ = - 0.008;
	const sourceDepth = Math.max( 0.045, ( ctx.footToeZ ?? 0.074 ) - centerZ );
	// The direction is fitted to the bare foot before the shoe's height: the
	// taller shoe's centre on bare toes would draw their top into a spike.
	const q = [ ( ctx.x - centerX ) / sourceWidth, ( ctx.y - sourceRadiusY ) / sourceRadiusY, ( ctx.z - centerZ ) / sourceDepth ];
	const length = Math.hypot( ...q ) || 1;
	const radii = [ sourceWidth + profile.weltWidth + 0.0015, profile.toeHeight / 2, sourceDepth + profile.toeExtension ];
	const normal = q.map( ( component, axis ) => component / radii[ axis ] );
	const normalLength = Math.hypot( ...normal ) || 1;
	return {
		amount: smoothstep( - 0.005, 0.024, ctx.z ) * ( 1 - smoothstep( 0.045, 0.075, ctx.y ) ),
		point: [ centerX + radii[ 0 ] * q[ 0 ] / length, radii[ 1 ] + radii[ 1 ] * q[ 1 ] / length, centerZ + radii[ 2 ] * q[ 2 ] / length ],
		normal: normal.map( ( component ) => component / normalLength )
	};

}

/** Fitted once to the body it dresses; the cloth still moves on its source rig. */
function fitTrouserSeat( contexts, faces ) {

	const source = contexts.filter( ( ctx ) => ctx.y > 0.425 && ctx.y < 0.65 && lowerBodyWeight( ctx ) > 0.5 );
	if ( source.length < 12 ) return {};

	const profiles = [];
	const start = 0.445;
	const step = 0.008;
	for ( let level = 0; level < 23; level ++ ) {

		const y = start + level * step;
		const points = source.filter( ( ctx ) => Math.abs( ctx.y - y ) < 0.013 ).map( ( ctx ) => [ ctx.x, ctx.z ] ).sort( ( a, b ) => a[ 0 ] - b[ 0 ] || a[ 1 ] - b[ 1 ] );
		if ( points.length < 3 ) continue;
		// The rear half of the level's convex hull bridges the cleft and keeps
		// every outer cheek; nearby levels ease the fold under the seat.
		const hull = [];
		for ( const point of points ) {

			while ( hull.length > 1 && cross2( hull.at( - 2 ), hull.at( - 1 ), point ) <= 0 ) hull.pop();
			hull.push( point );

		}
		if ( hull.length < 2 ) continue;
		const back = Math.min( ...points.map( ( point ) => point[ 1 ] ) );
		const forward = Math.max( ...points.map( ( point ) => point[ 1 ] ) );
		profiles.push( { y, hull, split: forward * 0.73 + back * 0.27 } );

	}
	if ( profiles.length < 2 ) return {};

	const baseShape = this.shape;
	const offsetFor = this.offset;
	const hem = upperSeatBoundary( contexts, faces );
	const surface = ( x, y ) => {

		const result = seatSurface( profiles, x, y );
		// A shallow sewn centre, not one flat panel over both cheeks: cloth ease,
		// not a second body-volume control.
		result.z += 0.0035 * ( 1 - smoothstep( 0, 0.03, Math.abs( x ) ) );
		return result;

	};
	const influence = ( ctx ) => {

		if ( hem.vertices.has( ctx ) ) return 0;
		const { split } = surface( ctx.x, ctx.y );
		return smoothstep( 0.454, 0.492, ctx.y ) * ( 1 - smoothstep( hem.y - 0.028, hem.y, ctx.y ) )
			* ( 1 - smoothstep( split - 0.016, split + 0.006, ctx.z ) ) * smoothstep( 0.08, 0.45, - ctx.nz );

	};

	return {
		shape( ctx, out ) {

			baseShape?.( ctx, out );
			const amount = influence( ctx );
			if ( amount <= 0 ) return;
			const offset = offsetFor( ctx );
			const currentZ = ctx.z + ctx.nz * offset + out[ 2 ];
			const envelopeZ = surface( ctx.x, ctx.y ).z - offset;
			// Outward only: a fuller seat always keeps its whole projection,
			// vertices beyond the sampled envelope included.
			out[ 2 ] += Math.min( 0, envelopeZ - currentZ ) * amount * 0.84;

		},
		normal( ctx, out ) {

			const offset = offsetFor( ctx );
			const gap = ctx.z + ctx.nz * offset - surface( ctx.x, ctx.y ).z + offset;
			const amount = influence( ctx ) * 0.84 * smoothstep( 0.0005, 0.009, gap );
			if ( amount <= 0 ) return;
			// The cloth's normal follows the smoothed seat, not the cleft beneath.
			const dx = ( surface( ctx.x + 0.009, ctx.y ).z - surface( ctx.x - 0.009, ctx.y ).z ) / 0.018;
			const dy = ( surface( ctx.x, ctx.y + 0.012 ).z - surface( ctx.x, ctx.y - 0.012 ).z ) / 0.024;
			const length = Math.hypot( dx, dy, 1 );
			out[ 0 ] += ( dx / length - out[ 0 ] ) * amount;
			out[ 1 ] += ( dy / length - out[ 1 ] ) * amount;
			out[ 2 ] += ( - 1 / length - out[ 2 ] ) * amount;

		}
	};

}

function upperSeatBoundary( contexts, faces ) {

	const fallback = { y: 0.617, vertices: new Set() };
	if ( ! faces?.length ) return fallback;
	const keys = contexts.map( ( ctx ) => ctx.weld );
	const edges = new Map();
	const size = contexts.length;
	for ( let face = 0; face < faces.length; face += 3 ) {

		for ( let side = 0; side < 3; side ++ ) {

			const a = faces[ face + side ];
			const b = faces[ face + ( side + 1 ) % 3 ];
			const key = Math.min( keys[ a ], keys[ b ] ) * size + Math.max( keys[ a ], keys[ b ] );
			const edge = edges.get( key );
			if ( edge ) edge.count ++;
			else edges.set( key, { a, b, count: 1 } );

		}

	}
	const boundary = new Map();
	for ( const { a, b, count } of edges.values() ) {

		if ( count !== 1 || Math.min( contexts[ a ].y, contexts[ b ].y ) < 0.49 ) continue;
		boundary.set( keys[ a ], contexts[ a ].y );
		boundary.set( keys[ b ], contexts[ b ].y );

	}
	if ( boundary.size < 3 ) return fallback;
	// Fitted to the chosen top's shared edge or the bare waistband; the builder
	// levels this ring, and its own vertices take no extra ease.
	return {
		y: [ ...boundary.values() ].reduce( ( sum, y ) => sum + y, 0 ) / boundary.size,
		vertices: new Set( contexts.filter( ( ctx, index ) => boundary.has( keys[ index ] ) ) )
	};

}

function seatSurface( profiles, x, y ) {

	let upper = 1;
	while ( upper < profiles.length - 1 && profiles[ upper ].y < y ) upper ++;
	const a = profiles[ upper - 1 ];
	const b = profiles[ upper ];
	const t = smoothstep( a.y, b.y, y );
	return { z: hullDepth( a.hull, x ) * ( 1 - t ) + hullDepth( b.hull, x ) * t, split: a.split * ( 1 - t ) + b.split * t };

}

function hullDepth( hull, x ) {

	let upper = 1;
	while ( upper < hull.length - 1 && hull[ upper ][ 0 ] < x ) upper ++;
	const a = hull[ upper - 1 ];
	const b = hull[ upper ];
	const t = Math.max( 0, Math.min( 1, ( x - a[ 0 ] ) / Math.max( 1e-8, b[ 0 ] - a[ 0 ] ) ) );
	return a[ 1 ] * ( 1 - t ) + b[ 1 ] * t;

}

function cross2( a, b, c ) {

	return ( b[ 0 ] - a[ 0 ] ) * ( c[ 1 ] - b[ 1 ] ) - ( b[ 1 ] - a[ 1 ] ) * ( c[ 0 ] - b[ 0 ] );

}

function trousers( ctx, waist ) {

	return ctx.y > 0.055 && ctx.y < waist && lowerBodyWeight( ctx ) > 0.25;

}

function footwear( ctx, top ) {

	return ctx.y < top && ctx.weight( 'foot' ) + ctx.weight( 'calf' ) > 0.25;

}

/** The high waist lies on spine_01, and the toes on the ball bones in these rigs. */
function lowerBodyWeight( ctx ) {

	return ctx.weight( 'torso' ) + ctx.weight( 'pelvis' ) + ctx.weight( 'thigh' ) + ctx.weight( 'calf' ) + ctx.weight( 'foot' );

}

function bootOffset( ctx ) {

	return 0.008 + band( ctx.y, 0.045, 0.19, 0.025 ) * 0.0025;

}

function shoeOffset( ctx ) {

	return 0.005 + band( ctx.y, 0.021, 0.079, 0.02 ) * 0.0015;

}

function shoeShape( ctx, out, offset, toeHeight, toeExtension, weltWidth ) {

	const sole = 1 - smoothstep( 0.012, 0.032, ctx.y );
	out[ 0 ] += ctx.nx * weltWidth * sole;
	out[ 2 ] += ctx.nz * weltWidth * sole;
	// The modelled toes go onto one rounded shoe envelope; the body's triangles
	// and bone weights stay intact through the ball-of-foot bend.
	const cap = toeEnvelope( ctx, toeHeight, toeExtension, weltWidth );
	out[ 0 ] += ( cap.point[ 0 ] - ctx.x - ctx.nx * offset - out[ 0 ] ) * cap.amount;
	out[ 1 ] += ( cap.point[ 1 ] - ctx.y - ctx.ny * offset - out[ 1 ] ) * cap.amount;
	out[ 2 ] += ( cap.point[ 2 ] - ctx.z - ctx.nz * offset - out[ 2 ] ) * cap.amount;
	const expandedY = ctx.y + ctx.ny * offset + out[ 1 ];
	out[ 1 ] -= expandedY * soleBottom( ctx );
	// The outsole stays on the actor's own ground plane.
	out[ 1 ] += Math.max( 0, - ctx.y - ctx.ny * offset - out[ 1 ] );

}

function shoeNormal( ctx, out, toeHeight, toeExtension, weltWidth ) {

	const cap = toeEnvelope( ctx, toeHeight, toeExtension, weltWidth );
	for ( let axis = 0; axis < 3; axis ++ ) out[ axis ] += ( cap.normal[ axis ] - out[ axis ] ) * cap.amount;
	const bottom = soleBottom( ctx );
	out[ 0 ] *= 1 - bottom;
	out[ 1 ] += ( - 1 - out[ 1 ] ) * bottom;
	out[ 2 ] *= 1 - bottom;

}

function toeEnvelope( ctx, toeHeight, toeExtension, weltWidth ) {

	const centerX = ctx.footCenterX ?? ( ctx.x < 0 ? - 0.064 : 0.064 );
	const radiusX = ( ctx.footHalfWidth ?? 0.033 ) + weltWidth + 0.0015;
	const centerY = toeHeight / 2;
	const centerZ = - 0.008;
	const radiusZ = Math.max( 0.055, ( ctx.footToeZ ?? 0.074 ) - centerZ + toeExtension );
	const q = [ ( ctx.x - centerX ) / radiusX, ( ctx.y - centerY ) / centerY, ( ctx.z - centerZ ) / radiusZ ];
	const length = Math.hypot( ...q ) || 1;
	const normal = [ q[ 0 ] / radiusX, q[ 1 ] / centerY, q[ 2 ] / radiusZ ];
	const normalLength = Math.hypot( ...normal ) || 1;
	return {
		amount: smoothstep( - 0.005, 0.024, ctx.z ) * ( 1 - smoothstep( 0.045, 0.075, ctx.y ) ),
		point: [ centerX + radiusX * q[ 0 ] / length, centerY + centerY * q[ 1 ] / length, centerZ + radiusZ * q[ 2 ] / length ],
		normal: normal.map( ( component ) => component / normalLength )
	};

}

function soleBottom( ctx ) {

	return ( 1 - smoothstep( 0.006, 0.016, ctx.y ) ) * smoothstep( 0.1, 0.65, - ctx.ny );

}

function outside( ctx ) {

	return ctx.nx * ( ctx.x < 0 ? - 1 : 1 );

}

function positive( value ) {

	return Math.max( 0, value );

}

function smoothstep( min, max, value ) {

	const t = Math.max( 0, Math.min( 1, ( value - min ) / ( max - min ) ) );
	return t * t * ( 3 - 2 * t );

}

function band( value, min, max, feather ) {

	return smoothstep( min, min + feather, value ) * ( 1 - smoothstep( max - feather, max, value ) );

}
