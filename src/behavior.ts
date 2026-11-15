import * as THREE from 'three';
import { TANK, WATER_Y, SAND_TOP } from './config';
import type { FishSpecies } from './fish';

export type Food = {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  alive: boolean;
};

type Boid = {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  species: FishSpecies;
  hunger: number;
  curiosity: number;
  fear: number;
  focus: number;
  mouth: number;
  swimAmp: number;
  swimFreq: number;
  phase: number;
  size: number;
  /** distance from the position point to the farthest geometry (nose or tail tip) */
  reach: number;
  wander: THREE.Vector3;
  wanderT: number;
  coolT: number;
};

const BOUNDS = {
  // fish live in the upper two-thirds: that is where the light and the
  // viewer's cursor are, and staying off the sand keeps them legible
  yMin: SAND_TOP + 1.35,
  yMax: WATER_Y - 0.55,
};

export class School {
  fish: Boid[] = [];
  interest = new THREE.Vector3(0, 2.5, 0);
  interestSpeed = 0;
  private rng = Math.random;

  add(species: FishSpecies, hunger: number, length = 1.1) {
    const comet = species === 'comet';
    // half body plus the caudal fin trailing behind the position point
    const reach = length * (comet ? 0.95 : 0.80);
    const bx = TANK.hw - reach - 0.18;
    const bz = TANK.hd - reach - 0.18;
    this.fish.push({
      pos: new THREE.Vector3(
        (this.rng() - 0.5) * bx * 1.7,
        BOUNDS.yMin + this.rng() * (BOUNDS.yMax - BOUNDS.yMin),
        (this.rng() - 0.5) * bz * 1.7,
      ),
      vel: new THREE.Vector3(this.rng() - 0.5, 0, this.rng() - 0.5).normalize().multiplyScalar(0.6),
      species,
      hunger,
      curiosity: this.rng(),
      fear: 0,
      focus: 0,
      mouth: 0,
      swimAmp: 0,
      swimFreq: comet ? 3.0 : 3.4,
      phase: this.rng() * 10,
      size: comet ? 1.0 : 1.12,
      reach,
      wander: new THREE.Vector3(this.rng() - 0.5, 0, this.rng() - 0.5).normalize(),
      wanderT: 0,
      coolT: 0,
    });
  }

  scare(at: THREE.Vector3, strength = 1) {
    this.interest.copy(at);   // remember the source so fleeing points away from it
    for (const f of this.fish) {
      const d = f.pos.distanceTo(at);
      if (d < 4.2) {
        f.fear = Math.min(1.6, f.fear + strength * (1 - d / 4.2));
        // dart away
        const away = f.pos.clone().sub(at).setY(0.2).normalize();
        f.vel.addScaledVector(away, 2.2 * strength);
      }
    }
  }

  update(dt: number, _t: number, foods: Food[], obstacles: THREE.Vector3[], mouse3: THREE.Vector3 | null, mouseSpeed: number) {
    const bounds = BOUNDS;

    // mouseSpeed is in CSS pixels per second; a deliberate swipe is fast,
    // ordinary cursor drift is not
    if (mouse3 && mouseSpeed > 1800) {
      this.scare(mouse3, Math.min(1, (mouseSpeed - 1800) / 2600) * dt * 6);
    }

    for (let i = 0; i < this.fish.length; i++) {
      const f = this.fish[i];
      f.hunger = Math.min(1, f.hunger + dt * 0.0045);
      f.fear = Math.max(0, f.fear - dt * 0.75);
      f.coolT = Math.max(0, f.coolT - dt);

      const hungerK = Math.pow(f.hunger, 1.6);
      const desired = new THREE.Vector3();

      // ---- wander
      f.wanderT -= dt;
      if (f.wanderT <= 0) {
        f.wanderT = 2.5 + this.rng() * 4;
        f.wander.set(this.rng() - 0.5, (this.rng() - 0.5) * 0.35, this.rng() - 0.5).normalize();
      }
      desired.addScaledVector(f.wander, 0.55);

      // ---- separation
      for (let j = 0; j < this.fish.length; j++) {
        if (i === j) continue;
        const o = this.fish[j];
        const dv = f.pos.clone().sub(o.pos);
        const dist = dv.length();
        const minD = 1.9 * f.size;
        if (dist < minD && dist > 1e-4) {
          desired.addScaledVector(dv.normalize(), (1 - dist / minD) * 3.2);
        }
      }

      // ---- obstacle avoidance (rocks/wood + wall padding)
      for (const ob of obstacles) {
        const dv = f.pos.clone().sub(ob);
        const dist = dv.length();
        // radius scales with the fish: the old fixed 1.5 boxed even small fish
        // into the bottom of the tank
        const r = 1.5 * f.size;
        if (dist < r && dist > 1e-3) {
          desired.addScaledVector(dv.normalize(), (1 - dist / r) * 3.2);
        }
      }

      // ---- walls: bounds are per fish, since the caudal fin trails behind
      // the position point by up to `reach`
      const bx = TANK.hw - f.reach - 0.16;
      const bz = TANK.hd - f.reach - 0.16;
      if (f.pos.x > bx) desired.x -= (f.pos.x - bx) * 5;
      if (f.pos.x < -bx) desired.x += (-bx - f.pos.x) * 5;
      if (f.pos.z > bz) desired.z -= (f.pos.z - bz) * 5;
      if (f.pos.z < -bz) desired.z += (-bz - f.pos.z) * 5;
      if (f.pos.y > bounds.yMax) desired.y -= (f.pos.y - bounds.yMax) * 6;
      if (f.pos.y < bounds.yMin) desired.y += (bounds.yMin - f.pos.y) * 6;

      // ---- food seeking
      let best: Food | null = null;
      let bestD = Infinity;
      if (hungerK > 0.12) {
        for (const food of foods) {
          if (!food.alive) continue;
          const d = food.pos.distanceTo(f.pos);
          const bias = food === foods[0] ? 0.85 : 1;
          if (d * bias < bestD) { bestD = d * bias; best = food; }
        }
      }
      if (best && bestD < 9 + hungerK * 5 && f.coolT <= 0) {
        const toFood = best.pos.clone().sub(f.pos);
        const dist = toFood.length();
        desired.addScaledVector(toFood.normalize(), 3.4 * (0.35 + hungerK));
        // eat
        if (dist < 0.24 * f.size + 0.10) {
          best.alive = false;
          f.hunger = Math.max(0, f.hunger - 0.42);
          f.mouth = 1;
          f.coolT = 1.4;
          f.fear = Math.min(f.fear, 0.35);
        }
      }

      // ---- curiosity toward the cursor
      if (mouse3 && f.fear < 0.2) {
        const d = f.pos.distanceTo(mouse3);
        if (d < 3.4) {
          const k = (1 - d / 3.4) * (0.55 + f.curiosity * 0.85);
          const to = mouse3.clone().sub(f.pos).normalize();
          desired.addScaledVector(to, k * 1.7);
          // hovering close, half-turn to inspect
          if (d < 1.35) {
            f.focus = Math.min(1, f.focus + dt * 1.6);
            desired.addScaledVector(to, -0.9 + f.focus * 0.5);
            desired.y *= 0.6;
          } else {
            f.focus = Math.max(0, f.focus - dt * 1.2);
          }
        } else {
          f.focus = Math.max(0, f.focus - dt * 1.2);
        }
      } else {
        f.focus = Math.max(0, f.focus - dt * 1.8);
      }

      // ---- fear: flee from whatever startled the school
      if (f.fear > 0.01) {
        const away = f.pos.clone().sub(this.interest).setY(0.1).normalize();
        desired.addScaledVector(away, f.fear * 4.5);
        f.focus = 0;
      }

      // ---- integrate steering
      desired.normalize();
      // slow, heavy water feel: less speed, gentler acceleration
      const baseSpeed = (0.62 + 0.38 * (1 - hungerK * 0.5)) * (f.species === 'comet' ? 1.20 : 1.0);
      const speedTarget = baseSpeed * (1 - f.focus * 0.55) * (1 + f.fear * 1.5);
      f.vel.lerp(desired.multiplyScalar(speedTarget), 1 - Math.exp(-dt * 1.15));
      const sp = f.vel.length();
      if (sp > 1.7) f.vel.multiplyScalar(1.7 / sp);
      f.pos.addScaledVector(f.vel, dt);

      // hard clamp so a fast turn can never push geometry through the glass
      const cbx = TANK.hw - f.reach - 0.10;
      const cbz = TANK.hd - f.reach - 0.10;
      f.pos.x = THREE.MathUtils.clamp(f.pos.x, -cbx, cbx);
      f.pos.z = THREE.MathUtils.clamp(f.pos.z, -cbz, cbz);
      f.pos.y = THREE.MathUtils.clamp(f.pos.y, SAND_TOP + 1.15, WATER_Y - 0.42);

      // ---- swim animation params
      // Real fish sweep the caudal peduncle about 10-15% of body length, not
      // the 4% an earlier tuning produced — that was the "stiff fish" tell.
      const targetAmp = THREE.MathUtils.clamp(sp * 0.17 + 0.055, 0.055, 0.20) * (1 + f.fear * 0.5);
      f.swimAmp += (targetAmp - f.swimAmp) * (1 - Math.exp(-dt * 2.2));
      f.swimFreq = (f.species === 'comet' ? 2.2 : 2.7) + sp * 1.4 + f.fear * 3.0;
      // integrate phase on the CPU: passing t*freq as a phase cancels the
      // shader's own time term and freezes the wave, so accumulate instead
      f.phase += f.swimFreq * dt;
      f.mouth = Math.max(0, f.mouth - dt * 1.8);
      // idle gape: real fish keep working their jaws while cruising
      const idleMouth = 0.10 + 0.08 * Math.sin(f.phase * 0.55 + f.size * 6.28);
      f.mouth = Math.max(f.mouth, idleMouth);
    }
  }
}
