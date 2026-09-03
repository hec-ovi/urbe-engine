// @vitest-environment jsdom
import { screen } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BuildingControlsPanel } from './BuildingControlsPanel.js';

describe( 'BuildingControlsPanel', () => {

	it( 'keeps source and slice controls usable across camera capture states', async () => {

		const onSourceChange = vi.fn();
		const onSliceChange = vi.fn();
		const panel = new BuildingControlsPanel( { parcel: 'p17', onSourceChange, onSliceChange } );
		document.body.replaceChildren( panel.element );
		panel.setSource( 'shell', true );
		panel.setFloorOptions( [
			{ value: 'full', label: 'full building' },
			{ value: '0', label: 'ground floor' }
		] );

		panel.setCameraCaptured( true );
		expect( screen.getByText( 'camera captured · Esc releases' ).dataset.captured ).toBe( 'true' );

		panel.setCameraCaptured( false );
		await userEvent.selectOptions( screen.getByLabelText( 'source' ), 'interior' );
		await userEvent.selectOptions( screen.getByLabelText( 'slice' ), '0' );
		expect( onSourceChange ).toHaveBeenCalledWith( 'interior' );
		expect( onSliceChange ).toHaveBeenCalledWith( '0' );

		panel.setCameraCaptured( false, true );
		expect( screen.getByText( 'camera capture failed · click the viewport to retry' ).dataset.captured ).toBe( 'false' );

	} );

} );
