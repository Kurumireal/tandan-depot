// The player: a physics body steered by the keyboard, plus look and recoil. All movement
// numbers live in physics.js, shared with the bots, so a bot and the player cross the
// map at the same pace.
import { createBody, stepBody } from './physics.js';

export function createPlayer(colliders, spawn) {
  const body = createBody(spawn.x, spawn.z, spawn.yaw);

  function look(dx, dy, sensitivity = 0.0021) {
    body.yaw -= dx * sensitivity;
    body.pitch = Math.max(-1.45, Math.min(1.45, body.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    body.pitch = Math.min(1.45, body.pitch + pitchKick);
    body.yaw += yawKick;
  }

  function teleport(next) {
    body.position.set(next.x, 0, next.z);
    body.velocity.set(0, 0, 0);
    body.yaw = next.yaw;
    body.pitch = 0;
  }

  function step(dt, keys) {
    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    let wishX = 0;
    let wishZ = 0;
    if (forward || strafe) {
      const sin = Math.sin(body.yaw);
      const cos = Math.cos(body.yaw);
      wishX = -sin * forward + cos * strafe;
      wishZ = -cos * forward - sin * strafe;
      const length = Math.hypot(wishX, wishZ);
      wishX /= length;
      wishZ /= length;
    }
    const crouch = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    const walk = keys.has('ShiftLeft') || keys.has('ShiftRight');
    stepBody(body, colliders, dt, wishX, wishZ, crouch, keys.has('Space'), walk ? 0.55 : 1);
  }

  return { state: body, step, look, recoil, teleport };
}
