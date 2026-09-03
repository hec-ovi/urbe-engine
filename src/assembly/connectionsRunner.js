/**
 * Black-box runner for the connections library (../connections/CONTRACT.md):
 * imports the sibling package by path and calls generate(atlas, params).
 * The entry is TypeScript, so this module must run under a TS-capable loader (tsx).
 */

const CONNECTIONS_ENTRY = new URL( '../../../connections/src/index.ts', import.meta.url ).href;

/** @returns ConnectionsOutput per ../connections/schemas/output.schema.json */
export async function runConnections( atlas, params ) {

	const { generate } = await import( CONNECTIONS_ENTRY );

	return generate( atlas, params );

}

/** @returns RooftopSpanOutput per ../connections/schemas/rooftop-span-output.schema.json */
export async function runRooftopSpans( request ) {

	const { generateRooftopSpans } = await import( CONNECTIONS_ENTRY );

	return generateRooftopSpans( request );

}
