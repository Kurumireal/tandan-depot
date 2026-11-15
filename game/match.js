// The match: two teams of five, rounds, money and the charge. This module owns the
// state machine (buy phase, live round, planted charge, round break, match end), the
// economy, bot plans and purchases, channels for planting and defusing, and every
// damage event, whoever dealt it. Rendering, input and sound live elsewhere; this
// module reports through hooks so the HUD and the mix can follow the game.
import * as THREE from 'three';
import { SPAWNS, SITES, NAV } from './map.js';
import { createActor, createActorMesh, resetActor, poseActor } from './actors.js';
import { createMind, stepMind } from './bots.js';
import { WEAPONS, ARMOR_PRICE, GRENADE_PRICES, pelletDamage, applyArmor } from './weapons.js';
import { lineOfSight, createBody } from './physics.js';
import { PALETTE } from './palette.js';

export const WIN_ROUNDS = 9;
const BUY_SECONDS = 14;
const ROUND_SECONDS = 100;
const BOMB_SECONDS = 40;
const BREAK_SECONDS = 5;
const PLANT_SECONDS = 3;
const DEFUSE_SECONDS = 6;
const START_MONEY = 800;
const MAX_MONEY = 9000;

const BOT_LOADOUTS = [
  ['smg', 'rifle', 'rifle', 'sniper'],
  ['pistol', 'smg', 'rifle', 'rifle'],
  ['shotgun', 'smg', 'rifle', 'sniper'],
  ['pistol', 'rifle', 'smg', 'rifle'],
  ['smg', 'shotgun', 'rifle', 'rifle'],
];

export function createMatch(scene, map, playerBody, grenades, hooks, random) {
  const actors = [];
  const minds = new Map();
  const playerActor = createActor('raiders', playerBody, null);
  playerActor.isPlayer = true;
  playerActor.id = 0;
  actors.push(playerActor);
  for (let i = 0; i < 4; i += 1) {
    const mesh = createActorMesh('raiders');
    scene.add(mesh.group);
    const actor = createActor('raiders', null, mesh);
    actor.id = i + 1;
    actors.push(actor);
  }
  for (let i = 0; i < 5; i += 1) {
    const mesh = createActorMesh('guards');
    scene.add(mesh.group);
    const actor = createActor('guards', null, mesh);
    actor.id = i + 5;
    actors.push(actor);
  }
  // Bot bodies: the player's body arrives from the controller, the bots get their own.
  for (const actor of actors) {
    if (!actor.body) actor.body = createBody(0, 0, 0);
  }

  const chargeMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.16, 0.24),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5 }),
  );
  const chargeLight = new THREE.PointLight(new THREE.Color(PALETTE.enemy), 0, 4);
  chargeMesh.add(chargeLight);
  scene.add(chargeMesh);

  const state = {
    phase: 'buy',
    phaseLeft: BUY_SECONDS,
    round: 1,
    wins: { raiders: 0, guards: 0 },
    lossStreak: { raiders: 0, guards: 0 },
    bomb: { carrier: null, droppedAt: null, planted: false, site: -1, x: 0, z: 0, beepAt: 0 },
    winner: null,
    winReason: '',
    time: 0,
    noise: [],
    intel: null,
    matchWinner: null,
  };
  playerActor.grenades = { he: 0, flash: 0, smoke: 0 };
  for (const actor of actors) actor.grenades = actor.grenades ?? { he: 0, flash: 0, smoke: 0 };

  function aliveCount(team) {
    return actors.filter((a) => a.team === team && a.alive).length;
  }

  function planFor(actor) {
    if (actor.team === 'raiders') {
      // The raider bots hit one site together each round; the fourth plays mid. When
      // the player carries the charge toward a site, the pack converges there (step).
      if (actor.id === 4) return { kind: 'mid', site: null };
      return { kind: 'attack', site: state.teamSite };
    }
    if (actor.id === 9) return { kind: 'mid', site: null };
    return { kind: 'defend', site: actor.id % 2 === 0 ? 0 : 1 };
  }

  function botBuy(actor) {
    const roundIndex = Math.min(state.round - 1, 3);
    const wanted = BOT_LOADOUTS[actor.id % BOT_LOADOUTS.length][roundIndex];
    if (!actor.armor && actor.money >= ARMOR_PRICE + 400) {
      actor.money -= ARMOR_PRICE;
      actor.armor = true;
    }
    if (WEAPONS[wanted] && actor.money >= WEAPONS[wanted].price && WEAPONS[actor.weaponId].price < WEAPONS[wanted].price) {
      actor.money -= WEAPONS[wanted].price;
      actor.weaponId = wanted;
    }
    if (actor.team === 'raiders' && actor.money >= GRENADE_PRICES.smoke + 500) {
      actor.money -= GRENADE_PRICES.smoke;
      actor.grenades.smoke = 1;
    }
  }

  function startRound() {
    state.teamSite = random() < 0.5 ? 0 : 1;
    state.siteLatch = -1;
    state.intel = null;
    state.bomb = { carrier: playerActor, droppedAt: null, planted: false, site: -1, x: 0, z: 0, beepAt: 0 };
    state.noise.length = 0;
    const raiderSpawns = SPAWNS.raiders;
    const guardSpawns = SPAWNS.guards;
    let r = 0;
    let g = 0;
    for (const actor of actors) {
      const spawn = actor.team === 'raiders' ? raiderSpawns[r++ % raiderSpawns.length] : guardSpawns[g++ % guardSpawns.length];
      resetActor(actor, spawn);
      actor.channel = null;
      if (!actor.isPlayer) {
        if (state.round > 1 || actor.money > START_MONEY) botBuy(actor);
        const mind = createMind(actor, planFor(actor), random);
        mind.hasCharge = actor === state.bomb.carrier;
        minds.set(actor, mind);
      }
    }
    state.phase = 'buy';
    state.phaseLeft = BUY_SECONDS;
    state.winner = null;
    hooks.banner(`Round ${state.round}`, 'Buy phase — press B');
    hooks.roundStart(state);
  }

  function endRound(winner, reason) {
    for (const actor of actors) actor.channel = null;
    state.phase = 'over';
    state.phaseLeft = BREAK_SECONDS;
    state.winner = winner;
    state.winReason = reason;
    state.wins[winner] += 1;
    const loser = winner === 'raiders' ? 'guards' : 'raiders';
    state.lossStreak[winner] = 0;
    state.lossStreak[loser] += 1;
    const winPay = reason === 'objective' || reason === 'defused' || reason === 'detonated' ? 1650 : 1400;
    const lossPay = Math.min(1400 + (state.lossStreak[loser] - 1) * 250, 2400);
    for (const actor of actors) {
      const pay = actor.team === winner ? winPay : lossPay;
      actor.money = Math.min(MAX_MONEY, actor.money + pay + (actor.roundBonus ?? 0));
      actor.roundBonus = 0;
    }
    if (state.bomb.planted && winner === 'guards') {
      // A defused round still pays the raiders their plant bonus.
      for (const actor of actors) if (actor.team === 'raiders') actor.money = Math.min(MAX_MONEY, actor.money + 0);
    }
    hooks.banner(winner === 'raiders' ? 'Raiders win the round' : 'Guards win the round', reasonText(reason));
    hooks.roundEnd(state);
    if (state.wins[winner] >= WIN_ROUNDS) {
      state.matchWinner = winner;
      state.phase = 'matchover';
      state.phaseLeft = 999;
      hooks.matchEnd(state);
    }
  }

  function reasonText(reason) {
    return {
      elimination: 'Elimination',
      detonated: 'The charge detonated',
      defused: 'The charge was defused',
      time: 'Time expired',
      objective: 'Objective complete',
    }[reason] ?? reason;
  }

  function damage(attacker, target, raw) {
    if (!target.alive || (state.phase !== 'live' && state.phase !== 'planted')) return false;
    target.health -= applyArmor(raw, target.armor);
    if (target.isPlayer) hooks.playerHurt(attacker);
    if (target.health > 0) return false;
    target.health = 0;
    target.alive = false;
    target.deaths += 1;
    target.channel = null;
    if (attacker && attacker !== target) {
      attacker.kills += 1;
      attacker.money = Math.min(MAX_MONEY, attacker.money + 300);
    }
    hooks.killfeed(attacker, target);
    if (state.bomb.carrier === target) {
      state.bomb.carrier = null;
      state.bomb.droppedAt = { x: target.body.position.x, z: target.body.position.z };
      const mind = minds.get(target);
      if (mind) mind.hasCharge = false;
      // The nearest raider bot is sent to recover the charge.
      let picker = null;
      let bestDist = Infinity;
      for (const actor of actors) {
        if (actor.team !== 'raiders' || actor.isPlayer || !actor.alive) continue;
        const d = Math.hypot(actor.body.position.x - state.bomb.droppedAt.x, actor.body.position.z - state.bomb.droppedAt.z);
        if (d < bestDist) { bestDist = d; picker = actor; }
      }
      if (picker) {
        const pickerMind = minds.get(picker);
        if (pickerMind) pickerMind.plan = { kind: 'pickup', site: state.teamSite };
      }
    }
    checkElimination();
    return true;
  }

  function checkElimination() {
    if (state.phase !== 'live' && state.phase !== 'planted') return;
    const raiders = aliveCount('raiders');
    const guards = aliveCount('guards');
    if (guards === 0) endRound('raiders', 'elimination');
    else if (raiders === 0 && !state.bomb.planted) endRound('guards', 'elimination');
  }

  // One bot shot at a foe: the roll lives here so every shooter's numbers match.
  function fireOnce(mind, foe) {
    const shooter = mind.actor;
    const weapon = WEAPONS[shooter.weaponId];
    const from = shooter.body.position;
    const to = foe.body.position;
    const dist = Math.hypot(to.x - from.x, to.z - from.z);
    state.noise.push({ x: from.x, z: from.z, radius: shooter.weaponId === 'sniper' ? 26 : 17, team: shooter.team });
    hooks.shotSound(shooter.weaponId, from.x, from.z);
    const pellets = weapon.pellets || 1;
    for (let p = 0; p < pellets; p += 1) {
      let chance = 0.44 - Math.max(0, dist - 8) * 0.011;
      if (shooter.body.speed < 0.3) chance += 0.07; // settled aim: holding an angle pays
      chance *= 1 - Math.min(0.55, foe.body.speed * 0.11);
      chance *= 1 - Math.min(0.4, shooter.body.speed * 0.08);
      if (foe.body.crouching) chance *= 0.85;
      if (pellets > 1) chance *= 0.5;
      chance = Math.max(0.04, Math.min(0.78, chance));
      const hit = random() < chance;
      const chestY = to.y + (foe.body.crouching ? 0.8 : 1.05);
      hooks.tracer(from.x, from.y + shooter.body.eye - 0.12, from.z, to.x, chestY, to.z, hit, shooter.team);
      if (hit) {
        const roll = random();
        const part = roll < 0.12 ? 'head' : roll < 0.35 ? 'legs' : 'torso';
        damage(shooter, foe, pelletDamage(shooter.weaponId, part, dist));
        if (!foe.alive) break;
      }
    }
  }

  function beginChannel(mind, kind) {
    const actor = mind.actor;
    if (actor.channel) return true;
    if (kind === 'plant') {
      if (state.bomb.carrier !== actor || state.bomb.planted) return false;
      const site = SITES[mind.plan.site];
      if (Math.hypot(actor.body.position.x - site.x, actor.body.position.z - site.z) > site.radius) return false;
      actor.channel = { kind, left: PLANT_SECONDS, total: PLANT_SECONDS };
      return true;
    }
    if (!state.bomb.planted) return false;
    if (Math.hypot(actor.body.position.x - state.bomb.x, actor.body.position.z - state.bomb.z) > 3.6) return false;
    actor.channel = { kind, left: DEFUSE_SECONDS, total: DEFUSE_SECONDS };
    return true;
  }

  function finishChannel(actor) {
    const { kind } = actor.channel;
    actor.channel = null;
    if (kind === 'plant') {
      state.bomb.planted = true;
      state.bomb.site = SITES.findIndex((s) => Math.hypot(actor.body.position.x - s.x, actor.body.position.z - s.z) <= s.radius + 1);
      state.bomb.x = actor.body.position.x;
      state.bomb.z = actor.body.position.z;
      state.bomb.carrier = null;
      state.phase = 'planted';
      state.phaseLeft = BOMB_SECONDS;
      actor.money = Math.min(MAX_MONEY, actor.money + 300);
      const mind = minds.get(actor);
      if (mind) mind.hasCharge = false;
      hooks.banner('Charge planted', `Site ${SITES[state.bomb.site].id} — 40 seconds`);
      hooks.planted(state);
    } else {
      endRound('guards', 'defused');
    }
  }

  function explodeAt(x, y, z, owner) {
    hooks.explosion(x, y, z);
    for (const actor of actors) {
      if (!actor.alive) continue;
      const dist = Math.hypot(actor.body.position.x - x, actor.body.position.z - z);
      if (dist > 6) continue;
      let raw = 110 * (1 - dist / 6.5);
      const clear = lineOfSight(map.shootables, x, y, z, actor.body.position.x, actor.body.position.y + 1, actor.body.position.z);
      if (!clear) raw *= 0.35;
      if (raw > 1) damage(owner === actor ? null : owner, actor, raw);
    }
  }

  function flashAt(x, y, z) {
    hooks.flashBang(x, y, z);
    for (const actor of actors) {
      if (!actor.alive) continue;
      const dx = actor.body.position.x - x;
      const dz = actor.body.position.z - z;
      const dist = Math.hypot(dx, dz);
      if (dist > 24) continue;
      if (!lineOfSight(map.shootables, x, y, z, actor.body.position.x, actor.body.position.y + actor.body.eye, actor.body.position.z)) continue;
      const facing = (-Math.sin(actor.body.yaw) * -dx - Math.cos(actor.body.yaw) * -dz) / (dist || 1);
      const strength = Math.max(0, facing) * Math.max(0, 1 - dist / 24);
      if (actor.isPlayer) hooks.playerFlashed(strength);
      else {
        const mind = minds.get(actor);
        if (mind) mind.blindUntil = state.time + 0.6 + strength * 2.6;
      }
    }
  }

  function buyForPlayer(item) {
    if (state.phase !== 'buy') return false;
    const actor = playerActor;
    if (item === 'armor') {
      if (actor.armor || actor.money < ARMOR_PRICE) return false;
      actor.money -= ARMOR_PRICE;
      actor.armor = true;
      return true;
    }
    if (GRENADE_PRICES[item]) {
      if (actor.money < GRENADE_PRICES[item] || actor.grenades[item] >= 2) return false;
      actor.money -= GRENADE_PRICES[item];
      actor.grenades[item] += 1;
      return true;
    }
    const weapon = WEAPONS[item];
    if (!weapon || actor.money < weapon.price) return false;
    actor.money -= weapon.price;
    hooks.playerBoughtWeapon(item);
    return true;
  }

  const losCheck = (ax, ay, az, bx, by, bz) => lineOfSight(map.shootables, ax, ay, az, bx, by, bz);

  function step(dt) {
    state.time += dt;
    const time = state.time;
    // Noise is cleared at the end of the step, so shots fired between steps (the
    // player's) are heard by the bots on the next one.
    if (state.phase === 'buy' || state.phase === 'live' || state.phase === 'planted') {
      state.phaseLeft -= dt;
      if (state.phase === 'buy' && state.phaseLeft <= 0) {
        state.phase = 'live';
        state.phaseLeft = ROUND_SECONDS;
        hooks.banner('Round live', state.bomb.carrier === playerActor ? 'You carry the charge' : 'Eliminate or plant');
      } else if (state.phase === 'live' && state.phaseLeft <= 0) {
        if (!state.bomb.planted) endRound('guards', 'time');
      } else if (state.phase === 'planted') {
        if (time >= state.bomb.beepAt) {
          state.bomb.beepAt = time + Math.max(0.18, state.phaseLeft / BOMB_SECONDS) * 0.9;
          hooks.beep(state.phaseLeft < 8);
          chargeLight.intensity = 26;
        }
        if (state.phaseLeft <= 0) endRound('raiders', 'detonated');
      }
    } else if (state.phase === 'over') {
      state.phaseLeft -= dt;
      if (state.phaseLeft <= 0 && !state.matchWinner) {
        state.round += 1;
        startRound();
      }
    }
    chargeLight.intensity = Math.max(0, chargeLight.intensity - dt * 60);

    // Channels tick for whoever is planting or defusing.
    for (const actor of actors) {
      if (!actor.channel || !actor.alive) continue;
      actor.channel.left -= dt;
      if (actor.isPlayer) hooks.playerChannel(actor.channel);
      if (actor.channel.left <= 0) finishChannel(actor);
    }

    // The charge: carried, dropped or planted.
    const bomb = state.bomb;
    if (bomb.planted) {
      chargeMesh.position.set(bomb.x, 0.1, bomb.z);
    } else if (bomb.carrier) {
      chargeMesh.position.set(bomb.carrier.body.position.x, bomb.carrier.body.position.y + 0.12, bomb.carrier.body.position.z + 0.2);
    } else if (bomb.droppedAt) {
      chargeMesh.position.set(bomb.droppedAt.x, 0.1, bomb.droppedAt.z);
      // If the assigned charge-recoverer died, hand the job to the next raider.
      const pickerAlive = actors.some((a) => a.team === 'raiders' && !a.isPlayer && a.alive && minds.get(a)?.plan.kind === 'pickup');
      if (!pickerAlive && (state.phase === 'live' || state.phase === 'planted')) {
        let picker = null;
        let bestDist = Infinity;
        for (const actor of actors) {
          if (actor.team !== 'raiders' || actor.isPlayer || !actor.alive) continue;
          const d = Math.hypot(actor.body.position.x - bomb.droppedAt.x, actor.body.position.z - bomb.droppedAt.z);
          if (d < bestDist) { bestDist = d; picker = actor; }
        }
        if (picker) {
          const pickerMind = minds.get(picker);
          if (pickerMind) pickerMind.plan = { kind: 'pickup', site: state.teamSite };
        }
      }
      for (const actor of actors) {
        if (actor.team !== 'raiders' || !actor.alive || actor.isPlayer) continue;
        if (Math.hypot(actor.body.position.x - bomb.droppedAt.x, actor.body.position.z - bomb.droppedAt.z) < 1.1) {
          bomb.carrier = actor;
          bomb.droppedAt = null;
          const mind = minds.get(actor);
          if (mind) { mind.hasCharge = true; mind.plan = { kind: 'attack', site: state.teamSite }; }
          break;
        }
      }
      if (bomb.droppedAt && playerActor.alive && Math.hypot(playerBody.position.x - bomb.droppedAt.x, playerBody.position.z - bomb.droppedAt.z) < 1.1) {
        bomb.carrier = playerActor;
        bomb.droppedAt = null;
        hooks.banner('Charge recovered', 'Plant it at a site');
      }
    }
    chargeMesh.visible = !(bomb.carrier === playerActor);

    // The pack converges on the site the charge carrier is approaching.
    const fighting = state.phase === 'live' || state.phase === 'planted';
    if (fighting && state.bomb.carrier === playerActor && state.siteLatch === -1) {
      for (let s = 0; s < SITES.length; s += 1) {
        const site = SITES[s];
        if (Math.hypot(playerBody.position.x - site.x, playerBody.position.z - site.z) < 13) {
          state.siteLatch = s;
          for (const actor of actors) {
            const mind = minds.get(actor);
            if (mind && actor.team === 'raiders') mind.plan = { kind: 'attack', site: s };
          }
        }
      }
    }

    // Team intel: a guard who spots a raider radios the position to the whole
    // guard team, which is what makes far defenders rotate to the pushed site.
    if (fighting) {
      for (const actor of actors) {
        if (actor.team !== 'guards' || actor.isPlayer || !actor.alive) continue;
        const mind = minds.get(actor);
        if (mind?.visible?.alive) {
          state.intel = { x: mind.visible.body.position.x, z: mind.visible.body.position.z, at: state.time };
          break;
        }
      }
    }

    // Bot minds act only while the round is live; the buy phase is a freeze.
    const ctx = {
      dt,
      time,
      colliders: map.colliders,
      noise: state.noise,
      objective: { planted: bomb.planted, site: bomb.site, x: bomb.x, z: bomb.z, dropped: bomb.droppedAt },
      timeLeft: state.phaseLeft,
      teamSite: state.teamSite,
      intel: state.intel,
      los: losCheck,
      siteOf: (index) => SITES[index],
      smokeBlocked: (a, b) => grenades.smokeBlocks(a.position.x, a.y + a.eye, a.position.z, b.position.x, b.position.y + 1.05, b.position.z),
      fireOnce,
      beginChannel,
      foes: null,
    };
    for (const actor of actors) {
      if (actor.isPlayer || !actor.alive || !fighting) continue;
      const mind = minds.get(actor);
      if (!mind) continue;
      ctx.foes = actors.filter((a) => a.team !== actor.team);
      ctx.alliesAlive = aliveCount(actor.team);
      stepMind(mind, ctx);
      // A raider reaching its site throws its smoke once, then pushes in.
      if (actor.team === 'raiders' && mind.plan.kind === 'attack' && actor.grenades.smoke > 0 && !mind.usedSmoke && !bomb.planted) {
        const site = SITES[mind.plan.site];
        if (Math.hypot(actor.body.position.x - site.x, actor.body.position.z - site.z) < site.radius + 3) {
          mind.usedSmoke = true;
          actor.grenades.smoke -= 1;
          const from = new THREE.Vector3(actor.body.position.x, 1.5, actor.body.position.z);
          const dir = new THREE.Vector3(site.x - from.x, 0.25, site.z - from.z).normalize();
          grenades.throwGrenade('smoke', from, dir, actor);
        }
      }
    }

    for (const actor of actors) poseActor(actor, time);
    grenades.step(dt, map.colliders);
    state.noise.length = 0;
  }

  function addNoise(x, z, radius, team) {
    state.noise.push({ x, z, radius, team });
  }

  startRound();

  return {
    state,
    actors,
    playerActor,
    minds,
    step,
    damage,
    addNoise,
    buyForPlayer,
    explodeAt,
    flashAt,
    aliveCount,
    playerChannelStart(kind) {
      const actor = playerActor;
      if (actor.channel || !actor.alive) return false;
      if (kind === 'plant') {
        if (state.bomb.carrier !== actor || state.bomb.planted) return false;
        const inside = SITES.some((s) => Math.hypot(actor.body.position.x - s.x, actor.body.position.z - s.z) <= s.radius);
        if (!inside) return false;
        actor.channel = { kind, left: PLANT_SECONDS, total: PLANT_SECONDS };
        return true;
      }
      return false;
    },
    playerChannelCancel() {
      if (playerActor.channel) {
        playerActor.channel = null;
        hooks.playerChannel(null);
      }
    },
    // The player can hand the charge off: dropping it lets a raider bot recover
    // it and take over the plant (the step loop assigns the nearest one).
    playerDropCharge() {
      if (state.bomb.carrier !== playerActor || state.bomb.planted) return false;
      if (state.phase !== 'live' && state.phase !== 'buy') return false;
      state.bomb.carrier = null;
      state.bomb.droppedAt = { x: playerActor.body.position.x, z: playerActor.body.position.z };
      if (playerActor.channel) {
        playerActor.channel = null;
        hooks.playerChannel(null);
      }
      return true;
    },
  };
}
