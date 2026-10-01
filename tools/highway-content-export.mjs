import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Group, Mesh, MeshStandardMaterial } from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { buildHighwayModel } from '../src/game/ground/HighwayModel.js';

const args = process.argv.slice( 2 );
const option = ( name ) => args.includes( name ) ? args[ args.indexOf( name ) + 1 ] : undefined;
const blueprint = option( '--blueprint' ), out = option( '--out' );
if ( ! blueprint || ! out ) throw new Error( 'Usage: node tools/highway-content-export.mjs --blueprint <Atlas JSON> --out <new directory>' );
const source = JSON.parse( await readFile( blueprint, 'utf8' ) );
const structures = source.streets?.highwayStructures;
if ( ! Array.isArray( structures ) || ! structures.length ) throw new Error( 'Source has no highwayStructures.' );
await mkdir( out ); // Existing destinations are deliberately not overwritten.
const fallback = {
	roadway: [ '#45484a', 0.84, 0 ], 'deck-concrete': [ '#85867f', 0.8, 0 ],
	'soffit-concrete': [ '#686a65', 0.88, 0 ], 'pier-concrete': [ '#818279', 0.86, 0 ],
	'barrier-concrete': [ '#919187', 0.78, 0 ], 'bearing-steel': [ '#505452', 0.52, 0.72 ],
	'joint-rubber': [ '#272a29', 0.92, 0 ]
};
const materials = new Map( Object.entries( fallback ).map( ( [ slot, values ] ) => {
	const m = new MeshStandardMaterial( { color: values[ 0 ], roughness: values[ 1 ], metalness: values[ 2 ] } );
	m.name = slot; m.userData = { highwayContentSlot: slot, placeholder: true };
	return [ slot, m ];
} ) );
globalThis.FileReader ??= class {
	readAsArrayBuffer( blob ) { blob.arrayBuffer().then( ( buffer ) => { this.result = buffer; this.onloadend?.(); } ); }
	readAsDataURL( blob ) { blob.arrayBuffer().then( ( buffer ) => { this.result = 'data:application/octet-stream;base64,' + Buffer.from( buffer ).toString( 'base64' ); this.onloadend?.(); } ); }
};
const group = new Group(); group.name = 'authored-highway-content';
const reports = [], models = [];
for ( let i = 0; i < structures.length; i ++ ) {
	const model = buildHighwayModel( structures[ i ] );
	models.push( model );
	const node = new Group(); node.name = 'highway-' + i;
	for ( const part of model.parts ) {
		const mesh = new Mesh( part.geometry, materials.get( part.slot ) );
		mesh.name = node.name + ':' + part.slot;
		mesh.userData = { highwayContentSlot: part.slot, sourceStructure: i };
		node.add( mesh );
	}
	group.add( node );
	reports.push( { sourceStructure: i, source: model.source, bounds: model.bounds, statistics: model.statistics, detail: model.detail } );
}
const buffer = await new GLTFExporter().parseAsync( group, { binary: true, onlyVisible: false } );
const bytes = Buffer.from( buffer );
await writeFile( path.join( out, 'highway-model.glb' ), bytes );
await writeFile( path.join( out, 'manifest.json' ), JSON.stringify( {
	format: 'urbe-highway-content-review', version: '1.0.0', sourceBlueprint: path.resolve( blueprint ),
	geometry: { file: 'highway-model.glb', bytes: bytes.byteLength, sha256: createHash( 'sha256' ).update( bytes ).digest( 'hex' ) },
	materials: { status: 'untextured slot placeholders; not final visual acceptance', slots: [ ...materials.keys() ] },
	coordinates: 'Atlas world metres; Y up; no additional placement transform',
	collision: 'not exported as gameplay collision; consumer ownership remains with Claude',
	structures: reports
}, null, 2 ) );
models.forEach( ( m ) => m.dispose() ); materials.forEach( ( m ) => m.dispose() );
console.log( JSON.stringify( { out: path.resolve( out ), structures: reports.length, bytes: bytes.byteLength,
	triangles: reports.reduce( ( sum, r ) => sum + r.statistics.triangles, 0 ), materials: materials.size } ) );
