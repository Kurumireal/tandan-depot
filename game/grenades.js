// Grenades: thrown physics projectiles with three payloads. A high-explosive charge
// bursts for area damage, a smoke charge blooms into a sphere that blocks sight lines
// (the bots' vision tests against it, and so does the player's screen), and a flash
// charge blinds whoever looks at it. The match owns damage and blindness; this module
// owns the flight, the bounce and the shapes.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const GRAVITY = 14;
const SMOKE_RADIUS = 3.4;
const SMOKE_SECONDS = 15;

export function createGrenades(scene, effects) {
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.6, metalness: 0.3 });
  const smokeMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.muted), transparent: true, opacity: 0.42, roughness: 1, depthWrite: false,
  });
  const flying = [];
  const smokes = [];
  const flashes = [];

  function throwGrenade(kind, from, direction, owner) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), bodyMaterial);
    mesh.position.copy(from);
    scene.add(mesh);
    flying.push({
      kind,
      mesh,
      owner,
      velocity: new THREE.Vector3(direction.x * 13, direction.y * 13 + 4.5, direction.z * 13),
      fuse: kind === 'he' ? 1.5 : kind === 'flash' ? 1.25 : 1.1,
      bounced: false,
    });
  }

  function detonate(item) {
    scene.remove(item.mesh);
    const pos = item.mesh.position;
    if (item.kind === 'he') {
      effects.explode(pos, item.owner);
    } else if (item.kind === 'flash') {
      effects.flash(pos, item.owner);
      const light = new THREE.PointLight(new THREE.Color(PALETTE.ink), 90, 22, 1.6);
      light.position.copy(pos);
      scene.add(light);
      flashes.push({ light, left: 0.12 });
    } else {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.4, 18, 14), smokeMaterial);
      mesh.position.copy(pos);
      mesh.position.y = Math.max(1.2, pos.y);
      scene.add(mesh);
      smokes.push({ mesh, left: SMOKE_SECONDS, radius: 0.4 });
    }
  }

  const probe = new THREE.Box3();
  function step(dt, colliders) {
    for (let i = flying.length - 1; i >= 0; i -= 1) {
      const item = flying[i];
      item.fuse -= dt;
      item.velocity.y -= GRAVITY * dt;
      const pos = item.mesh.position;
      pos.addScaledVector(item.velocity, dt);
      if (pos.y < 0.1) {
        pos.y = 0.1;
        item.velocity.y *= -0.35;
        item.velocity.x *= 0.7;
        item.velocity.z *= 0.7;
        item.bounced = true;
      }
      probe.min.set(pos.x - 0.09, pos.y - 0.09, pos.z - 0.09);
      probe.max.set(pos.x + 0.09, pos.y + 0.09, pos.z + 0.09);
      for (const collider of colliders) {
        if (probe.intersectsBox(collider)) {
          item.velocity.x *= -0.4;
          item.velocity.z *= -0.4;
          item.velocity.y = Math.abs(item.velocity.y) * 0.3;
          pos.y = Math.max(pos.y, collider.max.y + 0.1);
          item.bounced = true;
          break;
        }
      }
      if (item.fuse <= 0) {
        detonate(item);
        flying.splice(i, 1);
      }
    }
    for (let i = smokes.length - 1; i >= 0; i -= 1) {
      const smoke = smokes[i];
      smoke.left -= dt;
      smoke.radius = Math.min(SMOKE_RADIUS, smoke.radius + dt * 2.6);
      const fade = Math.min(1, smoke.left / 2);
      smoke.mesh.scale.setScalar(smoke.radius / 0.4);
      smoke.mesh.material.opacity = 0.42 * fade;
      if (smoke.left <= 0) {
        scene.remove(smoke.mesh);
        smokes.splice(i, 1);
      }
    }
    for (let i = flashes.length - 1; i >= 0; i -= 1) {
      flashes[i].left -= dt;
      if (flashes[i].left <= 0) {
        scene.remove(flashes[i].light);
        flashes.splice(i, 1);
      }
    }
  }

  // Does the segment pass through any live smoke sphere?
  function smokeBlocks(ax, ay, az, bx, by, bz) {
    for (const smoke of smokes) {
      const c = smoke.mesh.position;
      const abx = bx - ax; const aby = by - ay; const abz = bz - az;
      const t = Math.max(0, Math.min(1, ((c.x - ax) * abx + (c.y - ay) * aby + (c.z - az) * abz) / (abx * abx + aby * aby + abz * abz || 1)));
      const dx = ax + abx * t - c.x;
      const dy = ay + aby * t - c.y;
      const dz = az + abz * t - c.z;
      if (dx * dx + dy * dy + dz * dz < smoke.radius * smoke.radius) return true;
    }
    return false;
  }

  return { throwGrenade, step, smokeBlocks };
}
