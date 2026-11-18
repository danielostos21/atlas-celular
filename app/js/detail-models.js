import * as THREE from "three";
import { OrbitControls } from "./vendor/controls/OrbitControls.js";
import { mergeGeometries } from "./vendor/utils/BufferGeometryUtils.js";
import { saveCanvasAsJPG } from "./capture.js";

const TAU = Math.PI * 2;
const DURATION = 24;

const CONTENT = {
  membrane: {
    bilayer: { name: "Bicapa fosfolipídica", latin: "Phospholipid bilayer", description: "Cada fosfolípido tiene una cabeza hidrófila y dos colas hidrófobas. Al rodearse de agua, se organizan en dos capas: las cabezas quedan expuestas y las colas forman un interior que dificulta el paso libre de muchas sustancias.", label: "Propiedad", fact: "Fluida y selectivamente permeable" },
    channel: { name: "Proteína de canal", latin: "Channel protein", description: "Forma un poro hidrófilo que atraviesa la membrana. Permite que iones o moléculas específicas pasen a favor de su gradiente electroquímico. Las esferas claras del modelo representan iones atravesando el canal.", label: "Transporte", fact: "Difusión facilitada, sin consumo directo de ATP" },
    cholesterol: { name: "Colesterol", latin: "Cholesterolum", description: "Se inserta entre las colas de los fosfolípidos. Modula la fluidez y aporta estabilidad mecánica: reduce el movimiento excesivo de los lípidos y evita que la bicapa se vuelva demasiado rígida a baja temperatura.", label: "Ubicación", fact: "Distribuido dentro de ambas mitades de la bicapa" },
    glycocalyx: { name: "Glucocalix", latin: "Glycocalyx", description: "Es la capa de cadenas de carbohidratos que sobresale de la superficie externa. Participa en el reconocimiento celular, la adhesión y la protección de la membrana frente al entorno.", label: "Composición", fact: "Oligosacáridos unidos a proteínas y lípidos" },
  },
  cytoskeleton: {
    microtubules: { name: "Microtúbulos", latin: "Microtubuli", description: "Túbulos huecos formados por dímeros de α-tubulina y β-tubulina. Mantienen la organización interna, forman el huso mitótico y actúan como vías para el transporte de organelos y vesículas.", label: "Diámetro", fact: "Aproximadamente 25 nm; estructura dinámica y polarizada" },
    actin: { name: "Filamentos de actina", latin: "Filamenta actini", description: "Polímeros de actina, también llamados microfilamentos. Se concentran bajo la membrana y participan en la contracción, los cambios de forma y el movimiento celular.", label: "Diámetro", fact: "Aproximadamente 7 nm; dos hebras enrolladas" },
    intermediate: { name: "Filamentos intermedios", latin: "Filamenta intermedia", description: "Fibras resistentes que soportan tensiones mecánicas y estabilizan la célula y sus tejidos. Incluyen queratinas, vimentina y láminas nucleares, según el tipo celular y la localización.", label: "Diámetro", fact: "Aproximadamente 10 nm; gran resistencia a la tracción" },
    motor: { name: "Proteínas motoras", latin: "Kinesina et dyneina", description: "Las kinesinas y dineínas convierten energía química en movimiento sobre microtúbulos. La kinesina del modelo avanza hacia el extremo positivo arrastrando una vesícula; otras motoras se desplazan en sentido contrario.", label: "Energía", fact: "La hidrólisis de ATP impulsa los cambios conformacionales" },
  },
};

function seeded(seed) {
  return function random() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function material(color, options = {}) {
  const result = new THREE.MeshStandardMaterial({
    color,
    roughness: options.roughness ?? 0.5,
    metalness: 0.01,
    transparent: options.opacity !== undefined && options.opacity < 1,
    opacity: options.opacity ?? 1,
    side: options.side ?? THREE.FrontSide,
    depthWrite: options.depthWrite ?? true,
    emissive: 0x000000,
    emissiveIntensity: 0,
  });
  return result;
}

function curveTube(points, radius, segments = 48, radial = 7) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, false, "centripetal"), segments, radius, radial, false);
}

function makeBuilder() {
  const groups = new Map();
  const pickables = [];
  const materials = new Map();
  function register(root, id, object) {
    if (!groups.has(id)) {
      groups.set(id, new THREE.Group());
      groups.get(id).name = id;
      root.add(groups.get(id));
      materials.set(id, new Set());
    }
    const group = groups.get(id);
    group.add(object);
    object.traverse((child) => {
      if (!child.isMesh) return;
      child.userData.component = id;
      pickables.push(child);
      const list = Array.isArray(child.material) ? child.material : [child.material];
      list.forEach((item) => materials.get(id).add(item));
    });
  }
  function highlight(selected) {
    materials.forEach((set, id) => set.forEach((item) => {
      if (!item.emissive) return;
      if (id === selected) {
        item.emissive.set(item.color).multiplyScalar(0.18);
        item.emissiveIntensity = 0.85;
      } else {
        item.emissive.set(0x000000);
        item.emissiveIntensity = 0;
      }
    }));
  }
  return { groups, pickables, register, highlight };
}

function buildMembrane() {
  const random = seeded(9921);
  const root = new THREE.Group();
  const { pickables, register, highlight } = makeBuilder();
  const dummy = new THREE.Object3D();
  const nx = 13;
  const nz = 7;
  const lipidCount = nx * nz * 2;
  const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.105, 10, 8), material("#d6aa61", { roughness: 0.42 }), lipidCount);
  const tails = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.025, 0.035, 0.34, 6), material("#b88b48", { roughness: 0.65 }), lipidCount * 2);
  let headIndex = 0;
  let tailIndex = 0;
  for (let layer = 0; layer < 2; layer += 1) {
    const side = layer === 0 ? 1 : -1;
    for (let ix = 0; ix < nx; ix += 1) {
      for (let iz = 0; iz < nz; iz += 1) {
        const x = (ix - (nx - 1) / 2) * 0.43 + (iz % 2) * 0.12;
        const z = (iz - (nz - 1) / 2) * 0.43;
        const curve = 0.1 * Math.cos(x * 0.8) * Math.cos(z * 0.9);
        const jitterX = (random() - 0.5) * 0.035;
        const jitterZ = (random() - 0.5) * 0.035;
        dummy.position.set(x + jitterX, side * 0.5 + curve, z + jitterZ);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(0.92 + random() * 0.14);
        dummy.updateMatrix();
        heads.setMatrixAt(headIndex++, dummy.matrix);
        for (let tail = 0; tail < 2; tail += 1) {
          dummy.position.set(x + jitterX + (tail ? 0.047 : -0.047), side * 0.25 + curve, z + jitterZ);
          dummy.rotation.set(0, 0, side * (tail ? 0.08 : -0.08));
          dummy.scale.setScalar(1);
          dummy.updateMatrix();
          tails.setMatrixAt(tailIndex++, dummy.matrix);
        }
      }
    }
  }
  heads.instanceMatrix.needsUpdate = true;
  tails.instanceMatrix.needsUpdate = true;
  register(root, "bilayer", heads);
  register(root, "bilayer", tails);

  const cholesterol = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.045, 0.06, 0.3, 6), material("#c97755", { roughness: 0.55 }), 22);
  for (let i = 0; i < 22; i += 1) {
    dummy.position.set((random() - 0.5) * 4.6, (random() - 0.5) * 0.2, (random() - 0.5) * 2.25);
    dummy.rotation.set(random() * 0.25, random() * TAU, (random() - 0.5) * 0.5);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    cholesterol.setMatrixAt(i, dummy.matrix);
  }
  cholesterol.instanceMatrix.needsUpdate = true;
  register(root, "cholesterol", cholesterol);

  const channel = new THREE.Group();
  const channelMaterial = material("#9b75a2", { roughness: 0.42 });
  const channelGeometries = [];
  for (let i = 0; i < 7; i += 1) {
    const a = (i / 7) * TAU;
    const geometry = new THREE.CylinderGeometry(0.16, 0.18, 1.55, 12);
    geometry.translate(1.25 + Math.cos(a) * 0.35, 0, Math.sin(a) * 0.35);
    channelGeometries.push(geometry);
  }
  channel.add(new THREE.Mesh(mergeGeometries(channelGeometries), channelMaterial));
  for (const y of [-0.61, 0.61]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.07, 8, 36), channelMaterial);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(1.25, y, 0);
    channel.add(ring);
  }
  const ions = [];
  for (let i = 0; i < 3; i += 1) {
    const ion = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 9), material("#8dc6c4", { roughness: 0.3 }));
    ion.position.set(1.25, 1.5 - i, 0);
    channel.add(ion);
    ions.push(ion);
  }
  register(root, "channel", channel);

  const glycocalyx = new THREE.Group();
  const proteinMaterial = material("#5d938c", { roughness: 0.48 });
  const glycoMaterial = material("#75b7aa", { roughness: 0.42 });
  const glycoprotein = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 1.5, 16), proteinMaterial);
  glycoprotein.position.set(-1.45, 0.05, -0.15);
  glycocalyx.add(glycoprotein);
  const chains = [
    [[-1.45,0.8,-0.15],[-1.48,1.12,-0.12],[-1.32,1.42,-0.1],[-1.4,1.72,-0.06],[-1.25,1.96,0]],
    [[-1.4,1.38,-0.1],[-1.7,1.5,-0.12],[-1.9,1.7,-0.08]],
    [[-1.35,1.65,-0.08],[-1.05,1.75,-0.04],[-0.92,1.94,0]],
  ];
  chains.forEach((points) => {
    const vectors = points.map((point) => new THREE.Vector3(...point));
    glycocalyx.add(new THREE.Mesh(curveTube(vectors, 0.025, 24, 6), glycoMaterial));
    vectors.slice(1).forEach((point, index) => {
      const bead = new THREE.Mesh(new THREE.SphereGeometry(0.075 + index * 0.006, 10, 8), glycoMaterial);
      bead.position.copy(point);
      glycocalyx.add(bead);
    });
  });
  register(root, "glycocalyx", glycocalyx);

  root.rotation.y = -0.18;
  function update(time) {
    const phase = (time / DURATION) * TAU;
    root.rotation.y = -0.18 + Math.cos(phase) * 0.06;
    ions.forEach((ion, index) => {
      const progress = ((time / 8) + index / 3) % 1;
      ion.position.y = 1.55 - progress * 3.1;
      ion.scale.setScalar(0.85 + Math.sin(progress * Math.PI) * 0.25);
    });
  }
  update(0);
  return { root, pickables, highlight, update, home: new THREE.Vector3(5.8, 4.4, 7.4), target: new THREE.Vector3(0, 0.15, 0) };
}

function buildCytoskeleton() {
  const root = new THREE.Group();
  const { pickables, register, highlight } = makeBuilder();
  const origin = new THREE.Vector3(-1.35, 0, 0);
  const microMaterial = material("#739d6b", { roughness: 0.5 });
  const microGeometries = [];
  const motorPathPoints = [origin.clone(), new THREE.Vector3(-0.3,0.25,0.15), new THREE.Vector3(1.15,0.75,0.1), new THREE.Vector3(2.3,1.05,-0.1)];
  const motorCurve = new THREE.CatmullRomCurve3(motorPathPoints, false, "centripetal");
  microGeometries.push(new THREE.TubeGeometry(motorCurve, 64, 0.08, 9, false));
  const endpoints = [[1.8,-1.1,0.5],[0.7,1.8,-0.5],[-0.3,-2,0.1],[1.9,0.1,-1.3],[-2.6,1.3,0.4],[-2.3,-1.5,-0.7]];
  endpoints.forEach((point, index) => {
    const end = new THREE.Vector3(...point);
    const mid = origin.clone().lerp(end, 0.5);
    mid.z += index % 2 ? 0.35 : -0.2;
    microGeometries.push(curveTube([origin.clone(), mid, end], 0.065, 48, 8));
  });
  register(root, "microtubules", new THREE.Mesh(mergeGeometries(microGeometries), microMaterial));

  const centrioleMaterial = material("#668365", { roughness: 0.52 });
  const centrioles = new THREE.Group();
  for (let i = 0; i < 2; i += 1) {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.65, 12, 1, true), centrioleMaterial);
    barrel.position.copy(origin).add(new THREE.Vector3(i * 0.25 - 0.1, i * -0.2, 0));
    barrel.rotation.set(i ? Math.PI / 2 : 0.2, 0.2, i ? 0.2 : Math.PI / 2);
    centrioles.add(barrel);
  }
  register(root, "microtubules", centrioles);

  const actinGeometries = [];
  for (let strand = 0; strand < 2; strand += 1) {
    const points = Array.from({ length: 100 }, (_, index) => {
      const t = index / 99;
      const a = t * TAU * 8 + strand * Math.PI;
      return new THREE.Vector3(-2.3 + t * 4.5, -1.45 + Math.sin(t * Math.PI) * 0.28 + Math.sin(a) * 0.075, 0.65 + Math.cos(a) * 0.075);
    });
    actinGeometries.push(curveTube(points, 0.027, 128, 6));
  }
  register(root, "actin", new THREE.Mesh(mergeGeometries(actinGeometries), material("#ca7c6d", { roughness: 0.55 })));

  const intermediateGeometries = [];
  for (let strand = 0; strand < 4; strand += 1) {
    const points = Array.from({ length: 70 }, (_, index) => {
      const t = index / 69;
      const a = t * TAU * 3 + (strand / 4) * TAU;
      return new THREE.Vector3(-2.25 + t * 4.1, 1.45 - t * 1.25 + Math.sin(a) * 0.055, -0.85 + Math.sin(t * Math.PI) * 0.5 + Math.cos(a) * 0.055);
    });
    intermediateGeometries.push(curveTube(points, 0.035, 88, 6));
  }
  register(root, "intermediate", new THREE.Mesh(mergeGeometries(intermediateGeometries), material("#6e87ad", { roughness: 0.55 })));

  const motor = new THREE.Group();
  const motorMaterial = material("#bd9047", { roughness: 0.45 });
  const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.38, 7), motorMaterial);
  stalk.position.y = 0.24;
  motor.add(stalk);
  for (const x of [-0.075, 0.075]) {
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 9), motorMaterial);
    head.position.set(x, 0.05, 0);
    motor.add(head);
  }
  const cargo = new THREE.Mesh(new THREE.SphereGeometry(0.24, 20, 14), material("#d3a95d", { opacity: 0.88, roughness: 0.4 }));
  cargo.position.y = 0.57;
  motor.add(cargo);
  register(root, "motor", motor);

  root.rotation.y = 0.12;
  function update(time) {
    const phase = (time / DURATION) * TAU;
    root.rotation.y = 0.12 + Math.cos(phase) * 0.055;
    const progress = (time / 12) % 1;
    const point = motorCurve.getPoint(progress);
    motor.position.copy(point);
    motor.position.y += 0.1;
    motor.rotation.y = Math.sin(progress * TAU) * 0.2;
    cargo.scale.setScalar(0.96 + Math.sin(phase * 2) * 0.04);
  }
  update(0);
  return { root, pickables, highlight, update, home: new THREE.Vector3(5.4, 3.9, 7.5), target: new THREE.Vector3(0, 0, 0) };
}

class DetailScene {
  constructor(name, builder, reducedMotion) {
    this.name = name;
    this.builder = builder;
    this.reducedMotion = reducedMotion;
    this.canvas = document.getElementById(`${name}-canvas`);
    this.stage = document.getElementById(`${name}-stage`);
    this.loader = document.getElementById(`${name}-loader`);
    this.info = document.getElementById(`${name}-detail-info`);
    this.buttons = [...document.querySelectorAll(`#${name}-components .component-button`)];
    this.selected = this.buttons[0]?.dataset.component;
    this.initialized = false;
    this.visible = false;
    this.running = false;
    this.manual = false;
    this.autoRotateWanted = !reducedMotion;
    this.startTime = performance.now();
    this.raf = 0;
    this.buttons.forEach((button) => button.addEventListener("click", () => this.select(button.dataset.component)));
    this.select(this.selected);
  }

  getHome() {
    const aspect = Math.max(0.45, this.stage.clientWidth / Math.max(1, this.stage.clientHeight));
    const scale = Math.max(1, 1.08 / aspect);
    return this.model.home.clone().multiplyScalar(scale);
  }

  init() {
    if (this.initialized) return;
    this.initialized = true;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.15));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.setClearColor(0x000000, 0);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.autoRotate = this.autoRotateWanted;
    this.controls.autoRotateSpeed = 0.55;
    this.controls.minDistance = 4.5;
    this.controls.maxDistance = 18;

    this.scene.add(new THREE.HemisphereLight(0xfff7e8, 0x526860, 1.3));
    const key = new THREE.DirectionalLight(0xffecd6, 2.5);
    key.position.set(4, 6, 7);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xd7e8ef, 1.15);
    fill.position.set(-5, 2, 4);
    this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0xeeb4a4, 1.2);
    rim.position.set(-3, 4, -5);
    this.scene.add(rim);

    this.model = this.builder();
    this.scene.add(this.model.root);
    this.camera.position.copy(this.getHome());
    this.controls.target.copy(this.model.target);
    this.controls.update();
    this.model.highlight(this.selected);
    this.bindPointer();
    this.homeDistance = 0;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.stage);
    this.resize();
    this.render(0);
    this.loader.classList.add("hidden");
    this.loader.setAttribute("aria-hidden", "true");
  }

  resize() {
    if (!this.renderer) return;
    const width = this.stage.clientWidth;
    const height = this.stage.clientHeight;
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    const nextHomeDistance = this.getHome().length();
    if (this.homeDistance > 0) {
      const offset = this.camera.position.clone().sub(this.controls.target).multiplyScalar(nextHomeDistance / this.homeDistance);
      this.camera.position.copy(this.controls.target).add(offset);
    }
    this.homeDistance = nextHomeDistance;
    this.controls.minDistance = Math.max(4.5, nextHomeDistance * 0.45);
    this.controls.maxDistance = nextHomeDistance * 1.65;
    this.render(this.reducedMotion && !this.manual ? 0 : (performance.now() - this.startTime) / 1000);
  }

  select(id) {
    if (!CONTENT[this.name][id]) return;
    this.selected = id;
    this.buttons.forEach((button) => {
      const active = button.dataset.component === id;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    const item = CONTENT[this.name][id];
    this.info.classList.remove("swap");
    void this.info.offsetWidth;
    this.info.classList.add("swap");
    this.info.innerHTML = `<h4>${item.name}</h4><div class="component-latin">${item.latin}</div><p>${item.description}</p><div class="component-fact"><strong>${item.label}:</strong><span>${item.fact}</span></div>`;
    this.model?.highlight(id);
  }

  bindPointer() {
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let down = { x: 0, y: 0 };
    this.canvas.addEventListener("pointerdown", (event) => { down = { x: event.clientX, y: event.clientY }; });
    this.canvas.addEventListener("pointerup", (event) => {
      if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 7) return;
      const rect = this.canvas.getBoundingClientRect();
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, this.camera);
      const hit = raycaster.intersectObjects(this.model.pickables, false)[0];
      if (hit) this.select(hit.object.userData.component);
    });
    this.controls.addEventListener("start", () => { this.controls.autoRotate = false; });
    this.controls.addEventListener("end", () => {
      clearTimeout(this.resumeTimer);
      this.resumeTimer = setTimeout(() => { if (this.autoRotateWanted && !this.manual) this.controls.autoRotate = true; }, 1800);
    });
  }

  toggleRotate(button) {
    this.autoRotateWanted = !this.autoRotateWanted;
    if (this.controls) this.controls.autoRotate = this.autoRotateWanted;
    button.classList.toggle("active", this.autoRotateWanted);
    button.setAttribute("aria-pressed", String(this.autoRotateWanted));
  }

  reset() {
    if (!this.initialized) this.init();
    this.camera.position.copy(this.getHome());
    this.controls.target.copy(this.model.target);
    this.controls.update();
    this.render(this.reducedMotion && !this.manual ? 0 : (performance.now() - this.startTime) / 1000);
  }

  capture(button) {
    if (!this.initialized) this.init();
    const filename = this.name === "membrane" ? "atlas-membrana-celular.jpg" : "atlas-citoesqueleto.jpg";
    return saveCanvasAsJPG(this.canvas, filename, button);
  }

  render(time) {
    if (!this.renderer) return;
    this.model.update(time);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  start() {
    if (this.running || this.manual) return;
    this.running = true;
    const tick = () => {
      if (!this.visible || this.manual) {
        this.running = false;
        return;
      }
      this.raf = requestAnimationFrame(tick);
      this.render(this.reducedMotion ? 0 : (performance.now() - this.startTime) / 1000);
    };
    tick();
  }

  setVisible(visible, prepare = visible) {
    this.visible = visible;
    if (prepare) {
      try { this.init(); }
      catch (error) {
        this.loader.textContent = "El modelo 3D no está disponible; usa la guía de componentes.";
        console.warn(`Modelo ${this.name} no disponible.`, error.message);
        return;
      }
    }
    if (visible) this.start();
    else {
      this.running = false;
      cancelAnimationFrame(this.raf);
    }
  }

  seek(time) {
    if (!this.initialized) this.init();
    this.manual = true;
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.controls.autoRotate = false;
    this.controls.enableDamping = false;
    this.controls.update();
    this.camera.position.copy(this.getHome());
    this.controls.target.copy(this.model.target);
    this.controls.update();
    this.render(time);
  }
}

export function initDetailSections(reducedMotion) {
  const models = {
    membrane: new DetailScene("membrane", buildMembrane, reducedMotion),
    cytoskeleton: new DetailScene("cytoskeleton", buildCytoskeleton, reducedMotion),
  };
  if (reducedMotion) {
    document.querySelectorAll('[data-detail-action="rotate"]').forEach((button) => {
      button.classList.remove("active");
      button.setAttribute("aria-pressed", "false");
    });
  }
  const sectionsToObserve = [document.getElementById("membrana"), document.getElementById("citoesqueleto")];
  const modelForSection = (section) => models[section.id === "membrana" ? "membrane" : "cytoskeleton"];
  const preloadObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const model = modelForSection(entry.target);
      if (entry.isIntersecting && model && !model.initialized) model.setVisible(false, true);
    });
  }, { rootMargin: "160px 0px", threshold: 0.01 });
  const visibilityObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => modelForSection(entry.target)?.setVisible(entry.isIntersecting));
  }, { threshold: 0.02 });
  sectionsToObserve.forEach((section) => {
    preloadObserver.observe(section);
    visibilityObserver.observe(section);
  });

  document.querySelectorAll("[data-detail-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const model = models[button.dataset.target];
      if (!model.initialized) model.init();
      if (button.dataset.detailAction === "rotate") model.toggleRotate(button);
      else if (button.dataset.detailAction === "capture") model.capture(button);
      else model.reset();
    });
  });

  const navLinks = [...document.querySelectorAll(".atlas-nav a")];
  const sections = [document.getElementById("atlas-general"), document.getElementById("membrana"), document.getElementById("citoesqueleto")];
  let navScheduled = false;
  function updateNavigation() {
    navScheduled = false;
    let active = sections[0].id;
    sections.forEach((section) => { if (section.getBoundingClientRect().top <= window.innerHeight * 0.42) active = section.id; });
    navLinks.forEach((link) => link.classList.toggle("active", link.getAttribute("href") === `#${active}`));
  }
  window.addEventListener("scroll", () => {
    if (!navScheduled) {
      navScheduled = true;
      requestAnimationFrame(updateNavigation);
    }
  }, { passive: true });
  updateNavigation();

  window.__detailAtlas = {
    models,
    select: (name, id) => models[name]?.select(id),
    seek: (time) => Object.values(models).forEach((model) => model.seek(time)),
  };
  return models;
}
