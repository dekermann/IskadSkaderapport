export type WallType = 'drywall' | 'concrete';
export type DamageColor = 'pink' | 'blue' | 'green';
export type TileColor = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple';
export type ToolMode = 'draw' | 'damage' | 'select' | 'erase' | 'door' | 'prop' | 'tile';

export const GRID_SIZE = 20;

export interface Point {
  x: number;
  y: number;
}

/** A damage section is a colored range along the wall (0..1 parametric). */
export interface DamageSection {
  tStart: number;
  tEnd: number;
  color: DamageColor;
}

/** A door placed on a wall, defined by parametric range along it. */
export interface Door {
  tStart: number;
  tEnd: number;
  /** Which side the door swings to (+1 or -1 relative to wall normal). */
  swingSide: 1 | -1;
  /** Which end is the hinge: 'start' = tStart side, 'end' = tEnd side. */
  hingeSide: 'start' | 'end';
}

export interface Wall {
  id: string;
  start: Point;
  end: Point;
  type: WallType;
  damages: DamageSection[];
  doors: Door[];
}

// --------------- Props ---------------

export type PropKind =
  | 'fridge'
  | 'stove'
  | 'dishwasher'
  | 'sink'
  | 'washer'
  | 'toilet'
  | 'shower'
  | 'bathtub';

export interface PropDef {
  kind: PropKind;
  label: string;
  /** Width and height in grid cells (at scale 1). */
  gw: number;
  gh: number;
  /** Emoji/symbol shown inside. */
  icon: string;
}

export interface PlacedProp {
  id: string;
  kind: PropKind;
  /** Top-left corner, snapped to grid. */
  x: number;
  y: number;
  /** Scale multiplier for width (in grid units). */
  scaleW: number;
  /** Scale multiplier for height (in grid units). */
  scaleH: number;
  /** Rotation in degrees: 0, 90, 180, 270. */
  rotation: number;
}

export const PROP_CATALOG: PropDef[] = [
  { kind: 'fridge',      label: 'Fridge',      gw: 2, gh: 2, icon: '❄' },
  { kind: 'stove',       label: 'Stove',       gw: 2, gh: 2, icon: '🔥' },
  { kind: 'dishwasher',  label: 'Dishwasher',  gw: 2, gh: 2, icon: '💧' },
  { kind: 'sink',        label: 'Sink',        gw: 2, gh: 1, icon: '🚰' },
  { kind: 'washer',      label: 'Washer',      gw: 2, gh: 2, icon: '👕' },
  { kind: 'toilet',      label: 'Toilet',      gw: 1, gh: 2, icon: '🚽' },
  { kind: 'shower',      label: 'Shower',      gw: 3, gh: 3, icon: '🚿' },
  { kind: 'bathtub',     label: 'Bathtub',     gw: 3, gh: 2, icon: '🛁' },
];

export function getPropDef(kind: PropKind): PropDef {
  return PROP_CATALOG.find(p => p.kind === kind)!;
}

/** Inset in pixels per side so props fit inside walled cells (half of thickest wall). */
export const PROP_INSET = 5;

/** Get pixel dimensions of a placed prop (after rotation), inset to fit inside walls. */
export function propPixelSize(prop: PlacedProp): { w: number; h: number } {
  const def = getPropDef(prop.kind);
  const isRotated = prop.rotation === 90 || prop.rotation === 270;
  return {
    w: (isRotated ? def.gh : def.gw) * (isRotated ? prop.scaleH : prop.scaleW) * GRID_SIZE - PROP_INSET * 2,
    h: (isRotated ? def.gw : def.gh) * (isRotated ? prop.scaleW : prop.scaleH) * GRID_SIZE - PROP_INSET * 2,
  };
}

// --------------- Ground tiles ---------------

/** A painted ground tile at grid coordinates. */
export interface GroundTile {
  /** Grid column (pixel x = gx * GRID_SIZE). */
  gx: number;
  /** Grid row (pixel y = gy * GRID_SIZE). */
  gy: number;
  color: TileColor;
}

// --------------- Floorplan data ---------------

export interface FloorplanData {
  walls: Wall[];
  props: PlacedProp[];
  tiles: GroundTile[];
  version: number;
}

export const DAMAGE_COLOR_VALUES: Record<DamageColor, string> = {
  pink: '#ff69b4',
  blue: '#4488ff',
  green: '#44cc44',
};

export const TILE_COLOR_VALUES: Record<TileColor, string> = {
  red: '#f8aaaa',
  orange: '#fdd5a0',
  yellow: '#fff5a0',
  green: '#b0f0b0',
  blue: '#a0d0ff',
  purple: '#dbb0f0',
};
