export const GRID_METERS = 0.1524;

export function snapValue(value, enabled = true, spacing = GRID_METERS) {
  return enabled ? Math.round(value / spacing) * spacing : value;
}

export function wallLength(start, end) {
  return Math.hypot(end.x - start.x, end.z - start.z);
}

export function formatMetric(meters) {
  return `${meters.toFixed(2)} m`;
}

export function formatImperial(meters) {
  const inches = Math.round(meters * 39.3700787);
  const feet = Math.floor(inches / 12);
  const remainder = inches % 12;
  return `${feet}' ${remainder}"`;
}

export function formatDistance(meters, units = "imperial") {
  return units === "metric" ? formatMetric(meters) : formatImperial(meters);
}

export function nearestPointOnWall(point, wall) {
  const dx = wall.end.x - wall.start.x;
  const dz = wall.end.z - wall.start.z;
  const lengthSquared = dx * dx + dz * dz;
  if (!lengthSquared) return { ...wall.start, t: 0 };
  const t = Math.max(
    0,
    Math.min(1, ((point.x - wall.start.x) * dx + (point.z - wall.start.z) * dz) / lengthSquared),
  );
  return {
    x: wall.start.x + t * dx,
    z: wall.start.z + t * dz,
    t,
  };
}
