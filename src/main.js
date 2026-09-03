import { App } from './app/App.js';
import { RunConfig } from './app/RunConfig.js';
import { BuildingViewerApp } from './building/BuildingViewerApp.js';
import { CityApp } from './city/CityApp.js';
import { GameApp } from './game/GameApp.js';
import { LauncherApp } from './launcher/LauncherApp.js';
import { HttpLauncherApi } from './launcher/HttpLauncherApi.js';

const mode = new URLSearchParams( window.location.search ).get( 'mode' );

if ( mode === 'game' ) {

	new GameApp( GameApp.configFromUrl() ).start();

} else if ( mode === 'city' ) {

	new CityApp( CityApp.configFromUrl() ).start();

} else if ( mode === 'building' ) {

	new BuildingViewerApp( BuildingViewerApp.configFromUrl() ).start();

} else if ( mode === 'experiment' ) {

	new App( RunConfig.fromUrl() ).start();

} else {

	new LauncherApp( { mount: document.body, api: new HttpLauncherApi() } ).start();

}
