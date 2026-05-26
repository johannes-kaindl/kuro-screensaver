// VOID — orbiting polyhedra in deep space, with inter-shape lines and starfield.
import * as THREE from 'three';
import type { SceneCtx, SceneModule, SceneUpdater } from './scene-base';
import { SPEED_VALUES } from '../../data/defaults';

export const VoidScene: SceneModule = {
  modeLabels: ['DRIFT', 'DEEP VOID', 'ORBIT'] as const,
  triCount: '10K',

  build(ctx: SceneCtx): SceneUpdater {
    const { world, cam, mats, scene, rng } = ctx;
    scene.fog = new THREE.FogExp2(0x000000, 0.004);
    cam.position.set(0, 0, 45); cam.lookAt(0, 0, 0);

    const GF = [
      () => new THREE.IcosahedronGeometry(4, 1),
      () => new THREE.OctahedronGeometry(3.5),
      () => new THREE.TetrahedronGeometry(4.2),
      () => new THREE.DodecahedronGeometry(3.2),
      () => new THREE.IcosahedronGeometry(2.5, 0),
    ];
    interface VoidShape {
      mesh: THREE.Mesh;
      rx: number; ry: number; rz: number;
      fp: number; fa: number;
      orb?: THREE.Mesh;
    }
    const shapes: VoidShape[] = [];
    for (let i = 0; i < 22; i++) {
      const mesh = new THREE.Mesh(
        GF[i % GF.length](),
        mats.M({ transparent: true, opacity: 0.6 + rng() * 0.35 }),
      );
      const r = 12 + rng() * 30, a = rng() * Math.PI * 2;
      mesh.position.set(Math.cos(a) * r, (rng() - 0.5) * 24, Math.sin(a) * r - 5);
      const sh: VoidShape = {
        mesh,
        rx: (rng() - 0.5) * 0.018,
        ry: (rng() - 0.5) * 0.018,
        rz: (rng() - 0.5) * 0.013,
        fp: rng() * Math.PI * 2,
        fa: rng() * 0.9,
      };
      world.add(mesh);
      if (i < 8) {
        const orb = new THREE.Mesh(
          new THREE.TorusGeometry(5.5 + rng() * 2, 0.04, 4, 48),
          mats.M({ transparent: true, opacity: 0.42 }),
        );
        orb.position.copy(mesh.position);
        orb.rotation.x = rng() * 0.6 + 0.2;
        world.add(orb);
        sh.orb = orb;
      }
      shapes.push(sh);
    }

    // Inter-shape connection lines
    for (let i = 0; i < shapes.length; i++) {
      for (let j = i + 1; j < shapes.length; j++) {
        if (shapes[i].mesh.position.distanceTo(shapes[j].mesh.position) < 22 && rng() < 0.35) {
          const lg = new THREE.BufferGeometry().setFromPoints([
            shapes[i].mesh.position.clone(), shapes[j].mesh.position.clone(),
          ]);
          world.add(new THREE.Line(lg, mats.ML(0.22)));
        }
      }
    }

    // Starfield
    const pv: number[] = [];
    for (let i = 0; i < 2000; i++) pv.push((rng() - 0.5) * 130, (rng() - 0.5) * 80, (rng() - 0.5) * 130);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.Float32BufferAttribute(pv, 3));
    world.add(new THREE.Points(pg, mats.MP(0.1)));

    return (t: number, _dt: number) => {
      for (const s of shapes) {
        s.mesh.rotation.x += s.rx;
        s.mesh.rotation.y += s.ry;
        s.mesh.rotation.z += s.rz;
        s.mesh.position.y += Math.sin(t + s.fp) * s.fa * 0.007;
        if (s.orb) {
          s.orb.rotation.z += 0.009;
          s.orb.position.y = s.mesh.position.y;
        }
      }
      const R = 42, sp2 = SPEED_VALUES[ctx.settings.speed] * 0.006;
      cam.position.x = Math.cos(t * sp2) * R;
      cam.position.z = Math.sin(t * sp2) * R;
      cam.position.y = Math.sin(t * sp2 * 0.4) * 10;
      cam.lookAt(0, 0, 0);
    };
  },
};
