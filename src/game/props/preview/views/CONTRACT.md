# Review view

Renders [layout.json](../layout.json), validated by [schema](../layout.schema.json), reports select values.

`ReviewView(layout, onChange)` exposes `element`, `setBusy(boolean)` and `setStatus(text)`. Layout has title, hint and fields `{id,label,options:[{value,label}]}`. `onChange(id,value)` reports user selection. Rendering and model loading stay in the controller.
