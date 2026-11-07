import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import { extOf } from '../../shared/fileKinds';
import { api } from '../lib/format';
import StepWorker from '../workers/step.worker.ts?worker&inline';
import type { StepMesh, StepResponse } from '../workers/step.worker';
import occtWasmUrl from 'occt-import-js/dist/occt-import-js.wasm?url';

const DEFAULT_COLOR = new THREE.Color('#b9c0ca');

// ---------------------------------------------------------------- STEP via a worker

let worker: Worker | null = null;
let wasm: Promise<ArrayBuffer> | null = null;
let nextId = 0;

function loadWasm(): Promise<ArrayBuffer> {
  wasm ??= (async () => {
    if (/^https?:/.test(location.protocol)) return (await fetch(occtWasmUrl)).arrayBuffer(); // dev server
    const bytes = await api().appAsset(occtWasmUrl.split('/').pop()!);
    return bytes.slice().buffer;
  })();
  wasm.catch(() => (wasm = null));
  return wasm;
}

async function readCad(kind: 'step' | 'iges' | 'brep', file: ArrayBuffer): Promise<StepMesh[]> {
  const w = (worker ??= new StepWorker());
  const id = ++nextId;
  const wasmBytes = (await loadWasm()).slice(0); // the worker keeps its own copy after the first call
  return new Promise((resolve, reject) => {
    const onMessage = (e: MessageEvent<StepResponse>) => {
      if (e.data.id !== id) return;
      w.removeEventListener('message', onMessage);
      if (e.data.ok) resolve(e.data.meshes);
      else reject(new Error(e.data.error));
    };
    w.addEventListener('message', onMessage);
    w.postMessage({ id, kind, file, wasm: wasmBytes }, [file, wasmBytes]);
  });
}

function cadToObject(meshes: StepMesh[]): THREE.Object3D {
  const group = new THREE.Group();
  for (const m of meshes) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
    if (m.normal) geo.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3));
    geo.setIndex(new THREE.BufferAttribute(m.index, 1));
    if (!m.normal) geo.computeVertexNormals();
    const base = m.color ? new THREE.Color(...m.color) : DEFAULT_COLOR;
    if (m.faces.length) {
      // Colored faces: paint per vertex.
      const colors = new Float32Array(m.position.length).fill(0);
      for (let v = 0; v < colors.length; v += 3) colors.set([base.r, base.g, base.b], v);
      for (const [first, last, r, g, b] of m.faces) {
        for (let t = first; t <= last; t++) for (let k = 0; k < 3; k++) colors.set([r, g, b], m.index[t * 3 + k] * 3);
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      group.add(new THREE.Mesh(geo, material({ vertexColors: true })));
    } else {
      group.add(new THREE.Mesh(geo, material({ color: base })));
    }
  }
  // STEP files are Z-up like most CAD.
  return group;
}

function material(opts: THREE.MeshStandardMaterialParameters) {
  return new THREE.MeshStandardMaterial({ metalness: 0.05, roughness: 0.65, side: THREE.DoubleSide, ...opts });
}

// ---------------------------------------------------------------- other formats

async function loadModel(path: string, name: string): Promise<THREE.Object3D> {
  const ext = extOf(name);
  const bytes = await api().readBinary(path);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  if (ext === 'stl') {
    const geo = new STLLoader().parse(buffer);
    geo.computeVertexNormals();
    // Colored STLs are rare, and some exporters write a color header with all-black faces: ignore colors.
    geo.deleteAttribute('color');
    return new THREE.Mesh(geo, material({ color: DEFAULT_COLOR }));
  }
  if (ext === 'obj') {
    const obj = new OBJLoader().parse(new TextDecoder().decode(bytes));
    obj.traverse((o) => {
      if (o instanceof THREE.Mesh) o.material = material({ color: DEFAULT_COLOR });
    });
    obj.rotation.x = Math.PI / 2; // OBJ is usually Y-up
    return obj;
  }
  if (ext === '3mf') return new ThreeMFLoader().parse(buffer);
  const kind = ext === 'iges' || ext === 'igs' ? 'iges' : ext === 'brep' ? 'brep' : 'step';
  return cadToObject(await readCad(kind, buffer));
}

// ---------------------------------------------------------------- viewer

interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  root: THREE.Group;
  grid: THREE.GridHelper | null;
  home: () => void;
  dispose: () => void;
}

function createStage(host: HTMLDivElement, onChange: () => void): Stage {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(host.clientWidth, host.clientHeight);
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, host.clientWidth / Math.max(1, host.clientHeight), 0.1, 100000);
  camera.up.set(0, 0, 1);
  scene.add(camera);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x667080, 1.2));
  // Key light from just above-left of the camera, following the view.
  const key = new THREE.DirectionalLight(0xffffff, 1.8);
  key.position.set(-0.5, 1, 0);
  key.target.position.set(0, 0, -1);
  camera.add(key, key.target);
  // Soft fill from the other side, so dark parts (black enclosures) still show their shape.
  const fill = new THREE.DirectionalLight(0xffffff, 0.7);
  fill.position.set(1, -0.5, 0.3);
  fill.target.position.set(0, 0, -1);
  camera.add(fill, fill.target);

  const root = new THREE.Group();
  scene.add(root);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  let frame = 0;
  const loop = () => {
    frame = requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, camera);
  };
  loop();
  controls.addEventListener('change', onChange);

  const resize = new ResizeObserver(() => {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });
  resize.observe(host);

  const stage: Stage = {
    renderer,
    scene,
    camera,
    controls,
    root,
    grid: null,
    home: () => {
      const box = new THREE.Box3().setFromObject(root);
      if (box.isEmpty()) return;
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const radius = Math.max(size.length() / 2, 0.001);
      const dist = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2));
      camera.position.copy(center).add(new THREE.Vector3(0.9, -1.3, 0.9).normalize().multiplyScalar(dist * 1.05));
      camera.near = dist / 200;
      camera.far = dist * 50;
      camera.updateProjectionMatrix();
      controls.target.copy(center);
      controls.update();
    },
    dispose: () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      controls.dispose();
      root.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
  return stage;
}

const fmt = (n: number) => (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2));

/** Spin-around preview of STL, 3MF, OBJ, STEP and IGES files. */
export function ModelView({ path, name, modified }: { path: string; name: string; modified: number }) {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [info, setInfo] = useState<{ size: THREE.Vector3; triangles: number } | null>(null);
  const [wire, setWire] = useState(false);
  const [moved, setMoved] = useState(false);
  const ext = extOf(name);
  const slow = ext === 'step' || ext === 'stp' || ext === 'iges' || ext === 'igs' || ext === 'brep';

  useEffect(() => {
    if (!host.current) return;
    let cancelled = false;
    setState('loading');
    setInfo(null);
    setWire(false);
    let s: Stage;
    try {
      s = createStage(host.current, () => setMoved(true));
    } catch {
      setError('3D isn’t available on this computer (WebGL is turned off).');
      setState('error');
      return;
    }
    stage.current = s;
    loadModel(path, name)
      .then((obj) => {
        if (cancelled) return;
        s.root.add(obj);
        const box = new THREE.Box3().setFromObject(s.root);
        const size = box.getSize(new THREE.Vector3());
        let triangles = 0;
        obj.traverse((o) => {
          if (o instanceof THREE.Mesh) triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
        });
        // A light grid under the part, scaled to it.
        const span = Math.max(size.x, size.y) * 1.6 || 10;
        const step = 10 ** Math.floor(Math.log10(span / 4));
        const grid = new THREE.GridHelper(Math.ceil(span / step) * step, Math.ceil(span / step), 0x8a93a0, 0x8a93a0);
        (grid.material as THREE.Material).opacity = 0.18;
        (grid.material as THREE.Material).transparent = true;
        grid.rotation.x = Math.PI / 2;
        const center = box.getCenter(new THREE.Vector3());
        grid.position.set(center.x, center.y, box.min.z);
        s.scene.add(grid);
        s.grid = grid;
        s.home();
        setMoved(false);
        setInfo({ size, triangles: Math.round(triangles) });
        setState('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err));
        setState('error');
      });
    return () => {
      cancelled = true;
      s.dispose();
      stage.current = null;
    };
  }, [path, name, modified]);

  useEffect(() => {
    stage.current?.root.traverse((o) => {
      if (o instanceof THREE.Mesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => ((m as THREE.MeshStandardMaterial).wireframe = wire));
    });
  }, [wire]);

  return (
    <div className="viewer">
      <div className="text-toolbar">
        {info && (
          <span className="muted">
            {fmt(info.size.x)} × {fmt(info.size.y)} × {fmt(info.size.z)} mm · {info.triangles.toLocaleString()} triangles
          </span>
        )}
        <div className="spacer" />
        {state === 'ready' && (
          <>
            <button className={`button ghost small${wire ? ' active' : ''}`} onClick={() => setWire(!wire)}>
              Wireframe
            </button>
            <button className="button ghost small" disabled={!moved} onClick={() => stage.current?.home()}>
              Reset view
            </button>
          </>
        )}
      </div>
      <div className="model-stage" ref={host}>
        {state === 'loading' && <div className="viewer-overlay">{slow ? 'Reading the CAD file… (big STEP files take a few seconds)' : 'Loading…'}</div>}
        {state === 'error' && <div className="viewer-overlay error">Couldn’t show this model: {error}</div>}
      </div>
      {state === 'ready' && <div className="viewer-hint muted small">Drag to rotate · right-drag to move · scroll to zoom</div>}
    </div>
  );
}
