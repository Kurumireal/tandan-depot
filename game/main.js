// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the display's
// rate. This module is the glue — renderer, camera, the player's own shooting, effects
// and the HUD feed — while match.js owns the game, bots.js the minds, weapons.js the
// numbers. ?shot=menu|play|site|end with &seed=N stages a deterministic frame for a
// screenshot, renders it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createMap, SPAWNS, SITES } from './map.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createLoadout, WEAPONS, ARMOR_PRICE, GRENADE_PRICES, pelletDamage } from './weapons.js';
import { createGrenades } from './grenades.js';
import { createAudio } from './audio.js';
import { createMatch } from './match.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(Number.isFinite(seedParam) ? seedParam : (Date.now() % 100000) + 7);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.sky), 42, 118);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 220);
scene.add(camera);

const map = createMap(scene);
const hud = createHud();
const audio = createAudio();
const playerCtrl = createPlayer(map.colliders, SPAWNS.raiders[1]);
const loadout = createLoadout(camera);

// --- Effects: a small pool of tracer bolts and one explosion light, reused forever. ---
const tracerPool = [];
for (let i = 0; i < 28; i += 1) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.02, 0.02, 1),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 }),
  );
  mesh.visible = false;
  scene.add(mesh);
  tracerPool.push({ mesh, left: 0 });
}
let tracerAt = 0;
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
function tracer(x1, y1, z1, x2, y2, z2, hit, team) {
  const slot = tracerPool[tracerAt++ % tracerPool.length];
  _from.set(x1, y1, z1);
  _to.set(x2 + (hit ? 0 : (random() - 0.5) * 2.4), y2 + (hit ? 0 : (random() - 0.5) * 1.6), z2);
  const length = _from.distanceTo(_to);
  slot.mesh.position.copy(_from).lerp(_to, 0.5);
  slot.mesh.lookAt(_to);
  slot.mesh.scale.set(1, 1, length);
  slot.mesh.material.color.set(team === 'raiders' ? PALETTE.accent : PALETTE.siteB);
  slot.mesh.material.opacity = 0.85;
  slot.mesh.visible = true;
  slot.left = 0.055;
}
const boomLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 26, 1.4);
scene.add(boomLight);
let boomLeft = 0;
let shake = 0;

// --- The match, with its hooks wired to sound, effects and the HUD. ---
let playerChannel = null;
const actorNames = new Map();
const grenades = createGrenades(scene, {
  explode: (pos, owner) => match.explodeAt(pos.x, pos.y, pos.z, owner),
  flash: (pos) => match.flashAt(pos.x, pos.y, pos.z),
});
const hooks = {
  banner: (title, sub) => hud.banner(title, sub),
  killfeed: (attacker, target) => {
    const a = attacker ? actorNames.get(attacker) : '—';
    const t = actorNames.get(target);
    const ac = attacker?.team === 'raiders' ? 'r' : 'g';
    const tc = target.team === 'raiders' ? 'r' : 'g';
    hud.killfeedLine(`<span class="${ac}">${a}</span> ▸ <span class="${tc}">${t}</span>`);
  },
  playerHurt: () => { hud.damageFlash(); audio.hurt(); },
  playerFlashed: (strength) => { if (strength > 0.12) hud.setFlash(strength); },
  playerChannel: (channel) => { playerChannel = channel; },
  playerBoughtWeapon: (id) => { loadout.give(id); loadout.switchTo(id); audio.buy(); },
  beep: (final) => audio.beep(final),
  planted: () => audio.beep(true),
  shotSound: (id, x, z) => audio.shotAt(id, x, z),
  tracer,
  explosion: (x, y, z) => {
    audio.explode(x, z);
    boomLight.position.set(x, y + 1, z);
    boomLeft = 0.3;
    const d = Math.hypot(playerCtrl.state.position.x - x, playerCtrl.state.position.z - z);
    if (d < 13) shake = Math.max(shake, (1 - d / 13) * 0.5);
  },
  flashBang: (x, z) => audio.flashPop(x, z),
  roundStart: () => { loadout.switchTo(loadout.bestWeapon()); },
  roundEnd: (state) => audio.roundEnd(state.winner === 'raiders'),
  matchEnd: (state) => {
    hud.showOverlay(state.matchWinner === 'raiders' ? 'matchRaiders' : 'matchGuards');
    if (document.pointerLockElement) document.exitPointerLock();
  },
};
const match = createMatch(scene, { colliders: map.colliders, shootables: map.shootables }, playerCtrl.state, grenades, hooks, random);
for (const actor of match.actors) {
  actorNames.set(actor, actor.isPlayer ? 'YOU' : actor.team === 'raiders' ? `Raider-${actor.id}` : `Guard-${actor.id - 4}`);
}
const playerActor = match.playerActor;

const input = createInput(renderer.domElement, onLockChange);
let started = false;
let buyOpen = false;
let grenadeSel = 'he';
let wasFiring = false;
let frozen = false;

hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  if (match.state.phase === 'matchover') { window.location.reload(); return; }
  input.requestLock();
});

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    buyOpen = false;
    hud.hideBuy();
    hud.hideOverlay();
  } else if (!buyOpen && match.state.phase !== 'matchover') {
    hud.showOverlay(started ? 'paused' : 'start');
  }
}

// --- Buying ---
const BUY_ITEMS = [
  { id: 'rifle', name: 'Lestari RK rifle', price: () => WEAPONS.rifle.price },
  { id: 'smg', name: 'Cendana SMG', price: () => WEAPONS.smg.price },
  { id: 'shotgun', name: 'Banteng SG shotgun', price: () => WEAPONS.shotgun.price },
  { id: 'sniper', name: 'Rajawali SNP sniper', price: () => WEAPONS.sniper.price },
  { id: 'armor', name: 'Kevlar vest', price: () => ARMOR_PRICE },
  { id: 'he', name: 'HE grenade', price: () => GRENADE_PRICES.he },
  { id: 'flash', name: 'Flash grenade', price: () => GRENADE_PRICES.flash },
  { id: 'smoke', name: 'Smoke grenade', price: () => GRENADE_PRICES.smoke },
];
function buyCatalog() {
  return BUY_ITEMS.map((item) => {
    const price = item.price();
    let enabled = playerActor.money >= price && match.state.phase === 'buy';
    let detail = `$${price}`;
    if (WEAPONS[item.id] && loadout.owned.has(item.id)) { enabled = false; detail = 'Owned'; }
    if (item.id === 'armor' && playerActor.armor) { enabled = false; detail = 'Worn'; }
    if (GRENADE_PRICES[item.id]) detail = `$${price} · have ${playerActor.grenades[item.id]}`;
    return { id: item.id, name: item.name, detail, enabled };
  });
}
function openBuy() {
  if (match.state.phase !== 'buy') return;
  buyOpen = true;
  hud.showBuy(buyCatalog(), playerActor.money, buyItem);
  if (document.pointerLockElement) document.exitPointerLock();
}
function closeBuy() {
  buyOpen = false;
  hud.hideBuy();
  input.requestLock();
}
function buyItem(id) {
  if (!match.buyForPlayer(id)) return;
  audio.buy();
  hud.showBuy(buyCatalog(), playerActor.money, buyItem);
  hud.setMoney(playerActor.money);
}

// --- The player's own shooting ---
const raycaster = new THREE.Raycaster();
const shootDir = new THREE.Vector3();
const hitMeshes = [];
for (const actor of match.actors) if (actor.mesh) hitMeshes.push(...actor.mesh.hitMeshes);
const allShootables = map.shootables.concat(hitMeshes);

function playerShoot() {
  const id = loadout.currentId();
  const weapon = WEAPONS[id];
  if (!loadout.takeRound()) { audio.dryFire(); loadout.pullTrigger(); return; }
  loadout.pullTrigger();
  audio.shotAt(id, playerCtrl.state.position.x, playerCtrl.state.position.z);
  match.addNoise(playerCtrl.state.position.x, playerCtrl.state.position.z, id === 'sniper' ? 26 : 17, 'raiders');
  playerCtrl.recoil(weapon.recoil + random() * weapon.recoil * 0.4, (random() * 2 - 1) * weapon.recoil * 0.35);
  const spread = loadout.spread(playerCtrl.state.speed);
  const pellets = weapon.pellets || 1;
  for (let p = 0; p < (id === 'knife' ? 1 : pellets); p += 1) {
    camera.getWorldDirection(shootDir);
    shootDir.x += (random() * 2 - 1) * spread;
    shootDir.y += (random() * 2 - 1) * spread;
    shootDir.z += (random() * 2 - 1) * spread;
    shootDir.normalize();
    raycaster.set(camera.position, shootDir);
    raycaster.far = id === 'knife' ? weapon.range : 130;
    const hit = raycaster.intersectObjects(allShootables, false)[0];
    if (!hit) continue;
    const target = hit.object.userData.actor;
    // The tracer starts at the muzzle, not the camera origin, so the player does not
    // see their own bolt from inside it.
    const from = camera.position.clone().addScaledVector(shootDir, 0.7);
    tracer(from.x, from.y - 0.1, from.z, hit.point.x, hit.point.y, hit.point.z, !!target, 'raiders');
    if (target && target.alive && target.team !== 'raiders') {
      const killed = match.damage(playerActor, target, pelletDamage(id, hit.object.userData.part, hit.distance));
      hud.hitMarker(killed);
      audio.hit(killed);
    }
  }
  hud.setAmmo(loadout.ammo[loadout.currentId()].mag, loadout.ammo[loadout.currentId()].reserve, weapon.name);
}

function throwSelected() {
  if (playerActor.grenades[grenadeSel] <= 0) {
    const owned = ['he', 'flash', 'smoke'].find((k) => playerActor.grenades[k] > 0);
    if (!owned) return;
    grenadeSel = owned;
  }
  playerActor.grenades[grenadeSel] -= 1;
  camera.getWorldDirection(shootDir);
  const from = camera.position.clone();
  grenades.throwGrenade(grenadeSel, from, shootDir.clone(), playerActor);
  audio.throwWhoosh();
}

// --- Per-frame intent from keys ---
function handlePressed(codes) {
  for (const code of codes) {
    if (buyOpen) {
      if (code === 'KeyB' || code === 'Escape') closeBuy();
      else if (code.startsWith('Digit')) {
        const index = Number(code.slice(5)) - 1;
        const item = buyCatalog()[index];
        if (item) buyItem(item.id);
      }
      continue;
    }
    if (code === 'KeyB' && match.state.phase === 'buy' && playerActor.alive) openBuy();
    else if (code === 'Digit1') {
      const primaries = ['sniper', 'rifle', 'smg', 'shotgun'].filter((w) => loadout.owned.has(w));
      if (primaries.length) loadout.switchTo(primaries[(primaries.indexOf(loadout.currentId()) + 1) % primaries.length] ?? primaries[0]);
    } else if (code === 'Digit2') loadout.switchTo('pistol');
    else if (code === 'Digit3') loadout.switchTo('knife');
    else if (code === 'Digit4') grenadeSel = 'he';
    else if (code === 'Digit5') grenadeSel = 'flash';
    else if (code === 'Digit6') grenadeSel = 'smoke';
    else if (code === 'KeyG') throwSelected();
    else if (code === 'KeyX') { if (match.playerDropCharge()) hud.banner('Charge dropped', 'A raider will pick it up'); }
    else if (code === 'KeyR') loadout.reload();
  }
}

function step(dt) {
  const state = match.state;
  const alive = playerActor.alive;
  if (alive && !buyOpen) playerCtrl.step(dt, input.state.keys);
  else playerCtrl.state.speed = 0;
  // Planting: hold E inside a site; moving or firing cancels.
  const wantPlant = input.state.keys.has('KeyE') && alive && (state.phase === 'live');
  if (wantPlant && !playerActor.channel) match.playerChannelStart('plant');
  if (playerActor.channel) {
    const moving = ['KeyW', 'KeyA', 'KeyS', 'KeyD'].some((k) => input.state.keys.has(k));
    if (!input.state.keys.has('KeyE') || moving || input.state.firing) match.playerChannelCancel();
  }
  loadout.step(dt);
  match.step(dt);
  for (const slot of tracerPool) {
    if (slot.left > 0) {
      slot.left -= dt;
      if (slot.left <= 0) slot.mesh.visible = false;
    }
  }
  boomLeft = Math.max(0, boomLeft - dt);
  boomLight.intensity = boomLeft > 0 ? 120 * (boomLeft / 0.3) : 0;
  shake = Math.max(0, shake - dt * 1.4);
}

function syncCamera() {
  const body = playerCtrl.state;
  if (!playerActor.alive) {
    const mate = match.actors.find((a) => a.team === 'raiders' && a.alive && !a.isPlayer);
    if (mate) {
      camera.position.set(mate.body.position.x, mate.body.position.y + mate.body.eye, mate.body.position.z);
      camera.rotation.set(mate.body.pitch, mate.body.yaw, 0, 'YXZ');
      hud.setSpectate(true);
      return;
    }
  }
  hud.setSpectate(false);
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  if (shake > 0) {
    camera.position.x += (random() - 0.5) * shake * 0.14;
    camera.position.y += (random() - 0.5) * shake * 0.14;
  }
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
}

function syncHud() {
  const state = match.state;
  const current = loadout.currentId();
  const ammoSlot = loadout.ammo[current];
  hud.setVitals(playerActor.health, playerActor.armor);
  hud.setAmmo(current === 'knife' ? '—' : ammoSlot.mag, current === 'knife' ? '' : ammoSlot.reserve, WEAPONS[current].name);
  hud.setMoney(playerActor.money);
  hud.setGrenades(`HE ${playerActor.grenades.he} · FLASH ${playerActor.grenades.flash} · SMOKE ${playerActor.grenades.smoke} — G throws ${grenadeSel.toUpperCase()}`);
  const hot = state.phase === 'planted' || state.phaseLeft <= 10;
  hud.setClock(state.phase === 'matchover' ? 0 : state.phaseLeft, hot);
  hud.setScore(state.wins.raiders, state.wins.guards, state.round);
  hud.setAlive(match.aliveCount('raiders'), match.aliveCount('guards'));
  hud.setChargeChip(state.bomb.carrier === playerActor && state.phase !== 'planted');
  if (playerChannel) hud.setChannel(1 - playerChannel.left / playerChannel.total, 'Planting the charge…');
  else hud.setChannel(null);
  const scoped = input.state.aiming && current === 'sniper' && playerActor.alive;
  loadout.setScoped(scoped);
  hud.setScope(scoped);
  camera.fov += ((scoped ? 24 : 74) - camera.fov) * 0.4;
  camera.updateProjectionMatrix();
}

let accumulator = 0;
let lastTime = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    handlePressed(input.takePressed());
    const look = input.takeLook();
    if (playerActor.alive && !buyOpen) playerCtrl.look(look.x, look.y);
    const state = match.state;
    const canFire = playerActor.alive && !buyOpen && started && (state.phase === 'live' || state.phase === 'planted') && !playerActor.channel;
    if (canFire && input.state.firing) {
      const weapon = WEAPONS[loadout.currentId()];
      if ((weapon.auto || !wasFiring) && loadout.ready()) playerShoot();
    }
    wasFiring = input.state.firing;
    audio.setListener(playerCtrl.state.position.x, playerCtrl.state.position.z);
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
    syncHud();
  }
  renderer.render(scene, camera);
}

// --- Screenshot staging: deterministic scenes the captures are taken from. ---
function stageShot(name) {
  hud.hideOverlay();
  const state = match.state;
  const byId = (id) => match.actors.find((a) => a.id === id);
  const place = (actor, x, z, yaw) => {
    actor.body.position.set(x, 0, z);
    actor.body.yaw = yaw;
  };
  if (name === 'menu') {
    place(playerActor, 0, 20, 0);
    place(byId(6), -8, 2, 2.6);
    place(byId(7), 9, -3, -2.8);
    hud.showOverlay('start');
  } else if (name === 'play') {
    state.phase = 'live';
    state.phaseLeft = 63;
    place(playerActor, 1, 11, 0.12);
    place(byId(1), -6, 4, 0.4);
    place(byId(6), 4, -3, 2.9);
    place(byId(7), -7, -5, -2.6);
    for (let i = 0; i < 40; i += 1) step(FIXED_STEP);
    playerCtrl.state.position.set(1, 0, 11);
    playerCtrl.state.yaw = 0.14;
    playerCtrl.state.pitch = -0.02;
    hud.clearBanner();
    syncCamera();
    playerShoot();
    hud.hitMarker(false);
  } else if (name === 'site') {
    state.phase = 'planted';
    state.phaseLeft = 27;
    state.bomb.planted = true;
    state.bomb.site = 0;
    state.bomb.x = SITES[0].x + 1;
    state.bomb.z = SITES[0].z;
    place(playerActor, -11.5, -13.5, 1.35);
    place(byId(2), SITES[0].x + 4, SITES[0].z + 3, -1.5);
    place(byId(8), SITES[0].x + 5, SITES[0].z - 3, 0.4);
    byId(8).alive = false;
    for (let i = 0; i < 20; i += 1) step(FIXED_STEP);
    hud.banner('Charge planted', 'Site A — 40 seconds');
  } else {
    state.phase = 'matchover';
    state.matchWinner = 'raiders';
    state.wins.raiders = 9;
    state.wins.guards = 6;
    place(playerActor, 0, 14, 0);
    hud.showOverlay('matchRaiders');
  }
  syncCamera();
  syncHud();
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// A testing handle: the headless smoke test drives the match directly through this.
window.__tandan = { match, loadout };

syncCamera();
if (shot) stageShot(shot);
else requestAnimationFrame(frame);
