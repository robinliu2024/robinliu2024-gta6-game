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
    this._geo.dispose();
    this._points.material.dispose();
  }
}

export function createEffects(scene, opts) {
  return new Effects(scene, opts);
}

export default Effects;
