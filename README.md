# Roomcraft

A first-person 3D room builder for planning real-world floor plans at human scale. It combines Minecraft-style movement with purpose-built architectural tools, so you can walk through a room while laying it out.

## Current features

- First-person mouse look and WASD movement
- Real-world scale: one world unit equals one meter
- Imperial and metric measurement display
- Click-two-points wall construction with optional six-inch snapping
- Adjustable wall height and thickness
- Doors and two-corner, directly drawn windows with wall-flush previews and automatic merging when windows overlap
- Selection and deletion
- Undo and redo
- Browser saves plus portable JSON exports
- Responsive build controls

## Run locally

```bash
npm install
npm run dev
```

Open the local address shown by Vite, click **Enter project**, and use:

- `WASD` to move
- Mouse to look
- `Shift` to sprint
- Left click to build
- For windows, click two opposite corners directly on the wall
- Right click to cancel a wall
- `1–4` to switch tools
- `Z` / `Y` to undo and redo
- `G` to toggle grid snapping
- `U` to switch imperial/metric units
- `V` to show or hide dimensions
- `[` / `]` to decrease or increase wall height
- `Shift` + `[` / `]` to adjust wall thickness
- `C` to cancel the current placement
- `Ctrl/Cmd` + `S`, `O`, or `E` to save, load, or export
- `Delete` to remove a selected item
- `Esc` to release the mouse

## Validation

```bash
npm test
npm run build
```

## Next milestones

- Collision-aware walking and door interaction
- Click-and-drag editing with numeric dimension entry
- Multiple floors, stairs, furniture, materials, and room labels
- 2D blueprint overview and image/PDF export
