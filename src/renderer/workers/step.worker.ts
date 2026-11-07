/// <reference lib="webworker" />
/**
 * Turns a STEP / IGES / BREP file into triangle meshes, off the main thread.
 * Uses occt-import-js (OpenCascade compiled to WebAssembly, LGPL-2.1).
 */
import occtimportjs from 'occt-import-js';

export interface StepMesh {
  name: string;
  position: Float32Array;
  normal: Float32Array | null;
  index: Uint32Array;
  /** Mesh color, 0–1. */
  color: [number, number, number] | null;
  /** Per-face colors: [firstTriangle, lastTriangle, r, g, b]. */
  faces: Array<[number, number, number, number, number]>;
}

export type StepRequest = { id: number; kind: 'step' | 'iges' | 'brep'; file: ArrayBuffer; wasm: ArrayBuffer };
export type StepResponse = { id: number; ok: true; meshes: StepMesh[] } | { id: number; ok: false; error: string };

let occt: Promise<any> | null = null;

self.onmessage = async (e: MessageEvent<StepRequest>) => {
  const { id, kind, file, wasm } = e.data;
  try {
    occt ??= (occtimportjs as unknown as (o: object) => Promise<any>)({ wasmBinary: wasm });
    const o = await occt;
    const bytes = new Uint8Array(file);
    const params = { linearUnit: 'millimeter', linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.001 };
    const r = kind === 'iges' ? o.ReadIgesFile(bytes, params) : kind === 'brep' ? o.ReadBrepFile(bytes, params) : o.ReadStepFile(bytes, params);
    if (!r?.success) throw new Error('This file could not be read.');
    const meshes: StepMesh[] = r.meshes.map((m: any) => ({
      name: m.name ?? '',
      position: new Float32Array(m.attributes.position.array),
      normal: m.attributes.normal ? new Float32Array(m.attributes.normal.array) : null,
      index: new Uint32Array(m.index.array),
      color: m.color ?? null,
      faces: (m.brep_faces ?? []).filter((f: any) => f.color).map((f: any) => [f.first, f.last, ...f.color]),
    }));
    const transfer = meshes.flatMap((m) => [m.position.buffer, m.index.buffer, ...(m.normal ? [m.normal.buffer] : [])]);
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, ok: true, meshes } satisfies StepResponse, transfer);
  } catch (err) {
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies StepResponse);
  }
};
