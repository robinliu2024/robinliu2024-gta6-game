// effects.js — cheap visual feedback: particle bursts (sparks, blood, smoke),
// bullet tracers, muzzle flashes, skid marks that fade, and a mission ring.
// All particles are pooled meshes so the game never allocates mid-frame.
import * as THREE from 'three';

const POOL = 240;

export function createEffects(G) {
  const scene = G.scene;
  const geo = new THREE.BoxGeometry(0.22, 0.22, 0.22);
  const particles = [];
  for (let i = 0; i < POOL; i += 1) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true });
    const m = new THREE.Mesh(geo, mat);
    m.visible = false;
    scene.add(m);
    particles.push({ mesh: m, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, gravity: 0 });
  }
  let next = 0;
  function spawn(x, y, z, color, count, speed, up, gravity, life) {
    for (let i = 0; i < count; i += 1) {
      const p = particles[next];
      next = (next + 1) % POOL;
      p.mesh.visible = true;
      p.mesh.material.color.setHex(color);
      p.mesh.position.set(x, y, z);
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.6);
      p.vx = Math.cos(a) * s;
      p.vz = Math.sin(a) * s;
      p.vy = up * (0.5 + Math.random());
      p.gravity = gravity;
      p.life = life * (0.6 + Math.random() * 0.4);
      p.maxLife = p.life;
    }
  }

  // Skid marks: dark quads laid on the road, fading over seconds.
  const skids = [];
  const skidGeo = new THREE.PlaneGeometry(0.5, 1.6);
  for (let i = 0; i < 120; i += 1) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x141414, transparent: true, opacity: 0 });
    const m = new THREE.Mesh(skidGeo, mat);
    m.rotation.x = -Math.PI / 2;
    m.visible = false;
    scene.add(m);
    skids.push({ mesh: m, life: 0 });
  }
  let skidNext = 0;

  // One tracer line, reused for every shot.
  const tracerMat = new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0 });
  const tracerGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const tracer = new THREE.Line(tracerGeo, tracerMat);
  scene.add(tracer);
  let tracerLife = 0;

  return {
    sparks(x, z) { spawn(x, 1, z, 0xffd76a, 10, 6, 4, -12, 0.4); },
    blood(x, z) { spawn(x, 1, z, 0xc01818, 12, 3, 2, -9, 0.6); },
    smoke(x, z) { spawn(x, 1.2, z, 0x666666, 14, 2, 3, 2, 1.2); },
    explosion(x, z) {
      spawn(x, 1, z, 0xff7a1a, 30, 10, 8, -10, 0.8);
      spawn(x, 1, z, 0x333333, 20, 4, 6, 3, 1.6);
      spawn(x, 1, z, 0xffe9a8, 12, 14, 6, -6, 0.3);
    },
    muzzle(x, y, z) { spawn(x, y, z, 0xffe9a8, 4, 2, 1, 0, 0.08); },
    tracer(from, to) {
      tracerGeo.setFromPoints([from, to]);
      tracerMat.opacity = 0.9;
      tracerLife = 0.09;
    },
    skid(x, z, heading) {
      const s = skids[skidNext];
      skidNext = (skidNext + 1) % skids.length;
      s.mesh.visible = true;
      s.mesh.material.opacity = 0.55;
      s.mesh.position.set(x - Math.sin(heading) * 0.4, 0.06, z - Math.cos(heading) * 0.4);
      s.mesh.rotation.z = -heading;
      s.life = 6;
    },
    ring(x, z) {
      spawn(x, 0.5, z, 0xffb400, 24, 8, 3, -4, 0.7);
    },
    update(dt) {
      for (const p of particles) {
        if (p.life <= 0) continue;
        p.life -= dt;
        if (p.life <= 0) { p.mesh.visible = false; continue; }
        p.vy += p.gravity * dt;
        p.mesh.position.x += p.vx * dt;
        p.mesh.position.y = Math.max(0.1, p.mesh.position.y + p.vy * dt);
        p.mesh.position.z += p.vz * dt;
        p.mesh.material.opacity = p.life / p.maxLife;
      }
      for (const s of skids) {
        if (s.life <= 0) continue;
        s.life -= dt;
        s.mesh.material.opacity = Math.max(0, s.life / 6) * 0.55;
        if (s.life <= 0) s.mesh.visible = false;
      }
      if (tracerLife > 0) {
        tracerLife -= dt;
        tracerMat.opacity = Math.max(0, tracerLife / 0.09) * 0.9;
      }
    },
  };
}
