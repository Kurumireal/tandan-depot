// Bodies: one movement model for the player and every bot. Acceleration, friction,
// gravity, crouch and jump, resolved as a box against the world's colliders one axis at
// a time, so a wall never swallows a body. Callers pass a world-space wish direction;
// this module owns the numbers.
import * as THREE from 'three';

export const RADIUS = 0.34;
export const STAND_HEIGHT = 1.72;
export const CROUCH_HEIGHT = 1.12;
export const STAND_EYE = 1.6;
export const CROUCH_EYE = 1.02;
const WALK_SPEED = 5.2;
const CROUCH_SPEED = 2.4;
const GROUND_ACCEL = 42;
const AIR_ACCEL = 9;
const FRICTION = 9;
const GRAVITY = 20;
const JUMP_SPEED = 6.2;

export function createBody(x, z, yaw) {
  return {
    position: new THREE.Vector3(x, 0, z),
    velocity: new THREE.Vector3(),
    yaw,
    pitch: 0,
    eye: STAND_EYE,
    height: STAND_HEIGHT,
    crouching: false,
    onGround: true,
    speed: 0,
  };
}

const probe = new THREE.Box3();

function overlaps(colliders, x, y, z, height, lift) {
  probe.min.set(x - RADIUS, y + lift, z - RADIUS);
  probe.max.set(x + RADIUS, y + height - lift, z + RADIUS);
  for (const collider of colliders) if (probe.intersectsBox(collider)) return collider;
  return null;
}

// wishX/wishZ: desired world-space direction (unit length or zero). speedScale lets a
// bot walk slower than the player's full pace; crouch and jump are momentary inputs.
export function stepBody(body, colliders, dt, wishX, wishZ, crouch, jump, speedScale = 1) {
  if (crouch && !body.crouching) {
    body.crouching = true;
    body.height = CROUCH_HEIGHT;
  } else if (!crouch && body.crouching && !overlaps(colliders, body.position.x, body.position.y, body.position.z, STAND_HEIGHT, 0.02)) {
    body.crouching = false;
    body.height = STAND_HEIGHT;
  }
  const eyeTarget = body.crouching ? CROUCH_EYE : STAND_EYE;
  body.eye += (eyeTarget - body.eye) * Math.min(1, dt * 12);

  const speed = (body.crouching ? CROUCH_SPEED : WALK_SPEED) * speedScale;
  const blend = Math.min(1, (body.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt / Math.max(speed, 0.01));
  body.velocity.x += (wishX * speed - body.velocity.x) * blend;
  body.velocity.z += (wishZ * speed - body.velocity.z) * blend;
  if (body.onGround && wishX === 0 && wishZ === 0) {
    const damp = Math.max(0, 1 - FRICTION * dt);
    body.velocity.x *= damp;
    body.velocity.z *= damp;
  }

  if (jump && body.onGround) {
    body.velocity.y = JUMP_SPEED;
    body.onGround = false;
  }
  body.velocity.y -= GRAVITY * dt;

  const nextX = body.position.x + body.velocity.x * dt;
  if (!overlaps(colliders, nextX, body.position.y, body.position.z, body.height, 0.04)) body.position.x = nextX;
  else body.velocity.x = 0;
  const nextZ = body.position.z + body.velocity.z * dt;
  if (!overlaps(colliders, body.position.x, body.position.y, nextZ, body.height, 0.04)) body.position.z = nextZ;
  else body.velocity.z = 0;

  body.position.y += body.velocity.y * dt;
  body.onGround = false;
  const hit = overlaps(colliders, body.position.x, body.position.y, body.position.z, body.height, 0);
  if (hit && body.velocity.y <= 0) {
    body.position.y = hit.max.y;
    body.velocity.y = 0;
    body.onGround = true;
  } else if (hit) {
    body.position.y = hit.min.y - body.height;
    body.velocity.y = 0;
  }
  if (body.position.y < 0) {
    body.position.y = 0;
    body.velocity.y = 0;
    body.onGround = true;
  }
  body.velocity.y = Math.max(-30, body.velocity.y);
  body.speed = Math.hypot(body.velocity.x, body.velocity.z);
}

// Line of sight between two points: false when any shootable box blocks the segment.
// Uses three's raycaster against the map meshes only; callers throttle how often.
const raycaster = new THREE.Raycaster();
const origin = new THREE.Vector3();
const direction = new THREE.Vector3();
export function lineOfSight(shootables, ax, ay, az, bx, by, bz) {
  origin.set(ax, ay, az);
  direction.set(bx - ax, by - ay, bz - az);
  const distance = direction.length();
  if (distance < 0.01) return true;
  direction.normalize();
  raycaster.set(origin, direction);
  raycaster.far = distance - 0.05;
  const hits = raycaster.intersectObjects(shootables, false);
  return hits.length === 0;
}
