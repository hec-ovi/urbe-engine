/**
 * What this world is drawn at, wherever it is drawn. A preview of one building
 * and a played frame of the city it stands in are only comparable while they
 * share these, so they are stated once here rather than defaulted twice.
 *
 * `hour` is the fixed lighting hour the look was tuned at; `exposure` maps the
 * photometric levels onto the luminance bands in CONTRACT.md; `fog` is the
 * street's density per metre, which is what separates a skyline into planes;
 * `fov` is the field of view the frame is composed at, which decides how a
 * facade's panel rhythm and window proportion read. A near plane at 0.2 m is
 * still inside the player capsule, and it buys the depth precision that keeps
 * coplanar facade layers from flickering.
 */
export const LOOK = Object.freeze( {
	hour: 21,
	exposure: 0.024,
	fog: 0.0003,
	fov: 72,
	near: 0.2,
	far: 900
} );
