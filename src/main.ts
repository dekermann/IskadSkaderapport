import {
  Wall, WallType, DamageColor, DamageSection, Door, ToolMode, Point,
  PlacedProp, PropKind, GroundTile, TileColor, PROP_CATALOG, getPropDef, GRID_SIZE,
} from './types';
import { History, saveFloorplan, loadFloorplan } from './history';
import { render, snapToGrid, findWallAt, findPropAt, projectOntoWall, RenderState } from './renderer';

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

// Tile painting state
let isTilePainting = false;

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
    doorPreview = { tStart: Math.min(doorTStart, tEnd), tEnd: Math.max(doorTStart, tEnd), swingSide };
    doorPreviewWall = doorWall;
  }

  const state: RenderState = {
    walls,
    props,
    tiles,
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
  };
  render(ctx, state);
}

// --------------- Mouse handlers ---------------

function getCanvasPoint(e: MouseEvent): Point {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function onMouseDown(e: MouseEvent) {
  const p = getCanvasPoint(e);
  const snapped = snapToGrid(p);

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
    const existingProp = findPropAt(props, p);
    if (existingProp) {
      history.push(walls, props, tiles);
      isDraggingProp = true;
      dragIsNew = false;
      dragProp = { ...existingProp };
      dragOffset = { x: p.x - existingProp.x, y: p.y - existingProp.y };
      props = props.filter(pr => pr.id !== existingProp.id);
      requestRender();
    } else {
      history.push(walls, props, tiles);
      // Snap top-left to grid
      const gx = Math.floor(p.x / GRID_SIZE) * GRID_SIZE;
      const gy = Math.floor(p.y / GRID_SIZE) * GRID_SIZE;
      props.push({
        id: genId('p'),
        kind: selectedPropKind,
        x: gx,
        y: gy,
        scale: 1,
      });
      requestRender();
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

      doorWall.doors.push({
        tStart: Math.min(doorTStart, tEnd),
        tEnd: Math.max(doorTStart, tEnd),
        swingSide,
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
    el.textContent = `Prop: ${getPropDef(prop.kind).label} (scale ${prop.scale})`;
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
  saveFloorplan(walls, props, tiles);
  alert('Floorplan saved to browser storage.');
}

function doLoad() {
  const loaded = loadFloorplan();
  if (loaded) {
    history.push(walls, props, tiles);
    walls = loaded.walls;
    props = loaded.props;
    tiles = loaded.tiles;
    for (const w of walls) {
      const num = parseInt(w.id.replace('w', ''), 10);
      if (num >= nextId) nextId = num + 1;
    }
    for (const p of props) {
      const num = parseInt(p.id.replace('p', ''), 10);
      if (num >= nextId) nextId = num + 1;
    }
    requestRender();
    alert('Floorplan loaded.');
  } else {
    alert('No saved floorplan found.');
  }
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
      prop.scale = Math.max(1, Math.min(5, prop.scale + delta));
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

  requestRender();
}

init();
