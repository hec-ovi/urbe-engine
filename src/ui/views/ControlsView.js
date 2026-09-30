import { el } from '../components/dom.js';
import { keyCap } from '../components/KeyCap.js';
import { PanelHeader } from '../components/PanelHeader.js';
import '../components/controls.css';

/** Searchable studio input reference. Bindings and categories always come from the host. */
export class ControlsView {
	constructor( { onClose } ) {
		this.bindings = [];
		this.selected = null;
		this.category = '';
		this.header = new PanelHeader( { title: 'Controls', key: '?', onClose } );
		this.search = el( 'input', { type: 'search', className: 'controls-search', placeholder: 'Search controls…', ariaLabel: 'Find an action or key' } );
		this.search.addEventListener( 'input', () => this.filter() );
		this.categories = el( 'nav', { className: 'controls-categories', ariaLabel: 'Control categories' } );
		this.count = el( 'span', { className: 'controls-result-count', role: 'status' } );
		this.list = el( 'tbody' );
		this.empty = el( 'p', { className: 'controls-empty' } );
		this.clear = el( 'button', { type: 'button', className: 'hud-button', textContent: 'Clear filters' } );
		this.clear.addEventListener( 'click', () => { this.search.value = ''; this.category = ''; this.filter(); this.search.focus(); } );
		this.guideTitle = el( 'h3', { className: 'controls-guide-title' } );
		this.guideDescription = el( 'p', { className: 'controls-guide-description' } );
		this.guideKeys = el( 'div', { className: 'controls-guide-keys', ariaHidden: 'true' } );
		this.drawnKeys = new Map();
		const keyboard = el( 'div', { className: 'controls-keyboard', ariaHidden: 'true' } );
		for ( const keys of [ [ 'Q', 'W', 'E', 'R' ], [ 'A', 'S', 'D', 'C' ], [ 'Shift', 'Space', 'Esc' ] ] ) {
			keyboard.append( el( 'div', {}, ...keys.map( key => {
				const cap = el( 'span', { className: 'controls-drawn-key', textContent: key } );
				this.drawnKeys.set( key, cap );
				return cap;
			} ) ) );
		}
		this.main = el( 'div', { className: 'controls-reference' },
			el( 'div', { className: 'controls-search-row' }, this.search, this.count ),
			el( 'div', { className: 'controls-list-heading', ariaHidden: 'true' }, el( 'span', { textContent: 'ACTION' } ), el( 'span', { textContent: 'INPUT' } ) ),
			el( 'div', { className: 'controls-list' }, el( 'table', { className: 'controls-table', ariaLabel: 'Input bindings' }, this.list ), this.empty, this.clear ) );
		this.element = el( 'div', { className: 'view view-controls' },
			el( 'div', { className: 'controls-mast' }, el( 'span', { textContent: 'FIELD GUIDE / INPUT REFERENCE' } ), el( 'span', { textContent: 'KEYBOARD & MOUSE' } ) ),
			this.header.element, this.categories,
			el( 'div', { className: 'controls-body' },
				el( 'aside', { className: 'controls-guide' }, el( 'span', { className: 'controls-eyebrow', textContent: 'AT A GLANCE' } ), keyboard,
					this.guideTitle, this.guideDescription, this.guideKeys,
					el( 'p', { className: 'controls-tip', textContent: 'Use the mouse to look around. Open a menu to use the pointer.' } ) ), this.main ),
			el( 'footer', { className: 'controls-footer', textContent: 'Select an action to inspect its input.' } ) );
		this.setBindings( [] );
	}

	/** @param bindings [{action, keys: string[], category?, description?}] */
	setBindings( bindings = [] ) {
		const focused = this.list.querySelector( 'button:focus' )?.dataset.action;
		const scroll = this.main.querySelector( '.controls-list' ).scrollTop;
		this.bindings = bindings.map( binding => ( { ...binding, keys: [ ...binding.keys ] } ) );
		this.rows = this.bindings.map( binding => {
			const button = el( 'button', { type: 'button', className: 'controls-action', textContent: binding.action } );
			button.dataset.action = binding.action;
			button.addEventListener( 'click', () => this.select( binding ) );
			const row = el( 'tr', {}, el( 'td', {}, button ), el( 'td', {}, ...binding.keys.map( keyCap ) ) );
			return { binding, row, button };
		} );
		this.list.replaceChildren( ...this.rows.map( row => row.row ) );
		const categories = [ '', ...new Set( this.bindings.map( binding => binding.category ).filter( Boolean ) ) ];
		if ( ! categories.includes( this.category ) ) this.category = '';
		this.categories.replaceChildren( ...categories.map( category => {
			const button = el( 'button', { type: 'button', textContent: category || 'All controls' } );
			button.dataset.category = category;
			button.addEventListener( 'click', () => { this.category = category; this.filter(); } );
			return button;
		} ) );
		this.select( this.bindings.find( binding => binding.action === this.selected ) ?? this.bindings[ 0 ] );
		this.filter();
		this.main.querySelector( '.controls-list' ).scrollTop = scroll;
		this.rows.find( row => row.binding.action === focused && ! row.row.hidden )?.button.focus( { preventScroll: true } );
	}

	select( binding ) {
		this.selected = binding?.action ?? null;
		this.guideTitle.textContent = binding?.action ?? 'Input reference';
		this.guideDescription.textContent = binding?.description ?? '';
		this.guideKeys.replaceChildren( ...( binding?.keys ?? [] ).map( keyCap ) );
		for ( const [ key, node ] of this.drawnKeys ) node.classList.toggle( 'is-active', binding?.keys.includes( key ) ?? false );
		for ( const row of this.rows ) {
			const selected = row.binding === binding;
			row.row.classList.toggle( 'is-selected', selected );
			row.button.setAttribute( 'aria-pressed', String( selected ) );
		}
	}

	filter() {
		const terms = this.search.value.toLowerCase().trim().split( /\s+/ );
		let count = 0;
		for ( const { binding, row } of this.rows ) {
			const text = [ binding.action, binding.description, ...binding.keys ].join( ' ' ).toLowerCase();
			row.hidden = Boolean( this.category && binding.category !== this.category ) || ! terms.every( term => text.includes( term ) );
			if ( ! row.hidden ) count ++;
		}
		for ( const button of this.categories.children ) button.setAttribute( 'aria-pressed', String( button.dataset.category === this.category ) );
		this.count.textContent = `${count} controls`;
		this.empty.textContent = this.bindings.length ? 'No matching controls' : 'no bindings yet';
		this.empty.hidden = count > 0;
		this.clear.hidden = count > 0 || ! this.bindings.length;
	}
}
