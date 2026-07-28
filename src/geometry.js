export const GRID_METERS = 0.1524;

export function snapValue(value, enabled = true, spacing = GRID_METERS) {
  return enabled ? Math.round(value / spacing) * spacing : value;
}

export function wallLength(start, end) {
  return Math.hypot(end.x - start.x, end.z - start.z);
}

function cross2D(a, b) {
  return a.x * b.z - a.z * b.x;
}

export function wallSegmentsConflict(start, end, otherStart, otherEnd, epsilon = 1e-6) {
  const r = { x: end.x - start.x, z: end.z - start.z };
  const s = { x: otherEnd.x - otherStart.x, z: otherEnd.z - otherStart.z };
  const offset = { x: otherStart.x - start.x, z: otherStart.z - start.z };
  const denominator = cross2D(r, s);
  const collinearity = cross2D(offset, r);

  if (Math.abs(denominator) <= epsilon) {
    if (Math.abs(collinearity) > epsilon) return false;
    const useX = Math.abs(r.x) >= Math.abs(r.z);
    const divisor = useX ? r.x : r.z;
    if (Math.abs(divisor) <= epsilon) return false;
    const first = ((useX ? otherStart.x : otherStart.z) - (useX ? start.x : start.z)) / divisor;
    const second = ((useX ? otherEnd.x : otherEnd.z) - (useX ? start.x : start.z)) / divisor;
    const overlapStart = Math.max(0, Math.min(first, second));
    const overlapEnd = Math.min(1, Math.max(first, second));
    return overlapEnd - overlapStart > epsilon;
  }

  const t = cross2D(offset, s) / denominator;
  const u = cross2D(offset, r) / denominator;
  if (t < -epsilon || t > 1 + epsilon || u < -epsilon || u > 1 + epsilon) return false;
  const newEndpoint = t <= epsilon || t >= 1 - epsilon;
  const existingEndpoint = u <= epsilon || u >= 1 - epsilon;
  return !newEndpoint && !existingEndpoint;
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
