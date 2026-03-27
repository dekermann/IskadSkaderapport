import { Wall, PlacedProp, GroundTile, FloorplanData } from './types';

interface Snapshot {
  walls: Wall[];
  props: PlacedProp[];
  tiles: GroundTile[];
}

/** Undo/redo history for the floorplan state. */
export class History {
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];

  push(walls: Wall[], props: PlacedProp[], tiles: GroundTile[]) {
    this.undoStack.push({ walls: structuredClone(walls), props: structuredClone(props), tiles: structuredClone(tiles) });
    this.redoStack = [];
  }

  undo(currentWalls: Wall[], currentProps: PlacedProp[], currentTiles: GroundTile[]): Snapshot | null {
    if (this.undoStack.length === 0) return null;
    this.redoStack.push({ walls: structuredClone(currentWalls), props: structuredClone(currentProps), tiles: structuredClone(currentTiles) });
    return this.undoStack.pop()!;
  }

  redo(currentWalls: Wall[], currentProps: PlacedProp[], currentTiles: GroundTile[]): Snapshot | null {
    if (this.redoStack.length === 0) return null;
    this.undoStack.push({ walls: structuredClone(currentWalls), props: structuredClone(currentProps), tiles: structuredClone(currentTiles) });
    return this.redoStack.pop()!;
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }
}

const STORAGE_KEY = 'iskad-floorplan';

export function saveFloorplan(walls: Wall[], props: PlacedProp[], tiles: GroundTile[]) {
  const data: FloorplanData = { walls, props, tiles, version: 3 };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function loadFloorplan(): { walls: Wall[]; props: PlacedProp[]; tiles: GroundTile[] } | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as FloorplanData;
    if (Array.isArray(data.walls)) {
      return {
        walls: data.walls,
        props: Array.isArray(data.props) ? data.props : [],
        tiles: Array.isArray(data.tiles) ? data.tiles : [],
      };
    }
  } catch {
    // ignore corrupt data
  }
  return null;
}
