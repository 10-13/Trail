import test from 'node:test';
import assert from 'node:assert/strict';
import { WAGON, PLAYER, TYPES, dimensions, createState, placementError, putObject, movePlayer, serialize, deserialize, canStand, removeObject } from '../web/core.js';
const frame = (x = 10, y = 1) => ({ type: 'frame', x, y, z: 0, rotation: 0 });

test('demo layout satisfies all construction and player constraints', () => {
  const state = createState();
  for (const object of state.objects) assert.equal(placementError(state, object, object.id), '');
  assert.ok(canStand(state, state.player));
});
test('placement enforces all walls, voxel alignment, floor mounting and known types', () => {
  const state = createState(false);
  for (const candidate of [frame(-1), frame(43), frame(10, -1), frame(10, 9), { ...frame(), x: 10.5 }, { ...frame(), z: 1 }, { ...frame(), rotation: 4 }, { ...frame(), type: 'unknown' }]) {
    assert.notEqual(placementError(state, candidate), '');
  }
  assert.equal(placementError(state, frame(42, 8)), '');
});
test('racks can touch edges but cannot overlap; loose structures are refused', () => {
  const state = createState(false);
  assert.equal(putObject(state, frame()), '');
  assert.match(placementError(state, { type: 'frame', x: 15, y: 2, z: 0, rotation: 0 }), /занято/);
  assert.match(putObject(state, { type: 'storage', x: 16, y: 1, z: 0, rotation: 0 }), /только/);
  assert.equal(putObject(state,frame(16)), '');
  assert.equal(state.objects.length, 2);
});
test('player prevents placement, including a corner intersecting the character circle', () => {
  const state = createState(false);
  assert.match(placementError(state, frame(3, 5)), /персонаж/);
  state.player = { x: 9.5, y: 0.5, angle: 0 };
  assert.match(placementError(state, frame()), /персонаж/);
});
test('failed move is atomic, successful move preserves identity, deletion frees space', () => {
  const state = createState(false); putObject(state, frame()); putObject(state, frame(20));
  const id = state.objects[0].id, before = serialize(state);
  assert.match(putObject(state, frame(21), id), /занято/);
  assert.equal(serialize(state), before);
  assert.equal(putObject(state, frame(11), id), '');
  assert.equal(state.objects[0].id, id);
  assert.equal(state.objects[0].x, 11);
  removeObject(state, id); assert.equal(placementError(state, frame(11)), '');
});
test('rotation swaps footprint and validates the new boundary', () => {
  const state = createState(false), object = { ...frame(40, 6), rotation: 1 };
  assert.deepEqual(dimensions(object), { width: 4, depth: 6, height: 8 });
  assert.equal(putObject(state, object), '');
  assert.match(placementError(state, { ...object, y: 7 }, state.objects[0].id), /границами/);
});
test('movement stops at walls and obstacles, slides and cannot tunnel with a large time delta', () => {
  const state = createState(false); state.player = { x: 3, y: 2, angle: 0 }; putObject(state, frame(6));
  for (let i = 0; i < 180; i++) movePlayer(state, 1, 0, 1 / 60);
  assert.ok(state.player.x <= 5 + 1e-8); assert.ok(state.player.x > 4.8);
  movePlayer(state, 1, 0, 100); assert.ok(state.player.x <= 5 + 1e-8);
  for (let i = 0; i < 120; i++) movePlayer(state, 1, 1, 1 / 60);
  assert.ok(state.player.y > 5); assert.ok(canStand(state, state.player));
  for (let i = 0; i < 1000; i++) movePlayer(state, -1, -1, 1 / 60);
  assert.ok(state.player.x >= PLAYER.radius && state.player.y >= PLAYER.radius);
});
test('diagonal movement has the same speed as movement along an axis', () => {
  const a = createState(false), b = createState(false), start = { ...a.player };
  movePlayer(a, 1, 0, 0.1); movePlayer(b, 1, 1, 0.1);
  assert.ok(Math.abs((a.player.x - start.x) - Math.hypot(b.player.x - start.x, b.player.y - start.y)) < 1e-9);
});
test('save round trip preserves objects, orientation, identifiers and player', () => {
  const state = createState(); movePlayer(state, 1, 0, 0.1);
  assert.equal(serialize(deserialize(serialize(state))), serialize(state));
});
test('corrupt saves are rejected before they can replace a layout', () => {
  const original = createState();
  for (const mutate of [
    data => { data.version = 99; },
    data => { data.wagon.width = 49; },
    data => { data.objects[0].x = -1; },
    data => { data.objects[1] = { ...data.objects[0] }; },
    data => { data.objects[0].type = '__proto__'; },
    data => { data.player.x = 8; data.player.y = 2; },
    data => { data.nextId = 1; },
    data => { data.objects[0].z = 2; }
  ]) { const data = JSON.parse(serialize(original)); mutate(data); assert.throws(() => deserialize(JSON.stringify(data))); }
  assert.throws(() => deserialize('{bad json'));
  assert.throws(() => deserialize('null'));
  assert.equal(WAGON.voxel, 0.25); assert.equal(TYPES.frame.height, 8);
});
