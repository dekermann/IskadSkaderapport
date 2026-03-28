import {
  Wall, WallType, DamageColor, DamageSection, Door, ToolMode, Point,
  PlacedProp, PropKind, GroundTile, TileColor, PROP_CATALOG, getPropDef, propPixelSize, GRID_SIZE,
} from './types';
import { History, saveFloorplan, loadFloorplan } from './history';
import { render, snapToGrid, findWallAt, findPropAt, projectOntoWall, hitTestHandle, HandleType, getPropHandles, RenderState } from './renderer';

let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;

// State
let walls: Wall[] = [];
let props: PlacedProp[] = [];
let tiles: GroundTile[] = [];
let tool: ToolMode = 'draw';
let wallType: WallType = 'drywall';
let damageColor: DamageColor = 'pink';
let selectedPropKind: PropKind = 'fridge';
let selectedTileColor: TileColor = 'red';
const history = new History();

// Wall drawing state
let isDrawing = false;
let drawStart: Point | null = null;
let mousePos: Point = { x: 0, y: 0 };
let highlightWall: Wall | null = null;
let highlightProp: PlacedProp | null = null;

// Damage painting state
let isDamagePainting = false;
let damageWall: Wall | null = null;
let damageTStart = 0;

// Door placement state
let isDoorPlacing = false;
let doorWall: Wall | null = null;
let doorTStart = 0;

// Prop drag state
let isDraggingProp = false;
let dragProp: PlacedProp | null = null;
let dragOffset: Point = { x: 0, y: 0 };
let dragIsNew = false;
let selectedProp: PlacedProp | null = null;

// Handle drag state
let isDraggingHandle = false;
let activeHandle: HandleType | null = null;
let handleProp: PlacedProp | null = null;
let handleStartMouse: Point = { x: 0, y: 0 };
let handleStartRotation = 0;
let handleAnchor: Point = { x: 0, y: 0 }; // opposite corner, stays fixed
let handleStartScaleW = 1;
let handleStartScaleH = 1;
let handleStartX = 0;
let handleStartY = 0;

// Tile painting state
let isTilePainting = false;

// Export selection state
let isExportSelecting = false;
let exportStart: Point | null = null;
let exportEnd: Point | null = null;
let exportMode = false;

// Background image
let backgroundImage: HTMLImageElement | null = null;
let backgroundVisible = true;

let nextId = 1;
function genId(prefix = 'w'): string {
  return `${prefix}${nextId++}`;
}

// --------------- Canvas setup ---------------

function resizeCanvas() {
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  requestRender();
}

function requestRender() {
  let damagePreview: DamageSection | null = null;
  if (isDamagePainting && damageWall) {
    const tEnd = projectOntoWall(damageWall, mousePos);
    damagePreview = { tStart: damageTStart, tEnd, color: damageColor };
  }

  let doorPreview: Door | null = null;
  let doorPreviewWall: Wall | null = null;
  if (isDoorPlacing && doorWall) {
    const tEnd = projectOntoWall(doorWall, mousePos);
    // Compute swing side from mouse position relative to wall
    const n = wallNormalAt(doorWall);
    const wallPt = lerpWallAt(doorWall, (doorTStart + tEnd) / 2);
    const toMouse = { x: mousePos.x - wallPt.x, y: mousePos.y - wallPt.y };
    const dot = toMouse.x * n.x + toMouse.y * n.y;
    const swingSide: 1 | -1 = dot >= 0 ? 1 : -1;
    // hingeSide based on drag direction: if user dragged tStart→tEnd, hinge at tStart (start)
    // if user dragged the other way (doorTStart > tEnd), hinge at tEnd side
    const hingeSide: 'start' | 'end' = doorTStart <= tEnd ? 'start' : 'end';
    doorPreview = { tStart: Math.min(doorTStart, tEnd), tEnd: Math.max(doorTStart, tEnd), swingSide, hingeSide };
    doorPreviewWall = doorWall;
  }

  const state: RenderState = {
    walls,
    props,
    tiles,
    backgroundImage: backgroundVisible ? backgroundImage : null,
    highlightWall,
    highlightProp,
    previewStart: (tool === 'draw' && isDrawing) ? drawStart : null,
    previewEnd: (tool === 'draw' && isDrawing) ? snapToGrid(mousePos) : null,
    previewWallType: wallType,
    damagePreviewWall: damageWall,
    damagePreview,
    doorPreviewWall,
    doorPreview,
    dragProp: isDraggingProp ? dragProp : null,
    selectedProp: (tool === 'prop') ? selectedProp : null,
  };
  render(ctx, state);

  // Draw export selection overlay
  if (isExportSelecting && exportStart && exportEnd) {
    const x = Math.min(exportStart.x, exportEnd.x);
    const y = Math.min(exportStart.y, exportEnd.y);
    const w = Math.abs(exportEnd.x - exportStart.x);
    const h = Math.abs(exportEnd.y - exportStart.y);
    ctx.fillStyle = 'rgba(0,120,255,0.1)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#0078ff';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
  }
}

// --------------- Mouse handlers ---------------

function getCanvasPoint(e: MouseEvent): Point {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function onMouseDown(e: MouseEvent) {
  const p = getCanvasPoint(e);
  const snapped = snapToGrid(p);

  // Export selection mode intercepts all tools
  if (exportMode) {
    isExportSelecting = true;
    exportStart = p;
    exportEnd = p;
    requestRender();
    return;
  }

  if (tool === 'draw') {
    history.push(walls, props, tiles);
    isDrawing = true;
    drawStart = snapped;
  } else if (tool === 'damage') {
    const wall = findWallAt(walls, p);
    if (wall) {
      history.push(walls, props, tiles);
      isDamagePainting = true;
      damageWall = wall;
      damageTStart = projectOntoWall(wall, p);
    }
  } else if (tool === 'door') {
    const wall = findWallAt(walls, p);
    if (wall) {
      history.push(walls, props, tiles);
      isDoorPlacing = true;
      doorWall = wall;
      doorTStart = projectOntoWall(wall, p);
    }
  } else if (tool === 'prop') {
    // Check if clicking a handle on the selected prop
    if (selectedProp) {
      const handle = hitTestHandle(selectedProp, p);
      if (handle) {
        history.push(walls, props, tiles);
        isDraggingHandle = true;
        activeHandle = handle;
        handleProp = selectedProp;
        handleStartMouse = p;
        handleStartRotation = selectedProp.rotation;
        handleStartScaleW = selectedProp.scaleW;
        handleStartScaleH = selectedProp.scaleH;
        handleStartX = selectedProp.x;
        handleStartY = selectedProp.y;

        // Compute anchor = the opposite corner/edge that stays fixed during scaling
        const { w, h } = propPixelSize(selectedProp);
        const px = selectedProp.x;
        const py = selectedProp.y;
        if (handle === 'scale-tl') handleAnchor = { x: px + w, y: py + h };
        else if (handle === 'scale-tr') handleAnchor = { x: px, y: py + h };
        else if (handle === 'scale-bl') handleAnchor = { x: px + w, y: py };
        else if (handle === 'scale-br') handleAnchor = { x: px, y: py };
        else if (handle === 'scale-t') handleAnchor = { x: px, y: py + h };
        else if (handle === 'scale-b') handleAnchor = { x: px, y: py };
        else if (handle === 'scale-l') handleAnchor = { x: px + w, y: py };
        else if (handle === 'scale-r') handleAnchor = { x: px, y: py };
        else handleAnchor = { x: px + w / 2, y: py + h / 2 };
        return;
      }
    }

    // Check if clicking on an existing prop
    const existingProp = findPropAt(props, p);
    if (existingProp) {
      if (selectedProp?.id === existingProp.id) {
        // Already selected — start dragging
        history.push(walls, props, tiles);
        isDraggingProp = true;
        dragIsNew = false;
        dragProp = { ...existingProp };
        dragOffset = { x: p.x - existingProp.x, y: p.y - existingProp.y };
        props = props.filter(pr => pr.id !== existingProp.id);
        selectedProp = null;
      } else {
        // Select it (show handles)
        selectedProp = existingProp;
      }
      requestRender();
    } else {
      // Click on empty space: deselect, and place new prop
      if (selectedProp) {
        selectedProp = null;
        requestRender();
      } else {
        history.push(walls, props, tiles);
        const gx = Math.floor(p.x / GRID_SIZE) * GRID_SIZE;
        const gy = Math.floor(p.y / GRID_SIZE) * GRID_SIZE;
        props.push({
          id: genId('p'),
          kind: selectedPropKind,
          x: gx,
          y: gy,
          scaleW: 1,
          scaleH: 1,
          rotation: 0,
        });
        requestRender();
      }
    }
  } else if (tool === 'tile') {
    history.push(walls, props, tiles);
    isTilePainting = true;
    paintTileAt(p);
  } else if (tool === 'erase') {
    const prop = findPropAt(props, p);
    if (prop) {
      history.push(walls, props, tiles);
      props = props.filter(pr => pr.id !== prop.id);
      highlightProp = null;
      requestRender();
    } else {
      // Check for tile
      const gx = Math.floor(p.x / GRID_SIZE);
      const gy = Math.floor(p.y / GRID_SIZE);
      const tileIdx = tiles.findIndex(t => t.gx === gx && t.gy === gy);
      if (tileIdx >= 0) {
        history.push(walls, props, tiles);
        tiles.splice(tileIdx, 1);
        requestRender();
      } else {
        const wall = findWallAt(walls, p);
        if (wall) {
          history.push(walls, props, tiles);
          walls = walls.filter(w => w.id !== wall.id);
          highlightWall = null;
          requestRender();
        }
      }
    }
  } else if (tool === 'select') {
    const prop = findPropAt(props, p);
    if (prop) {
      highlightProp = prop;
      highlightWall = null;
      requestRender();
      updateStatusType(null, prop);
    } else {
      const wall = findWallAt(walls, p);
      highlightWall = wall;
      highlightProp = null;
      requestRender();
      updateStatusType(wall);
    }
  }
}

/** Paint or replace a tile at the given canvas point. */
function paintTileAt(p: Point) {
  const gx = Math.floor(p.x / GRID_SIZE);
  const gy = Math.floor(p.y / GRID_SIZE);
  const existing = tiles.find(t => t.gx === gx && t.gy === gy);
  if (existing) {
    existing.color = selectedTileColor;
  } else {
    tiles.push({ gx, gy, color: selectedTileColor });
  }
  requestRender();
}

function onMouseMove(e: MouseEvent) {
  mousePos = getCanvasPoint(e);
  updateStatusCoords(mousePos);

  if (isExportSelecting && exportStart) {
    exportEnd = mousePos;
    requestRender();
    return;
  }

  if (isDraggingHandle && handleProp && activeHandle) {
    if (activeHandle === 'rotate') {
      const { w, h } = propPixelSize(handleProp);
      const cx = handleProp.x + w / 2;
      const cy = handleProp.y + h / 2;
      const angle = Math.atan2(mousePos.y - cy, mousePos.x - cx);
      let deg = ((angle * 180 / Math.PI) + 90 + 360) % 360;
      const snapped = Math.round(deg / 90) * 90 % 360;
      if (snapped !== handleProp.rotation) {
        const oldSize = propPixelSize(handleProp);
        const oldCx = handleProp.x + oldSize.w / 2;
        const oldCy = handleProp.y + oldSize.h / 2;
        handleProp.rotation = snapped;
        const newSize = propPixelSize(handleProp);
        handleProp.x = Math.round((oldCx - newSize.w / 2) / GRID_SIZE) * GRID_SIZE;
        handleProp.y = Math.round((oldCy - newSize.h / 2) / GRID_SIZE) * GRID_SIZE;
      }
    } else {
      // Scale handles — measure from anchor to mouse
      const def = getPropDef(handleProp.kind);
      const isRotated = handleProp.rotation === 90 || handleProp.rotation === 270;
      const baseGw = isRotated ? def.gh : def.gw;
      const baseGh = isRotated ? def.gw : def.gh;

      const dx = Math.abs(mousePos.x - handleAnchor.x);
      const dy = Math.abs(mousePos.y - handleAnchor.y);
      let newScaleW = isRotated ? handleProp.scaleH : handleProp.scaleW;
      let newScaleH = isRotated ? handleProp.scaleW : handleProp.scaleH;

      if (activeHandle === 'scale-t' || activeHandle === 'scale-b') {
        const sy = Math.max(1, Math.min(5, Math.round(dy / (baseGh * GRID_SIZE))));
        newScaleH = sy;
      } else if (activeHandle === 'scale-l' || activeHandle === 'scale-r') {
        const sx = Math.max(1, Math.min(5, Math.round(dx / (baseGw * GRID_SIZE))));
        newScaleW = sx;
      } else {
        // Corner: uniform
        const sx = Math.max(1, Math.min(5, Math.round(dx / (baseGw * GRID_SIZE))));
        const sy = Math.max(1, Math.min(5, Math.round(dy / (baseGh * GRID_SIZE))));
        const s = Math.max(sx, sy);
        newScaleW = s;
        newScaleH = s;
      }

      if (isRotated) {
        handleProp.scaleW = newScaleH;
        handleProp.scaleH = newScaleW;
      } else {
        handleProp.scaleW = newScaleW;
        handleProp.scaleH = newScaleH;
      }

      // Reposition prop so the anchor corner stays fixed
      const newSize = propPixelSize(handleProp);
      // Anchor is the fixed point. Determine which edges are anchored.
      const ah = activeHandle!;
      const anchorsRight = ah === 'scale-tl' || ah === 'scale-bl' || ah === 'scale-l';
      const anchorsBottom = ah === 'scale-tl' || ah === 'scale-tr' || ah === 'scale-t';

      if (anchorsRight) {
        handleProp.x = Math.round((handleAnchor.x - newSize.w) / GRID_SIZE) * GRID_SIZE;
      } else {
        handleProp.x = Math.round(handleAnchor.x / GRID_SIZE) * GRID_SIZE;
      }
      if (anchorsBottom) {
        handleProp.y = Math.round((handleAnchor.y - newSize.h) / GRID_SIZE) * GRID_SIZE;
      } else {
        handleProp.y = Math.round(handleAnchor.y / GRID_SIZE) * GRID_SIZE;
      }
    }
    requestRender();
    return;
  }

  if (isDraggingProp && dragProp) {
    dragProp.x = mousePos.x - dragOffset.x;
    dragProp.y = mousePos.y - dragOffset.y;
    requestRender();
  } else if (tool === 'tile' && isTilePainting) {
    paintTileAt(mousePos);
  } else if (tool === 'draw' && isDrawing) {
    requestRender();
  } else if (tool === 'damage' && isDamagePainting) {
    requestRender();
  } else if (tool === 'door' && isDoorPlacing) {
    requestRender();
  } else if (tool === 'prop') {
    highlightProp = findPropAt(props, mousePos);
    // Change cursor if hovering a handle
    if (selectedProp) {
      const handle = hitTestHandle(selectedProp, mousePos);
      if (handle === 'rotate') canvas.style.cursor = 'grab';
      else if (handle === 'scale-t' || handle === 'scale-b') canvas.style.cursor = 'ns-resize';
      else if (handle === 'scale-l' || handle === 'scale-r') canvas.style.cursor = 'ew-resize';
      else if (handle === 'scale-tl' || handle === 'scale-br') canvas.style.cursor = 'nwse-resize';
      else if (handle === 'scale-tr' || handle === 'scale-bl') canvas.style.cursor = 'nesw-resize';
      else if (highlightProp) canvas.style.cursor = 'move';
      else canvas.style.cursor = 'pointer';
    }
    requestRender();
  } else if (tool === 'erase') {
    highlightProp = findPropAt(props, mousePos);
    highlightWall = highlightProp ? null : findWallAt(walls, mousePos);
    requestRender();
  } else if (tool === 'damage' || tool === 'select' || tool === 'door') {
    highlightWall = findWallAt(walls, mousePos);
    requestRender();
  }
}

function onMouseUp(e: MouseEvent) {
  // Handle drag complete
  if (isDraggingHandle) {
    isDraggingHandle = false;
    activeHandle = null;
    handleProp = null;
    requestRender();
    return;
  }

  // Export selection complete
  if (isExportSelecting && exportStart && exportEnd) {
    isExportSelecting = false;
    exportMode = false;
    canvas.style.cursor = 'crosshair';
    document.getElementById('status-tool')!.textContent = 'Tool: Draw Wall';
    doExportArea(exportStart, exportEnd);
    exportStart = null;
    exportEnd = null;
    requestRender();
    return;
  }

  if (isDraggingProp && dragProp) {
    // Snap top-left to grid
    const raw = { x: mousePos.x - dragOffset.x, y: mousePos.y - dragOffset.y };
    dragProp.x = Math.round(raw.x / GRID_SIZE) * GRID_SIZE;
    dragProp.y = Math.round(raw.y / GRID_SIZE) * GRID_SIZE;
    props.push(dragProp);
    isDraggingProp = false;
    dragProp = null;
    requestRender();
    return;
  }

  if (tool === 'tile' && isTilePainting) {
    isTilePainting = false;
    return;
  }

  if (tool === 'draw' && isDrawing && drawStart) {
    const end = snapToGrid(mousePos);
    if (Math.hypot(end.x - drawStart.x, end.y - drawStart.y) > 5) {
      const wall: Wall = {
        id: genId(),
        start: drawStart,
        end,
        type: wallType,
        damages: [],
        doors: [],
      };
      walls.push(wall);
    }
    isDrawing = false;
    drawStart = null;
    requestRender();
  } else if (tool === 'damage' && isDamagePainting && damageWall) {
    const tEnd = projectOntoWall(damageWall, mousePos);
    if (Math.abs(tEnd - damageTStart) > 0.01) {
      damageWall.damages.push({
        tStart: Math.min(damageTStart, tEnd),
        tEnd: Math.max(damageTStart, tEnd),
        color: damageColor,
      });
    }
    isDamagePainting = false;
    damageWall = null;
    requestRender();
  } else if (tool === 'door' && isDoorPlacing && doorWall) {
    const tEnd = projectOntoWall(doorWall, mousePos);
    if (Math.abs(tEnd - doorTStart) > 0.02) {
      // Determine swing side based on which side of the wall the mouse is on
      const n = wallNormalAt(doorWall);
      const wallPt = lerpWallAt(doorWall, (doorTStart + tEnd) / 2);
      const toMouse = { x: mousePos.x - wallPt.x, y: mousePos.y - wallPt.y };
      const dot = toMouse.x * n.x + toMouse.y * n.y;
      const swingSide: 1 | -1 = dot >= 0 ? 1 : -1;
      const hingeSide: 'start' | 'end' = doorTStart <= tEnd ? 'start' : 'end';

      doorWall.doors.push({
        tStart: Math.min(doorTStart, tEnd),
        tEnd: Math.max(doorTStart, tEnd),
        swingSide,
        hingeSide,
      });
    }
    isDoorPlacing = false;
    doorWall = null;
    requestRender();
  }
}

// Helpers for door swing side detection
function wallNormalAt(wall: Wall): Point {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { x: 0, y: -1 };
  return { x: -dy / len, y: dx / len };
}

function lerpWallAt(wall: Wall, t: number): Point {
  return {
    x: wall.start.x + (wall.end.x - wall.start.x) * t,
    y: wall.start.y + (wall.end.y - wall.start.y) * t,
  };
}

// --------------- Toolbar handlers ---------------

function setActiveTool(newTool: ToolMode) {
  tool = newTool;
  selectedProp = null; // clear selection when switching tools
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.classList.toggle('active', (btn as HTMLElement).dataset.tool === newTool);
  });

  const wallGroup = document.getElementById('wall-type-group')!;
  const damageGroup = document.getElementById('damage-color-group')!;
  const propPanel = document.getElementById('prop-panel')!;
  const tileGroup = document.getElementById('tile-color-group')!;
  wallGroup.classList.toggle('hidden', newTool !== 'draw');
  damageGroup.classList.toggle('hidden', newTool !== 'damage');
  propPanel.classList.toggle('hidden', newTool !== 'prop');
  tileGroup.classList.toggle('hidden', newTool !== 'tile');

  updateStatusTool();

  if (newTool === 'draw') canvas.style.cursor = 'crosshair';
  else if (newTool === 'erase') canvas.style.cursor = 'not-allowed';
  else canvas.style.cursor = 'pointer';
}

function setActiveWallType(type: WallType) {
  wallType = type;
  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.classList.toggle('active', (btn as HTMLElement).dataset.wallType === type);
  });
  updateStatusType();
}

function setActiveDamageColor(color: DamageColor) {
  damageColor = color;
  document.querySelectorAll('.damage-btn').forEach(btn => {
    btn.classList.toggle('active', (btn as HTMLElement).dataset.damage === color);
  });
  updateStatusType();
}

// --------------- Status bar ---------------

function updateStatusTool() {
  const labels: Record<ToolMode, string> = {
    draw: 'Draw Wall',
    damage: 'Mark Damage',
    select: 'Select',
    erase: 'Erase',
    door: 'Place Door',
    prop: 'Place Props',
    tile: 'Paint Ground',
  };
  document.getElementById('status-tool')!.textContent = `Tool: ${labels[tool]}`;
}

function updateStatusType(wall?: Wall | null, prop?: PlacedProp | null) {
  const el = document.getElementById('status-type')!;
  if (tool === 'select' && prop) {
    el.textContent = `Prop: ${getPropDef(prop.kind).label} (${prop.scaleW}×${prop.scaleH})`;
  } else if (tool === 'select' && wall) {
    let text = `Wall: ${wall.type}`;
    if (wall.damages.length > 0) text += ` | ${wall.damages.length} damage(s)`;
    if (wall.doors.length > 0) text += ` | ${wall.doors.length} door(s)`;
    el.textContent = text;
  } else if (tool === 'draw') {
    el.textContent = `Type: ${wallType}`;
  } else if (tool === 'damage') {
    el.textContent = `Color: ${damageColor}`;
  } else if (tool === 'door') {
    el.textContent = 'Click & drag on a wall';
  } else if (tool === 'prop') {
    el.textContent = `Prop: ${getPropDef(selectedPropKind).label} (scroll to resize)`;
  } else if (tool === 'tile') {
    el.textContent = `Color: ${selectedTileColor}`;
  } else {
    el.textContent = '';
  }
}

function updateStatusCoords(p: Point) {
  document.getElementById('status-coords')!.textContent =
    `${Math.round(p.x)}, ${Math.round(p.y)}`;
}

// --------------- Keyboard shortcuts ---------------

function onKeyDown(e: KeyboardEvent) {
  if (e.ctrlKey && e.key === 'z') {
    e.preventDefault();
    doUndo();
  } else if (e.ctrlKey && e.key === 'y') {
    e.preventDefault();
    doRedo();
  } else if (e.key === '1') setActiveTool('draw');
  else if (e.key === '2') setActiveTool('damage');
  else if (e.key === '3') setActiveTool('door');
  else if (e.key === '4') setActiveTool('prop');
  else if (e.key === '5') setActiveTool('tile');
  else if (e.key === '6') setActiveTool('select');
  else if (e.key === '7') setActiveTool('erase');
  else if (e.key === 'r' || e.key === 'R') {
    // Rotate prop under cursor
    if (tool === 'prop') {
      const prop = findPropAt(props, mousePos);
      if (prop) {
        history.push(walls, props, tiles);
        // Get old size to re-snap after rotation
        const oldSize = propPixelSize(prop);
        prop.rotation = ((prop.rotation || 0) + 90) % 360;
        // Re-snap position so the prop stays grid-aligned
        const newSize = propPixelSize(prop);
        // Adjust to keep center roughly in place, then snap
        const oldCx = prop.x + oldSize.w / 2;
        const oldCy = prop.y + oldSize.h / 2;
        prop.x = Math.round((oldCx - newSize.w / 2) / GRID_SIZE) * GRID_SIZE;
        prop.y = Math.round((oldCy - newSize.h / 2) / GRID_SIZE) * GRID_SIZE;
        requestRender();
      }
    }
  }
}

// --------------- Actions ---------------

function doUndo() {
  const prev = history.undo(walls, props, tiles);
  if (prev) {
    walls = prev.walls;
    props = prev.props;
    tiles = prev.tiles;
    requestRender();
  }
}

function doRedo() {
  const next = history.redo(walls, props, tiles);
  if (next) {
    walls = next.walls;
    props = next.props;
    tiles = next.tiles;
    requestRender();
  }
}

function doClear() {
  if (walls.length === 0 && props.length === 0 && tiles.length === 0) return;
  history.push(walls, props, tiles);
  walls = [];
  props = [];
  tiles = [];
  highlightWall = null;
  highlightProp = null;
  requestRender();
}

function doSave() {
  // Save to localStorage (auto-backup)
  saveFloorplan(walls, props, tiles);

  // Download as .iskad file
  const data = JSON.stringify({ walls, props, tiles, version: 3 }, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const link = document.createElement('a');
  link.download = 'floorplan.iskad';
  link.href = URL.createObjectURL(blob);
  link.click();
  URL.revokeObjectURL(link.href);
}

function doLoad() {
  document.getElementById('file-input')!.click();
}

function handleFileLoad(file: File) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result as string);
      if (!Array.isArray(data.walls)) throw new Error('Invalid file');
      history.push(walls, props, tiles);
      walls = data.walls;
      // Migrate old doors
      for (const w of walls) {
        for (const d of w.doors) {
          if ((d as any).hingeSide === undefined) (d as any).hingeSide = 'start';
        }
      }
      props = Array.isArray(data.props) ? data.props : [];
      // Migrate old props that have `scale` instead of `scaleW`/`scaleH`
      for (const p of props) {
        if (p.scaleW === undefined) {
          const oldScale = (p as any).scale ?? 1;
          p.scaleW = oldScale;
          p.scaleH = oldScale;
        }
        if (p.rotation === undefined) p.rotation = 0;
      }
      tiles = Array.isArray(data.tiles) ? data.tiles : [];
      for (const w of walls) {
        const num = parseInt(w.id.replace('w', ''), 10);
        if (num >= nextId) nextId = num + 1;
      }
      for (const p of props) {
        const num = parseInt(p.id.replace('p', ''), 10);
        if (num >= nextId) nextId = num + 1;
      }
      // Also save to localStorage
      saveFloorplan(walls, props, tiles);
      requestRender();
    } catch {
      alert('Failed to load file — invalid format.');
    }
  };
  reader.readAsText(file);
}

function doExport() {
  // Enter export selection mode
  exportMode = true;
  canvas.style.cursor = 'crosshair';
  document.getElementById('status-tool')!.textContent = 'Select area to export...';
}

function doExportArea(start: Point, end: Point) {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const w = Math.abs(end.x - start.x);
  const h = Math.abs(end.y - start.y);
  if (w < 5 || h < 5) return; // too small

  // Render a clean copy (no highlights/previews) onto a temporary canvas
  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = w;
  tmpCanvas.height = h;
  const tmpCtx = tmpCanvas.getContext('2d')!;

  // Render the full scene cleanly
  const fullCanvas = document.createElement('canvas');
  fullCanvas.width = canvas.width;
  fullCanvas.height = canvas.height;
  const fullCtx = fullCanvas.getContext('2d')!;

  const cleanState: RenderState = {
    walls,
    props,
    tiles,
    backgroundImage: null,
    highlightWall: null,
    highlightProp: null,
    previewStart: null,
    previewEnd: null,
    previewWallType: wallType,
    damagePreviewWall: null,
    damagePreview: null,
    doorPreviewWall: null,
    doorPreview: null,
    dragProp: null,
    selectedProp: null,
  };
  render(fullCtx, cleanState, { skipGrid: true });

  // Copy the selected region
  tmpCtx.drawImage(fullCanvas, x, y, w, h, 0, 0, w, h);

  // Trigger download
  const link = document.createElement('a');
  link.download = 'floorplan.png';
  link.href = tmpCanvas.toDataURL('image/png');
  link.click();
}

// --------------- Init ---------------

function init() {
  canvas = document.getElementById('canvas') as HTMLCanvasElement;
  ctx = canvas.getContext('2d')!;

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseup', onMouseUp);
  window.addEventListener('keydown', onKeyDown);

  // Ctrl+V paste image as background
  window.addEventListener('paste', (e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const blob = item.getAsFile();
        if (!blob) continue;
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          backgroundImage = img;
          requestRender();
        };
        img.src = url;
        return;
      }
    }
  });

  // Tool buttons
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setActiveTool((btn as HTMLElement).dataset.tool as ToolMode);
    });
  });

  // Wall type buttons
  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setActiveWallType((btn as HTMLElement).dataset.wallType as WallType);
    });
  });

  // Damage color buttons
  document.querySelectorAll('.damage-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setActiveDamageColor((btn as HTMLElement).dataset.damage as DamageColor);
    });
  });

  // Build prop panel dynamically
  const propPanel = document.getElementById('prop-panel')!;
  for (const def of PROP_CATALOG) {
    const btn = document.createElement('button');
    btn.className = 'prop-btn' + (def.kind === selectedPropKind ? ' active' : '');
    btn.dataset.propKind = def.kind;
    btn.innerHTML = `<span class="prop-icon">${def.icon}</span>${def.label}`;
    btn.addEventListener('click', () => {
      selectedPropKind = def.kind as PropKind;
      document.querySelectorAll('.prop-btn').forEach(b => {
        b.classList.toggle('active', (b as HTMLElement).dataset.propKind === def.kind);
      });
      updateStatusType();
    });
    propPanel.appendChild(btn);
  }

  // Scroll wheel to resize prop under cursor
  canvas.addEventListener('wheel', (e) => {
    if (tool !== 'prop') return;
    const p = getCanvasPoint(e as any);
    const prop = findPropAt(props, p);
    if (prop) {
      e.preventDefault();
      history.push(walls, props, tiles);
      const delta = e.deltaY < 0 ? 1 : -1;
      prop.scaleW = Math.max(1, Math.min(5, prop.scaleW + delta));
      prop.scaleH = Math.max(1, Math.min(5, prop.scaleH + delta));
      requestRender();
    }
  }, { passive: false });

  // Tile color buttons
  document.querySelectorAll('.tile-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedTileColor = (btn as HTMLElement).dataset.tileColor as TileColor;
      document.querySelectorAll('.tile-btn').forEach(b => {
        b.classList.toggle('active', (b as HTMLElement).dataset.tileColor === selectedTileColor);
      });
      updateStatusType();
    });
  });

  // Action buttons
  document.getElementById('btn-undo')!.addEventListener('click', doUndo);
  document.getElementById('btn-redo')!.addEventListener('click', doRedo);
  document.getElementById('btn-clear')!.addEventListener('click', doClear);
  document.getElementById('btn-save')!.addEventListener('click', doSave);
  document.getElementById('btn-load')!.addEventListener('click', doLoad);
  document.getElementById('file-input')!.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      handleFileLoad(input.files[0]);
      input.value = ''; // reset so same file can be loaded again
    }
  });
  document.getElementById('btn-export')!.addEventListener('click', doExport);
  document.getElementById('btn-toggle-bg')!.addEventListener('click', () => {
    backgroundVisible = !backgroundVisible;
    document.getElementById('btn-toggle-bg')!.textContent = backgroundVisible ? 'Hide BG' : 'Show BG';
    requestRender();
  });
  document.getElementById('btn-clear-bg')!.addEventListener('click', () => {
    backgroundImage = null;
    backgroundVisible = true;
    document.getElementById('btn-toggle-bg')!.textContent = 'Hide BG';
    requestRender();
  });

  // Auto-load from localStorage on startup
  const autoLoaded = loadFloorplan();
  if (autoLoaded) {
    walls = autoLoaded.walls;
    props = autoLoaded.props;
    tiles = autoLoaded.tiles;
    // Migrate old props
    for (const p of props) {
      if (p.scaleW === undefined) {
        const oldScale = (p as any).scale ?? 1;
        p.scaleW = oldScale;
        p.scaleH = oldScale;
      }
      if (p.rotation === undefined) p.rotation = 0;
    }
    for (const w of walls) {
      const num = parseInt(w.id.replace('w', ''), 10);
      if (num >= nextId) nextId = num + 1;
    }
    for (const p of props) {
      const num = parseInt(p.id.replace('p', ''), 10);
      if (num >= nextId) nextId = num + 1;
    }
  }

  requestRender();
}

init();
