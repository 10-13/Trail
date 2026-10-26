import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, WAGON, dimensions, localSize, placementError, putObject, updateFrame, putEquipment, equipmentError, removeEquipment, worldEquipment, canStand, movePlayer, serialize, deserialize } from '../web/core.js';

const frame = (extra = {}) => ({ type: 'frame', x: 10, y: 1, z: 0, rotation: 0, width: 8, depth: 6, height: 8, mount: 'floor', children: [], nextItemId: 1, ...extra });
const item = (extra = {}) => ({ type: 'machine', x: 0, y: 0, z: 0, width: 2, depth: 2, height: 2, rotation: 0, ...extra });

test('custom frame dimensions are integral, bounded and rotate in the wagon', () => {
  const state = createState(false);
  assert.equal(putObject(state, frame({ width: 11, depth: 3, height: 10 })), '');
  assert.deepEqual(dimensions({ ...state.objects[0], rotation: 1 }), { width: 3, depth: 11, height: 10 });
  for (const extra of [{ width: 0 }, { height: 2.5 }, { depth: -1 }, { width: null }, { height: 11 }, { width: 49 }, { mount: 'wall' }, { mount: null }]) assert.ok(placementError(createState(false), frame(extra)));
});
test('floor and ceiling volumes can share XY but cannot intersect in Z', () => {
  const state = createState(false);
  assert.equal(putObject(state, frame()), '');
  assert.equal(putObject(state, frame({ mount: 'ceiling', z: 8, height: 2 })), '');
  assert.match(placementError(state, frame({ mount: 'ceiling', z: 7, height: 3 })), /занято/);
  assert.match(placementError(createState(false), frame({ mount: 'ceiling', z: 7, height: 2 })), /потолку/);
});
test('two metres of headroom permits walking; lowering by a voxel blocks the same route', () => {
  const state = createState(false);
  assert.equal(putObject(state, frame({ mount: 'ceiling', z: 8, height: 2 })), '');
  const id = state.objects[0].id;
  assert.ok(canStand(state, { x: 12, y: 3 }));
  state.player = { x: 9, y: 3, angle: 0 };
  for (let n = 0; n < 40; n++) movePlayer(state, 1, 0, 1 / 60);
  assert.ok(state.player.x > 12);
  const before = serialize(state);
  assert.match(updateFrame(state, id, { height: 3 }), /персонаж/);
  assert.equal(serialize(state), before);
  state.player = { x: 7, y: 3, angle: 0 };
  assert.equal(updateFrame(state, id, { height: 3 }), '');
  assert.equal(state.objects[0].z, 7);
  assert.equal(canStand(state, { x: 12, y: 3 }), false);
  for (let n = 0; n < 90; n++) movePlayer(state, 1, 0, 1 / 60);
  assert.ok(state.player.x <= 9.001);
});
test('equipment belongs inside its frame and ignores that enclosing frame as an obstacle', () => {
  const state = createState(false); putObject(state, frame());
  const id = state.objects[0].id;
  assert.equal(putEquipment(state, id, item()), '');
  assert.equal(state.objects[0].children.length, 1);
  assert.match(putEquipment(state, id, item({ x: 1 })), /пересекается/);
  // Same XY projection at a different height is a separate volume.
  assert.equal(putEquipment(state, id, item({ z: 2 })), '');
  for (const extra of [{ x: -1 }, { y: 5 }, { z: 7 }, { x: 7 }, { height: 0 }, { width: 1.5 }, { type: 'frame' }]) assert.ok(equipmentError(state.objects[0], item(extra)));
});
test('equipment moves, resizes, rotates and deletes atomically; frame resize protects contents', () => {
  const state = createState(false); putObject(state, frame());
  const id = state.objects[0].id;
  putEquipment(state, id, item({ width: 3, depth: 2 }));
  let child = state.objects[0].children[0];
  assert.equal(putEquipment(state, id, { ...child, x: 2, y: 1, z: 3, rotation: 1 }, child.id), '');
  child = state.objects[0].children[0];
  assert.deepEqual(dimensions(child), { width: 2, depth: 3, height: 2 });
  let before = serialize(state);
  assert.match(putEquipment(state, id, { ...child, z: 7 }, child.id), /границы/);
  assert.equal(serialize(state), before);
  assert.match(updateFrame(state, id, { height: 4 }), /границы/);
  assert.equal(serialize(state), before);
  removeEquipment(state, id, child.id);
  assert.equal(state.objects[0].children.length, 0);
  assert.equal(updateFrame(state, id, { height: 4 }), '');
});
test('rotating and moving a frame preserves local equipment and computes world bounds on all turns', () => {
  const current = frame({ x: 20, y: 2, z: 4, width: 8, depth: 6 });
  const child = item({ x: 1, y: 2, z: 1, width: 3, depth: 2, rotation: 1 });
  const expected = [[21, 4], [21, 3], [25, 3], [22, 7]];
  for (let rotation = 0; rotation < 4; rotation++) {
    const world = worldEquipment({ ...current, rotation }, child);
    assert.deepEqual([world.x, world.y], expected[rotation]);
    assert.equal(world.z, 5);
    assert.equal(world.rotation, (rotation + 1) % 4);
    const size = dimensions(world), outer = dimensions({ ...current, rotation });
    assert.ok(world.x + size.width <= current.x + outer.width);
    assert.ok(world.y + size.depth <= current.y + outer.depth);
  }
});
test('save round trip retains dimensions, mounting, nested equipment and counters', () => {
  const state = createState(false);
  putObject(state, frame({ mount: 'ceiling', z: 8, height: 2 }));
  putEquipment(state, state.objects[0].id, item({ width: 3, rotation: 1 }));
  assert.equal(JSON.parse(serialize(state)).version, 5);
  assert.equal(serialize(deserialize(serialize(state))), serialize(state));
});
test('stage 1 saves migrate without losing objects, orientation or player position', () => {
  const legacy = { version: 1, wagon: WAGON, nextId: 2, player: { x: 3, y: 6, angle: 0 }, objects: [{ id: 'object-1', type: 'frame', x: 10, y: 1, z: 0, rotation: 1 }] };
  const state = deserialize(JSON.stringify(legacy));
  assert.equal(state.version, 5);
  assert.deepEqual(localSize(state.objects[0]), { width: 6, depth: 4, height: 8 });
  assert.equal(state.objects[0].mount, 'floor');
  assert.deepEqual(state.objects[0].children, []);
  assert.equal(state.objects[0].rotation, 1);
  assert.deepEqual(state.player, legacy.player);
});
test('nested corrupt saves reject duplicate IDs, invalid dimensions, overlaps and unsupported mounts', () => {
  const state = createState(false); putObject(state, frame()); putEquipment(state, state.objects[0].id, item());
  for (const mutate of [
    f => { f.children.push({ ...f.children[0] }); },
    f => { f.children[0].width = -1; },
    f => { f.children[0].z = 9; },
    f => { f.children[0].type = '__proto__'; },
    f => { f.children = null; },
    f => { f.nextItemId = 1; },
    f => { f.mount = 'wall'; },
    f => { f.children.push({ ...f.children[0], id: 'item-2' }); f.nextItemId = 3; }
  ]) {
    const data = JSON.parse(serialize(state)); mutate(data.objects[0]); assert.throws(() => deserialize(JSON.stringify(data)));
  }
});
