/** Converts the lamp builder's solid post and head records into prop obstacle volumes. */
export class DressingObstacles {
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
}
