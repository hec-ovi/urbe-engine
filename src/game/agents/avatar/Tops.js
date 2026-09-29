/*
 * Carried over from the NPC Studio (codex_npcs, src/clothing/tops.js): the
 * tailored shell patterns of the tops.
 *
 * Patterns are authored in bind-pose coordinates as shares of the body's full
 * height, so one pattern fits adult, teen, male and female rigs and any shape.
 * The shell builder (Wardrobe.js) keeps the source skin weights and the panels
 * (GarmentPanels.js) paint the colours. This is a light procedural pass, not
 * simulated cloth.
 */
export const TOPS = [
	{
		id: 'tech-top',
		tucked: true,
		collar: { height: 0.864, style: 'stand' },
		label: 'Contour tech top',
		category: 'top',
		priority: 20,
		includes: ( ctx ) => coversUpperBody( ctx, { hem: 0.57, neck: 0.864 } ),
		offset( ctx ) {

			// A little ease at the hem keeps the close fit from reading as paint.
			return 0.0038 + band( ctx.y, 0.57, 0.59, 0.011 ) * 0.0015 + shoulder( ctx ) * 0.0013;

		},
		shape( ctx, out ) {

			// The stand collar has a small straight upper edge instead of hugging skin.
			out[ 1 ] = neckShare( ctx ) * 0.0018;

		}
	},
	{
		id: 'police-jacket',
		tucked: false,
		collar: { height: 0.878, style: 'stand' },
		label: 'Metro police jacket',
		category: 'top',
		priority: 20,
		includes: ( ctx ) => coversUpperBody( ctx, { hem: 0.542, neck: 0.878 } ),
		offset( ctx ) {

			const cuff = smoothstep( 0.318, 0.343, Math.abs( ctx.x ) ) * armShare( ctx );
			return 0.0085 + shoulder( ctx ) * 0.004 + cuff * 0.0015 + neckShare( ctx ) * 0.002;

		},
		shape( ctx, out ) {

			// Eased side seams and a raised shoulder line, with nothing rigid that
			// could part from the rig as it moves.
			const torso = torsoShare( ctx );
			const waist = band( ctx.y, 0.59, 0.755, 0.04 ) * torso;
			out[ 0 ] = Math.sign( ctx.x ) * 0.004 * waist * Math.abs( ctx.nx );
			out[ 1 ] = shoulder( ctx ) * Math.max( 0, ctx.ny ) * 0.005 + neckShare( ctx ) * 0.003;
			// A flatter utility chest reads as woven outerwear on either body.
			out[ 2 ] = Math.max( 0, 0.062 - ctx.z ) * 0.35 * front( ctx ) * band( ctx.y, 0.68, 0.78, 0.025 ) * torso;

		}
	},
	{
		id: 'office-jacket',
		tucked: false,
		collar: { height: 0.86, style: 'open' },
		label: 'Executive office jacket',
		category: 'top',
		priority: 20,
		includes: ( ctx ) => coversUpperBody( ctx, { hem: 0.559, neck: 0.86, sleeveEnd: 0.304 } ),
		offset( ctx ) {

			const cuff = band( Math.abs( ctx.x ), 0.279, 0.308, 0.008 ) * armShare( ctx );
			return 0.006 + shoulder( ctx ) * 0.0018 + lapelShare( ctx ) * 0.003 + cuff * 0.0014;

		},
		shape( ctx, out ) {

			const tailoring = band( ctx.y, 0.59, 0.79, 0.035 ) * torsoShare( ctx );
			out[ 0 ] = Math.sign( ctx.x ) * Math.abs( ctx.nx ) * 0.0024 * tailoring;
			out[ 1 ] = shoulder( ctx ) * Math.max( 0, ctx.ny ) * 0.002;
			// The folded lapels stand off the contrasting inner shirt.
			out[ 2 ] = lapelShare( ctx ) * 0.0018;

		}
	},
	{
		id: 'top-tee',
		tucked: true,
		collar: { height: 0.853, style: 'crew' },
		label: 'Everyday crew tee',
		category: 'top',
		priority: 20,
		includes: ( ctx ) => coversUpperBody( ctx, { hem: 0.568, neck: 0.853, sleeveEnd: 0.215 } ),
		offset( ctx ) {

			return 0.0055 + shoulder( ctx ) * 0.0018 + sleeveBand( ctx, 0.197, 0.217 ) * 0.0012
				+ band( ctx.y, 0.568, 0.591, 0.011 ) * torsoShare( ctx ) * 0.002;

		},
		shape( ctx, out ) {

			// The relaxed lower torso hangs straight; the ribbed neck does not inflate.
			const ease = band( ctx.y, 0.585, 0.756, 0.033 ) * torsoShare( ctx );
			out[ 0 ] = Math.sign( ctx.x ) * Math.abs( ctx.nx ) * 0.0035 * ease;
			out[ 2 ] = Math.max( 0, 0.038 - ctx.z ) * front( ctx ) * ease * 0.16;

		}
	},
	{
		id: 'top-tank',
		tucked: true,
		collar: { height: 0.85, style: 'crew' },
		armholeAxis: 'x',
		label: 'Bound edge shell',
		category: 'top',
		priority: 20,
		includes: ( ctx ) => coversUpperBody( ctx, { hem: 0.568, neck: 0.85, sleeveEnd: 0.106 } ),
		offset( ctx ) {

			return 0.0034 + neckShare( ctx ) * 0.0008 + band( ctx.y, 0.568, 0.589, 0.01 ) * 0.0015;

		},
		shape( ctx, out ) {

			const ease = band( ctx.y, 0.58, 0.685, 0.025 ) * torsoShare( ctx );
			out[ 0 ] = Math.sign( ctx.x ) * Math.abs( ctx.nx ) * ease * 0.0018;

		}
	},
	{
		id: 'top-turtleneck',
		tucked: true,
		collar: { height: 0.887, style: 'stand' },
		label: 'Fine knit turtleneck',
		category: 'top',
		priority: 20,
		includes: ( ctx ) => coversUpperBody( ctx, { hem: 0.573, neck: 0.887 } ),
		offset( ctx ) {

			return 0.0032 + neckShare( ctx ) * 0.0016 + sleeveBand( ctx, 0.322, 0.355 ) * 0.0008
				+ band( ctx.y, 0.573, 0.588, 0.008 ) * torsoShare( ctx ) * 0.0008;

		},
		shape( ctx, out ) {

			// A lifted tubular collar is part of the weighted shell, not an attachment.
			out[ 1 ] = neckShare( ctx ) * smoothstep( 0.847, 0.876, ctx.y ) * 0.0035;

		}
	},
	{
		id: 'jacket-cropped',
		tucked: false,
		collar: { height: 0.86, style: 'stand' },
		label: 'Cropped city jacket',
		category: 'top',
		priority: 20,
		includes: ( ctx ) => coversUpperBody( ctx, { hem: 0.635, neck: 0.86, sleeveEnd: 0.3 } ),
		offset( ctx ) {

			return 0.0088 + shoulder( ctx ) * 0.0042 + sleeveBand( ctx, 0.277, 0.303 ) * 0.0032
				+ band( ctx.y, 0.633, 0.655, 0.01 ) * torsoShare( ctx ) * 0.002;

		},
		shape( ctx, out ) {

			const box = band( ctx.y, 0.647, 0.777, 0.027 ) * torsoShare( ctx );
			out[ 0 ] = Math.sign( ctx.x ) * Math.abs( ctx.nx ) * box * 0.005;
			out[ 1 ] = shoulder( ctx ) * Math.max( 0, ctx.ny ) * 0.0035;
			out[ 2 ] = Math.max( 0, 0.058 - ctx.z ) * front( ctx ) * box * 0.24;

		}
	},
	{
		id: 'vest-tailored',
		tucked: false,
		collar: { height: 0.85, style: 'open' },
		armholeAxis: 'x',
		label: 'Tailored city vest',
		category: 'top',
		priority: 20,
		includes: ( ctx ) => coversUpperBody( ctx, { hem: 0.576, neck: 0.85, sleeveEnd: 0.112 } ),
		offset( ctx ) {

			return 0.0058 + shoulder( ctx ) * 0.0015 + vestOpeningEdge( ctx ) * 0.0023;

		},
		shape( ctx, out ) {

			const fit = band( ctx.y, 0.604, 0.764, 0.025 ) * torsoShare( ctx );
			out[ 0 ] = Math.sign( ctx.x ) * Math.abs( ctx.nx ) * fit * 0.0018;
			out[ 2 ] = vestOpeningEdge( ctx ) * 0.0025;

		}
	},
	{
		id: 'shirt-utility',
		tucked: false,
		collar: { height: 0.854, style: 'open' },
		label: 'Utility overshirt',
		category: 'top',
		priority: 20,
		includes: ( ctx ) => coversUpperBody( ctx, { hem: 0.547, neck: 0.854, sleeveEnd: 0.286 } ),
		offset( ctx ) {

			const pocket = band( Math.abs( ctx.x ), 0.027, 0.075, 0.007 ) * band( ctx.y, 0.701, 0.753, 0.009 ) * front( ctx ) * torsoShare( ctx );
			return 0.0078 + shoulder( ctx ) * 0.0025 + pocket * 0.0022 + sleeveBand( ctx, 0.263, 0.289 ) * 0.0035;

		},
		shape( ctx, out ) {

			const ease = band( ctx.y, 0.56, 0.782, 0.03 ) * torsoShare( ctx );
			out[ 0 ] = Math.sign( ctx.x ) * Math.abs( ctx.nx ) * ease * 0.0042;
			out[ 2 ] = Math.max( 0, 0.062 - ctx.z ) * front( ctx ) * ease * 0.27;
			out[ 1 ] = shoulder( ctx ) * Math.max( 0, ctx.ny ) * 0.002;

		}
	},
	{
		id: 'jacket-bomber',
		tucked: false,
		collar: { height: 0.86, style: 'stand' },
		label: 'Ribbed flight bomber',
		category: 'top',
		priority: 20,
		includes: ( ctx ) => coversUpperBody( ctx, { hem: 0.605, neck: 0.86 } ),
		offset( ctx ) {

			const sleeve = sleeveBand( ctx, 0.133, 0.309, 0.029 );
			const body = band( ctx.y, 0.644, 0.791, 0.026 ) * torsoShare( ctx );
			return 0.006 + sleeve * 0.011 + body * 0.006 + shoulder( ctx ) * 0.004 + neckShare( ctx ) * 0.0015;

		},
		shape( ctx, out ) {

			// Sleeve volume fades before the cuffs and narrows into the ribbed hem.
			const volume = band( ctx.y, 0.639, 0.783, 0.027 ) * torsoShare( ctx );
			out[ 0 ] = Math.sign( ctx.x ) * Math.abs( ctx.nx ) * volume * 0.005;
			out[ 1 ] = shoulder( ctx ) * Math.max( 0, ctx.ny ) * 0.004;
			out[ 2 ] = Math.max( 0, 0.065 - ctx.z ) * front( ctx ) * volume * 0.25;

		}
	}
];

/**
 * Where each top covers, for a body that paints it on (the crowd): its hem
 * and neck heights and how far along the outstretched arm its sleeve reaches,
 * all as shares of the body's height; a sleeveless top reaches its armhole.
 */
export const TOP_CUTS = {
	'tech-top': { hem: 0.57, sleeve: 0.336 },
	'police-jacket': { hem: 0.542, sleeve: 0.343 },
	'office-jacket': { hem: 0.559, sleeve: 0.304 },
	'top-tee': { hem: 0.568, sleeve: 0.215 },
	'top-tank': { hem: 0.568, sleeve: 0.106 },
	'top-turtleneck': { hem: 0.573, sleeve: 0.336 },
	'jacket-cropped': { hem: 0.635, sleeve: 0.3 },
	'vest-tailored': { hem: 0.576, sleeve: 0.112 },
	'shirt-utility': { hem: 0.547, sleeve: 0.286 },
	'jacket-bomber': { hem: 0.605, sleeve: 0.336 }
};

function sleeveBand( ctx, start, end, feather = 0.008 ) {

	return band( Math.abs( ctx.x ), start, end, feather ) * armShare( ctx );

}

function vestOpeningEdge( ctx ) {

	const opening = 0.012 + smoothstep( 0.665, 0.827, ctx.y ) * 0.044;
	return ( 1 - smoothstep( 0.003, 0.012, Math.abs( Math.abs( ctx.x ) - opening ) ) ) * band( ctx.y, 0.665, 0.831, 0.009 ) * front( ctx ) * torsoShare( ctx );

}

/** A sleeveless top is the same cut with its sleeve ending at the upper arm's root. */
function coversUpperBody( ctx, { hem, neck, sleeveEnd = Infinity } ) {

	if ( ctx.y < hem || ctx.y > neck ) return false;
	if ( ctx.weight( 'head' ) > 0.2 || ctx.weight( 'hand' ) > 0.12 ) return false;
	if ( ctx.weight( 'thigh' ) + ctx.weight( 'calf' ) + ctx.weight( 'foot' ) > 0.35 ) return false;
	const arm = armShare( ctx );
	if ( arm > 0.12 && Math.abs( ctx.x ) > sleeveEnd ) return false;
	return torsoShare( ctx ) + neckShare( ctx ) + arm > 0.1;

}

function armShare( ctx ) {

	return ctx.weight( 'upperarm' ) + ctx.weight( 'lowerarm' );

}

function torsoShare( ctx ) {

	return ctx.weight( 'torso' ) + ctx.weight( 'pelvis' );

}

function neckShare( ctx ) {

	return ctx.weight( 'neck' );

}

function shoulder( ctx ) {

	return band( Math.abs( ctx.x ), 0.063, 0.155, 0.025 ) * smoothstep( 0.761, 0.797, ctx.y ) * ( ctx.weight( 'torso' ) + ctx.weight( 'upperarm' ) );

}

/** The inner shirt narrows to a V above the jacket's central fastening. */
function lapelOpening( y ) {

	return 0.012 + smoothstep( 0.656, 0.823, y ) * 0.046;

}

function lapelShare( ctx ) {

	if ( ctx.y < 0.69 || ctx.y > 0.83 ) return 0;
	return ( 1 - smoothstep( 0.006, 0.018, Math.abs( Math.abs( ctx.x ) - lapelOpening( ctx.y ) ) ) ) * front( ctx ) * torsoShare( ctx );

}

function front( ctx ) {

	return smoothstep( 0.05, 0.6, ctx.nz );

}

function band( value, start, end, feather ) {

	return smoothstep( start - feather, start + feather, value ) * ( 1 - smoothstep( end - feather, end + feather, value ) );

}

function smoothstep( start, end, value ) {

	const t = Math.max( 0, Math.min( 1, ( value - start ) / ( end - start ) ) );
	return t * t * ( 3 - 2 * t );

}
