import * as THREE from "three";
import { OrbitControls } from "./vendor/controls/OrbitControls.js";
import { RoomEnvironment } from "./vendor/environments/RoomEnvironment.js";
import { CELL_OVERVIEW, ORGANELLES } from "./cell-data.js";
import { createCellModel } from "./cell-model.js";
import { initDetailSections } from "./detail-models.js";
import { saveCanvasAsJPG } from "./capture.js";

const DURATION = 24;
const TAU = Math.PI * 2;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const params = new URLSearchParams(window.location.search);
const initialCaptureTime = params.has("t") ? Number(params.get("t")) || 0 : null;

const canvas = document.getElementById("stage");
const stageFrame = document.getElementById("stage-frame");
const infoContent = document.getElementById("info-content");
const organelleList = document.getElementById("organelle-list");
const overviewButton = document.getElementById("btn-overview");
const labelLayer = document.getElementById("label-layer");
const loader = document.getElementById("loader");
const fallback = document.getElementById("cell-fallback");

let selectedId = null;
let isolate = false;
let labelsVisible = true;
let webglReady = false;
let model = null;
let renderer = null;
let scene = null;
let camera = null;
let controls = null;
let cameraTween = null;
let rafId = 0;
let running = true;
let atlasVisible = true;

function organelleIcon(id) {
  const shapes = {
    membrane: '<circle cx="16" cy="16" r="11"/><circle cx="16" cy="16" r="8" stroke-dasharray="2 3"/>',
    cytoplasm: '<path d="M5 18c-2-8 5-13 12-12 8 1 12 8 9 15-3 6-11 7-16 3-2-1-4-3-5-6Z"/><circle cx="12" cy="13" r="1"/><circle cx="20" cy="18" r="1"/><circle cx="14" cy="22" r="1"/>',
    nucleus: '<circle cx="16" cy="16" r="11"/><circle cx="16" cy="16" r="8" stroke-dasharray="2 2"/>',
    nucleolus: '<circle cx="16" cy="16" r="10" opacity=".45"/><circle cx="16" cy="16" r="5"/>',
    mitochondria: '<path d="M5 19c-2-5 3-10 10-11 6-1 12 2 12 6 0 5-6 10-12 11-5 1-9-1-10-6Z"/><path d="M8 18c3-5 4 4 7-2s4 3 8-2"/>',
    rer: '<path d="M7 5c8 0 8 5 2 5s-6 5 2 5 9 5 2 5-5 5 2 7"/><path d="M13 4c8 1 8 5 3 6M15 14c8 1 8 5 2 6M14 24c6 0 8 2 5 4"/>',
    ser: '<path d="M5 12c4-7 10 6 15-2s7 4 3 8-13-3-15 4 9 7 15 2"/><path d="M8 6c3 0 5 2 6 4"/>',
    golgi: '<path d="M5 9c6-4 15-4 21 0M7 14c5-3 12-3 18 0M8 19c4-2 11-2 16 0M11 24c3-1 7-1 10 0"/><circle cx="25" cy="19" r="2"/>',
    lysosomes: '<circle cx="16" cy="16" r="10"/><circle cx="12" cy="13" r="2"/><circle cx="20" cy="17" r="2.5"/><circle cx="14" cy="21" r="1.5"/>',
    ribosomes: '<circle cx="10" cy="11" r="3"/><circle cx="22" cy="9" r="2.5"/><circle cx="18" cy="21" r="3.5"/><circle cx="7" cy="23" r="2"/><circle cx="26" cy="19" r="1.5"/>',
    cytoskeleton: '<path d="M16 16 5 7M16 16 26 5M16 16 28 19M16 16 21 28M16 16 6 25M16 16 4 16"/><circle cx="16" cy="16" r="3"/>',
    centrosome: '<path d="M8 9v12M12 8v12M16 9v11M20 16v12M24 15v12M28 16v10"/><path d="m10 9 14 7M7 23l17-12"/>',
  };
  return `<svg viewBox="0 0 32 32" aria-hidden="true">${shapes[id] || shapes.nucleus}</svg>`;
}

function sparkIcon() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7Z"/><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8Z"/></svg>';
}

function buildLibrary() {
  ORGANELLES.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "organ-entry";
    button.dataset.id = item.id;
    button.style.setProperty("--organelle-color", item.color);
    button.setAttribute("aria-label", `Explorar ${item.name}`);
    button.innerHTML = `
      <span class="organ-icon">${organelleIcon(item.id)}</span>
      <span class="organ-text">
        <span class="organ-name">${item.name}</span>
        <span class="organ-category">${item.category}</span>
      </span>
      <span class="organ-arrow" aria-hidden="true">›</span>`;
    button.addEventListener("click", () => selectOrganelle(item.id, true));
    organelleList.appendChild(button);
  });
}

function updateSelectionUI() {
  document.querySelectorAll(".organ-entry").forEach((button) => {
    const active = button.dataset.id === selectedId;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
    if (active) {
      const target = organelleList.scrollTop + button.getBoundingClientRect().top - organelleList.getBoundingClientRect().top
        - organelleList.clientHeight / 2 + button.clientHeight / 2;
      organelleList.scrollTo({ top: Math.max(0, target), behavior: reducedMotion ? "auto" : "smooth" });
    }
  });
  overviewButton.classList.toggle("active", !selectedId);
  overviewButton.setAttribute("aria-pressed", String(!selectedId));
  document.getElementById("caption-name").textContent = selectedId
    ? ORGANELLES.find((item) => item.id === selectedId).name
    : "Célula animal";
}

function renderInfo(item) {
  infoContent.style.setProperty("--current-color", item.color);
  infoContent.classList.remove("swap");
  void infoContent.offsetWidth;
  infoContent.classList.add("swap");
  const isOverview = item.id === "overview";
  infoContent.innerHTML = `
    <div class="info-kicker"><span class="k-dot"></span>${isOverview ? "Atlas de biología" : "Estructura celular"}</div>
    <h2 class="info-title">${item.name}</h2>
    <div class="info-en">${item.en}</div>
    <div class="info-category">${item.category}</div>
    <p class="info-desc">${item.description}</p>
    <hr class="info-divider" />
    <h3 class="facts-title">Claves para identificarla</h3>
    ${item.facts.map(([key, value]) => `
      <div class="fact-row">
        <span class="fact-key"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/></svg>${key}</span>
        <span class="fact-val">${value}</span>
      </div>`).join("")}
    <div class="note-card gold">
      <div class="note-title">${sparkIcon()}Dato clave</div>
      <p>${item.funFact}</p>
    </div>
    ${!isOverview && webglReady ? `
      <div class="info-actions">
        <button id="btn-isolate" class="action-button" type="button" aria-pressed="${isolate}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><circle cx="12" cy="12" r="5"/></svg>
          ${isolate ? "Mostrar la célula completa" : "Aislar esta estructura"}
        </button>
      </div>` : ""}
    <div class="note-card">
      <div class="note-title">${sparkIcon()}Observa en 3D</div>
      <p>${isOverview ? "Elige un organelo de la biblioteca o toca uno de los puntos del modelo para ver su nombre, estructura y función." : "La estructura seleccionada aparece iluminada. Puedes girar el modelo, acercarte o aislarla para estudiar su forma."}</p>
    </div>
    ${!isOverview ? '<button id="btn-back" class="back-link" type="button">‹ Volver a la célula completa</button>' : ""}`;

  document.getElementById("btn-back")?.addEventListener("click", showOverview);
  document.getElementById("btn-isolate")?.addEventListener("click", () => {
    isolate = !isolate;
    model?.setIsolate(selectedId, isolate);
    renderInfo(ORGANELLES.find((entry) => entry.id === selectedId));
  });
}

function selectOrganelle(id, focus = false) {
  const item = ORGANELLES.find((entry) => entry.id === id);
  if (!item) return;
  selectedId = id;
  updateSelectionUI();
  renderInfo(item);
  model?.setHighlight(id);
  model?.setIsolate(id, isolate);
  updateMarkers(0);
  if (focus && controls && camera) {
    const anchor = new THREE.Vector3(...item.anchor).multiplyScalar(0.18);
    tweenCamera(getHomeCamera(), anchor, reducedMotion ? 0.01 : 0.65);
  }
}

function showOverview() {
  selectedId = null;
  isolate = false;
  updateSelectionUI();
  renderInfo(CELL_OVERVIEW);
  model?.setHighlight(null);
  model?.setIsolate(null, false);
  updateMarkers(0);
  if (camera && controls) resetCamera();
}

overviewButton.addEventListener("click", showOverview);

function getHomeCamera() {
  const aspect = Math.max(0.4, stageFrame.clientWidth / Math.max(1, stageFrame.clientHeight));
  const distance = 10.8 * Math.max(1, 1.04 / aspect);
  return new THREE.Vector3(0, 0.72, distance);
}

function tweenCamera(position, target, duration = 0.65) {
  cameraTween = {
    fromPosition: camera.position.clone(),
    toPosition: position.clone(),
    fromTarget: controls.target.clone(),
    toTarget: target.clone(),
    elapsed: 0,
    duration,
  };
}

function resetCamera() {
  if (!camera || !controls) return;
  tweenCamera(getHomeCamera(), new THREE.Vector3(0, 0.08, 0), reducedMotion ? 0.01 : 0.65);
}

// Puntos y etiquetas HTML: siempre existe una alternativa accesible en la biblioteca.
const markers = [];
const projected = new THREE.Vector3();
const markerWorld = new THREE.Vector3();
const cameraLift = new THREE.Vector3();
let lastElapsed = 0;

function dotTexture(hex) {
  const size = 128;
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const ctx = cv.getContext("2d");
  const c = size / 2;
  const halo = ctx.createRadialGradient(c, c, 8, c, c, c);
  halo.addColorStop(0, "rgba(255,255,255,.95)");
  halo.addColorStop(0.28, hex);
  halo.addColorStop(0.45, hex);
  halo.addColorStop(0.52, "rgba(255,255,255,.9)");
  halo.addColorStop(0.65, "rgba(255,255,255,.15)");
  halo.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(cv);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function buildMarkers() {
  const layer = new THREE.Group();
  layer.name = "organelle-markers";
  scene.add(layer);
  ORGANELLES.forEach((item) => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: dotTexture(item.color), transparent: true, depthTest: false, depthWrite: false,
    }));
    sprite.renderOrder = 20;
    layer.add(sprite);
    const label = document.createElement("button");
    label.type = "button";
    label.className = "world-label";
    label.style.setProperty("--label-color", item.color);
    label.textContent = item.name;
    label.setAttribute("aria-label", `Abrir información sobre ${item.name}`);
    label.addEventListener("click", () => selectOrganelle(item.id, true));
    labelLayer.appendChild(label);
    markers.push({ item, sprite, label, world: new THREE.Vector3(...item.anchor) });
  });
}

function updateMarkers(elapsed) {
  if (!model || !camera || !renderer) return;
  lastElapsed = elapsed;
  model.root.updateMatrixWorld(true);
  const height = canvas.clientHeight || 1;
  const width = canvas.clientWidth || 1;
  markers.forEach((marker, index) => {
    markerWorld.copy(marker.world).applyMatrix4(model.root.matrixWorld);
    cameraLift.copy(camera.position).sub(markerWorld).normalize().multiplyScalar(0.18);
    marker.sprite.position.copy(markerWorld).add(cameraLift);
    const distance = camera.position.distanceTo(marker.sprite.position);
    const worldPerPixel = (2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / height;
    const selected = marker.item.id === selectedId;
    const pulse = selected && !reducedMotion ? 1 + Math.sin(elapsed * 4 + index) * 0.08 : 1;
    const pixels = (selected ? 37 : 27) * pulse;
    marker.sprite.scale.setScalar(pixels * worldPerPixel);
    marker.sprite.material.opacity = selected ? 1 : 0.88;

    projected.copy(marker.sprite.position).project(camera);
    const x = (projected.x * 0.5 + 0.5) * width;
    const y = (-projected.y * 0.5 + 0.5) * height;
    const onScreen = projected.z > -1 && projected.z < 1 && x > 20 && x < width - 20 && y > 60 && y < height - 72;
    const majorVisible = width < 620 ? ["rer", "nucleus", "golgi"].includes(marker.item.id) : marker.item.major;
    const show = labelsVisible && onScreen && (selected || (majorVisible && !selectedId));
    marker.label.hidden = !show;
    marker.label.classList.toggle("visible", show);
    marker.label.classList.toggle("selected", selected);
    marker.label.classList.toggle("left", projected.x > 0.22);
    if (show) {
      marker.label.style.left = `${x}px`;
      marker.label.style.top = `${y}px`;
    }
  });
}

function markerAtScreen(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  let nearest = null;
  let nearestDistance = 30;
  markers.forEach((marker) => {
    projected.copy(marker.sprite.position).project(camera);
    const x = rect.left + (projected.x * 0.5 + 0.5) * rect.width;
    const y = rect.top + (-projected.y * 0.5 + 0.5) * rect.height;
    const distance = Math.hypot(x - clientX, y - clientY);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = marker;
    }
  });
  return nearest;
}

function initScene() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance", preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.96;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(35, 1, 0.1, 120);
  camera.position.copy(getHomeCamera());

  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.enablePan = false;
  controls.minDistance = 5;
  controls.maxDistance = 24;
  controls.autoRotate = !reducedMotion && initialCaptureTime === null;
  controls.autoRotateSpeed = 0.52;
  controls.target.set(0, 0.08, 0);

  scene.add(new THREE.HemisphereLight(0xfff8e9, 0x536c67, 1.15));
  const key = new THREE.DirectionalLight(0xffedda, 2.35);
  key.position.set(4.5, 6.5, 7.5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xd9e8f0, 1.05);
  fill.position.set(-5, 1.5, 5);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xf2b5a3, 1.3);
  rim.position.set(-3.5, 4, -5.5);
  scene.add(rim);
  const bounce = new THREE.PointLight(0x91c4b3, 0.75, 16, 2);
  bounce.position.set(1, -4, 3);
  scene.add(bounce);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = new RoomEnvironment();
  scene.environment = pmrem.fromScene(environment, 0.04).texture;
  environment.dispose();
  pmrem.dispose();

  model = createCellModel();
  scene.add(model.root);

  const shadowCanvas = document.createElement("canvas");
  shadowCanvas.width = shadowCanvas.height = 256;
  const ctx = shadowCanvas.getContext("2d");
  const gradient = ctx.createRadialGradient(128, 128, 8, 128, 128, 128);
  gradient.addColorStop(0, "rgba(62,73,61,.24)");
  gradient.addColorStop(0.55, "rgba(62,73,61,.09)");
  gradient.addColorStop(1, "rgba(62,73,61,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);
  const shadowTexture = new THREE.CanvasTexture(shadowCanvas);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(7.4, 7.4), new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(0, -3.25, 0);
  scene.add(shadow);

  buildMarkers();
  webglReady = true;
  renderInfo(selectedId ? ORGANELLES.find((item) => item.id === selectedId) : CELL_OVERVIEW);

  const btnRotate = document.getElementById("btn-rotate");
  const btnLabels = document.getElementById("btn-labels");
  const btnReset = document.getElementById("btn-reset");
  const btnCapture = document.getElementById("btn-capture");
  let autoRotateWanted = !reducedMotion;
  let resumeTimer = 0;
  if (reducedMotion) {
    btnRotate.classList.remove("active");
    btnRotate.setAttribute("aria-pressed", "false");
  }

  btnRotate.addEventListener("click", () => {
    autoRotateWanted = !autoRotateWanted;
    controls.autoRotate = autoRotateWanted;
    btnRotate.classList.toggle("active", autoRotateWanted);
    btnRotate.setAttribute("aria-pressed", String(autoRotateWanted));
  });
  btnLabels.addEventListener("click", () => {
    labelsVisible = !labelsVisible;
    btnLabels.classList.toggle("active", labelsVisible);
    btnLabels.setAttribute("aria-pressed", String(labelsVisible));
    updateMarkers(lastElapsed);
  });
  btnReset.addEventListener("click", resetCamera);
  btnCapture.addEventListener("click", () => saveCanvasAsJPG(canvas, "atlas-celula-animal.jpg", btnCapture));
  controls.addEventListener("start", () => {
    controls.autoRotate = false;
    cameraTween = null;
    clearTimeout(resumeTimer);
  });
  controls.addEventListener("end", () => {
    clearTimeout(resumeTimer);
    resumeTimer = setTimeout(() => { if (autoRotateWanted && running) controls.autoRotate = true; }, 2200);
  });

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let down = { x: 0, y: 0, time: 0 };
  canvas.addEventListener("pointerdown", (event) => {
    down = { x: event.clientX, y: event.clientY, time: performance.now() };
    canvas.classList.add("dragging");
  });
  canvas.addEventListener("pointerup", (event) => {
    canvas.classList.remove("dragging");
    if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 7 || performance.now() - down.time > 650) return;
    const marker = markerAtScreen(event.clientX, event.clientY);
    if (marker) {
      selectOrganelle(marker.item.id, true);
      return;
    }
    const rect = canvas.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(model.pickables, false);
    if (hits.length) {
      const internal = hits.find((hit) => !["membrane", "cytoplasm"].includes(hit.object.userData.organelleId));
      const hit = internal || hits[0];
      selectOrganelle(hit.object.userData.organelleId, true);
    }
  });
  canvas.addEventListener("pointercancel", () => canvas.classList.remove("dragging"));
  canvas.addEventListener("pointermove", (event) => {
    if (event.buttons) return;
    canvas.classList.toggle("hot", Boolean(markerAtScreen(event.clientX, event.clientY)));
  });

  let homeDistance = 0;
  function resize() {
    const width = stageFrame.clientWidth;
    const height = stageFrame.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    const nextHomeDistance = getHomeCamera().z;
    if (homeDistance > 0) {
      const offset = camera.position.clone().sub(controls.target).multiplyScalar(nextHomeDistance / homeDistance);
      camera.position.copy(controls.target).add(offset);
    }
    homeDistance = nextHomeDistance;
    controls.minDistance = Math.max(4.8, nextHomeDistance * 0.45);
    controls.maxDistance = nextHomeDistance * 1.65;
    updateMarkers(lastElapsed);
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(stageFrame);
  resize();

  function renderAt(time) {
    model.update(time);
    markers.forEach((marker) => { marker.sprite.material.rotation = 0; });
    controls.update();
    model.root.updateMatrixWorld(true);
    updateMarkers(time);
    renderer.render(scene, camera);
    fallback.classList.add("ready");
    loader.classList.add("hidden");
    loader.setAttribute("aria-hidden", "true");
  }

  window.__seek = (time) => {
    running = false;
    cancelAnimationFrame(rafId);
    clearTimeout(resumeTimer);
    controls.autoRotate = false;
    controls.enableDamping = false;
    controls.update();
    cameraTween = null;
    camera.position.copy(getHomeCamera());
    controls.target.set(0, 0.08, 0);
    camera.lookAt(controls.target);
    controls.update();
    renderAt(Number(time) || 0);
    return true;
  };

  const startTime = performance.now();
  let previousTime = startTime;
  let frameTimeEMA = 16.7;
  let qualityFrame = 0;
  let qualityRatio = renderer.getPixelRatio();
  function animate() {
    if (!running) return;
    rafId = requestAnimationFrame(animate);
    const now = performance.now();
    const rawMilliseconds = now - previousTime;
    const delta = Math.min(rawMilliseconds / 1000, 0.05);
    previousTime = now;
    if (!atlasVisible) return;
    const elapsed = (now - startTime) / 1000;
    if (cameraTween) {
      cameraTween.elapsed += delta;
      const t = Math.min(1, cameraTween.elapsed / cameraTween.duration);
      const eased = 1 - Math.pow(1 - t, 3);
      camera.position.lerpVectors(cameraTween.fromPosition, cameraTween.toPosition, eased);
      controls.target.lerpVectors(cameraTween.fromTarget, cameraTween.toTarget, eased);
      if (t >= 1) cameraTween = null;
    }
    renderAt(elapsed);
    frameTimeEMA = frameTimeEMA * 0.9 + Math.min(rawMilliseconds, 1000) * 0.1;
    qualityFrame += 1;
    if (qualityFrame % 12 === 0 && frameTimeEMA > 34 && qualityRatio > 0.55) {
      qualityRatio = Math.max(0.55, qualityRatio - 0.15);
      renderer.setPixelRatio(qualityRatio);
      renderer.setSize(stageFrame.clientWidth, stageFrame.clientHeight, false);
    }
  }

  window.__cellAtlas = {
    get selectedId() { return selectedId; },
    get isolate() { return isolate; },
    get labelsVisible() { return labelsVisible; },
    get drawCalls() { return renderer.info.render.calls; },
    get triangles() { return renderer.info.render.triangles; },
    get pixelRatio() { return renderer.getPixelRatio(); },
    selectOrganelle,
    showOverview,
    model,
    ORGANELLES,
  };

  const visibilityObserver = new IntersectionObserver(([entry]) => {
    atlasVisible = entry.isIntersecting;
    if (!atlasVisible) controls.autoRotate = false;
    else if (autoRotateWanted && running && initialCaptureTime === null) controls.autoRotate = true;
  }, { rootMargin: "120px 0px", threshold: 0.01 });
  visibilityObserver.observe(stageFrame);

  if (initialCaptureTime !== null) window.__seek(initialCaptureTime);
  else animate();
  renderer.render(scene, camera);
  window.__SCENE_READY__ = true;
}

buildLibrary();
renderInfo(CELL_OVERVIEW);
updateSelectionUI();

try {
  initScene();
} catch (error) {
  loader.classList.add("hidden");
  document.getElementById("webgl-message").hidden = false;
  ["btn-rotate", "btn-labels", "btn-reset", "btn-capture"].forEach((id) => {
    const button = document.getElementById(id);
    button.disabled = true;
    button.title = "Requiere un navegador con WebGL";
  });
  console.warn("Vista 3D no disponible; se muestra la alternativa educativa.", error.message);
}

initDetailSections(reducedMotion);
