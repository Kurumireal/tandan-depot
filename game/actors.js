// Actor figures: a low-poly soldier per bot — legs, torso, head and a gun — in team
// colours. The torso, head and legs are separate hit meshes whose userData names the
// actor and the part, so the player's raycast can price a headshot apart from a leg
// shot. Bots never raycast each other; their fire is resolved by bots.js rolls against
// the same damage table, so both directions play by one set of numbers.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const HEALTH = 100;

export function createActorMesh(team) {
  const uniform = new THREE.MeshStandardMaterial({
    color: new THREE.Color(team === 'raiders' ? PALETTE.enemy : PALETTE.ally),
    roughness: 0.75, metalness: 0.05,
  });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.85 });
  const skin = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.muted), roughness: 0.6 });

  const group = new THREE.Group();
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.72, 0.26), dark);
  legs.position.y = 0.36;
  legs.userData.part = 'legs';
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.66, 0.3), uniform);
  torso.position.y = 1.05;
  torso.userData.part = 'torso';
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), skin);
  head.position.y = 1.56;
  head.userData.part = 'head';
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.175, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), dark);
  helmet.position.y = 1.58;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.62), dark);
  gun.position.set(0.18, 1.18, -0.3);
  group.add(legs, torso, head, helmet, gun);
  group.traverse((mesh) => {
    if (mesh.isMesh) mesh.castShadow = true;
  });
  return { group, hitMeshes: [torso, head, legs], gun };
}

// One combatant's state. The body is a physics body; this wraps health, team and the
// mesh around it. `isPlayer` actors have no mesh: the camera is their head.
export function createActor(team, body, mesh) {
  const actor = {
    team,
    body,
    mesh: mesh ?? null,
    health: HEALTH,
    armor: false,
    alive: true,
    kills: 0,
    deaths: 0,
    fall: 0,
    isPlayer: false,
    weaponId: 'pistol',
    money: 800,
  };
  if (mesh) {
    for (const part of mesh.hitMeshes) part.userData.actor = actor;
  }
  return actor;
}

export function resetActor(actor, spawn) {
  actor.health = HEALTH;
  actor.alive = true;
  actor.fall = 0;
  actor.body.position.set(spawn.x, 0, spawn.z);
  actor.body.velocity.set(0, 0, 0);
  actor.body.yaw = spawn.yaw;
  actor.body.pitch = 0;
  if (actor.mesh) {
    actor.mesh.group.visible = true;
    actor.mesh.group.rotation.set(0, spawn.yaw, 0);
    actor.mesh.group.position.set(spawn.x, 0, spawn.z);
  }
}

// Pose the mesh from the body each frame: position, facing, a walk bob and the gun's
// pitch. A dead actor tips over where it fell.
export function poseActor(actor, time) {
  if (!actor.mesh) return;
  const { group } = actor.mesh;
  const body = actor.body;
  group.position.copy(body.position);
  if (!actor.alive) {
    actor.fall = Math.min(1, actor.fall + 0.06);
    group.rotation.set(-actor.fall * 1.5, body.yaw, 0);
    group.position.y = body.position.y - actor.fall * 0.1;
    return;
  }
  group.rotation.set(0, body.yaw, 0);
  const bob = body.speed > 0.4 ? Math.sin(time * 11 + body.position.x) * 0.03 : 0;
  group.position.y = body.position.y + Math.abs(bob);
  actor.mesh.gun.rotation.x = -body.pitch;
}
