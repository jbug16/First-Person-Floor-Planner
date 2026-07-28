import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { formatDistance, nearestPointOnWall, snapValue, wallLength } from "./geometry.js";
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
  selected: null,
  hoveredDelete: null,
  undo: [],
  redo: [],
  previewOpening: null,
  previewWindowStart: null,
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
  state.walls = [];
  state.openings = [];
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
  state.hoveredDelete = null;
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
    `${formatDistance(candidate.dimensions.width, state.units)} × ${formatDistance(candidate.dimensions.height, state.units)}`;
  measurement.textContent = candidate.extensionHover
    ? "CLICK WINDOW TO EXTEND"
    : candidate.extension
      ? candidate.extended
        ? `EXTEND ${candidate.direction} TO ${size}`
        : "MOVE PAST A WINDOW EDGE"
      : candidate.merged?.length
        ? `EXTEND TO ${size}`
        : size;
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
      measurement.textContent = "CLICK FIRST CORNER";
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
  preview.visible = length > 0.05;
  preview.scale.set(length, height, thickness);
  preview.position.set((state.wallStart.x + end.x) / 2, height / 2, (state.wallStart.z + end.z) / 2);
  preview.rotation.y = -Math.atan2(end.z - state.wallStart.z, end.x - state.wallStart.x);
  const measurement = document.querySelector("#measurement");
  measurement.textContent = formatDistance(length, state.units);
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
    scale: "1 unit = 1 meter",
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
document.querySelector("#enter-world").addEventListener("click", () => controls.lock());
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
  if (!input.checked) document.querySelector("#measurement").classList.add("hidden");
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

let lastDimensionRender = 0;

function wallPointToScreen(wall, distance, y) {
  const length = wallLength(wall.start, wall.end);
  const t = THREE.MathUtils.clamp(distance / length, 0, 1);
  const point = new THREE.Vector3(
    wall.start.x + (wall.end.x - wall.start.x) * t,
    y,
    wall.start.z + (wall.end.z - wall.start.z) * t,
  );
  const cameraDirection = new THREE.Vector3();
  camera.getWorldDirection(cameraDirection);
  if (cameraDirection.dot(point.clone().sub(camera.position)) <= 0) return null;
  point.project(camera);
  if (point.z < -1 || point.z > 1) return null;
  return {
    x: (point.x * 0.5 + 0.5) * innerWidth,
    y: (-point.y * 0.5 + 0.5) * innerHeight,
  };
}

function renderAimedWallDimensions() {
  const overlay = document.querySelector("#dimension-overlay");
  if (!controls.isLocked || !document.querySelector("#dimensions").checked) {
    overlay.replaceChildren();
    return;
  }
  const now = performance.now();
  if (now - lastDimensionRender < 80) return;
  lastDimensionRender = now;

  const hit = wallHit();
  if (!hit) {
    overlay.replaceChildren();
    return;
  }
  const wall = hit.object.userData.ref;
  const wallIndex = state.walls.indexOf(wall);
  const length = wallLength(wall.start, wall.end);
  const openings = state.openings
    .filter((opening) => opening.wallIndex === wallIndex)
    .map((opening) => ({
      ...opening,
      left: opening.t * length - opening.width / 2,
      right: opening.t * length + opening.width / 2,
    }))
    .sort((a, b) => a.left - b.left);
  const labels = [
    {
      distance: length / 2,
      y: wall.height + 0.18,
      text: `WALL ${formatDistance(length, state.units)}`,
      className: "total",
    },
  ];

  let cursor = 0;
  openings.forEach((opening) => {
    const left = THREE.MathUtils.clamp(opening.left, 0, length);
    const right = THREE.MathUtils.clamp(opening.right, 0, length);
    const gap = left - cursor;
    if (gap > 0.05) {
      labels.push({
        distance: cursor + gap / 2,
        y: 0.22,
        text: formatDistance(gap, state.units),
        className: "gap",
      });
    }
    labels.push({
      distance: (left + right) / 2,
      y: opening.sill + opening.height / 2,
      text:
        `${opening.type.toUpperCase()} ${formatDistance(opening.width, state.units)}` +
        (opening.type === "window"
          ? ` × ${formatDistance(opening.height, state.units)}`
          : ""),
      className: "opening",
    });
    cursor = Math.max(cursor, right);
  });
  const finalGap = length - cursor;
  if (finalGap > 0.05) {
    labels.push({
      distance: cursor + finalGap / 2,
      y: 0.22,
      text: formatDistance(finalGap, state.units),
      className: "gap",
    });
  }

  const fragment = document.createDocumentFragment();
  labels.forEach((label) => {
    const screen = wallPointToScreen(wall, label.distance, label.y);
    if (!screen) return;
    const chip = document.createElement("span");
    chip.className = `dimension-chip ${label.className}`;
    chip.textContent = label.text;
    chip.style.left = `${screen.x}px`;
    chip.style.top = `${screen.y}px`;
    fragment.append(chip);
  });
  overlay.replaceChildren(fragment);
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
  document.querySelector("#start-card").classList.remove("hidden");
  document.querySelector("#dimension-overlay").replaceChildren();
});

addEventListener("keydown", (event) => {
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
    renderAimedWallDimensions();
  }
  renderer.render(scene, camera);
}

createWall({ x: -3.05, z: 0 }, { x: 3.05, z: 0 }, 2.44, 0.15, false);
createWall({ x: -3.05, z: 0 }, { x: -3.05, z: -4.57 }, 2.44, 0.15, false);
createOpening("door", 0, 0.72, false);
createOpening("window", 1, 0.48, false);
state.undo.length = 0;
rebuildGrid(state.units);
updateOutputs();
animate();
