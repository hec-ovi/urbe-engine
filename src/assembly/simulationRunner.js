/**
 * Black-box runner for the simulation library (../simulation/CONTRACT.md):
 * imports the sibling package's built entry by path and calls
 * createSimulation(input).
 */

const SIMULATION_ENTRY = new URL( '../../../simulation/dist/index.js', import.meta.url ).href;

/** @returns CitySimulation per the simulation contract */
export async function runCreateSimulation( input ) {

	const { createSimulation } = await import( SIMULATION_ENTRY );

	return createSimulation( input );

}
