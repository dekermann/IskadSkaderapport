import { Wall, Point, WallType, DamageSection, Door, PlacedProp, GroundTile, propPixelSize, getPropDef, DAMAGE_COLOR_VALUES, TILE_COLOR_VALUES, GRID_SIZE } from './types';

const SNAP_DISTANCE = 12;
const ENDPOINT_SNAP = 2; // how close endpoints must be to count as "meeting"

// Wall geometry constants
const DRYWALL_GAP = 6;       // distance between the two parallel lines
const DRYWALL_LINE_W = 1.5;
const CONCRETE_LINE_W = 8;

/** Snap a point to the nearest grid intersection. */
export function snapToGrid(p: Point): Point {
  return {
    x: Math.round(p.x / GRID_SIZE) * GRID_SIZE,
    y: Math.round(p.y / GRID_SIZE) * GRID_SIZE,
  };
}

/** Distance from a point to a line segment, also returns the parametric t. */
function distToSegmentWithT(p: Point, a: Point, b: Point): { dist: number; t: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { dist: Math.hypot(p.x - a.x, p.y - a.y), t: 0 };
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return {
    dist: Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)),
    t,
  };
}

/** Get the parametric t of the closest point on a wall to p. */
export function projectOntoWall(wall: Wall, p: Point): number {
  return distToSegmentWithT(p, wall.start, wall.end).t;
}

/** Find the wall nearest to a point, within `threshold` pixels. */
export function findWallAt(walls: Wall[], p: Point, threshold = SNAP_DISTANCE): Wall | null {
  let closest: Wall | null = null;
  let minDist = threshold;
  for (const w of walls) {
    const { dist } = distToSegmentWithT(p, w.start, w.end);
    if (dist < minDist) {
      minDist = dist;
      closest = w;
    }
  }
  return closest;
}

/** Draw the background grid. */
function drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.strokeStyle = '#ddd';
  ctx.lineWidth = 0.5;
  for (let x = 0; x <= width; x += GRID_SIZE) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y <= height; y += GRID_SIZE) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
}

/** Get the unit normal (perpendicular) of a wall. */
function wallNormal(wall: Wall): Point {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { x: 0, y: -1 };
  return { x: -dy / len, y: dx / len };
}

/** Get the unit direction vector of a wall. */
function wallDir(wall: Wall): Point {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { x: 1, y: 0 };
  return { x: dx / len, y: dy / len };
}

/** Interpolate a point along the wall at parametric t. */
function lerpWall(wall: Wall, t: number): Point {
  return {
    x: wall.start.x + (wall.end.x - wall.start.x) * t,
    y: wall.start.y + (wall.end.y - wall.start.y) * t,
  };
}

function ptsClose(a: Point, b: Point): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= ENDPOINT_SNAP;
}

/**
 * For a drywall endpoint, compute how far to extend the two parallel lines
 * so they meet nicely with an adjoining wall at that vertex.
 * Returns the signed extension distance for each side (+normal, -normal).
 */
function drywallEndExtension(
  wall: Wall, endpoint: Point, walls: Wall[]
): { plus: number; minus: number } {
  const half = DRYWALL_GAP / 2;
  const d = wallDir(wall);

  // Find other walls sharing this endpoint
  for (const other of walls) {
    if (other.id === wall.id) continue;
    let shared = false;
    if (ptsClose(other.start, endpoint) || ptsClose(other.end, endpoint)) {
      shared = true;
    }
    if (!shared) continue;

    // We have a neighbor. For a clean miter, extend parallel lines by half / tan(angle/2).
    // But for 90-degree joins (the common case) just cap with half-gap = nice square corner.
    const od = wallDir(other);
    // See if neighbor's direction is "away" from us — flip if needed so we measure the join angle
    let odx = od.x, ody = od.y;
    // Make od point away from the shared vertex
    if (ptsClose(other.start, endpoint)) {
      odx = od.x; ody = od.y;
    } else {
      odx = -od.x; ody = -od.y;
    }
    // Our direction away from this endpoint
    const isStart = ptsClose(wall.start, endpoint);
    const myDx = isStart ? d.x : -d.x;
    const myDy = isStart ? d.y : -d.y;

    // Cross product to figure out which side the neighbor is on
    const cross = myDx * ody - myDy * odx;

    // Extend both sides by half-gap for a clean L-corner cap
    return { plus: half, minus: half };
  }
  return { plus: 0, minus: 0 };
}

/** Draw a drywall with proper corner joins: two thin parallel lines with caps where walls meet. */
function drawDrywall(ctx: CanvasRenderingContext2D, wall: Wall, highlight: boolean, allWalls: Wall[]) {
  const n = wallNormal(wall);
  const d = wallDir(wall);
  const half = DRYWALL_GAP / 2;

  // Compute extensions at each end
  const startExt = drywallEndExtension(wall, wall.start, allWalls);
  const endExt = drywallEndExtension(wall, wall.end, allWalls);

  ctx.strokeStyle = highlight ? '#00ccff' : '#333';
  ctx.lineWidth = DRYWALL_LINE_W;
  ctx.lineCap = 'butt';

  // Plus-normal side line
  const p1s = {
    x: wall.start.x + n.x * half - d.x * startExt.plus,
    y: wall.start.y + n.y * half - d.y * startExt.plus,
  };
  const p1e = {
    x: wall.end.x + n.x * half + d.x * endExt.plus,
    y: wall.end.y + n.y * half + d.y * endExt.plus,
  };
  ctx.beginPath();
  ctx.moveTo(p1s.x, p1s.y);
  ctx.lineTo(p1e.x, p1e.y);
  ctx.stroke();

  // Minus-normal side line
  const p2s = {
    x: wall.start.x - n.x * half - d.x * startExt.minus,
    y: wall.start.y - n.y * half - d.y * startExt.minus,
  };
  const p2e = {
    x: wall.end.x - n.x * half + d.x * endExt.minus,
    y: wall.end.y - n.y * half + d.y * endExt.minus,
  };
  ctx.beginPath();
  ctx.moveTo(p2s.x, p2s.y);
  ctx.lineTo(p2e.x, p2e.y);
  ctx.stroke();

  // End caps (short perpendicular lines) where walls meet
  if (startExt.plus > 0 || startExt.minus > 0) {
    ctx.beginPath();
    ctx.moveTo(p1s.x, p1s.y);
    ctx.lineTo(p2s.x, p2s.y);
    ctx.stroke();
  }
  if (endExt.plus > 0 || endExt.minus > 0) {
    ctx.beginPath();
    ctx.moveTo(p1e.x, p1e.y);
    ctx.lineTo(p2e.x, p2e.y);
    ctx.stroke();
  }
}

/** Draw a concrete wall: thick black line. */
function drawConcrete(ctx: CanvasRenderingContext2D, wall: Wall, highlight: boolean) {
  ctx.beginPath();
  ctx.moveTo(wall.start.x, wall.start.y);
  ctx.lineTo(wall.end.x, wall.end.y);
  ctx.strokeStyle = highlight ? '#00ccff' : '#111';
  ctx.lineWidth = CONCRETE_LINE_W;
  ctx.lineCap = 'round';
  ctx.stroke();
}

/** Draw a door on a wall: gap in the wall + arc swing. */
function drawDoor(ctx: CanvasRenderingContext2D, wall: Wall, door: Door) {
  const n = wallNormal(wall);
  const pStart = lerpWall(wall, door.tStart);
  const pEnd = lerpWall(wall, door.tEnd);

  const dx = pEnd.x - pStart.x;
  const dy = pEnd.y - pStart.y;
  const doorLen = Math.hypot(dx, dy);
  if (doorLen < 1) return;

  // Clear the wall area where the door is (draw over with background)
  const hw = wall.type === 'drywall' ? DRYWALL_GAP / 2 + 1 : CONCRETE_LINE_W / 2 + 1;
  ctx.save();
  ctx.fillStyle = '#f5f0eb'; // match canvas bg
  ctx.beginPath();
  ctx.moveTo(pStart.x + n.x * hw, pStart.y + n.y * hw);
  ctx.lineTo(pEnd.x + n.x * hw, pEnd.y + n.y * hw);
  ctx.lineTo(pEnd.x - n.x * hw, pEnd.y - n.y * hw);
  ctx.lineTo(pStart.x - n.x * hw, pStart.y - n.y * hw);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Draw small perpendicular ticks at door edges
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(pStart.x + n.x * hw, pStart.y + n.y * hw);
  ctx.lineTo(pStart.x - n.x * hw, pStart.y - n.y * hw);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(pEnd.x + n.x * hw, pEnd.y + n.y * hw);
  ctx.lineTo(pEnd.x - n.x * hw, pEnd.y - n.y * hw);
  ctx.stroke();

  // Draw arc swing from the hinge point (tStart side)
  const side = door.swingSide;
  // Hinge is at pStart; the door swings from pStart→pEnd direction to swing outward
  const swingAngle = Math.atan2(dy, dx);
  const arcStartAngle = swingAngle;
  const arcEndAngle = Math.atan2(n.y * side, n.x * side);

  ctx.strokeStyle = '#666';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  // Draw the arc
  // Determine sweep direction
  let start = arcStartAngle;
  let end = arcEndAngle;
  // Normalize so arc goes the short way
  let diff = end - start;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  const ccw = diff < 0;
  ctx.arc(pStart.x, pStart.y, doorLen, start, start + diff, ccw);
  ctx.stroke();

  // Draw the door leaf (straight line from hinge to arc end)
  const leafEnd = {
    x: pStart.x + Math.cos(start + diff) * doorLen,
    y: pStart.y + Math.sin(start + diff) * doorLen,
  };
  ctx.setLineDash([]);
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(pStart.x, pStart.y);
  ctx.lineTo(leafEnd.x, leafEnd.y);
  ctx.stroke();
}

/** Draw a single wall (dispatches by type). */
function drawWallFull(ctx: CanvasRenderingContext2D, wall: Wall, highlight: boolean, allWalls: Wall[]) {
  if (wall.type === 'drywall') {
    drawDrywall(ctx, wall, highlight, allWalls);
  } else {
    drawConcrete(ctx, wall, highlight);
  }

  // Draw doors (must come after wall so the gap clears properly)
  for (const door of wall.doors) {
    drawDoor(ctx, wall, door);
  }

  // Draw damage sections
  for (const dmg of wall.damages) {
    drawDamageOutline(ctx, wall, dmg);
  }
}

/** Half-width of the damage outline away from the wall center. */
function getWallHalfWidth(type: WallType): number {
  return type === 'drywall' ? DRYWALL_GAP / 2 + 2 : CONCRETE_LINE_W / 2 + 2;
}

/** Draw a colored outline around a section of a wall. */
function drawDamageOutline(ctx: CanvasRenderingContext2D, wall: Wall, dmg: DamageSection) {
  const n = wallNormal(wall);
  const hw = getWallHalfWidth(wall.type);
  const tMin = Math.min(dmg.tStart, dmg.tEnd);
  const tMax = Math.max(dmg.tStart, dmg.tEnd);

  const p1 = lerpWall(wall, tMin);
  const p2 = lerpWall(wall, tMax);

  const a = { x: p1.x + n.x * hw, y: p1.y + n.y * hw };
  const b = { x: p2.x + n.x * hw, y: p2.y + n.y * hw };
  const c = { x: p2.x - n.x * hw, y: p2.y - n.y * hw };
  const d2 = { x: p1.x - n.x * hw, y: p1.y - n.y * hw };

  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(c.x, c.y);
  ctx.lineTo(d2.x, d2.y);
  ctx.closePath();

  ctx.strokeStyle = DAMAGE_COLOR_VALUES[dmg.color];
  ctx.lineWidth = 2.5;
  ctx.stroke();
}

/** Draw a preview wall. */
function drawWallPreview(ctx: CanvasRenderingContext2D, start: Point, end: Point, type: WallType, allWalls: Wall[]) {
  ctx.globalAlpha = 0.5;
  const fakeWall: Wall = { id: '__preview__', start, end, type, damages: [], doors: [] };
  // Include the preview wall in the list so corner joins calculate correctly
  const withPreview = [...allWalls, fakeWall];
  drawWallFull(ctx, fakeWall, false, withPreview);
  ctx.globalAlpha = 1;
}

/** Draw a preview of the damage section being painted. */
function drawDamagePreview(ctx: CanvasRenderingContext2D, wall: Wall, dmg: DamageSection) {
  ctx.globalAlpha = 0.5;
  drawDamageOutline(ctx, wall, dmg);
  ctx.globalAlpha = 1;
}

/** Draw a preview of a door being placed. */
function drawDoorPreview(ctx: CanvasRenderingContext2D, wall: Wall, door: Door) {
  ctx.globalAlpha = 0.5;
  drawDoor(ctx, wall, door);
  ctx.globalAlpha = 1;
}

/** Draw a placed prop on the canvas — gray fill, black outline, icon. */
function drawProp(ctx: CanvasRenderingContext2D, prop: PlacedProp, highlight = false) {
  const { w, h } = propPixelSize(prop);

  // Fill
  ctx.fillStyle = '#ddd';
  ctx.fillRect(prop.x, prop.y, w, h);

  // Border
  ctx.strokeStyle = highlight ? '#00ccff' : '#222';
  ctx.lineWidth = highlight ? 2 : 1.5;
  ctx.strokeRect(prop.x, prop.y, w, h);

  // Icon centered
  const cx = prop.x + w / 2;
  const cy = prop.y + h / 2;
  ctx.font = `${Math.min(w, h) * 0.5}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#222';
  ctx.fillText(getPropDef(prop.kind).icon, cx, cy);
}

/** Find a prop at a given point. */
export function findPropAt(props: PlacedProp[], p: Point): PlacedProp | null {
  for (let i = props.length - 1; i >= 0; i--) {
    const prop = props[i];
    const { w, h } = propPixelSize(prop);
    if (p.x >= prop.x && p.x <= prop.x + w &&
        p.y >= prop.y && p.y <= prop.y + h) {
      return prop;
    }
  }
  return null;
}

/** Draw a single ground tile. */
function drawGroundTile(ctx: CanvasRenderingContext2D, tile: GroundTile) {
  ctx.fillStyle = TILE_COLOR_VALUES[tile.color];
  ctx.fillRect(tile.gx * GRID_SIZE, tile.gy * GRID_SIZE, GRID_SIZE, GRID_SIZE);
}

export interface RenderState {
  walls: Wall[];
  props: PlacedProp[];
  tiles: GroundTile[];
  highlightWall: Wall | null;
  highlightProp: PlacedProp | null;
  // Wall drawing preview
  previewStart: Point | null;
  previewEnd: Point | null;
  previewWallType: WallType;
  // Damage drawing preview
  damagePreviewWall: Wall | null;
  damagePreview: DamageSection | null;
  // Door placement preview
  doorPreviewWall: Wall | null;
  doorPreview: Door | null;
  // Prop drag preview
  dragProp: PlacedProp | null;
}

/** Full render pass. */
export function render(ctx: CanvasRenderingContext2D, state: RenderState) {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);

  // Ground tiles first (under grid)
  for (const tile of state.tiles) {
    drawGroundTile(ctx, tile);
  }

  drawGrid(ctx, width, height);

  for (const wall of state.walls) {
    const isHighlighted = state.highlightWall?.id === wall.id;
    drawWallFull(ctx, wall, isHighlighted, state.walls);
  }

  // Props
  for (const prop of state.props) {
    const isHighlighted = state.highlightProp?.id === prop.id;
    drawProp(ctx, prop, isHighlighted);
  }

  if (state.previewStart && state.previewEnd) {
    drawWallPreview(ctx, state.previewStart, state.previewEnd, state.previewWallType, state.walls);
  }

  if (state.damagePreviewWall && state.damagePreview) {
    drawDamagePreview(ctx, state.damagePreviewWall, state.damagePreview);
  }

  if (state.doorPreviewWall && state.doorPreview) {
    drawDoorPreview(ctx, state.doorPreviewWall, state.doorPreview);
  }

  if (state.dragProp) {
    ctx.globalAlpha = 0.6;
    drawProp(ctx, state.dragProp);
    ctx.globalAlpha = 1;
  }
}
