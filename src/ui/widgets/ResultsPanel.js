import { el } from '../components/dom.js';
import { Button } from '../components/Button.js';

const ROWS = [
	[ 'fps', ( m ) => fmt( m.fps, 1 ) ],
	[ 'cpu frame ms', ( m ) => fmt( m.cpuFrameMs, 2 ) ],
	[ 'gpu render ms', ( m ) => fmt( m.gpuRenderMs, 2 ) ],
	[ 'gpu compute ms', ( m ) => fmt( m.gpuComputeMs, 2 ) ],
	[ 'draw calls', ( m ) => fmt( m.drawCalls, 0 ) ],
	[ 'triangles', ( m ) => fmt( m.triangles, 0 ) ],
	[ 'visible instances', ( m ) => fmt( m.visibleInstances, 0 ) ],
	[ 'visible by LOD', ( m ) => m.visibleByLod ? m.visibleByLod.join( ' / ' ) : '-' ]
];

/** Live numbers of the current run plus the copy-as-JSON export button. */
export class ResultsPanel {

	constructor( { onCopyJson } ) {

		this.values = new Map();

		const rows = ROWS.map( ( [ label ] ) => {

			const value = el( 'span', { className: 'results-value', textContent: '-' } );
			this.values.set( label, value );
			return el( 'div', { className: 'results-row' },
				el( 'span', { className: 'results-label', textContent: label } ),
				value
			);

		} );

		this.copyButton = new Button( {
			label: 'copy as JSON',
			onClick: async () => {

				try {

					await navigator.clipboard.writeText( onCopyJson() );
					this.copyButton.flash( 'copied' );

				} catch {

					this.copyButton.flash( 'copy failed' );

				}

			}
		} );

		this.status = el( 'div', { className: 'status', textContent: '' } );

		this.element = el( 'div', { className: 'panel panel-results' },
			el( 'h2', { className: 'panel-title', textContent: 'results' } ),
			...rows,
			this.status,
			this.copyButton.element
		);

	}

	update( snapshot ) {

		for ( const [ label, format ] of ROWS ) {

			this.values.get( label ).textContent = format( snapshot.metrics );

		}

	}

	setStatus( text ) {

		this.status.textContent = text;

	}

}

function fmt( value, digits ) {

	if ( typeof value !== 'number' ) return '-';
	return digits === 0 ? value.toLocaleString( 'en-US' ) : value.toFixed( digits );

}
