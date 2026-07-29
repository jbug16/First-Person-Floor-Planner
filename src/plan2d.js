const UNIT_TO_METERS = {
  ft: 0.3048,
  in: 0.0254,
  m: 1,
  cm: 0.01,
};

export function toMeters(value, unit = "ft") {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return numeric * (UNIT_TO_METERS[unit] || 1);
}

export function fromMeters(value, unit = "ft") {
  return value / (UNIT_TO_METERS[unit] || 1);
}

export function pointDistance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function nearestPointOnPlanWall(point, wall) {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return { ...wall.start, t: 0, distance: pointDistance(point, wall.start) };
  const t = Math.max(
    0,
    Math.min(1, ((point.x - wall.start.x) * dx + (point.y - wall.start.y) * dy) / lengthSquared),
  );
  const projected = { x: wall.start.x + dx * t, y: wall.start.y + dy * t, t };
  return { ...projected, distance: pointDistance(point, projected) };
}

export function roomWalls(origin, width, depth, height, thickness) {
  const x2 = origin.x + width;
  const y2 = origin.y + depth;
  return [
    { start: { ...origin }, end: { x: x2, y: origin.y }, height, thickness },
    { start: { x: x2, y: origin.y }, end: { x: x2, y: y2 }, height, thickness },
    { start: { x: x2, y: y2 }, end: { x: origin.x, y: y2 }, height, thickness },
    { start: { x: origin.x, y: y2 }, end: { ...origin }, height, thickness },
  ];
}

export function exactEndpoint(start, pointerEnd, exactLength) {
  if (!exactLength || exactLength <= 0) return pointerEnd;
  const dx = pointerEnd.x - start.x;
  const dy = pointerEnd.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return pointerEnd;
  return {
    x: start.x + (dx / length) * exactLength,
    y: start.y + (dy / length) * exactLength,
  };
}
