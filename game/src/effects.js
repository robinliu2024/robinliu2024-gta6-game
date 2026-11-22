// Solmar Heat — effects: particle bursts (crash debris, muzzle flash,
// explosion), fading skid marks under tires, gun tracers subscribed to the
// player's onShoot hook, and a small screen-shake hook the camera reads.

import * as THREE from 'three';

const MAX_PARTICLES = 240;
const MAX_SKIDS = 90;
const MAX_TRACERS = 12;

function makeParticleMaterial(color, size) {
  return new THREE.PointsMaterial({
    color, size, transparent: true, opacity: 1,
    depthWrite: false, sizeAttenuation: true,
  });
}

export class Effects {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.lowQuality = !!opts.lowQuality;
    this.particles = []; // {points, vel[], life, maxLife}
    this.skids = [];     // {mesh, life}
    this.tracers = [];   // {line, life}
    this.shockwaves = []; // {mesh, life}
    this.shakeAmount = 0;
    this.shakeTime = 0;
    this._geo = new THREE.BufferGeometry();
    this._positions = new Float32Array(MAX_PARTICLES * 3);
    this._geo.setAttribute('position', new THREE.BufferAttribute(this._positions, 3));
    this._points = new THREE.Points(this._geo, makeParticleMaterial(0xffc46b, 0.35));
    this._points.frustumCulled = false;
    this._vel = new Float32Array(MAX_PARTICLES * 3);
    this._life = new Float32Array(MAX_PARTICLES);
    this._count = 0;
    this._points.geometry.setDrawRange(0, 0);
    scene.add(this._points);
    // Smoke pool (v3, burning wrecks): separate from the fire pool so the
    // grey smoke is not recoloured by the next fire burst. Smoke rises
    // slowly instead of falling, and lives longer.
    this._smokeGeo = new THREE.BufferGeometry();
    this._smokePositions = new Float32Array(MAX_PARTICLES * 3);
    this._smokeGeo.setAttribute('position', new THREE.BufferAttribute(this._smokePositions, 3));
    this._smokePoints = new THREE.Points(
      this._smokeGeo,
      new THREE.PointsMaterial({
        color: 0x5a5a5a, size: 1.1, transparent: true, opacity: 0.55,
        depthWrite: false, sizeAttenuation: true,
      }),
    );
    this._smokePoints.frustumCulled = false;
    this._smokeVel = new Float32Array(MAX_PARTICLES * 3);
    this._smokeLife = new Float32Array(MAX_PARTICLES);
    this._smokeCount = 0;
    this._smokePoints.geometry.setDrawRange(0, 0);
    scene.add(this._smokePoints);
    this._skidGeo = new THREE.PlaneGeometry(0.5, 1.4);
    this._skidMat = new THREE.MeshBasicMaterial({
      color: 0x0a0a0a, transparent: true, opacity: 0.55, depthWrite: false,
    });
  }

  // Screen shake: main.js adds the returned offset to the camera each frame.
  shake(amount) {
    this.shakeAmount = Math.min(1.2, this.shakeAmount + amount);
    this.shakeTime = 0.45;
  }

  shakeOffset(dt) {
    if (this.shakeTime <= 0 || this.shakeAmount <= 0.01) return { x: 0, y: 0 };
    this.shakeTime -= dt;
    const a = this.shakeAmount * (this.shakeTime / 0.45);
    this.shakeAmount *= Math.max(0, 1 - dt * 3);
    return {
      x: (Math.random() * 2 - 1) * a * 0.35,
      y: (Math.random() * 2 - 1) * a * 0.25,
    };
  }

  _spawnBurst(pos, count, color, speed, up, life) {
    if (this.lowQuality) count = Math.ceil(count / 2);
    for (let i = 0; i < count; i++) {
      if (this._count >= MAX_PARTICLES) return;
      const idx = this._count++;
      this._positions[idx * 3] = pos.x;
      this._positions[idx * 3 + 1] = pos.y + 0.3;
      this._positions[idx * 3 + 2] = pos.z;
      const ang = Math.random() * Math.PI * 2;
      const sp = speed * (0.4 + Math.random() * 0.8);
      this._vel[idx * 3] = Math.cos(ang) * sp;
      this._vel[idx * 3 + 1] = up * (0.5 + Math.random());
      this._vel[idx * 3 + 2] = Math.sin(ang) * sp;
      this._life[idx] = life * (0.6 + Math.random() * 0.6);
    }
    this._points.material.color.setHex(color);
  }

  spawnCrash(pos) {
    this._spawnBurst(pos, 26, 0xffc46b, 7, 3, 0.7);
    this.shake(0.35);
  }

  spawnExplosion(pos) {
    this._spawnBurst(pos, 60, 0xff7a2a, 12, 7, 1.1);
    this._spawnBurst(pos, 24, 0xffe9a8, 5, 9, 0.5);
    this.shake(1.0);
  }

  // Small fire puff for a burning wreck (reuses the fire particle pool).
  spawnFire(pos) {
    this._spawnBurst(pos, 8, 0xff7a2a, 2.5, 4, 0.7);
  }

  // Grey smoke puff for a burning wreck (own pool: rises, lives ~3 s).
  spawnSmoke(pos) {
    const count = this.lowQuality ? 3 : 6;
    for (let i = 0; i < count; i++) {
      if (this._smokeCount >= MAX_PARTICLES) return;
      const idx = this._smokeCount++;
      this._smokePositions[idx * 3] = pos.x + (Math.random() - 0.5) * 1.2;
      this._smokePositions[idx * 3 + 1] = pos.y + 0.6 + Math.random() * 0.5;
      this._smokePositions[idx * 3 + 2] = pos.z + (Math.random() - 0.5) * 1.2;
      this._smokeVel[idx * 3] = (Math.random() - 0.5) * 0.8;
      this._smokeVel[idx * 3 + 1] = 1.2 + Math.random() * 1.4;
      this._smokeVel[idx * 3 + 2] = (Math.random() - 0.5) * 0.8;
      this._smokeLife[idx] = 2.2 + Math.random() * 1.2;
    }
  }

  // Expanding shockwave ring for a vehicle explosion: grows to ~12 m and
  // fades in ~0.6 s.
  spawnShockwave(pos) {
    const geo = new THREE.RingGeometry(0.6, 1.0, 32);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffb060, transparent: true, opacity: 0.85,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const ring = new THREE.Mesh(geo, mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(pos.x, 0.25, pos.z);
    this.scene.add(ring);
    this.shockwaves.push({ mesh: ring, life: 0.6, maxLife: 0.6 });
  }

  spawnMuzzle(pos, dir) {
    const at = pos.clone().add(dir.clone().multiplyScalar(0.8));
    at.y = Math.max(0.4, at.y);
    this._spawnBurst(at, 6, 0xffe9a8, 4, 1, 0.18);
  }

  // Tracer: a bright line from the muzzle that fades in ~90ms.
  spawnTracer(from, to) {
    const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: 0xffe9a8, transparent: true, opacity: 0.9,
    }));
    this.scene.add(line);
    this.tracers.push({ line, life: 0.09 });
    if (this.tracers.length > MAX_TRACERS) {
      const old = this.tracers.shift();
      this.scene.remove(old.line);
      old.line.geometry.dispose();
      old.line.material.dispose();
    }
  }

  // Subscribe to the player's shooting hook (part B's onShoot).
  subscribeToPlayer(player) {
    if (!player || typeof player.onShoot !== 'function') return () => {};
    return player.onShoot((evt) => {
      this.spawnTracer(evt.from, evt.to);
      this.spawnMuzzle(evt.from, evt.dir);
    });
  }

  // Dark quad under a tire; fades out over a few seconds.
  addSkid(pos, heading) {
    if (this.lowQuality && this.skids.length > 40) return;
    const mesh = new THREE.Mesh(this._skidGeo, this._skidMat.clone());
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = -heading;
    mesh.position.set(pos.x, 0.06, pos.z);
    this.scene.add(mesh);
    this.skids.push({ mesh, life: 5 });
    if (this.skids.length > MAX_SKIDS) {
      const old = this.skids.shift();
      this.scene.remove(old.mesh);
      old.mesh.material.dispose();
    }
  }

  update(dt) {
    // Particles: integrate, apply gravity, compact the dead ones.
    let n = 0;
    for (let i = 0; i < this._count; i++) {
      this._life[i] -= dt;
      if (this._life[i] <= 0) continue;
      this._vel[i * 3 + 1] -= 14 * dt;
      this._positions[i * 3] += this._vel[i * 3] * dt;
      this._positions[i * 3 + 1] = Math.max(0.05, this._positions[i * 3 + 1] + this._vel[i * 3 + 1] * dt);
      this._positions[i * 3 + 2] += this._vel[i * 3 + 2] * dt;
      if (i !== n) {
        for (let k = 0; k < 3; k++) {
          this._positions[n * 3 + k] = this._positions[i * 3 + k];
          this._vel[n * 3 + k] = this._vel[i * 3 + k];
        }
        this._life[n] = this._life[i];
      }
      n++;
    }
    this._count = n;
    this._geo.setDrawRange(0, n);
    this._geo.attributes.position.needsUpdate = true;
    this._points.material.opacity = n ? 0.95 : 0;
    // Smoke: rises slowly, drifts, no gravity; compact the dead ones.
    let sn = 0;
    for (let i = 0; i < this._smokeCount; i++) {
      this._smokeLife[i] -= dt;
      if (this._smokeLife[i] <= 0) continue;
      this._smokeVel[i * 3] *= Math.max(0, 1 - dt * 0.4);
      this._smokeVel[i * 3 + 2] *= Math.max(0, 1 - dt * 0.4);
      this._smokePositions[i * 3] += this._smokeVel[i * 3] * dt;
      this._smokePositions[i * 3 + 1] += this._smokeVel[i * 3 + 1] * dt;
      this._smokePositions[i * 3 + 2] += this._smokeVel[i * 3 + 2] * dt;
      if (i !== sn) {
        for (let k = 0; k < 3; k++) {
          this._smokePositions[sn * 3 + k] = this._smokePositions[i * 3 + k];
          this._smokeVel[sn * 3 + k] = this._smokeVel[i * 3 + k];
        }
        this._smokeLife[sn] = this._smokeLife[i];
      }
      sn++;
    }
    this._smokeCount = sn;
    this._smokeGeo.setDrawRange(0, sn);
    this._smokeGeo.attributes.position.needsUpdate = true;
    this._smokePoints.material.opacity = sn ? 0.55 : 0;
    // Shockwave rings: expand and fade.
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const s = this.shockwaves[i];
      s.life -= dt;
      const f = Math.max(0, s.life / s.maxLife);
      const scale = 1 + (1 - f) * 11;
      s.mesh.scale.set(scale, scale, 1);
      s.mesh.material.opacity = f * 0.85;
      if (s.life <= 0) {
        this.scene.remove(s.mesh);
        s.mesh.geometry.dispose();
        s.mesh.material.dispose();
        this.shockwaves.splice(i, 1);
      }
    }
    // Tracers fade fast.
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / 0.09) * 0.9;
      if (t.life <= 0) {
        this.scene.remove(t.line);
        t.line.geometry.dispose();
        t.line.material.dispose();
        this.tracers.splice(i, 1);
      }
    }
    // Skid marks fade slowly.
    for (let i = this.skids.length - 1; i >= 0; i--) {
      const s = this.skids[i];
      s.life -= dt;
      s.mesh.material.opacity = Math.max(0, s.life / 5) * 0.55;
      if (s.life <= 0) {
        this.scene.remove(s.mesh);
        s.mesh.material.dispose();
        this.skids.splice(i, 1);
      }
    }
  }

  dispose() {
    this.scene.remove(this._points);
    this.scene.remove(this._smokePoints);
    this._geo.dispose();
    this._smokeGeo.dispose();
    this._points.material.dispose();
    this._smokePoints.material.dispose();
    for (const s of this.shockwaves) {
      this.scene.remove(s.mesh);
      s.mesh.geometry.dispose();
      s.mesh.material.dispose();
    }
    this.shockwaves = [];
  }
}

export function createEffects(scene, opts) {
  return new Effects(scene, opts);
}

export default Effects;
