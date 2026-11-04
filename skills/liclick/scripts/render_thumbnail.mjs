// Render a thumbnail of a 3D model in pure Node.
//
// Mirrors the conventions of the frontend previewer (solid display mode):
//   src/components/three-d-model-previewer/{model-utils.ts,viewer-canvas.tsx,
//   model-content.tsx,constants.ts}
// — same loaders + STL rotation, same normalize (centered, bottom at y=0,
//   maxDim → 5), same camera placement (showGrid=false branch), same
//   LIGHTING_CONFIGS.solid lights, same MeshStandardMaterial color,
//   same ACES tone mapping with exposure 1.2.
//
// Usage:
//   node render_thumbnail.mjs <input> <output.png> [size]
//
// Supports: .glb / .gltf (embedded) / .obj / .stl
// Output:   PNG with transparent background (default 512x512)

import * as fs from 'node:fs';
import * as path from 'node:path';

// GLTFLoader uses `self` and `URL.createObjectURL` for texture decoding.
// Stub them so loading doesn't crash; we render solid (no textures) anyway.
globalThis.self = globalThis;
if (!globalThis.URL.createObjectURL) globalThis.URL.createObjectURL = () => '';
if (!globalThis.URL.revokeObjectURL) globalThis.URL.revokeObjectURL = () => {};

const _origConsoleError = console.error;
console.error = (...args) => {
  if (typeof args[0] === 'string' && args[0].includes("Couldn't load texture")) return;
  _origConsoleError(...args);
};

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { createCanvas } from '@napi-rs/canvas';

const [, , inputPath, outputPath, sizeArg] = process.argv;
if (!inputPath || !outputPath) {
  console.error('Usage: node render_thumbnail.mjs <input> <output.png> [size]');
  process.exit(1);
}
const SIZE = sizeArg ? parseInt(sizeArg, 10) : 512;
if (!Number.isFinite(SIZE) || SIZE < 16) {
  console.error(`Invalid size: ${sizeArg}`);
  process.exit(1);
}
if (!fs.existsSync(inputPath)) {
  console.error(`Input not found: ${inputPath}`);
  process.exit(1);
}

// ── Loaders (mirror loadModelByUrl) ─────────────────────────────────
async function loadModel(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const buf = fs.readFileSync(filePath);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

  if (ext === '.glb' || ext === '.gltf') {
    const loader = new GLTFLoader();
    const gltf = await new Promise((resolve, reject) => {
      loader.parse(ab, '', resolve, reject);
    });
    return gltf.scene;
  }
  if (ext === '.obj') {
    return new OBJLoader().parse(buf.toString('utf-8'));
  }
  if (ext === '.stl') {
    const geom = new STLLoader().parse(ab);
    geom.computeVertexNormals();
    const mesh = new THREE.Mesh(
      geom,
      new THREE.MeshStandardMaterial({ color: '#e0e0e0', roughness: 0.75, metalness: 0.05 }),
    );
    mesh.rotation.x = -Math.PI / 2; // matches frontend STL orientation
    return mesh;
  }
  throw new Error(`Unsupported format: ${ext} (FBX/USDZ unsupported — convert to GLB first)`);
}

// ── Normalize: center, lift bottom to y=0, scale maxDim → 5 ─────────
function normalizeModel(object) {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);

  object.position.sub(center);
  object.position.y += size.y / 2;
  if (maxDim > 0) object.scale.multiplyScalar(5 / maxDim);
  object.updateMatrixWorld(true);
}

const root = await loadModel(inputPath);
normalizeModel(root);

// ── Collect world-space triangles + per-vertex normals ──────────────
const triangles = [];
const normalMatrix = new THREE.Matrix3();

root.traverse((obj) => {
  if (!obj.isMesh) return;
  const geom = obj.geometry;
  if (!geom || !geom.attributes.position) return;
  if (!geom.attributes.normal) geom.computeVertexNormals();

  const posAttr = geom.attributes.position;
  const normAttr = geom.attributes.normal;
  const idxAttr = geom.index;
  const matWorld = obj.matrixWorld;
  normalMatrix.getNormalMatrix(matWorld);

  const getV = (i) =>
    new THREE.Vector3().fromBufferAttribute(posAttr, i).applyMatrix4(matWorld);
  const getN = (i) =>
    new THREE.Vector3().fromBufferAttribute(normAttr, i).applyMatrix3(normalMatrix).normalize();

  const pushTri = (i0, i1, i2) => {
    triangles.push({
      v0: getV(i0), v1: getV(i1), v2: getV(i2),
      n0: getN(i0), n1: getN(i1), n2: getN(i2),
    });
  };

  if (idxAttr) {
    for (let i = 0; i < idxAttr.count; i += 3) {
      pushTri(idxAttr.getX(i), idxAttr.getX(i + 1), idxAttr.getX(i + 2));
    }
  } else {
    for (let i = 0; i < posAttr.count; i += 3) {
      pushTri(i, i + 1, i + 2);
    }
  }
});

if (triangles.length === 0) {
  console.error('No renderable geometry found.');
  process.exit(1);
}

// ── Camera (mirror viewer-canvas placement, showGrid=false branch) ──
const box = new THREE.Box3();
for (const t of triangles) {
  box.expandByPoint(t.v0); box.expandByPoint(t.v1); box.expandByPoint(t.v2);
}
const center = box.getCenter(new THREE.Vector3());
const sceneSize = box.getSize(new THREE.Vector3());
const maxDim = Math.max(sceneSize.x, sceneSize.y, sceneSize.z);
const distance = Math.max(4, maxDim * 1.6);

const cam = new THREE.PerspectiveCamera(40, 1, distance * 0.01, distance * 100);
cam.position.set(center.x, center.y + distance * 0.1, center.z + distance * 1.4);
cam.lookAt(center);
cam.updateMatrixWorld(true);
cam.updateProjectionMatrix();

const viewProj = new THREE.Matrix4().multiplyMatrices(
  cam.projectionMatrix,
  cam.matrixWorldInverse,
);

// ── Lights (LIGHTING_CONFIGS.solid) ─────────────────────────────────
//   ambient 0, hemisphere 0.21 (sky #a0c4ff, ground #444),
//   secondaryDir 0 (skipped), cameraDir 2.1, cameraPoint 0.3
//   (decay=2 dist=14 → negligible at our camera distance, skipped).
const HEMI_INT = 0.21;
const HEMI_SKY = new THREE.Color('#a0c4ff');
const HEMI_GROUND = new THREE.Color('#444444');
const CAM_DIR_INT = 2.1;
// Camera-attached directional light: position = camDirVec*10 + (0,-1,0).
// Light direction (vector from surface near origin towards light) = position normalized.
const camDirVec = new THREE.Vector3().subVectors(cam.position, center).normalize();
const lightPos = new THREE.Vector3(
  camDirVec.x * 10,
  camDirVec.y * 10 - 1,
  camDirVec.z * 10,
);
const lightDir = lightPos.clone().normalize();

// Surface base color = solid #e0e0e0 (matches frontend SOLID_MATERIAL).
const BASE = new THREE.Color('#e0e0e0');

// ACES filmic tone map + exposure 1.2 (matches Canvas toneMapping config).
const EXPOSURE = 1.2;
const aces = (x) => {
  const a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return Math.max(0, Math.min(1, (x * (a * x + b)) / (x * (c * x + d) + e)));
};

// ── Project + back-face cull + per-vertex shade ─────────────────────
const projected = [];

const shadeVertex = (n) => {
  const t = 0.5 + 0.5 * n.y;
  const hr = HEMI_GROUND.r * (1 - t) + HEMI_SKY.r * t;
  const hg = HEMI_GROUND.g * (1 - t) + HEMI_SKY.g * t;
  const hb = HEMI_GROUND.b * (1 - t) + HEMI_SKY.b * t;
  const lambert = Math.max(0, n.dot(lightDir));
  return {
    r: HEMI_INT * hr + CAM_DIR_INT * lambert,
    g: HEMI_INT * hg + CAM_DIR_INT * lambert,
    b: HEMI_INT * hb + CAM_DIR_INT * lambert,
  };
};

for (const tri of triangles) {
  const p0 = tri.v0.clone().applyMatrix4(viewProj);
  const p1 = tri.v1.clone().applyMatrix4(viewProj);
  const p2 = tri.v2.clone().applyMatrix4(viewProj);

  if (p0.z < -1 && p1.z < -1 && p2.z < -1) continue;
  if (p0.z > 1 && p1.z > 1 && p2.z > 1) continue;

  const e1 = new THREE.Vector3().subVectors(tri.v1, tri.v0);
  const e2 = new THREE.Vector3().subVectors(tri.v2, tri.v0);
  const fn = new THREE.Vector3().crossVectors(e1, e2).normalize();
  const viewToTri = new THREE.Vector3().subVectors(tri.v0, cam.position).normalize();
  if (fn.dot(viewToTri) > 0) continue;

  const c0 = shadeVertex(tri.n0);
  const c1 = shadeVertex(tri.n1);
  const c2 = shadeVertex(tri.n2);

  const toPx = (p) => ({
    x: (p.x * 0.5 + 0.5) * SIZE,
    y: (1 - (p.y * 0.5 + 0.5)) * SIZE,
    z: p.z,
  });

  projected.push({ p0: toPx(p0), p1: toPx(p1), p2: toPx(p2), c0, c1, c2 });
}

// ── Z-buffer rasterizer with per-vertex color interpolation ─────────
const W = SIZE;
const H = SIZE;
const fb = new Uint8ClampedArray(W * H * 4);
const zbuf = new Float32Array(W * H);
zbuf.fill(Infinity);

for (const t of projected) {
  const { p0, p1, p2, c0, c1, c2 } = t;

  const minX = Math.max(0, Math.floor(Math.min(p0.x, p1.x, p2.x)));
  const maxX = Math.min(W - 1, Math.ceil(Math.max(p0.x, p1.x, p2.x)));
  const minY = Math.max(0, Math.floor(Math.min(p0.y, p1.y, p2.y)));
  const maxY = Math.min(H - 1, Math.ceil(Math.max(p0.y, p1.y, p2.y)));
  if (maxX < minX || maxY < minY) continue;

  const denom = (p1.y - p2.y) * (p0.x - p2.x) + (p2.x - p1.x) * (p0.y - p2.y);
  if (denom === 0) continue;
  const invDenom = 1 / denom;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const w0 = ((p1.y - p2.y) * (x - p2.x) + (p2.x - p1.x) * (y - p2.y)) * invDenom;
      const w1 = ((p2.y - p0.y) * (x - p2.x) + (p0.x - p2.x) * (y - p2.y)) * invDenom;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = w0 * p0.z + w1 * p1.z + w2 * p2.z;
      const i = y * W + x;
      if (z >= zbuf[i]) continue;
      zbuf[i] = z;

      const lr = c0.r * w0 + c1.r * w1 + c2.r * w2;
      const lg = c0.g * w0 + c1.g * w1 + c2.g * w2;
      const lb = c0.b * w0 + c1.b * w1 + c2.b * w2;

      const r = aces(lr * BASE.r * EXPOSURE);
      const g = aces(lg * BASE.g * EXPOSURE);
      const b = aces(lb * BASE.b * EXPOSURE);

      const px = i * 4;
      fb[px]     = Math.round(r * 255);
      fb[px + 1] = Math.round(g * 255);
      fb[px + 2] = Math.round(b * 255);
      fb[px + 3] = 255;
    }
  }
}

// ── Encode PNG ──────────────────────────────────────────────────────
const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');
const imgData = ctx.createImageData(W, H);
imgData.data.set(fb);
ctx.putImageData(imgData, 0, 0);

fs.mkdirSync(path.dirname(path.resolve(outputPath)) || '.', { recursive: true });
const png = await canvas.encode('png');
fs.writeFileSync(outputPath, png);
console.error(`Rendered ${triangles.length} triangles → ${outputPath}`);
