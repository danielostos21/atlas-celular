import * as THREE from "three";
import { mergeGeometries } from "./vendor/utils/BufferGeometryUtils.js";

const TAU = Math.PI * 2;
const DURATION = 24;

function mulberry32(seed) {
  return function random() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cutSphereGeometry(radius, cutZ, width = 56, height = 36) {
  const positions = [];
  const normals = [];
  const indices = [];
  for (let y = 0; y <= height; y += 1) {
    const theta = (y / height) * Math.PI;
    for (let x = 0; x <= width; x += 1) {
      const phi = (x / width) * TAU;
      const nx = Math.sin(theta) * Math.cos(phi);
      const ny = Math.cos(theta);
      const nz = Math.sin(theta) * Math.sin(phi);
      positions.push(radius * nx, radius * ny, radius * nz);
      normals.push(nx, ny, nz);
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const a = y * (width + 1) + x;
      const b = a + width + 1;
      const c = b + 1;
      const d = a + 1;
      const z = (positions[a * 3 + 2] + positions[b * 3 + 2] + positions[c * 3 + 2] + positions[d * 3 + 2]) / 4;
      if (z <= cutZ) indices.push(a, b, d, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

function standard(color, options = {}) {
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: options.roughness ?? 0.52,
    metalness: options.metalness ?? 0.02,
    transparent: options.opacity !== undefined && options.opacity < 1,
    opacity: options.opacity ?? 1,
    side: options.side ?? THREE.FrontSide,
    depthWrite: options.depthWrite ?? true,
    emissive: 0x000000,
    emissiveIntensity: 0,
    envMapIntensity: 0.48,
  });
  material.userData.baseOpacity = material.opacity;
  return material;
}

function tube(points, radius, segments = 48, radial = 7, closed = false) {
  const curve = new THREE.CatmullRomCurve3(points, closed, "centripetal");
  return new THREE.TubeGeometry(curve, segments, radius, radial, closed);
}

function arcPoints(center, radius, start, end, count, yScale = 1, zWave = 0) {
  return Array.from({ length: count }, (_, i) => {
    const a = start + (end - start) * (i / (count - 1));
    return new THREE.Vector3(
      center[0] + radius * Math.cos(a),
      center[1] + radius * Math.sin(a) * yScale,
      center[2] + Math.sin(a * 2) * zWave,
    );
  });
}

export function createCellModel() {
  const random = mulberry32(41721);
  const root = new THREE.Group();
  root.name = "animal-cell";
  const groups = new Map();
  const pickables = [];
  const materials = new Map();
  const floaters = [];

  function groupFor(id) {
    if (!groups.has(id)) {
      const group = new THREE.Group();
      group.name = id;
      groups.set(id, group);
      materials.set(id, new Set());
      root.add(group);
    }
    return groups.get(id);
  }

  function register(id, object, pickable = true) {
    const group = groupFor(id);
    group.add(object);
    object.traverse((child) => {
      if (!child.isMesh) return;
      child.userData.organelleId = id;
      if (pickable) pickables.push(child);
      const list = Array.isArray(child.material) ? child.material : [child.material];
      list.forEach((material) => materials.get(id).add(material));
    });
    return object;
  }

  function addCutShell(id, radius, cutZ, color, opacity, position = [0, 0, 0], rimRadius = 0.065) {
    const assembly = new THREE.Group();
    const shell = new THREE.Mesh(
      cutSphereGeometry(radius, cutZ),
      standard(color, { opacity, side: THREE.DoubleSide, depthWrite: false, roughness: 0.38 }),
    );
    shell.renderOrder = 1;
    assembly.add(shell);
    const ringRadius = Math.sqrt(radius * radius - cutZ * cutZ);
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(ringRadius, rimRadius, 10, 128),
      standard(color, { opacity: Math.min(1, opacity + 0.35), roughness: 0.42 }),
    );
    rim.position.z = cutZ;
    assembly.add(rim);
    assembly.position.set(...position);
    register(id, assembly);
    return assembly;
  }

  // Membrana: corte frontal y doble borde con fosfolípidos.
  addCutShell("membrane", 3.15, 0.95, "#438f8c", 0.36, [0, 0, 0], 0.075);
  addCutShell("cytoplasm", 3.01, 0.91, "#8abb9f", 0.09, [0, 0, 0], 0.035);

  const lipidGeometry = new THREE.SphereGeometry(0.036, 7, 6);
  const lipidMaterial = standard("#b7d6c4", { opacity: 0.82, roughness: 0.45 });
  const lipids = new THREE.InstancedMesh(lipidGeometry, lipidMaterial, 144);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < 72; i += 1) {
    const a = (i / 72) * TAU;
    const outerR = Math.sqrt(3.15 ** 2 - 0.95 ** 2);
    dummy.position.set(outerR * Math.cos(a), outerR * Math.sin(a), 0.99);
    dummy.updateMatrix();
    lipids.setMatrixAt(i, dummy.matrix);
    dummy.position.set(2.86 * Math.cos(a), 2.86 * Math.sin(a), 0.87);
    dummy.updateMatrix();
    lipids.setMatrixAt(i + 72, dummy.matrix);
  }
  lipids.instanceMatrix.needsUpdate = true;
  register("membrane", lipids);

  // Núcleo con envoltura recortada, poros y nucléolo visible.
  const nucleusCenter = [-0.55, 0.32, -0.15];
  addCutShell("nucleus", 1.16, 0.36, "#a4779c", 0.68, nucleusCenter, 0.048);
  addCutShell("nucleus", 1.04, 0.32, "#c095b0", 0.19, nucleusCenter, 0.025);

  const poreGeometry = new THREE.SphereGeometry(0.035, 7, 5);
  const pores = new THREE.InstancedMesh(poreGeometry, standard("#694d71", { opacity: 0.9 }), 38);
  for (let i = 0; i < 38; i += 1) {
    const theta = Math.acos(1 - 2 * random());
    const phi = random() * TAU;
    const normal = new THREE.Vector3(Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi));
    if (normal.z > 0.25) normal.z = -normal.z;
    normal.normalize().multiplyScalar(1.17).add(new THREE.Vector3(...nucleusCenter));
    dummy.position.copy(normal);
    dummy.scale.setScalar(0.75 + random() * 0.45);
    dummy.updateMatrix();
    pores.setMatrixAt(i, dummy.matrix);
  }
  dummy.scale.setScalar(1);
  pores.instanceMatrix.needsUpdate = true;
  register("nucleus", pores);

  const nucleolus = new THREE.Mesh(new THREE.SphereGeometry(0.4, 40, 28), standard("#d58b78", { roughness: 0.58 }));
  nucleolus.position.set(-0.48, 0.28, 0.38);
  register("nucleolus", nucleolus);

  // Retículo endoplásmico rugoso: cisternas curvas y ribosomas adheridos.
  const rerGroup = new THREE.Group();
  const rerMaterial = standard("#5f94a8", { roughness: 0.5 });
  const rerCurves = [];
  const rerGeometries = [];
  for (let layer = 0; layer < 5; layer += 1) {
    const radius = 1.36 + layer * 0.145;
    const points = arcPoints([-0.55, 0.32, -0.42 + layer * 0.065], radius, Math.PI * 0.43, Math.PI * 1.58, 40, 0.82, 0.12);
    const curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
    rerCurves.push(curve);
    rerGeometries.push(new THREE.TubeGeometry(curve, 64, 0.052, 6, false));
  }
  rerGroup.add(new THREE.Mesh(mergeGeometries(rerGeometries), rerMaterial));
  const attachedRibosomes = new THREE.InstancedMesh(new THREE.SphereGeometry(0.027, 6, 5), standard("#d4b469", { roughness: 0.7 }), 90);
  let attachedIndex = 0;
  rerCurves.forEach((curve, layer) => {
    for (let j = 0; j < 18; j += 1) {
      const point = curve.getPoint((j + 0.35) / 18);
      point.z += 0.065 + (j % 2) * 0.015;
      point.y += (layer % 2 ? 1 : -1) * 0.025;
      dummy.position.copy(point);
      dummy.scale.setScalar(0.85 + random() * 0.35);
      dummy.updateMatrix();
      attachedRibosomes.setMatrixAt(attachedIndex++, dummy.matrix);
    }
  });
  attachedRibosomes.instanceMatrix.needsUpdate = true;
  rerGroup.add(attachedRibosomes);
  register("rer", rerGroup);

  // Retículo liso: túbulos conectados sin gránulos.
  const serGroup = new THREE.Group();
  const serMaterial = standard("#7aa184", { roughness: 0.54 });
  const serGeometries = [];
  for (let layer = 0; layer < 5; layer += 1) {
    const points = Array.from({ length: 28 }, (_, j) => {
      const a = (j / 28) * TAU;
      const r = 0.48 + layer * 0.055;
      return new THREE.Vector3(
        1.45 + r * Math.cos(a),
        0.62 + (layer - 2) * 0.11 + 0.29 * Math.sin(a * 2 + layer * 0.4),
        -0.42 + 0.19 * Math.sin(a) + layer * 0.035,
      );
    });
    serGeometries.push(tube(points, 0.043, 48, 6, true));
  }
  serGroup.add(new THREE.Mesh(mergeGeometries(serGeometries), serMaterial));
  register("ser", serGroup);

  // Aparato de Golgi: seis cisternas apiladas y vesículas cercanas.
  const golgiGroup = new THREE.Group();
  const golgiMaterial = standard("#a77fa8", { roughness: 0.48 });
  const golgiGeometries = [];
  for (let layer = 0; layer < 6; layer += 1) {
    const radius = 0.88 - layer * 0.065;
    const points = arcPoints([0.72, -1.48 + layer * 0.135, 0.52 + layer * 0.025], radius, Math.PI * 0.08, Math.PI * 0.94, 32, 0.34, 0.22);
    golgiGeometries.push(tube(points, 0.065, 48, 7));
  }
  golgiGroup.add(new THREE.Mesh(mergeGeometries(golgiGeometries), golgiMaterial));
  const vesicles = new THREE.InstancedMesh(new THREE.SphereGeometry(0.085, 12, 9), standard("#c29aba", { opacity: 0.88 }), 12);
  for (let i = 0; i < 12; i += 1) {
    const a = random() * TAU;
    dummy.position.set(0.72 + Math.cos(a) * (0.7 + random() * 0.45), -1.1 + (random() - 0.5) * 0.9, 0.55 + (random() - 0.5) * 0.55);
    dummy.scale.setScalar(0.55 + random() * 0.65);
    dummy.updateMatrix();
    vesicles.setMatrixAt(i, dummy.matrix);
  }
  dummy.scale.setScalar(1);
  vesicles.instanceMatrix.needsUpdate = true;
  golgiGroup.add(vesicles);
  register("golgi", golgiGroup);

  // Mitocondrias con envoltura translúcida y crestas internas sinuosas.
  const mitochondriaPositions = [
    [1.9, 1.15, 0.35, -0.65],
    [-1.95, -1.18, 0.5, 0.75],
    [-1.9, 1.45, -0.2, 0.4],
    [1.75, -0.45, -0.5, -0.35],
  ];
  mitochondriaPositions.forEach(([x, y, z, angle], index) => {
    const mito = new THREE.Group();
    const shell = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.235, 0.72, 8, 20),
      standard(index % 2 ? "#cf7438" : "#db8844", { opacity: 0.82, depthWrite: false, roughness: 0.38, side: THREE.DoubleSide }),
    );
    mito.add(shell);
    const cristaPoints = Array.from({ length: 32 }, (_, j) => {
      const t = j / 31;
      return new THREE.Vector3(0.12 * Math.sin(t * TAU * 4.5), -0.36 + t * 0.72, 0.105 * Math.cos(t * TAU * 4.5));
    });
    mito.add(new THREE.Mesh(tube(cristaPoints, 0.026, 64, 6), standard("#f2c16f", { roughness: 0.52 })));
    mito.position.set(x, y, z);
    mito.rotation.set(0.35, index * 0.42, angle);
    mito.scale.setScalar(0.92 + index * 0.04);
    register("mitochondria", mito);
    floaters.push({ object: mito, base: mito.position.clone(), phase: index * 1.4, amplitude: 0.035 });
  });

  // Lisosomas con contenido granular.
  const lysosomeGroup = new THREE.Group();
  const lysosomePositions = [[-1.55,-1.65,0.65],[-2.15,-0.45,0.25],[2.2,0.15,0.35],[0.2,-2.15,0.25],[1.2,1.95,-0.3]];
  lysosomePositions.forEach((position, index) => {
    const lysosome = new THREE.Group();
    const radius = 0.2 + (index % 3) * 0.035;
    lysosome.add(new THREE.Mesh(new THREE.SphereGeometry(radius, 22, 16), standard(index % 2 ? "#6987b3" : "#607aa8", { opacity: 0.88, roughness: 0.42 })));
    for (let granule = 0; granule < 3; granule += 1) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.18, 7, 5), standard("#b8c5d9", { opacity: 0.85 }));
      const a = (granule / 3) * TAU + index;
      dot.position.set(Math.cos(a) * radius * 0.45, Math.sin(a) * radius * 0.45, radius * 0.65);
      lysosome.add(dot);
    }
    lysosome.position.set(...position);
    lysosomeGroup.add(lysosome);
    floaters.push({ object: lysosome, base: lysosome.position.clone(), phase: index * 0.9, amplitude: 0.025 });
  });
  register("lysosomes", lysosomeGroup);

  // Ribosomas libres: distribución determinista dentro del citoplasma.
  const freeRibosomes = new THREE.InstancedMesh(new THREE.SphereGeometry(0.029, 6, 5), standard("#c7a252", { roughness: 0.72 }), 170);
  let placed = 0;
  while (placed < 170) {
    const point = new THREE.Vector3((random() - 0.5) * 5.4, (random() - 0.5) * 5.4, (random() - 0.5) * 2.8);
    if (point.length() > 2.65 || point.distanceTo(new THREE.Vector3(...nucleusCenter)) < 1.35) continue;
    dummy.position.copy(point);
    dummy.scale.setScalar(0.75 + random() * 0.55);
    dummy.updateMatrix();
    freeRibosomes.setMatrixAt(placed++, dummy.matrix);
  }
  dummy.scale.setScalar(1);
  freeRibosomes.instanceMatrix.needsUpdate = true;
  register("ribosomes", freeRibosomes);

  // Citoesqueleto: microtúbulos radiales y filamentos periféricos.
  const cytoskeleton = new THREE.Group();
  const microtubuleMaterial = standard("#799d6f", { opacity: 0.38, depthWrite: false, roughness: 0.6 });
  const cytoskeletonGeometries = [];
  const centrosomeOrigin = new THREE.Vector3(0.48, 0.05, 0.55);
  for (let i = 0; i < 14; i += 1) {
    const a = (i / 14) * TAU + 0.18;
    const end = new THREE.Vector3(Math.cos(a) * (2.4 + random() * 0.3), Math.sin(a) * (2.35 + random() * 0.3), -0.55 + random() * 0.75);
    const middle = centrosomeOrigin.clone().lerp(end, 0.52);
    middle.z += 0.25 + random() * 0.3;
    cytoskeletonGeometries.push(tube([centrosomeOrigin.clone(), middle, end], 0.014, 28, 5));
  }
  for (let band = 0; band < 3; band += 1) {
    const points = arcPoints([0, 0, -0.7 + band * 0.34], 2.55 - band * 0.1, Math.PI * 0.75, Math.PI * 1.85, 42, 0.96, 0.18);
    cytoskeletonGeometries.push(tube(points, 0.012, 44, 5));
  }
  cytoskeleton.add(new THREE.Mesh(mergeGeometries(cytoskeletonGeometries), microtubuleMaterial));
  register("cytoskeleton", cytoskeleton);

  // Centrosoma: dos centriolos perpendiculares con nueve haces cada uno.
  const centrosome = new THREE.Group();
  function makeCentriole(rotation, offset) {
    const centriole = new THREE.Group();
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.58, 24, 1, true), standard("#668365", { opacity: 0.36, side: THREE.DoubleSide, depthWrite: false }));
    centriole.add(wall);
    const rods = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.019, 0.019, 0.58, 6), standard("#6f8c65", { roughness: 0.55 }), 9);
    for (let i = 0; i < 9; i += 1) {
      const a = (i / 9) * TAU;
      dummy.position.set(Math.cos(a) * 0.115, 0, Math.sin(a) * 0.115);
      dummy.updateMatrix();
      rods.setMatrixAt(i, dummy.matrix);
    }
    rods.instanceMatrix.needsUpdate = true;
    centriole.add(rods);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.018, 6, 32), standard("#91a77b"));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.29;
    centriole.add(ring);
    centriole.rotation.set(...rotation);
    centriole.position.set(...offset);
    centrosome.add(centriole);
  }
  makeCentriole([0.25, 0.15, Math.PI / 2], [-0.12, 0.08, 0]);
  makeCentriole([Math.PI / 2, 0.25, 0.1], [0.18, -0.12, 0.08]);
  centrosome.position.copy(centrosomeOrigin);
  register("centrosome", centrosome);

  // Sutil variación periódica; todas las animaciones comparten un reloj.
  function update(time) {
    const phase = (time / DURATION) * TAU;
    root.rotation.set(-0.055 + Math.cos(phase) * 0.025, 0.1 + Math.cos(phase) * 0.16, 0);
    floaters.forEach(({ object, base, phase: offset, amplitude }) => {
      object.position.y = base.y + Math.sin(phase + offset) * amplitude;
      object.position.x = base.x + Math.cos(phase + offset) * amplitude * 0.35;
    });
  }

  function setHighlight(selectedId) {
    materials.forEach((set, id) => {
      set.forEach((material) => {
        if (!material.emissive) return;
        if (id === selectedId) {
          material.emissive.set(material.color).multiplyScalar(0.22);
          material.emissiveIntensity = 0.75;
        } else {
          material.emissive.set(0x000000);
          material.emissiveIntensity = 0;
        }
      });
    });
  }

  function setIsolate(selectedId, isolate) {
    groups.forEach((group, id) => { group.visible = !isolate || id === selectedId; });
  }

  update(0);
  return { root, groups, pickables, update, setHighlight, setIsolate, duration: DURATION };
}
