import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import {
  formatDistance,
  nearestPointOnWall,
  snapValue,
  wallLength,
  wallSegmentsConflict,
} from "./geometry.js";
import {
  exactEndpoint,
  fromMeters,
  nearestPointOnPlanWall,
  pointDistance,
  roomWalls,
  toMeters,
} from "./plan2d.js";
import "./style.css";

const canvas = document.querySelector("#world");
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xcbd4d4);
scene.fog = new THREE.Fog(0xcbd4d4, 25, 80);

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 150);
camera.position.set(0, 1.7, 7);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

scene.add(new THREE.HemisphereLight(0xf6fbff, 0x52605e, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.position.set(-8, 16, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.00015;
sun.shadow.normalBias = 0.04;
sun.shadow.radius = 2;
sun.shadow.camera.left = -30;
sun.shadow.camera.right = 30;
sun.shadow.camera.top = 30;
sun.shadow.camera.bottom = -30;
scene.add(sun);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(100, 100),
  new THREE.MeshStandardMaterial({ color: 0xe8e9e4, roughness: 0.88 }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
floor.name = "floor";
scene.add(floor);

let grid;

function rebuildGrid(units) {
  if (grid) {
    scene.remove(grid);
    grid.geometry.dispose();
    grid.material.dispose();
  }
  const spacing = units === "imperial" ? 0.3048 : 1;
  const halfSize = 50;
  const lineCount = Math.floor(halfSize / spacing);
  const positions = [];
  const colors = [];
  const minor = new THREE.Color(0xb7bfbd);
  const major = new THREE.Color(0x758382);

  const pushLine = (x1, z1, x2, z2, color) => {
    positions.push(x1, 0, z1, x2, 0, z2);
    colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
  };

  for (let index = -lineCount; index <= lineCount; index += 1) {
    const position = index * spacing;
    const color = index % 5 === 0 ? major : minor;
    pushLine(position, -halfSize, position, halfSize, color);
    pushLine(-halfSize, position, halfSize, position, color);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  grid = new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
    }),
  );
  grid.position.y = 0.004;
  scene.add(grid);
}

const controls = new PointerLockControls(camera, document.body);
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2(0, 0);
const clock = new THREE.Clock();
const keys = {};
const colliders = [];

const state = {
  tool: "wall",
  units: "imperial",
  wallStart: null,
  windowStart: null,
  walls: [],
  openings: [],
  fixtures: [],
  selected: null,
  hoveredDelete: null,
  undo: [],
  redo: [],
  previewOpening: null,
  previewWindowStart: null,
  previewWallValid: true,
};

const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xf3f0e8, roughness: 0.72 });
const selectedMaterial = new THREE.MeshStandardMaterial({ color: 0xd9a85e, roughness: 0.65 });
const previewMaterial = new THREE.MeshStandardMaterial({
  color: 0xd89549,
  transparent: true,
  opacity: 0.55,
});
const doorMaterial = new THREE.MeshStandardMaterial({ color: 0x7f5638, roughness: 0.8 });
const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x26302f, roughness: 0.65 });
const glassMaterial = new THREE.MeshPhysicalMaterial({
  color: 0xaed9df,
  transparent: true,
  opacity: 0.38,
  roughness: 0.1,
  transmission: 0.35,
});
const fixtureMaterial = new THREE.MeshStandardMaterial({
  color: 0x477e93,
  roughness: 0.72,
});
const fixtureTopMaterial = new THREE.MeshStandardMaterial({
  color: 0x9fc1cc,
  roughness: 0.48,
});
const applianceMaterial = new THREE.MeshStandardMaterial({
  color: 0x738b93,
  roughness: 0.42,
  metalness: 0.16,
});

const preview = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), previewMaterial);
preview.visible = false;
scene.add(preview);
const openingPreviewMaterial = new THREE.LineBasicMaterial({
  color: 0x62c98d,
  transparent: true,
  opacity: 0.95,
  depthTest: false,
  depthWrite: false,
});
const openingPreview = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)),
  openingPreviewMaterial,
);
openingPreview.renderOrder = 20;
openingPreview.visible = false;
scene.add(openingPreview);
const anchorGeometry = new THREE.BufferGeometry();
anchorGeometry.setAttribute(
  "position",
  new THREE.Float32BufferAttribute(
    [-0.09, 0, 0, 0.09, 0, 0, 0, -0.09, 0, 0, 0.09, 0],
    3,
  ),
);
const windowAnchor = new THREE.LineSegments(
  anchorGeometry,
  new THREE.LineBasicMaterial({
    color: 0xf2b45f,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    depthWrite: false,
  }),
);
windowAnchor.renderOrder = 21;
windowAnchor.visible = false;
scene.add(windowAnchor);

function snapshot() {
  return JSON.stringify({
    walls: state.walls.map(({ start, end, height, thickness }) => ({ start, end, height, thickness })),
    openings: state.openings.map(({ type, wallIndex, t, width, height, sill }) => ({
      type,
      wallIndex,
      t,
      width,
      height,
      sill,
    })),
    fixtures: state.fixtures.map(
      ({ type, label, x, z, width, depth, height, rotation, locked }) => ({
        type,
        label,
        x,
        z,
        width,
        depth,
        height,
        rotation,
        locked,
      }),
    ),
  });
}

function recordHistory() {
  state.undo.push(snapshot());
  if (state.undo.length > 60) state.undo.shift();
  state.redo.length = 0;
}

function clearObjects() {
  state.walls.forEach((wall) => {
    scene.remove(wall.mesh);
    wall.mesh.traverse((child) => child.geometry?.dispose());
  });
  state.openings.forEach((opening) => scene.remove(opening.mesh));
  state.fixtures.forEach((fixture) => {
    scene.remove(fixture.mesh);
    fixture.mesh.traverse((child) => child.geometry?.dispose());
  });
  state.walls = [];
  state.openings = [];
  state.fixtures = [];
  colliders.length = 0;
}

function restore(serialized) {
  const data = JSON.parse(serialized);
  clearDeleteHighlight();
  clearObjects();
  data.walls.forEach((wall) => createWall(wall.start, wall.end, wall.height, wall.thickness, false));
  data.openings.forEach((opening) =>
    createOpening(opening.type, opening.wallIndex, opening.t, false, opening),
  );
  (data.fixtures || []).forEach((fixture) => createFixture(fixture, false));
  state.hoveredDelete = null;
}

function fixtureBox(group, width, height, depth, y, material = fixtureMaterial) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.y = y;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function makeFixtureMesh(fixture) {
  const group = new THREE.Group();
  if (fixture.type === "toilet") {
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(fixture.width * 0.34, fixture.width * 0.42, 0.42, 24),
      fixtureTopMaterial,
    );
    base.scale.z = 1.35;
    base.position.set(0, 0.21, fixture.depth * 0.12);
    group.add(base);
    fixtureBox(group, fixture.width * 0.82, 0.68, fixture.depth * 0.34, 0.34, applianceMaterial)
      .position.z = -fixture.depth * 0.31;
  } else if (fixture.type === "tub") {
    fixtureBox(group, fixture.width, 0.48, fixture.depth, 0.24);
    fixtureBox(
      group,
      fixture.width * 0.76,
      0.07,
      fixture.depth * 0.82,
      0.5,
      new THREE.MeshStandardMaterial({ color: 0xb9dbe4, roughness: 0.25 }),
    );
  } else if (fixture.type === "washer" || fixture.type === "dryer") {
    fixtureBox(group, fixture.width, fixture.height, fixture.depth, fixture.height / 2, applianceMaterial);
    const door = new THREE.Mesh(
      new THREE.CylinderGeometry(fixture.width * 0.27, fixture.width * 0.27, 0.035, 24),
      frameMaterial,
    );
    door.rotation.x = Math.PI / 2;
    door.position.set(0, fixture.height * 0.46, fixture.depth / 2 + 0.02);
    group.add(door);
  } else {
    fixtureBox(group, fixture.width, fixture.height, fixture.depth, fixture.height / 2);
    if (["counter", "island", "vanity"].includes(fixture.type)) {
      fixtureBox(
        group,
        fixture.width + 0.035,
        0.055,
        fixture.depth + 0.035,
        fixture.height + 0.0275,
        fixtureTopMaterial,
      );
    }
  }
  return group;
}

function createFixture(data, saveHistory = true) {
  if (saveHistory) recordHistory();
  const fixture = { locked: true, rotation: 0, ...data };
  const mesh = makeFixtureMesh(fixture);
  mesh.position.set(fixture.x, 0, fixture.z);
  mesh.rotation.y = fixture.rotation;
  mesh.userData = { kind: "fixture", ref: fixture, locked: true };
  mesh.traverse((child) => {
    child.userData = { kind: "fixture", ref: fixture, locked: true };
  });
  fixture.mesh = mesh;
  state.fixtures.push(fixture);
  scene.add(mesh);
  return fixture;
}

function createWall(start, end, height, thickness, saveHistory = true) {
  const length = wallLength(start, end);
  if (length < 0.3) return;
  if (saveHistory) recordHistory();
  const mesh = new THREE.Group();
  mesh.position.set((start.x + end.x) / 2, height / 2, (start.z + end.z) / 2);
  mesh.rotation.y = -Math.atan2(end.z - start.z, end.x - start.x);
  const wall = { start: { ...start }, end: { ...end }, height, thickness, mesh };
  mesh.userData = { kind: "wall", ref: wall };
  const hitbox = new THREE.Mesh(
    new THREE.PlaneGeometry(length, height),
    new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      colorWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  hitbox.userData = { kind: "wall-hitbox", ref: wall };
  wall.hitbox = hitbox;
  mesh.add(hitbox);
  scene.add(mesh);
  state.walls.push(wall);
  colliders.push(mesh);
  rebuildWallMesh(wall);
  return wall;
}

function addWallSegment(wall, width, height, centerX, centerY) {
  if (width <= 0.01 || height <= 0.01) return;
  const segment = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, wall.thickness),
    wallMaterial.clone(),
  );
  segment.position.set(centerX, centerY - wall.height / 2, 0);
  segment.castShadow = true;
  segment.receiveShadow = true;
  segment.userData = { kind: "wall", ref: wall };
  wall.mesh.add(segment);
}

function rebuildWallMesh(wall) {
  wall.mesh.children
    .filter((child) => child !== wall.hitbox)
    .forEach((child) => {
      child.geometry?.dispose();
      wall.mesh.remove(child);
    });

  const length = wallLength(wall.start, wall.end);
  const wallIndex = state.walls.indexOf(wall);
  const openings = state.openings
    .filter((opening) => opening.wallIndex === wallIndex)
    .map((opening) => ({
      ...opening,
      width: opening.width,
      bottom: opening.sill,
      top: opening.sill + opening.height,
      center: opening.t * length - length / 2,
    }))
    .sort((a, b) => a.center - b.center);

  let cursor = -length / 2;
  openings.forEach((opening) => {
    const left = Math.max(-length / 2, opening.center - opening.width / 2);
    const right = Math.min(length / 2, opening.center + opening.width / 2);
    addWallSegment(wall, left - cursor, wall.height, (cursor + left) / 2, wall.height / 2);

    if (opening.bottom > 0) {
      addWallSegment(wall, right - left, opening.bottom, (left + right) / 2, opening.bottom / 2);
    }
    if (opening.top < wall.height) {
      addWallSegment(
        wall,
        right - left,
        wall.height - opening.top,
        (left + right) / 2,
        opening.top + (wall.height - opening.top) / 2,
      );
    }
    cursor = Math.max(cursor, right);
  });
  addWallSegment(wall, length / 2 - cursor, wall.height, (cursor + length / 2) / 2, wall.height / 2);
}

function makeOpeningMesh(type, dimensions) {
  const group = new THREE.Group();
  if (type === "door") {
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(dimensions.width - 0.16, dimensions.height - 0.08, 0.055),
      doorMaterial,
    );
    door.position.y = dimensions.height / 2 - 0.04;
    door.castShadow = true;
    group.add(door);
    const header = new THREE.Mesh(
      new THREE.BoxGeometry(dimensions.width, 0.08, 0.1),
      frameMaterial,
    );
    header.position.y = dimensions.height - 0.04;
    group.add(header);
    for (const x of [-dimensions.width / 2 + 0.04, dimensions.width / 2 - 0.04]) {
      const side = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, dimensions.height, 0.1),
        frameMaterial,
      );
      side.position.set(x, dimensions.height / 2, 0);
      group.add(side);
    }
  } else {
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(dimensions.width - 0.14, dimensions.height - 0.14, 0.04),
      glassMaterial,
    );
    glass.position.y = dimensions.sill + dimensions.height / 2;
    group.add(glass);
    const parts = [
      [dimensions.width, 0.07, 0.1, 0, dimensions.sill + 0.035],
      [dimensions.width, 0.07, 0.1, 0, dimensions.sill + dimensions.height - 0.035],
      [0.07, dimensions.height, 0.1, -dimensions.width / 2 + 0.035, dimensions.sill + dimensions.height / 2],
      [0.07, dimensions.height, 0.1, dimensions.width / 2 - 0.035, dimensions.sill + dimensions.height / 2],
    ];
    parts.forEach(([w, h, d, x, y]) => {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), frameMaterial);
      frame.position.set(x, y, 0);
      group.add(frame);
    });
  }
  return group;
}

function defaultOpeningDimensions(type) {
  if (type === "door") return { width: 1.02, height: 2.12, sill: 0 };
  return { width: 1.2, height: 1, sill: 1 };
}

function openingPlacement(wall, wallIndex, type, t, dimensions, ignoredOpenings = []) {
  const length = wallLength(wall.start, wall.end);
  const halfT = dimensions.width / 2 / length;
  const clampedT = THREE.MathUtils.clamp(t, halfT, 1 - halfT);
  const overlaps = state.openings.some((opening) => {
    if (ignoredOpenings.includes(opening)) return false;
    if (opening.wallIndex !== wallIndex) return false;
    return Math.abs(opening.t - clampedT) * length <
      (dimensions.width + opening.width) / 2 + 0.12;
  });
  return {
    t: clampedT,
    valid:
      dimensions.width <= length &&
      dimensions.sill + dimensions.height <= wall.height &&
      !overlaps,
  };
}

function mergedWindow(wallIndex, t, dimensions) {
  const wall = state.walls[wallIndex];
  const length = wallLength(wall.start, wall.end);
  let left = t * length - dimensions.width / 2;
  let right = t * length + dimensions.width / 2;
  let bottom = dimensions.sill;
  let top = dimensions.sill + dimensions.height;
  const merged = [];

  let foundMore = true;
  while (foundMore) {
    foundMore = false;
    state.openings.forEach((opening) => {
      if (opening.type !== "window" || opening.wallIndex !== wallIndex || merged.includes(opening)) {
        return;
      }
      const openingLeft = opening.t * length - opening.width / 2;
      const openingRight = opening.t * length + opening.width / 2;
      const openingBottom = opening.sill;
      const openingTop = opening.sill + opening.height;
      const horizontallyOverlaps = left <= openingRight && right >= openingLeft;
      const verticallyOverlaps = bottom <= openingTop && top >= openingBottom;
      if (horizontallyOverlaps && verticallyOverlaps) {
        merged.push(opening);
        left = Math.min(left, openingLeft);
        right = Math.max(right, openingRight);
        bottom = Math.min(bottom, openingBottom);
        top = Math.max(top, openingTop);
        foundMore = true;
      }
    });
  }

  return {
    t: (left + right) / 2 / length,
    dimensions: { width: right - left, height: top - bottom, sill: bottom },
    merged,
  };
}

function createOpening(
  type,
  wallIndex,
  t,
  saveHistory = true,
  savedDimensions = null,
  mergeWindows = saveHistory,
) {
  const wall = state.walls[wallIndex];
  if (!wall) return;
  let dimensions = savedDimensions?.width
    ? {
        width: savedDimensions.width,
        height: savedDimensions.height,
        sill: savedDimensions.sill,
      }
    : defaultOpeningDimensions(type);
  const mergeResult =
    type === "window" && mergeWindows
      ? mergedWindow(wallIndex, t, dimensions)
      : { t, dimensions, merged: [] };
  t = mergeResult.t;
  dimensions = mergeResult.dimensions;
  const placement = openingPlacement(
    wall,
    wallIndex,
    type,
    t,
    dimensions,
    mergeResult.merged,
  );
  if (!placement.valid) {
    toast("That opening does not fit there");
    return;
  }
  t = placement.t;
  if (saveHistory) recordHistory();
  mergeResult.merged.forEach((opening) => {
    scene.remove(opening.mesh);
    state.openings.splice(state.openings.indexOf(opening), 1);
  });
  const point = {
    x: wall.start.x + (wall.end.x - wall.start.x) * t,
    z: wall.start.z + (wall.end.z - wall.start.z) * t,
  };
  const mesh = makeOpeningMesh(type, dimensions);
  mesh.position.set(point.x, 0, point.z);
  mesh.rotation.y = -Math.atan2(wall.end.z - wall.start.z, wall.end.x - wall.start.x);
  mesh.userData = { kind: "opening" };
  scene.add(mesh);
  const opening = { type, wallIndex, t, ...dimensions, mesh };
  mesh.traverse((child) => (child.userData.ref = opening));
  state.openings.push(opening);
  rebuildWallMesh(wall);
  return opening;
}

function groundPoint() {
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(floor)[0];
  if (!hit) return null;
  const snapping = document.querySelector("#snap").checked;
  const spacing = state.units === "imperial" ? 0.1524 : 0.1;
  return {
    x: snapValue(hit.point.x, snapping, spacing),
    z: snapValue(hit.point.z, snapping, spacing),
  };
}

function wallPlacementIsValid(start, end) {
  if (wallLength(start, end) < 0.3) return false;
  return !state.walls.some((wall) =>
    wallSegmentsConflict(start, end, wall.start, wall.end),
  );
}

function wallHit() {
  raycaster.setFromCamera(pointer, camera);
  return raycaster.intersectObjects(state.walls.map((wall) => wall.hitbox), false)[0];
}

function windowPointFromHit(hit) {
  const wall = hit.object.userData.ref;
  const snapping = document.querySelector("#snap").checked;
  const projected = nearestPointOnWall(hit.point, wall);
  const length = wallLength(wall.start, wall.end);
  const snapSpacing = state.units === "imperial" ? 0.1524 : 0.1;
  return {
    wall,
    wallIndex: state.walls.indexOf(wall),
    t: snapping
      ? THREE.MathUtils.clamp(
          snapValue(projected.t * length, true, snapSpacing) / length,
          0,
          1,
        )
      : projected.t,
    y: THREE.MathUtils.clamp(
      snapValue(hit.point.y, snapping, snapSpacing),
      0,
      wall.height,
    ),
  };
}

function windowAtPoint(point) {
  const wall = state.walls[point.wallIndex];
  const length = wallLength(wall.start, wall.end);
  const along = point.t * length;
  return state.openings.find((opening) => {
    if (opening.type !== "window" || opening.wallIndex !== point.wallIndex) return false;
    const center = opening.t * length;
    const insideWidth = along >= center - opening.width / 2 && along <= center + opening.width / 2;
    const insideHeight =
      point.y >= opening.sill && point.y <= opening.sill + opening.height;
    return insideWidth && insideHeight;
  });
}

function windowCandidate(hit) {
  if (!state.windowStart || !hit) return null;
  const end = windowPointFromHit(hit);
  if (end.wallIndex !== state.windowStart.wallIndex) return null;
  const wall = end.wall;
  const length = wallLength(wall.start, wall.end);

  if (state.windowStart.extensionOpening) {
    const opening = state.windowStart.extensionOpening;
    const originalLeft = opening.t * length - opening.width / 2;
    const originalRight = opening.t * length + opening.width / 2;
    const originalBottom = opening.sill;
    const originalTop = opening.sill + opening.height;
    const startAlong = state.windowStart.t * length;
    const endAlong = end.t * length;
    const horizontalMovement = endAlong - startAlong;
    const verticalMovement = end.y - state.windowStart.y;
    let left = originalLeft;
    let right = originalRight;
    let bottom = originalBottom;
    let top = originalTop;
    let direction;

    if (Math.abs(horizontalMovement) >= Math.abs(verticalMovement)) {
      if (horizontalMovement >= 0) {
        right = Math.max(originalRight, endAlong);
        direction = "RIGHT";
      } else {
        left = Math.min(originalLeft, endAlong);
        direction = "LEFT";
      }
    } else if (verticalMovement >= 0) {
      top = Math.max(originalTop, end.y);
      direction = "UP";
    } else {
      bottom = Math.min(originalBottom, end.y);
      direction = "DOWN";
    }

    const extended =
      left < originalLeft - 0.01 ||
      right > originalRight + 0.01 ||
      bottom < originalBottom - 0.01 ||
      top > originalTop + 0.01;
    const dimensions = { width: right - left, height: top - bottom, sill: bottom };
    const centerT = (left + right) / 2 / length;
    const mergeResult = mergedWindow(end.wallIndex, centerT, dimensions);
    const placement = openingPlacement(
      wall,
      end.wallIndex,
      "window",
      mergeResult.t,
      mergeResult.dimensions,
      mergeResult.merged,
    );
    return {
      type: "window",
      wallIndex: end.wallIndex,
      t: mergeResult.t,
      dimensions: mergeResult.dimensions,
      valid: extended && placement.valid,
      merged: mergeResult.merged,
      extension: true,
      direction,
      extended,
    };
  }

  const width = Math.abs(end.t - state.windowStart.t) * length;
  const height = Math.abs(end.y - state.windowStart.y);
  const dimensions = {
    width,
    height,
    sill: Math.min(end.y, state.windowStart.y),
  };
  const centerT = (end.t + state.windowStart.t) / 2;
  const mergeResult = mergedWindow(end.wallIndex, centerT, dimensions);
  const placement = openingPlacement(
    wall,
    end.wallIndex,
    "window",
    mergeResult.t,
    mergeResult.dimensions,
    mergeResult.merged,
  );
  return {
    type: "window",
    wallIndex: end.wallIndex,
    t: mergeResult.t,
    dimensions: mergeResult.dimensions,
    valid: width >= 0.3 && height >= 0.3 && placement.valid,
    merged: mergeResult.merged,
  };
}

function openingClearances(candidate) {
  const wall = state.walls[candidate.wallIndex];
  const length = wallLength(wall.start, wall.end);
  const left = candidate.t * length - candidate.dimensions.width / 2;
  const right = candidate.t * length + candidate.dimensions.width / 2;
  const ignored = candidate.merged || [];
  let leftBoundary = 0;
  let rightBoundary = length;

  state.openings.forEach((opening) => {
    if (opening.wallIndex !== candidate.wallIndex || ignored.includes(opening)) return;
    const openingLeft = opening.t * length - opening.width / 2;
    const openingRight = opening.t * length + opening.width / 2;
    if (openingRight <= left + 1e-6) leftBoundary = Math.max(leftBoundary, openingRight);
    if (openingLeft >= right - 1e-6) rightBoundary = Math.min(rightBoundary, openingLeft);
  });

  return {
    left: Math.max(0, left - leftBoundary),
    right: Math.max(0, rightBoundary - right),
  };
}

function showOpeningPreview(candidate) {
  const wall = state.walls[candidate.wallIndex];
  const length = wallLength(wall.start, wall.end);
  const point = {
    x: wall.start.x + (wall.end.x - wall.start.x) * candidate.t,
    z: wall.start.z + (wall.end.z - wall.start.z) * candidate.t,
  };
  const normal = new THREE.Vector3(
    -(wall.end.z - wall.start.z) / length,
    0,
    (wall.end.x - wall.start.x) / length,
  );
  const towardCamera = new THREE.Vector3(
    camera.position.x - point.x,
    0,
    camera.position.z - point.z,
  );
  if (normal.dot(towardCamera) < 0) normal.negate();
  const surfaceOffset = wall.thickness / 2 + 0.012;
  openingPreview.visible = true;
  openingPreview.position.set(
    point.x + normal.x * surfaceOffset,
    candidate.dimensions.sill + candidate.dimensions.height / 2,
    point.z + normal.z * surfaceOffset,
  );
  openingPreview.rotation.y = -Math.atan2(
    wall.end.z - wall.start.z,
    wall.end.x - wall.start.x,
  );
  openingPreview.scale.set(
    Math.max(candidate.dimensions.width, 0.04),
    Math.max(candidate.dimensions.height, 0.04),
    1,
  );
  openingPreview.material.color.setHex(
    candidate.extensionHover ? 0x4ba8d1 : candidate.valid ? 0x62c98d : 0xd4574f,
  );
  state.previewOpening = candidate;
  const measurement = document.querySelector("#measurement");
  const size =
    candidate.type === "door"
      ? `DOOR ${formatDistance(candidate.dimensions.width, state.units)}`
      : `WINDOW ${formatDistance(candidate.dimensions.width, state.units)} × ${formatDistance(candidate.dimensions.height, state.units)}`;
  const gaps = openingClearances(candidate);
  const spacing =
    `← ${formatDistance(gaps.left, state.units)}  |  ${size}  |  ` +
    `${formatDistance(gaps.right, state.units)} →`;
  measurement.textContent = candidate.extensionHover
    ? "CLICK WINDOW TO EXTEND"
    : candidate.extension
      ? candidate.extended
        ? `EXTEND ${candidate.direction} · ${spacing}`
        : "MOVE PAST A WINDOW EDGE"
      : candidate.merged?.length
        ? `EXTEND · ${spacing}`
        : `${candidate.valid ? "" : "BLOCKED · "}${spacing}`;
  measurement.classList.toggle("hidden", !document.querySelector("#dimensions").checked);
}

function showWindowAnchor(start) {
  const wall = state.walls[start.wallIndex];
  const length = wallLength(wall.start, wall.end);
  const point = {
    x: wall.start.x + (wall.end.x - wall.start.x) * start.t,
    z: wall.start.z + (wall.end.z - wall.start.z) * start.t,
  };
  const normal = new THREE.Vector3(
    -(wall.end.z - wall.start.z) / length,
    0,
    (wall.end.x - wall.start.x) / length,
  );
  const towardCamera = new THREE.Vector3(
    camera.position.x - point.x,
    0,
    camera.position.z - point.z,
  );
  if (normal.dot(towardCamera) < 0) normal.negate();
  const offset = wall.thickness / 2 + 0.025;
  windowAnchor.position.set(
    point.x + normal.x * offset,
    start.y,
    point.z + normal.z * offset,
  );
  windowAnchor.rotation.y = -Math.atan2(
    wall.end.z - wall.start.z,
    wall.end.x - wall.start.x,
  );
  windowAnchor.visible = true;
}

function updatePreview() {
  preview.visible = false;
  openingPreview.visible = false;
  windowAnchor.visible = false;
  state.previewOpening = null;
  state.previewWindowStart = null;

  if (state.tool === "delete") {
    updateDeleteHover();
    document.querySelector("#measurement").classList.add("hidden");
    return;
  }

  if (state.tool === "window") {
    if (state.windowStart) showWindowAnchor(state.windowStart);
    const hit = wallHit();
    if (!hit) {
      document.querySelector("#measurement").classList.add("hidden");
      return;
    }
    if (state.windowStart) {
      const candidate = windowCandidate(hit);
      if (candidate) showOpeningPreview(candidate);
      else document.querySelector("#measurement").classList.add("hidden");
      return;
    }
    const start = windowPointFromHit(hit);
    const existingWindow = windowAtPoint(start);
    if (existingWindow) start.extensionOpening = existingWindow;
    state.previewWindowStart = start;
    if (existingWindow) {
      showOpeningPreview({
        type: "window",
        wallIndex: start.wallIndex,
        t: existingWindow.t,
        dimensions: {
          width: existingWindow.width,
          height: existingWindow.height,
          sill: existingWindow.sill,
        },
        valid: true,
        extensionHover: true,
      });
    } else {
      const measurement = document.querySelector("#measurement");
      const pointGaps = openingClearances({
        type: "window",
        wallIndex: start.wallIndex,
        t: start.t,
        dimensions: { width: 0 },
        merged: [],
      });
      measurement.textContent =
        `← ${formatDistance(pointGaps.left, state.units)}  |  CLICK FIRST CORNER  |  ` +
        `${formatDistance(pointGaps.right, state.units)} →`;
      measurement.classList.toggle("hidden", !document.querySelector("#dimensions").checked);
    }
    state.previewOpening = null;
    return;
  }

  if (state.tool === "door") {
    const hit = wallHit();
    if (!hit) {
      document.querySelector("#measurement").classList.add("hidden");
      return;
    }
    const wall = hit.object.userData.ref;
    const wallIndex = state.walls.indexOf(wall);
    const projected = nearestPointOnWall(hit.point, wall);
    const dimensions = defaultOpeningDimensions("door");
    const placement = openingPlacement(wall, wallIndex, "door", projected.t, dimensions);
    showOpeningPreview({
      type: "door",
      wallIndex,
      t: placement.t,
      dimensions,
      valid: placement.valid,
    });
    return;
  }

  if (state.tool !== "wall" || !state.wallStart) {
    document.querySelector("#measurement").classList.add("hidden");
    return;
  }
  const end = groundPoint();
  if (!end) return;
  const length = wallLength(state.wallStart, end);
  const height = Number(document.querySelector("#wall-height").value);
  const thickness = Number(document.querySelector("#wall-thickness").value);
  state.previewWallValid = wallPlacementIsValid(state.wallStart, end);
  preview.visible = length > 0.05;
  preview.material.color.setHex(state.previewWallValid ? 0xd89549 : 0xd4574f);
  preview.scale.set(length, height, thickness);
  preview.position.set((state.wallStart.x + end.x) / 2, height / 2, (state.wallStart.z + end.z) / 2);
  preview.rotation.y = -Math.atan2(end.z - state.wallStart.z, end.x - state.wallStart.x);
  const measurement = document.querySelector("#measurement");
  measurement.textContent =
    `${state.previewWallValid ? "" : "BLOCKED · "}${formatDistance(length, state.units)}`;
  measurement.classList.toggle("hidden", !document.querySelector("#dimensions").checked);
}

function buildAction() {
  if (state.tool === "wall") {
    const point = groundPoint();
    if (!point) return;
    if (!state.wallStart) {
      state.wallStart = point;
      document.querySelector("#tool-help").textContent = "WALL · CLICK END POINT · RIGHT CLICK CANCEL";
    } else {
      if (!wallPlacementIsValid(state.wallStart, point)) {
        toast("Walls cannot cross or overlap existing walls");
        return;
      }
      createWall(
        state.wallStart,
        point,
        Number(document.querySelector("#wall-height").value),
        Number(document.querySelector("#wall-thickness").value),
      );
      state.wallStart = null;
      preview.visible = false;
      document.querySelector("#measurement").classList.add("hidden");
      document.querySelector("#tool-help").textContent = "WALL · CLICK START POINT";
    }
  } else if (state.tool === "window") {
    if (!state.windowStart) {
      if (!state.previewWindowStart) return toast("Aim at a wall to start the window");
      state.windowStart = { ...state.previewWindowStart };
      showWindowAnchor(state.windowStart);
      document.querySelector("#tool-help").textContent =
        state.windowStart.extensionOpening
          ? "WINDOW · MOVE PAST AN EDGE · CLICK TO EXTEND"
          : "WINDOW · CLICK OPPOSITE CORNER · RIGHT CLICK CANCEL";
      return;
    }
    const hit = wallHit();
    const candidate = windowCandidate(hit);
    if (!candidate) return toast("Finish on the same wall");
    if (!candidate.valid) {
      return toast(
        candidate.extension
          ? "Move past the window edge to extend it"
          : "Window must be at least 1' × 1' and fit on the wall",
      );
    }
    const isExtending = candidate.extension || candidate.merged.length > 0;
    createOpening("window", candidate.wallIndex, candidate.t, true, candidate.dimensions);
    state.windowStart = null;
    openingPreview.visible = false;
    windowAnchor.visible = false;
    document.querySelector("#measurement").classList.add("hidden");
    document.querySelector("#tool-help").textContent = "WINDOW · CLICK FIRST CORNER";
    toast(isExtending ? "Window extended" : "Window placed");
  } else if (state.tool === "door") {
    const candidate = state.previewOpening;
    if (!candidate) return toast("Aim at a wall to place this.");
    if (!candidate.valid) return toast("That opening does not fit there");
    createOpening(
      candidate.type,
      candidate.wallIndex,
      candidate.t,
      true,
      candidate.dimensions,
    );
    toast(`${state.tool === "door" ? "Door" : "Window"} placed`);
  } else if (state.tool === "delete") {
    deleteSelected();
  }
}

function updateDeleteHover() {
  raycaster.setFromCamera(pointer, camera);
  const openingHit = raycaster.intersectObjects(
    state.openings.map((opening) => opening.mesh),
    true,
  )[0];
  const wallHit = raycaster.intersectObjects(
    state.walls.map((wall) => wall.mesh),
    true,
  )[0];
  const hit = openingHit || wallHit;
  const nextTarget = hit?.object.userData.ref || null;
  if (nextTarget === state.hoveredDelete) return;
  clearDeleteHighlight();
  state.hoveredDelete = nextTarget;
  if (state.hoveredDelete?.mesh) {
    state.hoveredDelete.mesh.traverse((child) => {
      if (!child.isMesh || child === state.hoveredDelete.hitbox) return;
      child.userData.deleteOriginalMaterial = child.material;
      child.material = selectedMaterial;
    });
  }
}

function clearDeleteHighlight() {
  if (!state.hoveredDelete?.mesh) {
    state.hoveredDelete = null;
    return;
  }
  state.hoveredDelete.mesh.traverse((child) => {
    if (!child.userData.deleteOriginalMaterial) return;
    child.material = child.userData.deleteOriginalMaterial;
    delete child.userData.deleteOriginalMaterial;
  });
  state.hoveredDelete = null;
}

function deleteSelected() {
  const target = state.hoveredDelete || state.selected;
  if (!target) return toast("Aim at a wall, door, or window to delete it");
  recordHistory();
  clearDeleteHighlight();
  if (target.start) {
    const index = state.walls.indexOf(target);
    const nextData = {
      walls: state.walls
        .filter((_, wallIndex) => wallIndex !== index)
        .map(({ start, end, height, thickness }) => ({ start, end, height, thickness })),
      openings: state.openings
        .filter((opening) => opening.wallIndex !== index)
        .map((opening) => ({
          type: opening.type,
          wallIndex: opening.wallIndex > index ? opening.wallIndex - 1 : opening.wallIndex,
          t: opening.t,
          width: opening.width,
          height: opening.height,
          sill: opening.sill,
        })),
    };
    restore(JSON.stringify(nextData));
  } else {
    const wall = state.walls[target.wallIndex];
    scene.remove(target.mesh);
    state.openings.splice(state.openings.indexOf(target), 1);
    if (wall) rebuildWallMesh(wall);
  }
  state.selected = null;
  state.hoveredDelete = null;
  toast(`${target.type || "Wall"} deleted · Z to undo`);
}

function setTool(tool) {
  state.tool = tool;
  state.wallStart = null;
  state.windowStart = null;
  preview.visible = false;
  openingPreview.visible = false;
  windowAnchor.visible = false;
  state.previewOpening = null;
  state.previewWindowStart = null;
  clearDeleteHighlight();
  document.querySelector("#wall-controls").classList.toggle("hidden", tool !== "wall");
  document.querySelectorAll(".tool").forEach((button) => {
    button.classList.toggle("active", button.dataset.tool === tool);
  });
  document.querySelector("#tool-help").textContent =
    tool === "wall"
      ? "WALL · CLICK START POINT"
      : tool === "window"
        ? "WINDOW · CLICK FIRST CORNER"
        : tool === "delete"
          ? "DELETE · HOVER ITEM AND CLICK"
        : `${tool.toUpperCase()} · AIM AND CLICK`;
}

function toast(message) {
  const element = document.querySelector("#toast");
  element.textContent = message;
  element.classList.remove("hidden");
  clearTimeout(toast.timeout);
  toast.timeout = setTimeout(() => element.classList.add("hidden"), 1800);
}

function saveProject() {
  localStorage.setItem("roomcraft-project", snapshot());
  localStorage.setItem("roomcraft-name", document.querySelector("#project-name").value);
  toast("Project saved in this browser");
}

function loadProject() {
  const data = localStorage.getItem("roomcraft-project");
  if (!data) return toast("No saved project found");
  recordHistory();
  restore(data);
  document.querySelector("#project-name").value = localStorage.getItem("roomcraft-name") || "My Floor Plan";
  toast("Project loaded");
}

function exportProject() {
  const payload = {
    name: document.querySelector("#project-name").value,
    scale: "1 world unit = 1 meter; imperial grid = 1 foot",
    ...JSON.parse(snapshot()),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${payload.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.roomcraft.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

document.querySelectorAll(".tool").forEach((button) =>
  button.addEventListener("click", () => setTool(button.dataset.tool)),
);
document.querySelector("#save").addEventListener("click", saveProject);
document.querySelector("#load").addEventListener("click", loadProject);
document.querySelector("#export").addEventListener("click", exportProject);
document.querySelector("#imperial").addEventListener("click", () => setUnits("imperial"));
document.querySelector("#metric").addEventListener("click", () => setUnits("metric"));

function setUnits(units) {
  state.units = units;
  document.querySelector("#imperial").classList.toggle("selected", units === "imperial");
  document.querySelector("#metric").classList.toggle("selected", units === "metric");
  document.querySelector("#snap-label").textContent =
    units === "imperial" ? 'Snap to 6" grid' : "Snap to 10 cm grid";
  rebuildGrid(units);
  updateOutputs();
}

function updateOutputs() {
  document.querySelector("#height-output").textContent = formatDistance(
    Number(document.querySelector("#wall-height").value),
    state.units,
  );
  document.querySelector("#thickness-output").textContent = formatDistance(
    Number(document.querySelector("#wall-thickness").value),
    state.units,
  );
}

function toggleSnap() {
  const input = document.querySelector("#snap");
  input.checked = !input.checked;
  toast(`Grid snapping ${input.checked ? "on" : "off"} · G`);
}

function toggleDimensions() {
  const input = document.querySelector("#dimensions");
  input.checked = !input.checked;
  if (!input.checked) {
    document.querySelector("#measurement").classList.add("hidden");
  }
  toast(`Dimensions ${input.checked ? "shown" : "hidden"} · V`);
}

function toggleUnits() {
  setUnits(state.units === "imperial" ? "metric" : "imperial");
  toast(`${state.units === "imperial" ? "Imperial" : "Metric"} units · U`);
}

function adjustWallSetting(id, delta, name) {
  const input = document.querySelector(`#${id}`);
  const next = THREE.MathUtils.clamp(
    Number(input.value) + delta,
    Number(input.min),
    Number(input.max),
  );
  input.value = String(Number(next.toFixed(3)));
  updateOutputs();
  const value = formatDistance(Number(input.value), state.units);
  toast(`${name}: ${value}`);
}

document.querySelectorAll('input[type="range"]').forEach((input) => input.addEventListener("input", updateOutputs));
document.querySelector("#undo").addEventListener("click", () => {
  if (!state.undo.length) return;
  state.redo.push(snapshot());
  restore(state.undo.pop());
});
document.querySelector("#redo").addEventListener("click", () => {
  if (!state.redo.length) return;
  state.undo.push(snapshot());
  restore(state.redo.pop());
});

controls.addEventListener("lock", () => document.querySelector("#start-card").classList.add("hidden"));
controls.addEventListener("unlock", () => {
  if (projectStarted) {
    document.querySelector("#open-2d").classList.add("hidden");
    document.querySelector("#enter-world").textContent = "Resume project";
  }
  document.querySelector("#start-card").classList.remove("hidden");
});

addEventListener("keydown", (event) => {
  if (!document.querySelector("#plan-2d").classList.contains("hidden")) {
    handlePlanShortcut(event);
    return;
  }
  keys[event.code] = true;
  const isTyping =
    event.target instanceof HTMLInputElement &&
    !["range", "checkbox"].includes(event.target.type);
  if (isTyping && !(event.ctrlKey || event.metaKey)) return;

  const command = event.ctrlKey || event.metaKey;
  if (command && ["KeyS", "KeyO", "KeyE", "KeyZ", "KeyY"].includes(event.code)) {
    event.preventDefault();
  }
  if (event.repeat) return;
  if (command && event.code === "KeyS") return saveProject();
  if (command && event.code === "KeyO") return loadProject();
  if (command && event.code === "KeyE") return exportProject();
  if (command && event.code === "KeyZ") {
    document.querySelector(event.shiftKey ? "#redo" : "#undo").click();
    return;
  }
  if (command && event.code === "KeyY") {
    document.querySelector("#redo").click();
    return;
  }

  if (["Digit1", "Digit2", "Digit3", "Digit4"].includes(event.code)) {
    setTool({ Digit1: "wall", Digit2: "door", Digit3: "window", Digit4: "delete" }[event.code]);
    toast(`${state.tool[0].toUpperCase()}${state.tool.slice(1)} tool · ${event.code.slice(-1)}`);
  }
  if (event.code === "Delete" || event.code === "Backspace") {
    event.preventDefault();
    deleteSelected();
  }
  if (event.code === "KeyZ") document.querySelector("#undo").click();
  if (event.code === "KeyY") document.querySelector("#redo").click();
  if (event.code === "KeyG") toggleSnap();
  if (event.code === "KeyU") toggleUnits();
  if (event.code === "KeyV") toggleDimensions();
  if (event.code === "KeyC") setTool(state.tool);
  if (event.code === "BracketLeft") {
    adjustWallSetting(
      event.shiftKey ? "wall-thickness" : "wall-height",
      event.shiftKey ? -0.01 : -0.1,
      event.shiftKey ? "Wall thickness" : "Wall height",
    );
  }
  if (event.code === "BracketRight") {
    adjustWallSetting(
      event.shiftKey ? "wall-thickness" : "wall-height",
      event.shiftKey ? 0.01 : 0.1,
      event.shiftKey ? "Wall thickness" : "Wall height",
    );
  }
});
addEventListener("keyup", (event) => (keys[event.code] = false));
addEventListener("mousedown", (event) => {
  if (!controls.isLocked) return;
  if (event.button === 0) buildAction();
  if (event.button === 2) {
    state.wallStart = null;
    state.windowStart = null;
    preview.visible = false;
    openingPreview.visible = false;
    windowAnchor.visible = false;
    document.querySelector("#measurement").classList.add("hidden");
    setTool(state.tool);
  }
});
addEventListener("contextmenu", (event) => event.preventDefault());
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const playerVelocity = new THREE.Vector3();
function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.05);
  if (controls.isLocked) {
    const speed = (keys.ShiftLeft || keys.ShiftRight ? 5.4 : 3.2) * delta;
    playerVelocity.x *= Math.pow(0.001, delta);
    playerVelocity.z *= Math.pow(0.001, delta);
    if (keys.KeyW) controls.moveForward(speed);
    if (keys.KeyS) controls.moveForward(-speed);
    if (keys.KeyA) controls.moveRight(-speed);
    if (keys.KeyD) controls.moveRight(speed);
    camera.position.y = 1.7;
    camera.position.x = THREE.MathUtils.clamp(camera.position.x, -48, 48);
    camera.position.z = THREE.MathUtils.clamp(camera.position.z, -48, 48);
    document.querySelector("#position").textContent =
      `X ${camera.position.x.toFixed(1)} · Z ${camera.position.z.toFixed(1)}`;
    updatePreview();
  }
  renderer.render(scene, camera);
}

const svgNamespace = "http://www.w3.org/2000/svg";
const plan2d = {
  tool: "wall",
  unit: "ft",
  walls: [],
  openings: [],
  dragStart: null,
  dragEnd: null,
  selected: null,
  undo: [],
  redo: [],
};
let projectStarted = false;

function planSnapshot() {
  return JSON.stringify({ walls: plan2d.walls, openings: plan2d.openings });
}

function recordPlanHistory() {
  plan2d.undo.push(planSnapshot());
  if (plan2d.undo.length > 60) plan2d.undo.shift();
  plan2d.redo.length = 0;
}

function restorePlan(serialized) {
  const data = JSON.parse(serialized);
  plan2d.walls = data.walls;
  plan2d.openings = data.openings;
  plan2d.selected = null;
  syncPlanSelection();
  renderPlan2d();
}

function planValue(id) {
  return toMeters(document.querySelector(`#${id}`).value, plan2d.unit);
}

function planDistanceLabel(meters) {
  const value = fromMeters(meters, plan2d.unit);
  const digits = ["in", "cm"].includes(plan2d.unit) ? 1 : 2;
  return `${Number(value.toFixed(digits))} ${plan2d.unit}`;
}

function svgPoint(event) {
  const svg = document.querySelector("#plan-canvas");
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const transformed = point.matrixTransform(svg.getScreenCTM().inverse());
  if (!document.querySelector("#plan-snap").checked) return { x: transformed.x, y: transformed.y };
  const spacing = ["ft", "in"].includes(plan2d.unit) ? 0.1524 : 0.1;
  return {
    x: Math.round(transformed.x / spacing) * spacing,
    y: Math.round(transformed.y / spacing) * spacing,
  };
}

function planElement(name, attributes = {}) {
  const element = document.createElementNS(svgNamespace, name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
  return element;
}

function renderPlan2d() {
  const shapes = document.querySelector("#plan-shapes");
  const draft = document.querySelector("#plan-preview");
  shapes.replaceChildren();
  draft.replaceChildren();

  plan2d.walls.forEach((wall, wallIndex) => {
    const line = planElement("line", {
      x1: wall.start.x,
      y1: wall.start.y,
      x2: wall.end.x,
      y2: wall.end.y,
      "stroke-width": Math.max(wall.thickness, 0.055),
      class:
        plan2d.selected?.kind === "wall" && plan2d.selected.index === wallIndex
          ? "plan-wall selected"
          : "plan-wall",
    });
    shapes.append(line);
    const hit = planElement("line", {
      x1: wall.start.x,
      y1: wall.start.y,
      x2: wall.end.x,
      y2: wall.end.y,
      class: "plan-wall-hit",
      "data-wall-index": wallIndex,
    });
    shapes.append(hit);
    const middleX = (wall.start.x + wall.end.x) / 2;
    const middleY = (wall.start.y + wall.end.y) / 2 - 0.18;
    const label = planElement("text", { x: middleX, y: middleY, class: "plan-dimension" });
    label.textContent = planDistanceLabel(pointDistance(wall.start, wall.end));
    shapes.append(label);
  });

  plan2d.openings.forEach((opening, openingIndex) => {
    const wall = plan2d.walls[opening.wallIndex];
    if (!wall) return;
    const length = pointDistance(wall.start, wall.end);
    const dx = (wall.end.x - wall.start.x) / length;
    const dy = (wall.end.y - wall.start.y) / length;
    const centerX = wall.start.x + (wall.end.x - wall.start.x) * opening.t;
    const centerY = wall.start.y + (wall.end.y - wall.start.y) * opening.t;
    const half = opening.width / 2;
    const line = planElement("line", {
      x1: centerX - dx * half,
      y1: centerY - dy * half,
      x2: centerX + dx * half,
      y2: centerY + dy * half,
      "stroke-width": Math.max(wall.thickness + 0.04, 0.1),
      class:
        plan2d.selected?.kind === "opening" && plan2d.selected.index === openingIndex
          ? "plan-opening selected"
          : "plan-opening",
      "data-opening-index": openingIndex,
    });
    shapes.append(line);
  });

  if (plan2d.dragStart && plan2d.dragEnd) {
    draft.append(
      planElement("line", {
        x1: plan2d.dragStart.x,
        y1: plan2d.dragStart.y,
        x2: plan2d.dragEnd.x,
        y2: plan2d.dragEnd.y,
        class: "plan-draft",
      }),
    );
    const draftLength = pointDistance(plan2d.dragStart, plan2d.dragEnd);
    const draftLabel = planElement("text", {
      x: (plan2d.dragStart.x + plan2d.dragEnd.x) / 2,
      y: (plan2d.dragStart.y + plan2d.dragEnd.y) / 2 - 0.2,
      class: "plan-dimension",
    });
    draftLabel.textContent = planDistanceLabel(draftLength);
    draft.append(draftLabel);
  }
  document.querySelector("#plan-count").textContent =
    `${plan2d.walls.length} walls · ${plan2d.openings.length} openings`;
}

function syncPlanSelection() {
  const selectedFields = document.querySelector("#selection-fields");
  selectedFields.classList.toggle("hidden", !plan2d.selected);
  if (!plan2d.selected) return;
  const unit = plan2d.unit;
  if (plan2d.selected.kind === "wall") {
    const wall = plan2d.walls[plan2d.selected.index];
    if (!wall) {
      plan2d.selected = null;
      return syncPlanSelection();
    }
    document.querySelector("#selection-name").textContent = "Wall";
    document.querySelector("#wall-fields").classList.remove("hidden");
    document.querySelector("#room-fields").classList.add("hidden");
    document.querySelector("#opening-fields").classList.add("hidden");
    document.querySelector("#plan-length").value = Number(
      fromMeters(pointDistance(wall.start, wall.end), unit).toFixed(3),
    );
    document.querySelector("#plan-wall-height").value = Number(
      fromMeters(wall.height, unit).toFixed(3),
    );
    document.querySelector("#plan-wall-thickness").value = Number(
      fromMeters(wall.thickness, unit).toFixed(3),
    );
  } else {
    const opening = plan2d.openings[plan2d.selected.index];
    if (!opening) {
      plan2d.selected = null;
      return syncPlanSelection();
    }
    document.querySelector("#selection-name").textContent =
      opening.type === "door" ? "Door" : "Window";
    document.querySelector("#wall-fields").classList.add("hidden");
    document.querySelector("#room-fields").classList.add("hidden");
    document.querySelector("#opening-fields").classList.remove("hidden");
    document.querySelector("#sill-field").classList.toggle("hidden", opening.type !== "window");
    document.querySelector("#opening-width").value = Number(fromMeters(opening.width, unit).toFixed(3));
    document.querySelector("#opening-height").value = Number(fromMeters(opening.height, unit).toFixed(3));
    document.querySelector("#opening-sill").value = Number(fromMeters(opening.sill, unit).toFixed(3));
  }
}

function selectPlanObject(kind, index) {
  plan2d.selected = { kind, index };
  syncPlanSelection();
  renderPlan2d();
}

function clearPlanSelection() {
  plan2d.selected = null;
  syncPlanSelection();
  setPlanTool(plan2d.tool);
}

function setPlanTool(tool) {
  plan2d.tool = tool;
  plan2d.dragStart = null;
  plan2d.dragEnd = null;
  plan2d.selected = null;
  syncPlanSelection();
  document.querySelectorAll(".plan-tool").forEach((button) =>
    button.classList.toggle("active", button.dataset.planTool === tool),
  );
  document.querySelector("#wall-fields").classList.toggle("hidden", tool !== "wall");
  document.querySelector("#room-fields").classList.toggle("hidden", tool !== "room");
  document.querySelector("#opening-fields").classList.toggle(
    "hidden",
    !["door", "window"].includes(tool),
  );
  document.querySelector("#sill-field").classList.toggle("hidden", tool !== "window");
  const instructions = {
    wall: "Drag anywhere on the grid to draw a wall. Add an exact length to override the dragged distance.",
    room: "Enter the room width and depth, then click where its top-left corner should go.",
    door: "Enter the door size, then click the wall where it belongs.",
    window: "Enter the window size and sill height, then click the wall where it belongs.",
    delete: "Click a door, window, or wall to remove it.",
  };
  document.querySelector("#plan-help").textContent = instructions[tool];
  if (tool === "door") {
    document.querySelector("#opening-width").value = fromMeters(0.9144, plan2d.unit).toFixed(2);
    document.querySelector("#opening-height").value = fromMeters(2.032, plan2d.unit).toFixed(2);
  }
  if (tool === "window") {
    document.querySelector("#opening-width").value = fromMeters(1.2192, plan2d.unit).toFixed(2);
    document.querySelector("#opening-height").value = fromMeters(1.2192, plan2d.unit).toFixed(2);
    document.querySelector("#opening-sill").value = fromMeters(0.9144, plan2d.unit).toFixed(2);
  }
  renderPlan2d();
}

function wallAtPlanPoint(point, threshold = 0.3) {
  let best = null;
  plan2d.walls.forEach((wall, wallIndex) => {
    const projected = nearestPointOnPlanWall(point, wall);
    if (projected.distance <= threshold && (!best || projected.distance < best.distance)) {
      best = { ...projected, wall, wallIndex };
    }
  });
  return best;
}

function removePlanWall(wallIndex) {
  plan2d.walls.splice(wallIndex, 1);
  plan2d.openings = plan2d.openings
    .filter((opening) => opening.wallIndex !== wallIndex)
    .map((opening) => ({
      ...opening,
      wallIndex: opening.wallIndex > wallIndex ? opening.wallIndex - 1 : opening.wallIndex,
    }));
}

function deletePlanSelection() {
  if (!plan2d.selected) return;
  recordPlanHistory();
  if (plan2d.selected.kind === "wall") removePlanWall(plan2d.selected.index);
  else plan2d.openings.splice(plan2d.selected.index, 1);
  plan2d.selected = null;
  syncPlanSelection();
  renderPlan2d();
}

function addPlanOpening(point) {
  const target = wallAtPlanPoint(point);
  if (!target) return toast("Click closer to a wall");
  const width = planValue("opening-width");
  const height = planValue("opening-height");
  const sill = plan2d.tool === "window" ? planValue("opening-sill") : 0;
  const wallLengthMeters = pointDistance(target.wall.start, target.wall.end);
  if (width <= 0 || width > wallLengthMeters) return toast("That opening is wider than the wall");
  const halfT = width / 2 / wallLengthMeters;
  const t = THREE.MathUtils.clamp(target.t, halfT, 1 - halfT);
  const overlaps = plan2d.openings.some(
    (opening) =>
      opening.wallIndex === target.wallIndex &&
      Math.abs(opening.t - t) * wallLengthMeters < (opening.width + width) / 2,
  );
  if (overlaps) return toast("That opening overlaps another opening");
  recordPlanHistory();
  plan2d.openings.push({
    type: plan2d.tool,
    wallIndex: target.wallIndex,
    t,
    width,
    height,
    sill,
  });
  renderPlan2d();
}

const planCanvas = document.querySelector("#plan-canvas");
planCanvas.addEventListener("pointerdown", (event) => {
  const point = svgPoint(event);
  const openingIndex = Number(event.target.dataset.openingIndex);
  const wallIndex = Number(event.target.dataset.wallIndex);
  if (Number.isInteger(openingIndex) && plan2d.tool !== "delete") {
    selectPlanObject("opening", openingIndex);
    return;
  }
  if (plan2d.tool === "wall") {
    if (Number.isInteger(wallIndex)) {
      selectPlanObject("wall", wallIndex);
      return;
    }
    plan2d.dragStart = point;
    plan2d.dragEnd = point;
    planCanvas.setPointerCapture(event.pointerId);
    renderPlan2d();
    return;
  }
  if (plan2d.tool === "room") {
    const width = planValue("room-width");
    const depth = planValue("room-depth");
    if (width <= 0 || depth <= 0) return toast("Enter a valid room width and depth");
    recordPlanHistory();
    plan2d.walls.push(
      ...roomWalls(
        point,
        width,
        depth,
        planValue("plan-wall-height"),
        planValue("plan-wall-thickness"),
      ),
    );
    renderPlan2d();
    return;
  }
  if (["door", "window"].includes(plan2d.tool)) return addPlanOpening(point);
  if (plan2d.tool === "delete") {
    recordPlanHistory();
    if (Number.isInteger(openingIndex)) {
      plan2d.openings.splice(openingIndex, 1);
    } else {
      const target = wallAtPlanPoint(point);
      if (target) removePlanWall(target.wallIndex);
    }
    renderPlan2d();
  }
});
planCanvas.addEventListener("pointermove", (event) => {
  if (!plan2d.dragStart) return;
  const pointerEnd = svgPoint(event);
  plan2d.dragEnd = exactEndpoint(plan2d.dragStart, pointerEnd, planValue("plan-length"));
  renderPlan2d();
});
planCanvas.addEventListener("pointerup", () => {
  if (!plan2d.dragStart || !plan2d.dragEnd) return;
  if (pointDistance(plan2d.dragStart, plan2d.dragEnd) >= 0.15) {
    recordPlanHistory();
    plan2d.walls.push({
      start: plan2d.dragStart,
      end: plan2d.dragEnd,
      height: planValue("plan-wall-height"),
      thickness: planValue("plan-wall-thickness"),
    });
  }
  plan2d.dragStart = null;
  plan2d.dragEnd = null;
  renderPlan2d();
});

document.querySelectorAll(".plan-tool").forEach((button) =>
  button.addEventListener("click", () => setPlanTool(button.dataset.planTool)),
);
document.querySelector("#clear-selection").addEventListener("click", clearPlanSelection);

function applySelectedMeasurements() {
  if (!plan2d.selected) return;
  recordPlanHistory();
  if (plan2d.selected.kind === "wall") {
    const wall = plan2d.walls[plan2d.selected.index];
    const currentLength = pointDistance(wall.start, wall.end);
    const nextLength = planValue("plan-length");
    if (nextLength > 0 && currentLength > 0) {
      wall.end = {
        x: wall.start.x + ((wall.end.x - wall.start.x) / currentLength) * nextLength,
        y: wall.start.y + ((wall.end.y - wall.start.y) / currentLength) * nextLength,
      };
    }
    wall.height = planValue("plan-wall-height");
    wall.thickness = planValue("plan-wall-thickness");
    const wallLengthMeters = pointDistance(wall.start, wall.end);
    plan2d.openings
      .filter((opening) => opening.wallIndex === plan2d.selected.index)
      .forEach((opening) => {
        opening.width = Math.min(opening.width, wallLengthMeters);
        const halfT = opening.width / 2 / wallLengthMeters;
        opening.t = THREE.MathUtils.clamp(opening.t, halfT, 1 - halfT);
      });
  } else {
    const opening = plan2d.openings[plan2d.selected.index];
    const wall = plan2d.walls[opening.wallIndex];
    const maximumWidth = pointDistance(wall.start, wall.end);
    opening.width = Math.min(planValue("opening-width"), maximumWidth);
    opening.height = planValue("opening-height");
    opening.sill = opening.type === "window" ? planValue("opening-sill") : 0;
    const halfT = opening.width / 2 / maximumWidth;
    opening.t = THREE.MathUtils.clamp(opening.t, halfT, 1 - halfT);
  }
  renderPlan2d();
}

[
  "plan-length",
  "plan-wall-height",
  "plan-wall-thickness",
  "opening-width",
  "opening-height",
  "opening-sill",
].forEach((id) => document.querySelector(`#${id}`).addEventListener("change", applySelectedMeasurements));
document.querySelector("#plan-unit").addEventListener("change", (event) => {
  const previous = plan2d.unit;
  const next = event.target.value;
  [
    "plan-length",
    "room-width",
    "room-depth",
    "opening-width",
    "opening-height",
    "opening-sill",
    "plan-wall-height",
    "plan-wall-thickness",
  ].forEach((id) => {
    const input = document.querySelector(`#${id}`);
    if (input.value === "") return;
    input.value = Number(fromMeters(toMeters(input.value, previous), next).toFixed(3));
  });
  plan2d.unit = next;
  syncPlanSelection();
  renderPlan2d();
});

function handlePlanShortcut(event) {
  if (
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLSelectElement
  ) return;
  const command = event.ctrlKey || event.metaKey;
  if (command && ["KeyZ", "KeyY"].includes(event.code)) event.preventDefault();
  if ((command && event.code === "KeyZ") || (!command && event.code === "KeyZ")) {
    if (!plan2d.undo.length) return;
    plan2d.redo.push(planSnapshot());
    restorePlan(plan2d.undo.pop());
    return;
  }
  if ((command && event.code === "KeyY") || (!command && event.code === "KeyY")) {
    if (!plan2d.redo.length) return;
    plan2d.undo.push(planSnapshot());
    restorePlan(plan2d.redo.pop());
    return;
  }
  if (event.code === "Digit1") setPlanTool("wall");
  if (event.code === "Digit2") setPlanTool("door");
  if (event.code === "Digit3") setPlanTool("window");
  if (event.code === "Digit4") setPlanTool("delete");
  if (event.code === "KeyR") setPlanTool("room");
  if (event.code === "Delete" || event.code === "Backspace") deletePlanSelection();
  if (event.code === "KeyG") {
    const snap = document.querySelector("#plan-snap");
    snap.checked = !snap.checked;
    toast(`2D snapping ${snap.checked ? "on" : "off"}`);
  }
  if (event.code === "KeyU") {
    const unit = document.querySelector("#plan-unit");
    unit.value = ["ft", "in"].includes(plan2d.unit) ? "m" : "ft";
    unit.dispatchEvent(new Event("change"));
  }
  if (event.code === "Escape") {
    plan2d.dragStart = null;
    plan2d.dragEnd = null;
    clearPlanSelection();
  }
}

function startBlank3d() {
  clearObjects();
  state.undo.length = 0;
  state.redo.length = 0;
  camera.position.set(0, 1.7, 7);
  camera.lookAt(0, 1.7, 0);
  document.querySelector("#project-name").value = "Untitled Floor Plan";
  document.querySelector("#start-card").classList.add("hidden");
  projectStarted = true;
  controls.lock();
}

document.querySelector("#open-2d").addEventListener("click", () => {
  document.querySelector("#start-card").classList.add("hidden");
  document.querySelector("#plan-2d").classList.remove("hidden");
  renderPlan2d();
});
document.querySelector("#cancel-2d").addEventListener("click", () => {
  document.querySelector("#plan-2d").classList.add("hidden");
  document.querySelector("#start-card").classList.remove("hidden");
});
document.querySelector("#finish-2d").addEventListener("click", () => {
  clearObjects();
  plan2d.walls.forEach((wall) =>
    createWall(
      { x: wall.start.x, z: wall.start.y },
      { x: wall.end.x, z: wall.end.y },
      wall.height,
      wall.thickness,
      false,
    ),
  );
  plan2d.openings.forEach((opening) =>
    createOpening(opening.type, opening.wallIndex, opening.t, false, opening, false),
  );
  state.undo.length = 0;
  state.redo.length = 0;
  const points = plan2d.walls.flatMap((wall) => [wall.start, wall.end]);
  const center = points.length
    ? {
        x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
        y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
      }
    : { x: 0, y: 0 };
  camera.position.set(center.x, 1.7, center.y + 3);
  camera.lookAt(center.x, 1.7, center.y);
  document.querySelector("#project-name").value = "My Floor Plan";
  document.querySelector("#plan-2d").classList.add("hidden");
  projectStarted = true;
  controls.lock();
});
document.querySelector("#enter-world").addEventListener("click", () => {
  if (projectStarted) controls.lock();
  else startBlank3d();
});

state.undo.length = 0;
rebuildGrid(state.units);
updateOutputs();
animate();
