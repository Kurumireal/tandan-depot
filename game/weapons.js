// The arsenal: five guns and a knife, each a row of numbers and a low-poly view model.
// The table is the single source of truth for damage, spread, recoil and price; the
// player and the bots read the same rows, so a bot's rifle hurts exactly like yours.
// Damage falls with range, heads take a multiplier, armour halves what reaches health.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  knife:   { name: 'Kukri',        price: 0,    slot: 3, damage: 55, headMult: 1.5, mag: 0,  reserve: 0,  gap: 0.45,  reload: 0,   auto: false, pellets: 0, spreadStill: 0,      spreadMove: 0,     range: 1.7,  falloff: 1,   recoil: 0 },
  pistol:  { name: 'Kakatua P1',   price: 0,    slot: 2, damage: 26, headMult: 3.2, mag: 12, reserve: 48, gap: 0.24,  reload: 1.4, auto: false, pellets: 1, spreadStill: 0.006,  spreadMove: 0.03,  range: 60,   falloff: 0.5, recoil: 0.010 },
  smg:     { name: 'Cendana SMG',  price: 1400, slot: 1, damage: 20, headMult: 2.6, mag: 30, reserve: 90, gap: 0.07,  reload: 2.0, auto: true,  pellets: 1, spreadStill: 0.013,  spreadMove: 0.046, range: 55,   falloff: 0.45, recoil: 0.007 },
  shotgun: { name: 'Banteng SG',   price: 1100, slot: 1, damage: 11, headMult: 1.8, mag: 6,  reserve: 24, gap: 0.85,  reload: 2.8, auto: false, pellets: 8, spreadStill: 0.05,   spreadMove: 0.07,  range: 26,   falloff: 0.25, recoil: 0.035 },
  rifle:   { name: 'Lestari RK',   price: 2700, slot: 1, damage: 34, headMult: 3.4, mag: 25, reserve: 75, gap: 0.105, reload: 2.2, auto: true,  pellets: 1, spreadStill: 0.0035, spreadMove: 0.032, range: 80,   falloff: 0.55, recoil: 0.013 },
  sniper:  { name: 'Rajawali SNP', price: 4300, slot: 1, damage: 95, headMult: 2.6, mag: 5,  reserve: 20, gap: 1.35,  reload: 2.9, auto: false, pellets: 1, spreadStill: 0.0012, spreadMove: 0.09,  range: 120,  falloff: 0.8, recoil: 0.05 },
};
export const WEAPON_ORDER = ['rifle', 'smg', 'shotgun', 'sniper', 'pistol', 'knife'];
export const ARMOR_PRICE = 650;
export const GRENADE_PRICES = { he: 300, flash: 200, smoke: 300 };

// Health damage of one pellet that lands on `part` at `distance`, before armour.
export function pelletDamage(id, part, distance) {
  const w = WEAPONS[id];
  const beyond = Math.max(0, distance - 16);
  const rangeFactor = Math.max(w.falloff, 1 - beyond / Math.max(1, w.range) * (1 - w.falloff));
  const partFactor = part === 'head' ? w.headMult : part === 'legs' ? 0.75 : 1;
  return w.damage * rangeFactor * partFactor;
}

export function applyArmor(rawDamage, hasArmor) {
  return hasArmor ? rawDamage * 0.55 : rawDamage;
}

// --- The player's hands: view models, magazines, reloads, muzzle flash. ---

function buildModel(id) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.45, metalness: 0.35 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.muted), roughness: 0.5, metalness: 0.3 });
  const model = new THREE.Group();
  const part = (geo, mat, x, y, z) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    model.add(mesh);
    return mesh;
  };
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  if (id === 'pistol') {
    part(box(0.07, 0.11, 0.24), body, 0, 0, -0.05);
    part(box(0.06, 0.14, 0.08), grip, 0, -0.11, 0.04);
  } else if (id === 'smg') {
    part(box(0.08, 0.12, 0.4), body, 0, 0, -0.1);
    part(box(0.05, 0.05, 0.22), grip, 0, 0.02, -0.38);
    part(box(0.055, 0.2, 0.07), accent, 0, -0.15, -0.05);
    part(box(0.06, 0.13, 0.07), grip, 0, -0.1, 0.14);
  } else if (id === 'shotgun') {
    part(box(0.09, 0.11, 0.55), body, 0, 0, -0.16);
    part(box(0.07, 0.07, 0.3), grip, 0, -0.05, -0.3);
    part(box(0.08, 0.09, 0.2), accent, 0, -0.01, 0.24);
  } else if (id === 'sniper') {
    part(box(0.08, 0.1, 0.62), body, 0, 0, -0.2);
    part(box(0.035, 0.035, 0.4), grip, 0, 0.03, -0.62);
    part(box(0.05, 0.07, 0.2), accent, 0, 0.1, -0.15);
    part(box(0.06, 0.14, 0.07), grip, 0, -0.11, 0.1);
  } else if (id === 'knife') {
    part(box(0.03, 0.05, 0.3), accent, 0, 0.02, -0.18);
    part(box(0.035, 0.12, 0.05), grip, 0, -0.05, 0.02);
    model.rotation.x = 0.5;
  } else {
    part(box(0.09, 0.11, 0.44), body, 0, 0, -0.12);
    part(box(0.045, 0.045, 0.4), grip, 0, 0.03, -0.5);
    part(box(0.06, 0.19, 0.07), accent, 0, -0.14, -0.02);
    part(box(0.07, 0.08, 0.22), grip, 0, -0.02, 0.28);
    part(box(0.03, 0.09, 0.03), grip, 0, 0.09, -0.3);
  }
  model.position.set(0.25, -0.22, -0.45);
  model.visible = false;
  return model;
}

export function createLoadout(camera) {
  const models = {};
  for (const id of Object.keys(WEAPONS)) {
    models[id] = buildModel(id);
    camera.add(models[id]);
  }
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.17, 0.17),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.25, -0.18, -0.98);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 6);
  flashLight.position.set(0.25, -0.16, -0.7);
  camera.add(flashLight);

  const ammo = {};
  const owned = new Set(['pistol', 'knife']);
  const state = { current: 'pistol', cooldown: 0, reloadLeft: 0, flash: 0, kick: 0, scoped: false };
  function resetAmmo(id) {
    ammo[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
  }
  for (const id of Object.keys(WEAPONS)) resetAmmo(id);
  models[state.current].visible = true;

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 13);
    const model = models[state.current];
    model.position.z = -0.45 + state.kick;
    model.rotation.x = state.kick * 2.4 + (state.current === 'knife' ? 0.5 : 0);
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 26;
    flashLight.intensity = state.flash > 0 ? 20 : 0;
    if (state.reloadLeft > 0) {
      const w = WEAPONS[state.current];
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.6 * Math.sin(Math.PI * (1 - state.reloadLeft / w.reload));
      if (state.reloadLeft === 0) {
        const slot = ammo[state.current];
        const take = Math.min(w.mag - slot.mag, slot.reserve);
        slot.mag += take;
        slot.reserve -= take;
      }
    }
  }

  return {
    state,
    owned,
    ammo,
    step,
    current() { return WEAPONS[state.current]; },
    currentId() { return state.current; },
    ready() {
      return state.cooldown === 0 && state.reloadLeft === 0 && (state.current === 'knife' || ammo[state.current].mag > 0);
    },
    pullTrigger() {
      state.cooldown = WEAPONS[state.current].gap;
      state.flash = state.current === 'knife' ? 0 : 0.055;
      state.kick = 0.05 + WEAPONS[state.current].recoil * 2;
    },
    takeRound() {
      if (state.current === 'knife') return true;
      const slot = ammo[state.current];
      if (slot.mag <= 0) return false;
      slot.mag -= 1;
      return true;
    },
    reload() {
      const w = WEAPONS[state.current];
      const slot = ammo[state.current];
      if (state.reloadLeft > 0 || !slot || slot.mag === w.mag || slot.reserve === 0) return;
      state.reloadLeft = w.reload;
    },
    spread(speed) {
      const w = WEAPONS[state.current];
      const base = state.current === 'sniper' && state.scoped ? w.spreadStill : state.current === 'sniper' ? 0.06 : w.spreadStill;
      return base + Math.min(1, speed / 5.2) * w.spreadMove;
    },
    switchTo(id) {
      if (!owned.has(id) || id === state.current) return false;
      models[state.current].visible = false;
      state.current = id;
      state.reloadLeft = 0;
      state.cooldown = Math.max(state.cooldown, 0.25);
      state.scoped = false;
      models[id].visible = true;
      return true;
    },
    bestWeapon() {
      for (const id of WEAPON_ORDER) if (owned.has(id)) return id;
      return 'knife';
    },
    give(id) {
      owned.add(id);
      resetAmmo(id);
    },
    refill() {
      for (const id of Object.keys(WEAPONS)) resetAmmo(id);
    },
    setScoped(on) { state.scoped = on; },
  };
}
