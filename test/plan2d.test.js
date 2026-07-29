import { describe, expect, it } from "vitest";
import {
  exactEndpoint,
  fromMeters,
  nearestPointOnPlanWall,
  roomWalls,
  toMeters,
} from "../src/plan2d.js";

describe("2D floor plan measurements", () => {
  it("converts supported units to meters", () => {
    expect(toMeters(1, "ft")).toBeCloseTo(0.3048);
    expect(toMeters(12, "in")).toBeCloseTo(0.3048);
    expect(toMeters(100, "cm")).toBeCloseTo(1);
    expect(fromMeters(1, "cm")).toBeCloseTo(100);
  });

  it("creates a rectangular room at exact scale", () => {
    const walls = roomWalls({ x: 1, y: 2 }, 3, 4, 2.44, 0.15);
    expect(walls).toHaveLength(4);
    expect(walls[0].end).toEqual({ x: 4, y: 2 });
    expect(walls[2].end).toEqual({ x: 1, y: 6 });
  });

  it("uses the drag direction with an exact wall length", () => {
    const end = exactEndpoint({ x: 0, y: 0 }, { x: 3, y: 4 }, 10);
    expect(end.x).toBeCloseTo(6);
    expect(end.y).toBeCloseTo(8);
  });

  it("projects openings onto the nearest wall position", () => {
    const point = nearestPointOnPlanWall(
      { x: 4, y: 2 },
      { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
    );
    expect(point.t).toBeCloseTo(0.4);
    expect(point.distance).toBeCloseTo(2);
  });
});
