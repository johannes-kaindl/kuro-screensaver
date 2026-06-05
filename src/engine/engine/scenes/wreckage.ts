// WRECKAGE — a CORP-station debris field: the same flythrough engine as VOID, but the
// pool is angular wreckage (hull panels, struts, torn fragments) instead of rocks, with
// hard-faceted flat shading + erratic tumble. The film picks it as a PANIC/aftermath variant.
import * as THREE from 'three';
import { makeFlythroughScene, type FlyTpl } from './void';

function debrisTemplates(rng: () => number): FlyTpl[] {
  const TPL: FlyTpl[] = [
    { geo: new THREE.BoxGeometry(1.5, 1.0, 0.06), w: 0.26 },   // hull panel
    { geo: new THREE.BoxGeometry(0.7, 1.8, 0.06), w: 0.20 },   // tall panel
    { geo: new THREE.BoxGeometry(0.13, 0.13, 3.0), w: 0.22 },  // strut / girder
    { geo: new THREE.IcosahedronGeometry(0.7, 0),  w: 0.16 },  // angular chunk
  ];
  // Sheared panel — pull a corner in so it reads as torn metal, not a clean box.
  const bent = new THREE.BoxGeometry(1.2, 1.2, 0.06);
  const bp = bent.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < bp.count; i++) {
    if (bp.getX(i) > 0 && bp.getY(i) > 0) bp.setXYZ(i, bp.getX(i) * (0.4 + rng() * 0.3), bp.getY(i), bp.getZ(i));
  }
  bent.computeVertexNormals();
  TPL.push({ geo: bent, w: 0.16 });
  return TPL;
}

export const WreckageScene = makeFlythroughScene({
  modeLabels: ['WRECKAGE', 'SALVAGE', 'DEBRIS'] as const,
  triCount: '14K',
  fog: 0.006,
  tumble: 2.2,
  makeTemplates: debrisTemplates,
});
