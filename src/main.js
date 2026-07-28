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

const grid = new THREE.GridHelper(100, 100, 0x879493, 0xb4bcba);
grid.position.y = 0.004;
grid.material.opacity = 0.48;
grid.material.transparent = true;
scene.add(grid);

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
  walls: [],
  openings: [],
  selected: null,
  undo: [],
  redo: [],
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

function snapshot() {
  return JSON.stringify({
    walls: state.walls.map(({ start, end, height, thickness }) => ({ start, end, height, thickness })),
    openings: state.openings.map(({ type, wallIndex, t }) => ({ type, wallIndex, t })),
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
    wall.mesh.geometry.dispose();
  });
  state.openings.forEach((opening) => scene.remove(opening.mesh));
  state.walls = [];
  state.openings = [];
  colliders.length = 0;
}

function restore(serialized) {
  const data = JSON.parse(serialized);
  clearObjects();
  data.walls.forEach((wall) => createWall(wall.start, wall.end, wall.height, wall.thickness, false));
  data.openings.forEach((opening) => createOpening(opening.type, opening.wallIndex, opening.t, false));
}

function createWall(start, end, height, thickness, saveHistory = true) {
  const length = wallLength(start, end);
  if (length < 0.3) return;
  if (saveHistory) recordHistory();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(length, height, thickness), wallMaterial.clone());
  mesh.position.set((start.x + end.x) / 2, height / 2, (start.z + end.z) / 2);
  mesh.rotation.y = -Math.atan2(end.z - start.z, end.x - start.x);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const wall = { start: { ...start }, end: { ...end }, height, thickness, mesh };
  mesh.userData = { kind: "wall", ref: wall };
  scene.add(mesh);
  state.walls.push(wall);
  colliders.push(mesh);
  return wall;
}

function makeOpeningMesh(type) {
  const group = new THREE.Group();
  if (type === "door") {
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.86, 2.04, 0.055), doorMaterial);
    door.position.y = 1.02;
    door.castShadow = true;
    group.add(door);
    const header = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.08, 0.1), frameMaterial);
    header.position.y = 2.08;
    group.add(header);
    for (const x of [-0.47, 0.47]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.08, 0.1), frameMaterial);
      side.position.set(x, 1.04, 0);
      group.add(side);
    }
  } else {
    const glass = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.0, 0.04), glassMaterial);
    glass.position.y = 1.55;
    group.add(glass);
    const parts = [
      [1.34, 0.07, 0.1, 0, 1.02],
      [1.34, 0.07, 0.1, 0, 2.08],
      [0.07, 1.13, 0.1, -0.635, 1.55],
      [0.07, 1.13, 0.1, 0.635, 1.55],
    ];
    parts.forEach(([w, h, d, x, y]) => {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), frameMaterial);
      frame.position.set(x, y, 0);
      group.add(frame);
    });
  }
  return group;
}

function createOpening(type, wallIndex, t, saveHistory = true) {
  const wall = state.walls[wallIndex];
  if (!wall) return;
  if (saveHistory) recordHistory();
  const point = {
    x: wall.start.x + (wall.end.x - wall.start.x) * t,
    z: wall.start.z + (wall.end.z - wall.start.z) * t,
  };
  const mesh = makeOpeningMesh(type);
  mesh.position.set(point.x, 0, point.z);
  mesh.rotation.y = -Math.atan2(wall.end.z - wall.start.z, wall.end.x - wall.start.x);
  mesh.userData = { kind: "opening" };
  scene.add(mesh);
  const opening = { type, wallIndex, t, mesh };
  mesh.traverse((child) => (child.userData.ref = opening));
  state.openings.push(opening);
  return opening;
}

function groundPoint() {
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(floor)[0];
  if (!hit) return null;
  const snapping = document.querySelector("#snap").checked;
  return { x: snapValue(hit.point.x, snapping), z: snapValue(hit.point.z, snapping) };
}

function wallHit() {
  raycaster.setFromCamera(pointer, camera);
  return raycaster.intersectObjects(state.walls.map((wall) => wall.mesh), false)[0];
}

function updatePreview() {
  if (state.tool !== "wall" || !state.wallStart) {
    preview.visible = false;
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
  } else if (state.tool === "door" || state.tool === "window") {
    const hit = wallHit();
    if (!hit) return toast("Aim at a wall to place this.");
    const wall = hit.object.userData.ref;
    const point = nearestPointOnWall(hit.point, wall);
    createOpening(state.tool, state.walls.indexOf(wall), point.t);
    toast(`${state.tool === "door" ? "Door" : "Window"} placed`);
  } else {
    selectAtCrosshair();
  }
}

function selectAtCrosshair() {
  raycaster.setFromCamera(pointer, camera);
  const objects = [
    ...state.walls.map((wall) => wall.mesh),
    ...state.openings.flatMap((opening) => opening.mesh.children),
  ];
  const hit = raycaster.intersectObjects(objects, false)[0];
  state.walls.forEach((wall) => (wall.mesh.material = wallMaterial.clone()));
  state.selected = hit?.object.userData.ref || null;
  if (state.selected?.mesh?.isMesh) state.selected.mesh.material = selectedMaterial;
  toast(state.selected ? `${state.selected.type || "Wall"} selected · Delete to remove` : "Nothing selected");
}

function deleteSelected() {
  if (!state.selected) return;
  recordHistory();
  if (state.selected.start) {
    const index = state.walls.indexOf(state.selected);
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
        })),
    };
    restore(JSON.stringify(nextData));
  } else {
    scene.remove(state.selected.mesh);
    state.openings.splice(state.openings.indexOf(state.selected), 1);
  }
  state.selected = null;
}

function setTool(tool) {
  state.tool = tool;
  state.wallStart = null;
  preview.visible = false;
  document.querySelectorAll(".tool").forEach((button) => {
    button.classList.toggle("active", button.dataset.tool === tool);
  });
  document.querySelector("#tool-help").textContent =
    tool === "wall" ? "WALL · CLICK START POINT" : `${tool.toUpperCase()} · AIM AND CLICK`;
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
controls.addEventListener("unlock", () => document.querySelector("#start-card").classList.remove("hidden"));

addEventListener("keydown", (event) => {
  keys[event.code] = true;
  if (["Digit1", "Digit2", "Digit3", "Digit4"].includes(event.code)) {
    setTool({ Digit1: "wall", Digit2: "door", Digit3: "window", Digit4: "select" }[event.code]);
  }
  if (event.code === "Delete" || event.code === "Backspace") deleteSelected();
  if ((event.ctrlKey || event.metaKey) && event.code === "KeyZ") {
    event.preventDefault();
    document.querySelector(event.shiftKey ? "#redo" : "#undo").click();
  }
});
addEventListener("keyup", (event) => (keys[event.code] = false));
addEventListener("mousedown", (event) => {
  if (!controls.isLocked) return;
  if (event.button === 0) buildAction();
  if (event.button === 2) {
    state.wallStart = null;
    preview.visible = false;
    document.querySelector("#measurement").classList.add("hidden");
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

createWall({ x: -3.05, z: 0 }, { x: 3.05, z: 0 }, 2.44, 0.15, false);
createWall({ x: -3.05, z: 0 }, { x: -3.05, z: -4.57 }, 2.44, 0.15, false);
createOpening("door", 0, 0.72, false);
createOpening("window", 1, 0.48, false);
state.undo.length = 0;
updateOutputs();
animate();
