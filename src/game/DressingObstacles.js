/**
 * The solid things standing on the street as obstacle volumes
 * `{ footprint: [[x, z]], bottom, top }`: what street dressing keeps clear of,
 * and what a quest scene on the sidewalk stands around.
 */
export class DressingObstacles {

	/** The lamp builder's solid post and head records. */
	static fromPosts( posts ) {
		return posts.flatMap( post => {
			const r = post.radius;
			const volumes = [ {
				footprint: [ [ post.x - r, post.z - r ], [ post.x + r, post.z - r ], [ post.x + r, post.z + r ], [ post.x - r, post.z + r ] ],
				bottom: post.base, top: post.base + post.height
			} ];
			if ( post.head ) {
				const { center, aim, length, width, height, underside } = post.head;
				volumes.push( {
					footprint: [ [ - 1, - 1 ], [ 1, - 1 ], [ 1, 1 ], [ - 1, 1 ] ].map( ( [ along, across ] ) => [ center.x + aim.x * length * along / 2 - aim.z * width * across / 2, center.z + aim.z * length * along / 2 + aim.x * width * across / 2 ] ),
					bottom: underside, top: underside + height
				} );
			}
			return volumes;
		} );
	}

	/** The native street features except tree grates, whose tree stands among the props. */
	static fromFeatures( features ) {
		return features.filter( feature => feature.kind !== 'tree-grate' ).map( feature => ( {
			footprint: feature.footprint, bottom: feature.bounds.min[ 1 ], top: feature.bounds.max[ 1 ]
		} ) );
	}

	/** Placed street props; a tree stands where its trunk and lowest branches do, not under its whole crown. */
	static fromPlacements( placements ) {
		return placements.map( item => ( {
			footprint: item.kind === 'tree' ? item.lowFootprint : item.footprint, bottom: item.bottom, top: item.top
		} ) );
	}

}
