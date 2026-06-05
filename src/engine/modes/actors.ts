// Combat actors — meshes with a path + lifecycle, owned by the engine's persistent
// actorsGroup (survives scene swaps). Cinematic: they react/emit, no damage model.
// Actors build their OWN materials (NOT the shared MaterialPool) so loadScene's
// disposeAll() never kills a persistent actor's material.
//
// Redo (2026-06-05): the actors used to be bare icosahedra in wireframe — from 26-44
// units away that read as a tangle of lines (a "glitch"), and the tracers were near-
// invisible. Now they are box-built craft with a clear silhouette (fuselage + wing +
// fin), bank into their weave instead of tumbling, and fire a bright bolt that flies
// AT the camera growing as it nears (+ muzzle flash) so "taking fire" actually reads.
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

/** Assemble a wireframe craft from boxes — each part is [w,h,d] with an optional offset.
 *  A few boxes give a far more readable silhouette than one polyhedron. */
type Part = { s: [number, number, number]; p?: [number, number, number] };
function craft(mat: THREE.Material, parts: Part[]): THREE.Group {
  const g = new THREE.Group();
  for (const part of parts) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(part.s[0], part.s[1], part.s[2]), mat);
    if (part.p) m.position.set(part.p[0], part.p[1], part.p[2]);
    g.add(m);
  }
  return g;
}

const FWD = new THREE.Vector3(0, 0, -1);
const RIGHT = new THREE.Vector3(1, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);

/** Lurking hunter: weaves at the edge of view, fires bright bolts toward the camera. */
export class AntagonistDrone implements Actor {
  readonly obj = new THREE.Group();
  alive = true;
  private rng: () => number;
  private t0 = -1;
  private nextFire: number;
  private side: number;
  private mat: THREE.MeshBasicMaterial;
  private bolt: { mesh: THREE.Mesh; born: number; from: THREE.Vector3 } | null = null;
  private tmp = new THREE.Vector3();

  constructor(hex: number, seed: number, private onFire: () => void) {
    this.rng = mkRng((seed ^ 0xbad5eed) >>> 0);
    this.side = this.rng() < 0.5 ? -1 : 1;
    this.mat = wire(hex);
    // Interceptor silhouette: long fuselage, wide wing bar, tail fin, nose block.
    this.obj.add(craft(this.mat, [
      { s: [1.0, 0.7, 4.6] },                      // fuselage (long along local Z)
      { s: [6.2, 0.18, 1.5], p: [0, 0, 0.7] },     // wing
      { s: [0.18, 1.2, 1.0], p: [0, 0.55, 1.9] },  // tail fin
      { s: [0.9, 0.5, 0.9], p: [0, -0.1, -2.0] },  // nose block
    ]));
    this.nextFire = 2 + this.rng() * 2;
  }

  update(t: number, _dt: number, cam: THREE.PerspectiveCamera, threat: number): boolean {
    if (this.t0 < 0) this.t0 = t;
    const lt = t - this.t0;
    if (threat < 0.05) { this.alive = false; return false; }      // exhale at the crash
    // anchor at the edge of view, relative to the camera; closer + bigger as threat rises.
    const dist = 20 + (1 - threat) * 12;
    const lat = this.side * (11 + Math.sin(lt * 0.5) * 3);
    const vert = 4 + Math.sin(lt * 0.37) * 2.5;
    const fwd = FWD.clone().applyQuaternion(cam.quaternion);
    const right = RIGHT.clone().applyQuaternion(cam.quaternion);
    const up = UP.clone().applyQuaternion(cam.quaternion);
    this.obj.position.copy(cam.position).addScaledVector(fwd, dist).addScaledVector(right, lat).addScaledVector(up, vert);
    this.obj.lookAt(cam.position);                  // nose aims at the camera (it's targeting you)
    this.obj.rotateZ(Math.sin(lt * 0.7) * 0.4);     // bank with the weave — no tumble
    if (lt > this.nextFire) {
      this.nextFire = lt + (4 - threat * 3) + this.rng() * 1.5;    // cadence shortens with threat
      this.fire(t);
      this.onFire();
    }
    this.updateBolt(t, cam);
    return true;
  }

  private fire(t: number) {
    this.clearBolt();
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0), wire(this.mat.color.getHex()));
    this.obj.add(m);
    this.bolt = { mesh: m, born: t, from: this.obj.position.clone() };
  }

  /** Bolt flies from the muzzle to the camera in world space, growing as it nears (a
   *  bolt aimed straight at you reads as an approaching point, not a thin line). */
  private updateBolt(t: number, cam: THREE.PerspectiveCamera) {
    if (!this.bolt) return;
    const LIFE = 0.32;
    const age = t - this.bolt.born;
    if (age >= LIFE) { this.clearBolt(); return; }
    const frac = age / LIFE;
    this.obj.updateWorldMatrix(true, false);       // fresh matrix so worldToLocal is correct
    this.tmp.copy(this.bolt.from).lerp(cam.position, frac);
    this.obj.worldToLocal(this.tmp);
    this.bolt.mesh.position.copy(this.tmp);
    this.bolt.mesh.scale.setScalar(0.6 + frac * 2.4);            // grows as it bears down
    (this.bolt.mesh.material as THREE.Material).opacity = 1 - frac * 0.35;
  }

  private clearBolt() {
    if (!this.bolt) return;
    this.obj.remove(this.bolt.mesh);
    this.bolt.mesh.geometry.dispose();
    (this.bolt.mesh.material as THREE.Material).dispose();
    this.bolt = null;
  }

  dispose() { disposeTree(this.obj); }
}

/** CORP support unit: arrive → hold → flee or crash. Broader "corvette" silhouette. */
export class SupportUnit implements Actor {
  readonly obj = new THREE.Group();
  alive = true;
  private t0 = -1;
  private side: number;
  private crashFired = false;
  private crashSpin = 0;
  private mat: THREE.MeshBasicMaterial;

  constructor(hex: number, seed: number, private crash: boolean, private onCrash: () => void) {
    const rng = mkRng((seed ^ 0x600d) >>> 0);
    this.side = rng() < 0.5 ? -1 : 1;
    this.mat = wire(hex);
    // Corvette silhouette: bulky hull, stub wings, twin engine pods — clearly not the hunter.
    this.obj.add(craft(this.mat, [
      { s: [1.6, 1.2, 4.0] },                      // hull
      { s: [4.4, 0.2, 1.8], p: [0, 0, 0.3] },      // wing
      { s: [0.8, 0.8, 1.1], p: [1.7, 0, 0.9] },    // engine pod R
      { s: [0.8, 0.8, 1.1], p: [-1.7, 0, 0.9] },   // engine pod L
    ]));
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
        this.crashSpin += dt * 7;                                // tumble as it goes down
        if (d > 2.5) { if (!this.crashFired) { this.crashFired = true; this.onCrash(); } this.alive = false; return false; }
      } else {
        along -= d * 16;                                         // flee toward + past the camera
        if (d > 3) { this.alive = false; return false; }
      }
    }
    this.obj.position.copy(cam.position).addScaledVector(fwd, along).addScaledVector(right, lateral).addScaledVector(up, rise);
    this.obj.quaternion.copy(cam.quaternion);                   // fly facing our direction of travel
    this.obj.rotateY(-this.side * 0.25);                        // slight inward yaw → 3/4 silhouette
    this.obj.rotateZ(this.crash ? this.crashSpin : Math.sin(lt * 0.8) * 0.12);
    return true;
  }

  dispose() { disposeTree(this.obj); }
}
