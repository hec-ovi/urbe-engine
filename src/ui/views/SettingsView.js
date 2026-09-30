import { el } from '../components/dom.js';
import { PanelHeader } from '../components/PanelHeader.js';
import { SettingField } from '../components/SettingField.js';
import layout from './settings-layout.json' with { type: 'json' };

/**
 * The run's settings as a card over the paused city: one tab per section of
 * [settings-layout.json](settings-layout.json), its fields in lettered groups,
 * and beside it the card reading out the setting in focus or under the pointer.
 * Every edit reports one change at once; the game applies it and hands the
 * values back through setValues.
 * props: { onChange({ key, value }), onClose }
 */
export class SettingsView {

	constructor( { onChange, onClose } ) {

		this.fields = new Map();
		this.specs = new Map();
		this.tab = 0;

		this.tabs = el( 'div', { className: 'screen-tabs settings-tabs', role: 'tablist' } );
		this.tabs.setAttribute( 'aria-label', layout.tabs );
		this.sections = layout.sections.map( ( section, index ) => {

			const tab = el( 'button', { className: 'screen-tab settings-tab', type: 'button', role: 'tab' },
				el( 'span', { className: 'settings-tab-number', textContent: section.number } ),
				section.label
			);
			tab.addEventListener( 'click', () => this.showSection( index ) );
			this.tabs.append( tab );
			const panel = el( 'section', { className: 'settings-section', role: 'tabpanel' },
				el( 'header', { className: 'settings-section-heading' },
					el( 'h3', { textContent: section.title } ),
					el( 'p', { textContent: section.text } )
				),
				...section.groups.map( ( group ) => el( 'div', { className: 'settings-group', role: 'group', ariaLabel: group.label },
					el( 'div', { className: 'settings-group-label', ariaHidden: 'true' },
						el( 'span', { className: 'settings-group-code', textContent: group.code } ),
						group.label
					),
					...group.fields.map( ( spec, at ) => this.#field( spec, onChange, String( at + 1 ).padStart( 2, '0' ) ) )
				) )
			);
			return { tab, panel };

		} );

		this.detailIndex = el( 'span', { className: 'settings-detail-index', ariaHidden: 'true' } );
		this.detailTitle = el( 'h4', { className: 'settings-detail-title' } );
		this.detailText = el( 'p', { className: 'settings-detail-text' } );
		this.header = new PanelHeader( { title: layout.title, eyebrow: layout.eyebrow, subtitle: layout.subtitle, onClose } );
		this.element = el( 'div', { className: 'view view-settings' },
			el( 'div', { className: 'settings-frame' },
				el( 'div', { className: 'settings-card' },
					this.header.element,
					this.tabs,
					el( 'div', { className: 'settings-body' }, ...this.sections.map( ( section ) => section.panel ) ),
					el( 'footer', { className: 'settings-footer' },
						el( 'span', { className: 'settings-status' }, el( 'span', { className: 'settings-status-dot', ariaHidden: 'true' } ), layout.status )
					)
				),
				el( 'aside', { className: 'settings-aside' },
					el( 'div', { className: 'settings-detail', ariaLive: 'polite' },
						el( 'p', { className: 'settings-eyebrow', textContent: layout.details.eyebrow } ),
						this.detailIndex, this.detailTitle, this.detailText
					),
					el( 'div', { className: 'settings-session' },
						el( 'span', { className: 'settings-session-mark', ariaHidden: 'true' }, ...Array.from( { length: 5 }, () => el( 'span' ) ) ),
						el( 'p', { className: 'settings-eyebrow', textContent: layout.session.eyebrow } ),
						el( 'h4', { textContent: layout.session.title } ),
						el( 'p', { textContent: layout.session.text } )
					)
				)
			)
		);
		this.showSection( 0 );

	}

	/** @param values { quality, fog, exposure, crowd, voice, voiceVolume, details }; keys left out keep their field as is. */
	setValues( values ) {

		for ( const [ key, field ] of this.fields ) {

			if ( key in values ) field.setValue( values[ key ] );

		}

	}

	/** Shows one section's tab; every field stays in the form. */
	showSection( index ) {

		this.tab = index;
		this.sections.forEach( ( { tab, panel }, at ) => {

			tab.setAttribute( 'aria-selected', String( at === index ) );
			tab.tabIndex = at === index ? 0 : - 1;
			panel.hidden = at !== index;

		} );
		const first = layout.sections[ index ].groups[ 0 ].fields[ 0 ];
		this.#explain( first, '01' );

	}

	#field( spec, onChange, number ) {

		const field = new SettingField( {
			...spec,
			onChange: ( key, value ) => onChange( { key, value } )
		} );
		this.fields.set( spec.key, field );
		this.specs.set( spec.key, spec );
		const explain = () => this.#explain( spec, number );
		field.element.addEventListener( 'focusin', explain );
		field.element.addEventListener( 'pointerenter', explain );
		return field.element;

	}

	#explain( spec, number ) {

		this.detailIndex.textContent = number;
		this.detailTitle.textContent = spec?.label ?? '';
		this.detailText.textContent = spec?.text ?? layout.details.idle;

	}

}
