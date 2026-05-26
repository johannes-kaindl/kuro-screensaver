// Material factories — track all materials so we can recolor + dispose en masse.
import * as THREE from 'three';

export class MaterialPool {
  private mats: THREE.Material[] = [];
  hex = 0x00ff41;

  reset() { this.mats = []; }

  setColorHex(hex: number) {
    this.hex = hex;
    const c = new THREE.Color(hex);
    for (const m of this.mats) {
      const cm = m as any;
      if (cm.color) cm.color.copy(c);
    }
  }

  M(opts: Partial<THREE.MeshBasicMaterialParameters> = {}): THREE.MeshBasicMaterial {
    const m = new THREE.MeshBasicMaterial({ color: this.hex, wireframe: true, ...opts });
    this.mats.push(m); return m;
  }

  ML(opacity = 0.3): THREE.LineBasicMaterial {
    const m = new THREE.LineBasicMaterial({ color: this.hex, transparent: true, opacity });
    this.mats.push(m); return m;
  }

  MP(size = 0.13): THREE.PointsMaterial {
    const m = new THREE.PointsMaterial({ color: this.hex, size, sizeAttenuation: true });
    this.mats.push(m); return m;
  }

  MSolid(opacity = 0.9): THREE.MeshBasicMaterial {
    const m = new THREE.MeshBasicMaterial({ color: this.hex, transparent: true, opacity });
    this.mats.push(m); return m;
  }

  disposeAll() {
    for (const m of this.mats) m.dispose();
    this.mats = [];
  }
}
