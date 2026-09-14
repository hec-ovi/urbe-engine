/** A rendering-only projection; complete Atlas planning data stays authoritative. */
export function retainedStreetGround( atlas, manifest ) {
	const replaced = new Set( manifest.ground.replacements.moduleOwnerIds );
	const construction = atlas.streets.construction;
	return {
		...atlas,
		streets: { ...atlas.streets, construction: {
			...construction,
			...( construction.modules ? { modules: { ...construction.modules,
				placements: construction.modules.placements.filter( placement => ! replaced.has( placement.blockId ) )
			} } : {} )
		} },
		volumetric: { ...atlas.volumetric, ground: manifest.delegated.remainingGroundIndices.map( index => atlas.volumetric.ground[ index ] ) }
	};
}
