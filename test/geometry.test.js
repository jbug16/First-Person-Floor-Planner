import { describe, expect, it } from "vitest";
import {
  GRID_METERS,
  formatImperial,
  formatMetric,
  nearestPointOnWall,
  snapValue,
  wallLength,
} from "../src/geometry.js";

describe("real-scale geometry", () => {
  it("uses a six-inch snapping grid", () => {
    expect(GRID_METERS).toBeCloseTo(0.1524);
    expect(snapValue(1.2)).toBeCloseTo(1.2192);
  });

  it("supports unit-specific snapping increments", () => {
    expect(snapValue(1.24, true, 0.1)).toBeCloseTo(1.2);
    expect(snapValue(1.26, true, 0.1)).toBeCloseTo(1.3);
  });

  it("measures wall length in meters", () => {
    expect(wallLength({ x: 0, z: 0 }, { x: 3, z: 4 })).toBe(5);
  });

  it("formats both supported unit systems", () => {
    expect(formatImperial(2.4384)).toBe("8' 0\"");
    expect(formatMetric(2.4384)).toBe("2.44 m");
  });

  it("projects openings onto a wall segment", () => {
    expect(nearestPointOnWall({ x: 3, z: 2 }, {
      start: { x: 0, z: 0 },
      end: { x: 4, z: 0 },
    })).toEqual({ x: 3, z: 0, t: 0.75 });
  });
});
