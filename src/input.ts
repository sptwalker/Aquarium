import * as THREE from 'three';
import { WATER_Y, TANK } from './config';

export type InputState = {
  mouse3: THREE.Vector3 | null;
  mouseSpeed: number;
  ndc: THREE.Vector2;
  clicked: boolean;
  pointerInside: boolean;
};

/** Maps the pointer onto the water surface plane for interactive aiming. */
export class Input {
  readonly state: InputState = {
    mouse3: null,
    mouseSpeed: 0,
    ndc: new THREE.Vector2(),
    clicked: false,
    pointerInside: false,
  };
  /** timestamp of the last real pointer activity, for idle camera drift */
  lastActivity = 0;

  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -WATER_Y);
  private hit = new THREE.Vector3();
  private last = new THREE.Vector2();
  private lastT = 0;
  private el: HTMLElement;
  private camera: THREE.PerspectiveCamera;

  constructor(el: HTMLElement, camera: THREE.PerspectiveCamera) {
    this.el = el;
    this.camera = camera;
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointerleave', this.onLeave);
  }

  private onMove = (e: PointerEvent) => {
    const r = this.el.getBoundingClientRect();
    this.state.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.state.pointerInside = true;
    this.lastActivity = performance.now() / 1000;
  };

  private onDown = () => {
    this.state.clicked = true;
    this.lastActivity = performance.now() / 1000;
  };

  private onLeave = () => {
    this.state.pointerInside = false;
  };

  update(t: number) {
    this.ray.setFromCamera(this.state.ndc, this.camera);
    // Aim at the water surface if the ray hits it, otherwise at the back glass.
    const ok = this.ray.ray.intersectPlane(this.plane, this.hit);
    if (ok && Math.abs(this.hit.x) < TANK.hw && Math.abs(this.hit.z) < TANK.hd) {
      this.state.mouse3 = this.state.mouse3 ?? new THREE.Vector3();
      this.state.mouse3.copy(this.hit);
    } else {
      // project onto the mid-depth plane
      const p = this.ray.ray.at(8, new THREE.Vector3());
      this.state.mouse3 = this.state.mouse3 ?? new THREE.Vector3();
      this.state.mouse3.copy(p);
      this.state.mouse3.y = THREE.MathUtils.clamp(p.y, 0.8, WATER_Y - 0.3);
      this.state.mouse3.x = THREE.MathUtils.clamp(p.x, -TANK.hw + 0.4, TANK.hw - 0.4);
      this.state.mouse3.z = THREE.MathUtils.clamp(p.z, -TANK.hd + 0.4, TANK.hd - 0.4);
    }
    const dt = Math.max(1e-3, t - this.lastT);
    const moved = this.last.distanceTo(this.state.ndc);
    this.state.mouseSpeed = moved / dt;
    this.last.copy(this.state.ndc);
    this.lastT = t;
    if (!this.state.pointerInside) this.state.mouseSpeed = 0;
  }

  consumeClick(): boolean {
    const c = this.state.clicked;
    this.state.clicked = false;
    return c;
  }

  dispose() {
    this.el.removeEventListener('pointermove', this.onMove);
    this.el.removeEventListener('pointerdown', this.onDown);
    this.el.removeEventListener('pointerleave', this.onLeave);
  }
}
