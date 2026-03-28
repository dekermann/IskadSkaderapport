import { Wall, Point, WallType, DamageSection, Door, PlacedProp, GroundTile, propPixelSize, getPropDef, DAMAGE_COLOR_VALUES, TILE_COLOR_VALUES, GRID_SIZE, PROP_INSET } from './types';

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

  // Determine hinge and free end based on hingeSide
  const hinge = door.hingeSide === 'start' ? pStart : pEnd;
  const free = door.hingeSide === 'start' ? pEnd : pStart;

  const dx = free.x - hinge.x;
  const dy = free.y - hinge.y;
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

  // Draw arc swing from the hinge point
  const side = door.swingSide;
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
  ctx.arc(hinge.x, hinge.y, doorLen, start, start + diff, ccw);
  ctx.stroke();

  // Draw the door leaf (straight line from hinge to arc end)
  const leafEnd = {
    x: hinge.x + Math.cos(start + diff) * doorLen,
    y: hinge.y + Math.sin(start + diff) * doorLen,
  };
  ctx.setLineDash([]);
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(hinge.x, hinge.y);
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

/** Draw a placed prop on the canvas with architectural-style icons. */
function drawProp(ctx: CanvasRenderingContext2D, prop: PlacedProp, highlight = false) {
  const { w, h } = propPixelSize(prop);
  // Offset by inset so prop centers within the grid cell
  const x = prop.x + PROP_INSET;
  const y = prop.y + PROP_INSET;
  const def = getPropDef(prop.kind);
  const rot = prop.rotation || 0;

  ctx.save();

  // Rotate around the center of the prop
  const cx = x + w / 2;
  const cy = y + h / 2;
  ctx.translate(cx, cy);
  ctx.rotate((rot * Math.PI) / 180);

  // After rotation, draw in "unrotated" local coords.
  // Use the inset dimensions so the prop fits inside walls.
  const baseW = def.gw * prop.scaleW * GRID_SIZE - PROP_INSET * 2;
  const baseH = def.gh * prop.scaleH * GRID_SIZE - PROP_INSET * 2;
  const lx = -baseW / 2;
  const ly = -baseH / 2;

  // Common background + border
  ctx.fillStyle = '#eee';
  ctx.fillRect(lx, ly, baseW, baseH);
  ctx.strokeStyle = highlight ? '#00ccff' : '#222';
  ctx.lineWidth = highlight ? 2 : 1.5;
  ctx.strokeRect(lx, ly, baseW, baseH);

  // Draw type-specific details in local coords
  ctx.fillStyle = '#222';
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 1.2;

  const kind = prop.kind;
  if (kind === 'stove') {
    drawStove(ctx, lx, ly, baseW, baseH);
  } else if (kind === 'fridge') {
    drawFridge(ctx, lx, ly, baseW, baseH);
  } else if (kind === 'sink') {
    drawSink(ctx, lx, ly, baseW, baseH);
  } else if (kind === 'dishwasher') {
    drawDishwasher(ctx, lx, ly, baseW, baseH);
  } else if (kind === 'washer') {
    drawWasher(ctx, lx, ly, baseW, baseH);
  } else if (kind === 'toilet') {
    drawToilet(ctx, lx, ly, baseW, baseH);
  } else if (kind === 'shower') {
    drawShower(ctx, lx, ly, baseW, baseH);
  } else if (kind === 'bathtub') {
    drawBathtub(ctx, lx, ly, baseW, baseH);
  }

  ctx.restore();
}

/** Stove: 4 burner circles in a 2x2 grid. */
function drawStove(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const r = Math.min(w, h) * 0.16;
  const padX = w * 0.28;
  const padY = h * 0.28;
  for (const [cx, cy] of [
    [x + padX, y + padY],
    [x + w - padX, y + padY],
    [x + padX, y + h - padY],
    [x + w - padX, y + h - padY],
  ]) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    // Inner ring
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/** Fridge: rectangle with horizontal divider line and small handle. */
function drawFridge(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  // Divider line at ~35% from top (freezer/fridge split)
  const divY = y + h * 0.35;
  ctx.beginPath();
  ctx.moveTo(x + 2, divY);
  ctx.lineTo(x + w - 2, divY);
  ctx.stroke();
  // Handle on right side
  const hx = x + w * 0.82;
  ctx.beginPath();
  ctx.moveTo(hx, y + h * 0.12);
  ctx.lineTo(hx, y + h * 0.28);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(hx, y + h * 0.45);
  ctx.lineTo(hx, y + h * 0.85);
  ctx.stroke();
}

/** Sink: oval basin inside the rectangle. */
function drawSink(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rx = w * 0.35;
  const ry = h * 0.32;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  // Faucet dot at top center
  ctx.beginPath();
  ctx.arc(cx, y + h * 0.15, 2, 0, Math.PI * 2);
  ctx.fill();
}

/** Dishwasher: rectangle with horizontal lines (racks). */
function drawDishwasher(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const pad = w * 0.12;
  // Two horizontal rack lines
  for (const frac of [0.38, 0.62]) {
    const ly = y + h * frac;
    ctx.beginPath();
    ctx.moveTo(x + pad, ly);
    ctx.lineTo(x + w - pad, ly);
    ctx.stroke();
  }
  // Small handle at bottom
  const hx1 = x + w * 0.35;
  const hx2 = x + w * 0.65;
  const hy = y + h * 0.85;
  ctx.beginPath();
  ctx.moveTo(hx1, hy);
  ctx.lineTo(hx2, hy);
  ctx.stroke();
}

/** Washer: large circle (drum) with small circle inside. */
function drawWasher(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const cx = x + w / 2;
  const cy = y + h * 0.55;
  const r = Math.min(w, h) * 0.32;
  // Door circle
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  // Inner drum
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
  ctx.stroke();
  // Control panel area at top
  const panelY = y + h * 0.12;
  ctx.beginPath();
  ctx.moveTo(x + 2, y + h * 0.22);
  ctx.lineTo(x + w - 2, y + h * 0.22);
  ctx.stroke();
  // Small knob dots
  for (const fx of [0.3, 0.5, 0.7]) {
    ctx.beginPath();
    ctx.arc(x + w * fx, panelY, 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Toilet: oval seat viewed from above with tank rectangle at back. */
function drawToilet(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  // Tank (rectangle at top)
  const tankH = h * 0.25;
  const tankPad = w * 0.1;
  ctx.strokeRect(x + tankPad, y + 2, w - tankPad * 2, tankH);

  // Bowl (oval)
  const cx = x + w / 2;
  const cy = y + tankH + (h - tankH) * 0.5;
  const rx = w * 0.38;
  const ry = (h - tankH) * 0.4;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Seat opening (smaller oval inside)
  ctx.beginPath();
  ctx.ellipse(cx, cy + ry * 0.05, rx * 0.65, ry * 0.65, 0, 0, Math.PI * 2);
  ctx.stroke();
}

/** Shower: square with diagonal lines (water) and drain circle. */
function drawShower(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  // Diagonal hatch lines to show floor
  ctx.save();
  ctx.beginPath();
  ctx.rect(x + 1, y + 1, w - 2, h - 2);
  ctx.clip();
  const spacing = Math.min(w, h) * 0.18;
  for (let i = -10; i < 20; i++) {
    const sx = x + i * spacing;
    ctx.beginPath();
    ctx.moveTo(sx, y);
    ctx.lineTo(sx + h, y + h);
    ctx.stroke();
  }
  ctx.restore();

  // Drain circle in center
  const cx = x + w / 2;
  const cy = y + h / 2;
  ctx.fillStyle = '#eee';
  ctx.beginPath();
  ctx.arc(cx, cy, Math.min(w, h) * 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#222';
  ctx.beginPath();
  ctx.arc(cx, cy, Math.min(w, h) * 0.1, 0, Math.PI * 2);
  ctx.stroke();
  // Drain dots
  ctx.beginPath();
  ctx.arc(cx, cy, 2, 0, Math.PI * 2);
  ctx.fill();

  // Shower head in corner
  ctx.beginPath();
  ctx.arc(x + w * 0.18, y + h * 0.18, Math.min(w, h) * 0.08, 0, Math.PI * 2);
  ctx.fill();
}

/** Bathtub: rounded rectangle with oval basin inside. */
function drawBathtub(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  // Inner rounded basin
  const pad = Math.min(w, h) * 0.12;
  const bx = x + pad;
  const by = y + pad;
  const bw = w - pad * 2;
  const bh = h - pad * 2;
  const r = Math.min(bw, bh) * 0.3;
  ctx.beginPath();
  ctx.moveTo(bx + r, by);
  ctx.lineTo(bx + bw - r, by);
  ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + r);
  ctx.lineTo(bx + bw, by + bh - r);
  ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - r, by + bh);
  ctx.lineTo(bx + r, by + bh);
  ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - r);
  ctx.lineTo(bx, by + r);
  ctx.quadraticCurveTo(bx, by, bx + r, by);
  ctx.closePath();
  ctx.stroke();

  // Faucet at one end
  const fx = x + w * 0.15;
  const fy = y + h * 0.5;
  ctx.beginPath();
  ctx.arc(fx, fy, 3, 0, Math.PI * 2);
  ctx.fill();

  // Drain at other end
  const dx = x + w * 0.85;
  const dy = y + h * 0.5;
  ctx.beginPath();
  ctx.arc(dx, dy, 2.5, 0, Math.PI * 2);
  ctx.stroke();
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

// --------------- Prop handles ---------------

const HANDLE_SIZE = 8;
const HANDLE_HALF = HANDLE_SIZE / 2;
const ROTATE_HANDLE_OFFSET = 18; // pixels above the prop

export type HandleType = 'scale-tl' | 'scale-tr' | 'scale-bl' | 'scale-br' | 'scale-t' | 'scale-b' | 'scale-l' | 'scale-r' | 'rotate';

interface HandlePos {
  type: HandleType;
  x: number;
  y: number;
}

/** Get the handle positions for a prop (on the visual inset bounds). */
export function getPropHandles(prop: PlacedProp): HandlePos[] {
  const { w, h } = propPixelSize(prop);
  const x = prop.x + PROP_INSET;
  const y = prop.y + PROP_INSET;
  return [
    // Corner handles (uniform scale)
    { type: 'scale-tl', x, y },
    { type: 'scale-tr', x: x + w, y },
    { type: 'scale-bl', x, y: y + h },
    { type: 'scale-br', x: x + w, y: y + h },
    // Edge handles (single-axis scale)
    { type: 'scale-t', x: x + w / 2, y },
    { type: 'scale-b', x: x + w / 2, y: y + h },
    { type: 'scale-l', x, y: y + h / 2 },
    { type: 'scale-r', x: x + w, y: y + h / 2 },
    // Rotation
    { type: 'rotate', x: x + w / 2, y: y - ROTATE_HANDLE_OFFSET },
  ];
}

/** Check if a point hits a handle. Returns the handle type or null. */
export function hitTestHandle(prop: PlacedProp, p: Point): HandleType | null {
  const handles = getPropHandles(prop);
  for (const h of handles) {
    if (Math.abs(p.x - h.x) <= HANDLE_HALF + 2 && Math.abs(p.y - h.y) <= HANDLE_HALF + 2) {
      return h.type;
    }
  }
  return null;
}

/** Draw handles on a prop. */
function drawPropHandles(ctx: CanvasRenderingContext2D, prop: PlacedProp) {
  const handles = getPropHandles(prop);
  for (const h of handles) {
    if (h.type === 'rotate') {
      // Draw line from prop center-top to rotate handle
      const { w } = propPixelSize(prop);
      ctx.strokeStyle = '#666';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(prop.x + PROP_INSET + w / 2, prop.y + PROP_INSET);
      ctx.lineTo(h.x, h.y);
      ctx.stroke();

      // Rotation circle
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(h.x, h.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Small arrow inside
      ctx.fillStyle = '#333';
      ctx.beginPath();
      ctx.arc(h.x, h.y, 3, 0, Math.PI * 1.5);
      ctx.stroke();
    } else if (h.type.startsWith('scale-') && h.type.length === 7) {
      // Edge handle (single letter: t, b, l, r) — small diamond
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#555';
      ctx.lineWidth = 1.5;
      ctx.save();
      ctx.translate(h.x, h.y);
      ctx.rotate(Math.PI / 4);
      const s = HANDLE_SIZE * 0.7;
      ctx.fillRect(-s / 2, -s / 2, s, s);
      ctx.strokeRect(-s / 2, -s / 2, s, s);
      ctx.restore();
    } else {
      // Corner scale handle — square
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 1.5;
      ctx.fillRect(h.x - HANDLE_HALF, h.y - HANDLE_HALF, HANDLE_SIZE, HANDLE_SIZE);
      ctx.strokeRect(h.x - HANDLE_HALF, h.y - HANDLE_HALF, HANDLE_SIZE, HANDLE_SIZE);
    }
  }
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
  backgroundImage: HTMLImageElement | null;
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
  // Selected prop (shows handles)
  selectedProp: PlacedProp | null;
}

/** Full render pass. */
export function render(ctx: CanvasRenderingContext2D, state: RenderState, opts?: { skipGrid?: boolean }) {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);

  // Background image (under everything)
  if (state.backgroundImage) {
    ctx.globalAlpha = 0.35;
    ctx.drawImage(state.backgroundImage, 0, 0, width, height);
    ctx.globalAlpha = 1;
  }

  // Ground tiles first (under grid)
  for (const tile of state.tiles) {
    drawGroundTile(ctx, tile);
  }

  if (!opts?.skipGrid) {
    drawGrid(ctx, width, height);
  }

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

  // Draw handles on selected prop (last, on top of everything)
  if (state.selectedProp) {
    drawPropHandles(ctx, state.selectedProp);
  }
}
