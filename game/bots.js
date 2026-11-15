// Bot minds: one per bot actor. A mind perceives (sight inside a cone with line of
// sight, hearing from the round's noise list), follows a plan across the waypoint
// graph, fights with bursts that punish moving targets and moving shooters, and works
// the objective: carriers plant, guards hold, defenders retake and defuse. All damage
// is priced by weapons.js through the match context, so bots and the player share one
// set of numbers.
import { NAV } from './map.js';
import { stepBody } from './physics.js';
import { WEAPONS } from './weapons.js';

const SIGHT_RANGE = 34;
const SIGHT_COS = Math.cos(1.25); // ~72 degrees each way
const MEMORY_SECONDS = 4;

export function createMind(actor, plan, random) {
  return {
    actor,
    plan, // { kind: 'attack'|'defend'|'mid', site: 0|1|null }
    path: [],
    pathAt: 0,
    goalNode: -1,
    visible: null,
    seenAt: -Infinity,
    seenPos: { x: 0, z: 0 },
    alertPos: null,
    alertAt: -Infinity,
    thinkAt: random() * 0.12,
    fireAt: 0,
    burstLeft: 0,
    pauseUntil: 0,
    reloadUntil: 0,
    mag: WEAPONS[actor.weaponId].mag,
    reserve: WEAPONS[actor.weaponId].reserve * 2,
    strafeDir: 1,
    strafeUntil: 0,
    stuckAt: 0,
    lastDist: Infinity,
    holdUntil: 0,
    blindUntil: 0,
    hasCharge: false,
    usedSmoke: false,
    rng: random,
  };
}

function faceToward(body, x, z, dt, rate = 10) {
  const dx = x - body.position.x;
  const dz = z - body.position.z;
  const target = Math.atan2(-dx, -dz);
  let diff = target - body.yaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  body.yaw += Math.max(-rate * dt, Math.min(rate * dt, diff));
  return Math.abs(diff);
}

function followPath(mind, body, dt, colliders, speedScale = 1) {
  if (mind.pathAt >= mind.path.length) return true;
  const node = NAV.nodes[mind.path[mind.pathAt]];
  const dx = node.x - body.position.x;
  const dz = node.z - body.position.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.8) {
    mind.pathAt += 1;
    mind.stuckAt = 0;
    mind.lastDist = Infinity;
    return followPath(mind, body, dt, colliders, speedScale);
  }
  // Stuck rescue: if the distance to the node is not shrinking, the straight line is
  // clipped by a corner — sidestep briefly, then give the node up and move on.
  if (dist < mind.lastDist - 0.05) {
    mind.lastDist = dist;
    mind.stuckAt = 0;
  } else {
    mind.stuckAt += dt;
  }
  let wishX = dx / dist;
  let wishZ = dz / dist;
  if (mind.stuckAt > 0.7 && mind.stuckAt < 1.3) {
    wishX = -dz / dist;
    wishZ = dx / dist;
  } else if (mind.stuckAt >= 1.3) {
    mind.pathAt += 1;
    mind.stuckAt = 0;
    mind.lastDist = Infinity;
    return followPath(mind, body, dt, colliders, speedScale);
  }
  faceToward(body, node.x, node.z, dt);
  stepBody(body, colliders, dt, wishX, wishZ, false, false, speedScale);
  return false;
}

function setGoal(mind, nodeIndex) {
  if (nodeIndex === mind.goalNode && mind.path.length) {
    // A path can be exhausted by the stuck rescue while the bot is still far from
    // the goal node; standing there forever is not arrival. Recompute instead.
    if (mind.pathAt < mind.path.length) return;
    const node = NAV.nodes[nodeIndex];
    const d = Math.hypot(node.x - mind.actor.body.position.x, node.z - mind.actor.body.position.z);
    if (d < 2.5) return;
  }
  mind.goalNode = nodeIndex;
  const from = NAV.nearest(mind.actor.body.position.x, mind.actor.body.position.z);
  mind.path = NAV.path(from, nodeIndex);
  mind.pathAt = 0;
  mind.stuckAt = 0;
  mind.lastDist = Infinity;
}

// Nodes worth standing on, nearest the site centre first: the charge carrier takes
// index 0 so it always ends its path inside the plant radius.
const SITE_NODES = [[23, 22, 20], [29, 28, 26]];
const MID_NODES = [13, 14, 16];

export function stepMind(mind, ctx) {
  const { actor } = mind;
  const body = actor.body;
  mind.stillTime = body.speed < 0.3 ? (mind.stillTime ?? 0) + ctx.dt : 0;
  if (!actor.alive || actor.channel) {
    stepBody(body, ctx.colliders, ctx.dt, 0, 0, false, false);
    return;
  }
  const time = ctx.time;
  const dt = ctx.dt;
  const blind = time < mind.blindUntil;

  // Perception, throttled: sight first, then the loudest recent noise.
  mind.thinkAt -= dt;
  if (mind.thinkAt <= 0 && !blind) {
    mind.thinkAt = 0.12;
    let best = null;
    let bestDist = Infinity;
    for (const foe of ctx.foes) {
      if (!foe.alive) continue;
      const dx = foe.body.position.x - body.position.x;
      const dz = foe.body.position.z - body.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > SIGHT_RANGE) continue;
      const facing = (-Math.sin(body.yaw) * dx - Math.cos(body.yaw) * dz) / (dist || 1);
      if (facing < SIGHT_COS && dist > 3.2) continue;
      const eyeY = body.position.y + body.eye;
      if (!ctx.los(body.position.x, eyeY, body.position.z, foe.body.position.x, foe.body.position.y + 1.05, foe.body.position.z)) continue;
      if (ctx.smokeBlocked(body, foe.body)) continue;
      if (dist < bestDist) { bestDist = dist; best = foe; }
    }
    if (best) {
      if (mind.visible !== best) {
        // A bot that has been holding still has its angle pre-aimed: it fires sooner.
        const settled = (mind.stillTime ?? 0) > 1.5;
        mind.fireAt = Math.max(mind.fireAt, time + (settled ? 0.16 + mind.rng() * 0.18 : 0.3 + mind.rng() * 0.3));
      }
      mind.visible = best;
      mind.seenAt = time;
      mind.seenPos.x = best.body.position.x;
      mind.seenPos.z = best.body.position.z;
    } else if (time - mind.seenAt > 0.4) {
      mind.visible = null;
    }
    for (const noise of ctx.noise) {
      const d = Math.hypot(noise.x - body.position.x, noise.z - body.position.z);
      if (d < noise.radius && noise.team !== actor.team) {
        mind.alertPos = { x: noise.x, z: noise.z };
        mind.alertAt = time;
      }
    }
  }

  // The carrier leaves distant fights to its escorts and keeps walking the charge in;
  // it only fights for itself when the enemy is close or no escort is left.
  let carriedFight = true;
  if (mind.hasCharge && mind.visible && ctx.alliesAlive > 1) {
    const d = Math.hypot(mind.visible.body.position.x - body.position.x, mind.visible.body.position.z - body.position.z);
    carriedFight = d < 12;
  }

  // Combat: face the enemy, manage distance, fire bursts while (mostly) still.
  if (mind.visible && mind.visible.alive && !blind && carriedFight) {
    const foe = mind.visible;
    const dx = foe.body.position.x - body.position.x;
    const dz = foe.body.position.z - body.position.z;
    const dist = Math.hypot(dx, dz);
    const aimError = faceToward(body, foe.body.position.x, foe.body.position.z, dt, 14);
    body.pitch = Math.max(-0.4, Math.min(0.4, (foe.body.position.y + 1.1 - (body.position.y + body.eye)) / Math.max(dist, 1)));
    let wishX = 0;
    let wishZ = 0;
    if (time < mind.strafeUntil) {
      wishX = -dz / (dist || 1) * mind.strafeDir;
      wishZ = dx / (dist || 1) * mind.strafeDir;
    } else if (dist > 24) {
      wishX = dx / dist;
      wishZ = dz / dist;
    } else if (dist < 7) {
      wishX = -dx / dist;
      wishZ = -dz / dist;
    }
    stepBody(body, ctx.colliders, dt, wishX, wishZ, foe.body.crouching && dist > 14, false, 0.9);
    if (time >= mind.reloadUntil && aimError < 0.16) {
      if (mind.burstLeft > 0 && time >= mind.fireAt) {
        if (mind.mag <= 0) {
          mind.reloadUntil = time + WEAPONS[actor.weaponId].reload;
          mind.mag = WEAPONS[actor.weaponId].mag;
        } else {
          ctx.fireOnce(mind, foe);
          mind.mag -= 1;
          mind.burstLeft -= 1;
          mind.fireAt = time + WEAPONS[actor.weaponId].gap;
          if (mind.burstLeft === 0) {
            mind.pauseUntil = time + 0.3 + mind.rng() * 0.35;
            mind.strafeUntil = time + 0.4 + mind.rng() * 0.5;
            if (mind.rng() < 0.5) mind.strafeDir *= -1;
          }
        }
      } else if (time >= mind.pauseUntil) {
        mind.burstLeft = 3 + Math.floor(mind.rng() * 3);
      }
    }
    return;
  }

  // Investigate the last sighting or a loud noise, briefly. A guard on a site only
  // chases what comes near that site; the depot is not won by abandoning the doors.
  if (time - mind.seenAt < MEMORY_SECONDS || time - mind.alertAt < 3) {
    const pos = time - mind.seenAt < MEMORY_SECONDS ? mind.seenPos : mind.alertPos;
    if (mind.plan.kind === 'defend') {
      const site = ctx.siteOf(mind.plan.site);
      if (Math.hypot(pos.x - site.x, pos.z - site.z) > 17) {
        stepBody(body, ctx.colliders, dt, 0, 0, false, false);
        return;
      }
    }
    const dx = pos.x - body.position.x;
    const dz = pos.z - body.position.z;
    if (Math.hypot(dx, dz) > 2.4) {
      setGoal(mind, NAV.nearest(pos.x, pos.z));
      followPath(mind, body, dt, ctx.colliders, 0.95);
    } else {
      faceToward(body, pos.x, pos.z, dt, 4);
      stepBody(body, ctx.colliders, dt, 0, 0, false, false);
    }
    return;
  }

  // Work the plan.
  const objective = ctx.objective;
  if (objective.planted) {
    const siteNodes = SITE_NODES[objective.site];
    if (actor.team === 'guards') {
      // Retake: path to the node nearest the charge, then defuse when in reach.
      setGoal(mind, NAV.nearest(objective.x, objective.z));
      followPath(mind, body, dt, ctx.colliders);
      if (Math.hypot(objective.x - body.position.x, objective.z - body.position.z) < 3.4) {
        ctx.beginChannel(mind, 'defuse');
      }
    } else {
      setGoal(mind, siteNodes[actor.id % siteNodes.length]);
      followPath(mind, body, dt, ctx.colliders, 0.8);
    }
    return;
  }

  if (mind.plan.kind === 'pickup' && objective.dropped) {
    const dx = objective.dropped.x - body.position.x;
    const dz = objective.dropped.z - body.position.z;
    if (Math.hypot(dx, dz) < 7) {
      // Close enough to walk straight at the charge on the ground.
      faceToward(body, objective.dropped.x, objective.dropped.z, dt);
      const d = Math.max(0.001, Math.hypot(dx, dz));
      stepBody(body, ctx.colliders, dt, dx / d, dz / d, false, false);
    } else {
      setGoal(mind, NAV.nearest(objective.dropped.x, objective.dropped.z));
      followPath(mind, body, dt, ctx.colliders);
    }
  } else if (mind.plan.kind === 'attack') {
    const siteNodes = SITE_NODES[mind.plan.site];
    if (mind.hasCharge) {
      // Final approach: near the site, leave the graph and walk straight at the
      // plant spot, so a corner-clipped path can never strand the carrier.
      const site = ctx.siteOf(mind.plan.site);
      const dSite = Math.hypot(site.x - body.position.x, site.z - body.position.z);
      if (dSite < 13) {
        if (!ctx.beginChannel(mind, 'plant')) {
          faceToward(body, site.x, site.z, dt);
          stepBody(body, ctx.colliders, dt, (site.x - body.position.x) / (dSite || 1), (site.z - body.position.z) / (dSite || 1), false, false);
        }
        return;
      }
    }
    const goal = mind.hasCharge ? siteNodes[0] : siteNodes[actor.id % siteNodes.length];
    setGoal(mind, goal);
    const arrived = followPath(mind, body, dt, ctx.colliders);
    if (arrived && mind.hasCharge) ctx.beginChannel(mind, 'plant');
  } else if (mind.plan.kind === 'defend') {
    // Rotation: fresh intel placing the push at the OTHER site pulls this guard
    // across the map to reinforce, instead of guarding an empty depot corner.
    if (ctx.intel && time - ctx.intel.at < 6) {
      const mySite = ctx.siteOf(mind.plan.site);
      const otherSite = ctx.siteOf(1 - mind.plan.site);
      const dMine = Math.hypot(ctx.intel.x - mySite.x, ctx.intel.z - mySite.z);
      const dOther = Math.hypot(ctx.intel.x - otherSite.x, ctx.intel.z - otherSite.z);
      if (dOther < 13 && dMine > 20) {
        const nodes = SITE_NODES[1 - mind.plan.site];
        setGoal(mind, nodes[actor.id % nodes.length]);
        followPath(mind, body, dt, ctx.colliders);
        return;
      }
    }
    const siteNodes = SITE_NODES[mind.plan.site];
    const goal = siteNodes[actor.id % siteNodes.length];
    setGoal(mind, goal);
    if (followPath(mind, body, dt, ctx.colliders, 0.9)) {
      // Holding: face south down the lane the raiders must come up.
      faceToward(body, body.position.x, body.position.z + 10, dt, 3);
      stepBody(body, ctx.colliders, dt, 0, 0, false, false);
    }
  } else {
    // Mid: drift between lane nodes so a quiet round never freezes, and join
    // the push when the round clock runs low.
    if (ctx.timeLeft !== undefined && ctx.timeLeft < 35 && actor.team === 'raiders') {
      mind.plan = { kind: 'attack', site: ctx.teamSite ?? 0 };
      return;
    }
    if (mind.goalNode === undefined || time > (mind.nextDrift ?? 0)) {
      mind.goalNode = MID_NODES[Math.floor(mind.rng() * MID_NODES.length)];
      mind.nextDrift = time + 7 + mind.rng() * 6;
    }
    setGoal(mind, mind.goalNode);
    followPath(mind, body, dt, ctx.colliders, 0.9);
  }
}
