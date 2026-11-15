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
  wander: THREE.Vector3;
  wanderT: number;
  coolT: number;
};

const BOUNDS = {
  x: TANK.hw - 0.85,
  z: TANK.hd - 0.7,
  yMin: SAND_TOP + 1.05,
  yMax: WATER_Y - 0.55,
};

export class School {
  fish: Boid[] = [];
  interest = new THREE.Vector3(0, 2.5, 0);
  interestSpeed = 0;
  private rng = Math.random;

  add(species: FishSpecies, hunger: number) {
    const comet = species === 'comet';
    this.fish.push({
      pos: new THREE.Vector3(
        (this.rng() - 0.5) * BOUNDS.x * 1.6,
        BOUNDS.yMin + this.rng() * (BOUNDS.yMax - BOUNDS.yMin),
        (this.rng() - 0.5) * BOUNDS.z * 1.6,
      ),
      vel: new THREE.Vector3(this.rng() - 0.5, 0, this.rng() - 0.5).normalize().multiplyScalar(0.6),
      species,
      hunger,
      curiosity: this.rng(),
      fear: 0,
      focus: 0,
      mouth: 0,
      swimAmp: 0,
      swimFreq: comet ? 7.0 : 8.5,
      phase: this.rng() * 10,
      size: comet ? 1.0 : 1.12,
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

    if (mouse3 && mouseSpeed > 0.55) {
      // fast swipe = a passing shadow, fish scatter briefly
      this.scare(mouse3, Math.min(1, (mouseSpeed - 0.55) * 1.5) * dt * 6);
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
        if (dist < 1.5 && dist > 1e-3) {
          desired.addScaledVector(dv.normalize(), (1 - dist / 1.5) * 3.2);
        }
      }

      // ---- walls
      if (f.pos.x > bounds.x) desired.x -= (f.pos.x - bounds.x) * 5;
      if (f.pos.x < -bounds.x) desired.x += (-bounds.x - f.pos.x) * 5;
      if (f.pos.z > bounds.z) desired.z -= (f.pos.z - bounds.z) * 5;
      if (f.pos.z < -bounds.z) desired.z += (-bounds.z - f.pos.z) * 5;
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

      // clamp inside the glass. The lower bound keeps the belly and anal fin
      // clear of the sand: a fish's body centre sits roughly one girth plus fin
      // span above its lowest point, not a fixed small offset.
      f.pos.x = THREE.MathUtils.clamp(f.pos.x, -TANK.hw + 0.35, TANK.hw - 0.35);
      f.pos.z = THREE.MathUtils.clamp(f.pos.z, -TANK.hd + 0.30, TANK.hd - 0.30);
      f.pos.y = THREE.MathUtils.clamp(f.pos.y, SAND_TOP + 0.95, WATER_Y - 0.30);

      // ---- swim animation params
      // Goldfish cruise lazily: a calm tail beat is ~0.7 Hz and only speeds up
      // when startled. uSwimFreq is angular (rad/s), so keep it low.
      const targetAmp = THREE.MathUtils.clamp(sp * 0.055 + 0.008, 0, 0.18) * (1 + f.fear * 0.35);
      f.swimAmp += (targetAmp - f.swimAmp) * (1 - Math.exp(-dt * 2.2));
      f.swimFreq = (f.species === 'comet' ? 2.6 : 3.2) + sp * 1.0 + f.fear * 3.0;
      // integrate phase on the CPU: passing t*freq as a phase cancels the
      // shader's own time term and freezes the wave, so accumulate instead
      f.phase += f.swimFreq * dt;
      f.mouth = Math.max(0, f.mouth - dt * 1.8);
    }
  }
}
