# Objective routes

`ObjectiveRouter` turns the Connections walk graph into quest directions. It finds the published entry for a parcel, station, or stop and returns the shortest exact 3D walking path from the player's current position.

The layer calculates routes only. The map and minimap decide how to draw the returned `path3`.
