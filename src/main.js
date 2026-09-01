import { App } from './app/App.js';
import { RunConfig } from './app/RunConfig.js';
import { BuildingViewerApp } from './building/BuildingViewerApp.js';

const mode = new URLSearchParams( window.location.search ).get( 'mode' );

if ( mode === 'building' ) {

	new BuildingViewerApp( BuildingViewerApp.configFromUrl() ).start();

} else {

	new App( RunConfig.fromUrl() ).start();

}
