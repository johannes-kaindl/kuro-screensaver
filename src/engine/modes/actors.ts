// Combat actors — meshes with a path + lifecycle, owned by the engine's persistent
// actorsGroup (survives scene swaps). Cinematic: they react/emit, no damage model.
// Actors build their OWN materials (NOT the shared MaterialPool) so loadScene's
// disposeAll() never kills a persistent actor's material.
import * as THREE from 'three';
import { mkRng } from '../engine/rng';

export interface Actor {
  readonly obj: THREE.Object3D;
  alive: boolean;
  /** advance; return false when finished (engine culls + disposes). */
  update(t: number, dt: number, cam: THREE.PerspectiveCamera, threat: number): boolean;
  dispose(): void;
}

const disposeTree = (o: THREE.Object3D) => o.traverse((c: any) => {
  c.geometry?.dispose?.(); ([] as any[]).concat(c.material || []).forEach((m) => m.dispose?.());
});

const wire = (hex: number, opacity = 1) =>
  new THREE.MeshBasicMaterial({ color: hex, wireframe: true, transparent: true, opacity });

const FWD = new THREE.Vector3(0, 0, -1);
const RIGHT = new THREE.Vector3(1, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);

/** Lurking hunter: weaves at the edge of view, fires tracers toward the camera. */
export class AntagonistDrone implements Actor {
  readonly obj = new THREE.Group();
  alive = true;
  private rng: () => number;
  private t0 = -1;
  private nextFire: number;
  private tracer: { mesh: THREE.Mesh; born: number } | null = null;
  private side: number;
  private mat: THREE.MeshBasicMaterial;

  constructor(hex: number, seed: number, private onFire: () => void) {
    this.rng = mkRng((seed ^ 0xbad5eed) >>> 0);
    this.side = this.rng() < 0.5 ? -1 : 1;
    this.mat = wire(hex);
    const body = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 0), this.mat);
    const fin = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 0), this.mat);
    fin.position.set(0, -0.9, 0);
    this.obj.add(body, fin);
    this.nextFire = 2 + this.rng() * 2;
  }

  update(t: number, _dt: number, cam: THREE.PerspectiveCamera, threat: number): boolean {
    if (this.t0 < 0) this.t0 = t;
    const lt = t - this.t0;
    if (threat < 0.05) { this.alive = false; return false; }      // exhale at the crash
    // anchor at the edge of view, relative to the camera; closer as threat rises.
    const dist = 26 + (1 - threat) * 18;
    const lat = this.side * (10 + Math.sin(lt * 0.5) * 3);
    const vert = 5 + Math.sin(lt * 0.37) * 2.5;
    const fwd = FWD.clone().applyQuaternion(cam.quaternion);
    const right = RIGHT.clone().applyQuaternion(cam.quaternion);
    const up = UP.clone().applyQuaternion(cam.quaternion);
    this.obj.position.copy(cam.position).addScaledVector(fwd, dist).addScaledVector(right, lat).addScaledVector(up, vert);
    this.obj.lookAt(cam.position);          // local -Z now points at the camera
    this.obj.rotateZ(lt * 0.6);             // spin about the look axis (keeps -Z on camera)
    if (lt > this.nextFire) {
      this.nextFire = lt + (4 - threat * 3) + this.rng() * 1.5;    // cadence shortens with threat
      this.fire(t, this.obj.position.distanceTo(cam.position));
      this.onFire();
    }
    if (this.tracer) {                      // fade the tracer out over 0.3s
      const age = t - this.tracer.born;
      if (age > 0.3) { this.clearTracer(); }
      else (this.tracer.mesh.material as THREE.Material).opacity = 1 - age / 0.3;
    }
    return true;
  }

  private fire(t: number, len: number) {
    this.clearTracer();
    const geo = new THREE.CylinderGeometry(0.05, 0.05, Math.max(1, len), 5);
    const m = new THREE.Mesh(geo, wire(this.mat.color.getHex()));
    m.position.set(0, 0, -len / 2);         // along local -Z (drone faces the camera)
    m.quaternion.setFromUnitVectors(UP, new THREE.Vector3(0, 0, -1));
    this.obj.add(m);
    this.tracer = { mesh: m, born: t };
  }

  private clearTracer() {
    if (!this.tracer) return;
    this.obj.remove(this.tracer.mesh);
    this.tracer.mesh.geometry.dispose();
    (this.tracer.mesh.material as THREE.Material).dispose();
    this.tracer = null;
  }

  dispose() { disposeTree(this.obj); }
}

/** CORP support unit: arrive → hold → flee or crash. */
export class SupportUnit implements Actor {
  readonly obj = new THREE.Group();
  alive = true;
  private t0 = -1;
  private side: number;
  private crashFired = false;
  private mat: THREE.MeshBasicMaterial;

  constructor(hex: number, seed: number, private crash: boolean, private onCrash: () => void) {
    const rng = mkRng((seed ^ 0x600d) >>> 0);
    this.side = rng() < 0.5 ? -1 : 1;
    this.mat = wire(hex);
    this.obj.add(new THREE.Mesh(new THREE.OctahedronGeometry(1.0, 0), this.mat));
  }

  update(t: number, dt: number, cam: THREE.PerspectiveCamera, _threat: number): boolean {
    if (this.t0 < 0) this.t0 = t;
    const lt = t - this.t0;
    const fwd = FWD.clone().applyQuaternion(cam.quaternion);
    const right = RIGHT.clone().applyQuaternion(cam.quaternion);
    const up = UP.clone().applyQuaternion(cam.quaternion);
    const arrive = Math.min(1, lt / 2.5);
    const ease = 1 - (1 - arrive) * (1 - arrive);
    let lateral = this.side * (28 * (1 - ease) + 12 * ease);    // slide in to a holding offset
    let along = 30;
    let rise = 6;
    if (lt > 6) {                                                // depart
      const d = lt - 6;
      if (this.crash) {
        rise -= d * d * 1.4;                                     // dive
        lateral += this.side * d * 2;
        this.obj.rotateZ(dt * 7);                               // spin
        if (d > 2.5) { if (!this.crashFired) { this.crashFired = true; this.onCrash(); } this.alive = false; return false; }
      } else {
        along -= d * 16;                                         // flee toward + past the camera
        if (d > 3) { this.alive = false; return false; }
      }
    }
    this.obj.position.copy(cam.position).addScaledVector(fwd, along).addScaledVector(right, lateral).addScaledVector(up, rise);
    return true;
  }

  dispose() { disposeTree(this.obj); }
}
