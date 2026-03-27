# Iskad — Floorplan Drawing Application

## Overview
A simple application for drawing floorplans. Runs locally in the browser so it can later be made accessible from anywhere.

## Core Features

### Wall Drawing
- Draw walls on a 2D canvas
- Wall types:
  - Drywall
  - Cement
  - (extensible for more types)

### Damage Marking
- Mark walls as damaged
- Different damage types/categories (cracks, water damage, structural, etc.)
- Visual indicators on damaged wall sections

## Tech Stack
- **Vite** — dev server & bundler
- **TypeScript** — type-safe source
- **HTML5 Canvas** — 2D rendering (vanilla, no framework)
- **localStorage** — save/load persistence

## Keyboard Shortcuts
- `1` — Draw Wall
- `2` — Mark Damage
- `3` — Select
- `4` — Erase
- `Ctrl+Z` — Undo
- `Ctrl+Y` — Redo

## Status
- [x] Project setup
- [x] Canvas rendering with grid
- [x] Wall drawing tool (snap-to-grid)
- [x] Wall type selection (drywall, cement, brick, wood)
- [x] Damage marking tool (crack, water, mold, structural)
- [x] Select & erase tools
- [x] Undo/redo
- [x] Save/load to localStorage
