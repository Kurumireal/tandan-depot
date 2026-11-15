// The map: Depot Tandan, a palm-oil depot at dusk, built from axis-aligned boxes only.
// Two bomb sites (the warehouse west, the tank farm east), a container yard in the middle
// and three lanes between the spawns. Every box is a movement collider and a surface a
// bullet stops on. The waypoint graph at the bottom is how the bots cross it: nodes on
// the lanes, edges where a bot can walk a straight line.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const SITES = [
  { id: 'A', x: -24, z: -16, radius: 5.5, color: 'siteA' },
  { id: 'B', x: 23, z: -16, radius: 5.5, color: 'siteB' },
];

export const SPAWNS = {
  raiders: [
    { x: -3, z: 24, yaw: 0 }, { x: 0, z: 25.5, yaw: 0 }, { x: 3, z: 24, yaw: 0 },
    { x: -6.5, z: 22, yaw: 0 }, { x: 6.5, z: 22, yaw: 0 },
  ],
  guards: [
    { x: -3, z: -25, yaw: Math.PI }, { x: 0, z: -26.5, yaw: Math.PI }, { x: 3, z: -25, yaw: Math.PI },
    { x: -6.5, z: -23, yaw: Math.PI }, { x: 6.5, z: -23, yaw: Math.PI },
  ],
};

// Node positions [x, z]; edges are index pairs a bot may walk directly.
export const NAV_NODES = [
  [0, 21], [-9, 17], [9, 17], [0, 13],                       // 0-3 raider yard
  [-19, 13], [-27, 8], [-31, 0], [-28, -4],                  // 4-7 west lane
  [19, 13], [27, 8], [31, 0], [28, -4],                      // 8-11 east lane
  [-15, 3], [-6, 1], [3, 3], [11, 1],                        // 12-15 mid yard
  [0, -5], [-13, -3], [13, -3],                              // 16-18 mid doors
  [-16, -9], [-24, -9], [-29, -14], [-19, -15], [-24, -21], [-13, -17], // 19-24 site A
  [16, -9], [23, -9], [31, -16], [20, -15], [24, -21], [14, -18],       // 25-30 site B
  [0, -19], [-7, -21], [7, -21], [-14, -23], [14, -23],      // 31-35 guard yard
  [-10.5, -15], [24, -3], [10, -14.5], [8, -14],             // 36-39 door and gap nodes
];
export const NAV_EDGES = [
  [0, 1], [0, 2], [0, 3], [1, 4], [2, 8], [3, 12], [3, 14],
  [4, 5], [4, 12], [5, 6], [6, 7], [7, 19], [7, 21],
  [8, 9], [8, 14], [9, 10], [10, 11], [11, 37],
  [12, 13], [13, 14], [14, 15], [12, 17], [15, 18], [13, 16], [16, 17], [16, 18], [16, 31], [16, 36],
  [18, 38], [36, 19], [36, 24], [37, 26], [37, 27], [38, 30], [31, 39], [39, 38],
  [19, 20], [20, 21], [20, 22], [21, 22], [22, 23], [19, 24], [24, 23], [23, 34],
  [25, 26], [26, 28], [28, 29], [25, 30], [30, 29], [28, 27],
  [31, 32], [31, 33], [32, 34], [32, 23],
];

export function createMap(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.5 : 0.9,
      metalness: 0.04,
    });
  }
  const flatSite = (hex) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex), transparent: true, opacity: 0.3, depthWrite: false });

  const colliders = [];
  const shootables = [];

  function box(w, h, d, x, y, z, material, solid = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (solid) colliders.push(new THREE.Box3().setFromObject(mesh));
    if (solid !== 'ghost') shootables.push(mesh);
    return mesh;
  }

  function cylinder(radius, height, x, z, material) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 20), materials[material]);
    mesh.position.set(x, height / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    const r = radius * 0.92;
    colliders.push(new THREE.Box3(new THREE.Vector3(x - r, 0, z - r), new THREE.Vector3(x + r, height, z + r)));
    shootables.push(mesh);
    return mesh;
  }

  // Ground and perimeter: a 76 x 60 yard walled at 5 m.
  box(76.8, 0.4, 60.8, 0, -0.2, 0, 'ground', false).receiveShadow = true;
  box(0.5, 5, 60.8, -38.2, 2.5, 0, 'surface');
  box(0.5, 5, 60.8, 38.2, 2.5, 0, 'surface');
  box(76.8, 5, 0.5, 0, 2.5, -30.2, 'surface');
  box(76.8, 5, 0.5, 0, 2.5, 30.2, 'surface');

  // Warehouse (site A): walls on x in [-34,-12], z in [-26,-6], doors east (2) and south (1).
  box(22.5, 5.4, 0.5, -23, 2.7, -26.2, 'surface');                    // north wall
  box(0.5, 5.4, 20.5, -34.2, 2.7, -16, 'surface');                    // west wall
  box(0.5, 5.4, 6.5, -12, 2.7, -22.8, 'surface');                     // east wall, north door segment
  box(0.5, 5.4, 5.5, -12, 2.7, -8.8, 'surface');                      // east wall, south door segment
  box(0.5, 1.4, 8.5, -12, 4.7, -16, 'surface');                       // east wall lintel over the mid gap
  box(7.5, 5.4, 0.5, -30.2, 2.7, -6, 'surface');                      // south wall west of the door
  box(9.5, 5.4, 0.5, -16.8, 2.7, -6, 'surface');                      // south wall east of the door
  box(22.5, 0.3, 20.5, -23, 5.55, -16, 'hairline');                   // warehouse roof slab
  // Warehouse cover: crate stacks and a rack.
  box(2.2, 2.2, 2.2, -29, 1.1, -12, 'foliage');
  box(2.2, 1.1, 2.2, -29, 2.75, -12, 'muted');
  box(3.4, 1.1, 1.6, -20, 0.55, -20, 'foliage');
  box(1.6, 1.6, 1.6, -16, 0.8, -13, 'muted');
  box(5.5, 2.6, 0.8, -24, 1.3, -24.6, 'hairline');
  box(1.8, 1.8, 1.8, -31, 0.9, -20, 'muted');

  // Tank farm (site B): three storage tanks, pipes and a low fence with two gaps.
  cylinder(3.4, 5.2, 18, -21, 'muted');
  cylinder(3.4, 5.2, 28.5, -11, 'muted');
  cylinder(2.6, 4.2, 30, -22, 'surface');
  box(9, 0.5, 0.8, 23, 0.25, -16, 'hairline', 'ghost');
  box(0.8, 0.5, 9, 23, 0.25, -16, 'hairline', 'ghost');
  box(0.4, 2.2, 8, 12.2, 1.1, -22, 'hairline');                       // fence west, north gap segment
  box(0.4, 2.2, 5, 12.2, 1.1, -8.5, 'hairline');                      // fence west, south segment
  box(8, 2.2, 0.4, 16.5, 1.1, -6, 'hairline');                        // fence south, west segment
  box(6, 2.2, 0.4, 30.5, 1.1, -6, 'hairline');                        // fence south, east segment
  box(2.2, 1.1, 2.2, 15.5, 0.55, -13, 'foliage');
  box(1.6, 1.6, 1.6, 21, 0.8, -24.5, 'foliage');

  // Mid yard: container stacks making two lanes and a cross. A container is 6 x 2.4, 2.6 high.
  function container(x, z, alongX, material, level = 0) {
    const w = alongX ? 6 : 2.4;
    const d = alongX ? 2.4 : 6;
    box(w, 2.6, d, x, 1.3 + level * 2.6, z, material);
    box(w === 6 ? 6.1 : 0.3, 0.18, d === 6 ? 6.1 : 0.3, x, 2.66 + level * 2.6, z, 'hairline');
  }
  container(-16, 6, true, 'muted');
  container(-16, 6, true, 'foliage', 1);
  container(-4, 7.5, false, 'surface');
  container(8, 5, true, 'foliage');
  container(17, 7, false, 'muted');
  container(-9, -1, true, 'surface');
  container(6, -2, false, 'foliage');
  container(-22, 3, false, 'muted');
  container(24, 2, true, 'surface');
  // Lane cover: crates and barrels.
  box(1.8, 1.8, 1.8, -27, 0.9, 12, 'foliage');
  box(1.8, 0.9, 1.8, -27, 2.25, 12, 'muted');
  box(1.8, 1.8, 1.8, 27, 0.9, 12, 'foliage');
  cylinder(0.55, 1.15, -6, 12.5, 'accent');
  cylinder(0.55, 1.15, 5.5, -7.5, 'accent');
  cylinder(0.55, 1.15, -13, -7, 'accent');
  box(2.4, 1.1, 1.2, 0, 0.55, 17, 'muted');
  box(2.4, 1.1, 1.2, -13, 0.55, -13.5, 'muted');
  // Guard yard divider: a low wall with a centre gap, behind the north mid door.
  box(10, 2.4, 0.5, -10.5, 1.2, -19, 'surface');
  box(10, 2.4, 0.5, 10.5, 1.2, -19, 'surface');
  // Office block in the south-west corner: pure backdrop with a lit doorway slab.
  box(10, 4.4, 6, -31, 2.2, 24, 'surface');
  box(1.6, 2.6, 0.2, -27.5, 1.3, 20.9, 'accent');

  // Site markings: a translucent disc and four corner posts per site.
  for (const site of SITES) {
    const disc = new THREE.Mesh(new THREE.CircleGeometry(site.radius, 36), flatSite(PALETTE[site.color]));
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(site.x, 0.03, site.z);
    group.add(disc);
    shootables.push(disc);
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      box(0.28, 1.5, 0.28, site.x + dx * site.radius * 0.72, 0.75, site.z + dz * site.radius * 0.72, site.color, false);
    }
  }

  // Light: dusk. A low warm key from the south-west, cool sky fill, and two site lamps.
  const sky = new THREE.HemisphereLight(new THREE.Color(PALETTE.muted), new THREE.Color(PALETTE.canvas), 1.9);
  scene.add(sky);
  const key = new THREE.DirectionalLight(new THREE.Color(PALETTE.accent), 2.6);
  key.position.set(-18, 22, 16);
  key.target.position.set(0, 0, -4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -42;
  key.shadow.camera.right = 42;
  key.shadow.camera.top = 36;
  key.shadow.camera.bottom = -36;
  key.shadow.camera.far = 80;
  key.shadow.bias = -0.0006;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.ink), 0.7);
  fill.position.set(14, 18, -12);
  scene.add(fill);
  for (const site of SITES) {
    const lamp = new THREE.PointLight(new THREE.Color(PALETTE[site.color]), 60, 17, 1.8);
    lamp.position.set(site.x, 4.4, site.z);
    scene.add(lamp);
  }

  return { colliders, shootables, group };
}

// The navigation graph, built once from the tables above.
export const NAV = (() => {
  const nodes = NAV_NODES.map(([x, z]) => ({ x, z }));
  const adjacency = nodes.map(() => []);
  for (const [a, b] of NAV_EDGES) {
    adjacency[a].push(b);
    adjacency[b].push(a);
  }
  function nearest(x, z) {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < nodes.length; i += 1) {
      const d = (nodes[i].x - x) ** 2 + (nodes[i].z - z) ** 2;
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
  }
  // Breadth-first over a 36-node graph: cheap enough to run whenever a bot replans.
  function path(fromIndex, toIndex) {
    if (fromIndex === toIndex) return [toIndex];
    const prev = new Array(nodes.length).fill(-1);
    const queue = [fromIndex];
    prev[fromIndex] = fromIndex;
    while (queue.length) {
      const at = queue.shift();
      if (at === toIndex) break;
      for (const next of adjacency[at]) {
        if (prev[next] === -1) { prev[next] = at; queue.push(next); }
      }
    }
    if (prev[toIndex] === -1) return [toIndex];
    const out = [];
    let at = toIndex;
    while (at !== fromIndex) { out.push(at); at = prev[at]; }
    out.reverse();
    return out;
  }
  return { nodes, adjacency, nearest, path };
})();
