import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, putObject, putEquipment, putPipe, paintPipeRoute, removePipe, updatePorts, updateFrame, movePlayer, serialize, deserialize, canStand } from '../web/core.js';
import { allPipes, worldPorts, PIPE_CAPACITY, cellKey } from '../web/logistics.js';
const machine = (extra = {}) => ({ type: 'machine', x: 0, y: 1, z: 0, rotation: 0, width: 2, depth: 2, height: 2, ...extra });
function pair() {
  const state = createState(false);
  assert.equal(putObject(state, { type: 'frame', x: 10, y: 1, z: 0, rotation: 0, width: 12, depth: 6, height: 8, mount: 'floor', children: [], nextItemId: 1 }), '');
  const frame = state.objects[0];
  assert.equal(putEquipment(state, frame.id, machine()), '');
  assert.equal(putEquipment(state, frame.id, machine({ x: 8 })), '');
  return { state, frame };
}
const cell = (x, y = 2, z = 0) => ({ x, y, z });

test('a drawn route connects an output to an input and a removed section breaks the graph immediately', () => {
  const { state, frame } = pair();
  assert.equal(paintPipeRoute(state, frame.id, cell(2), cell(7)), '');
  assert.equal(state.graph.links.length, 1);
  assert.equal(state.graph.links[0].pipeIds.length, 6);
  assert.match(state.graph.links[0].source, /item-1\/port-2$/);
  assert.match(state.graph.links[0].target, /item-2\/port-1$/);
  removePipe(state, frame.pipes.find(pipe => pipe.x === 4).id);
  assert.equal(state.graph.links.length, 0);
  assert.equal(paintPipeRoute(state, frame.id, cell(3), cell(5)), '');
  assert.equal(state.graph.links.length, 1);
  assert.equal(PIPE_CAPACITY, 4);
});
test('adjacent parallel routes stay separate and a crossing cannot create a junction', () => {
  const { state, frame } = pair();
  paintPipeRoute(state, frame.id, cell(2), cell(7));
  paintPipeRoute(state, frame.id, cell(2, 3), cell(7, 3));
  const at = (x, y) => frame.pipes.find(p => p.x === x && p.y === y);
  assert.equal(state.graph.edges.some(([a,b]) => a === at(4,2).id && b === at(4,3).id), false);
  const unchanged=serialize(state);
  assert.match(paintPipeRoute(state, frame.id, cell(4,2), cell(4,3)), /Ответвление/);
  assert.equal(serialize(state),unchanged);
  assert.equal(at(4,2).faces.length,2);
  const before = serialize(state);
  assert.match(putPipe(state, { ...cell(4), faces: ['nx','px'] }, frame.id), /занята/);
  assert.equal(serialize(state), before);
  assert.equal(new Set(allPipes(state).map(cellKey)).size, allPipes(state).length);
});
test('a third direction is refused without changing the existing connection', () => {
  const { state, frame } = pair();
  putEquipment(state, frame.id, machine({ x: 4, y: 4 }));
  paintPipeRoute(state, frame.id, cell(2), cell(7));
  const before=serialize(state);
  assert.match(paintPipeRoute(state, frame.id, cell(3,2), cell(3,5)), /Ответвление/);
  assert.equal(state.graph.links.length,1);assert.equal(serialize(state),before);
  assert.match(putPipe(state,{...cell(3,3),faces:['nx','px','py']},frame.id),/две грани/);
});
test('an explicit shared junction can join local and world pipes without duplicating a cell', () => {
  const { state, frame } = pair();
  assert.equal(putPipe(state, { x: 14, y: 3, z: 0, faces: ['nx','px'] }), '');
  assert.equal(paintPipeRoute(state, frame.id, cell(2), cell(7)), '');
  assert.equal(frame.pipes.length, 5);
  assert.equal(state.pipes.length, 1);
  assert.equal(state.graph.links.length, 1);
  assert.equal(putObject(state, { ...frame, rotation: 1, y: 0 }, frame.id), '');
  assert.equal(state.graph.links.length, 0);
  assert.deepEqual([state.pipes[0].x,state.pipes[0].y], [14,3]);
});
test('moving and rotating equipment moves its ports and never leaves stale graph links', () => {
  const { state, frame } = pair(); paintPipeRoute(state, frame.id, cell(2), cell(7));
  let target = frame.children[1];
  assert.equal(putEquipment(state, frame.id, { ...target, rotation: 1 }, target.id), '');
  assert.equal(state.graph.links.length, 0);
  target = frame.children[1];
  assert.equal(putEquipment(state, frame.id, { ...target, x: 9, rotation: 0 }, target.id), '');
  assert.equal(state.graph.links.length, 0);
  target = frame.children[1];
  assert.equal(putEquipment(state, frame.id, { ...target, x: 8 }, target.id), '');
  assert.equal(state.graph.links.length, 1);
  assert.equal(updatePorts(state, frame.id, target.id, [], 3), '');
  assert.equal(state.graph.links.length, 0);
});
test('ports on vertical faces form actual three-dimensional paths', () => {
  const { state, frame } = pair(); frame.children = []; frame.nextItemId = 1;
  putEquipment(state, frame.id, machine({ x: 0, y: 0, ports: [{ id: 'port-1', kind: 'output', face: 'pz', u: 0, v: 0 }], nextPortId: 2 }));
  putEquipment(state, frame.id, machine({ x: 0, y: 0, z: 5, ports: [{ id: 'port-1', kind: 'input', face: 'nz', u: 0, v: 0 }], nextPortId: 2 }));
  assert.equal(paintPipeRoute(state, frame.id, cell(0,0,2), cell(0,0,4)), '');
  assert.equal(state.graph.links.length, 1);
  assert.deepEqual(frame.pipes.map(p => p.z), [2,3,4]);
  assert.ok(frame.pipes[1].faces.includes('nz') && frame.pipes[1].faces.includes('pz'));
});
test('moving or rotating a frame carries local ports and pipes; its internal link remains valid', () => {
  const { state, frame } = pair(); paintPipeRoute(state, frame.id, cell(2), cell(7));
  const old = worldPorts(state).map(port => ({ ...port.cell }));
  assert.equal(putObject(state, { ...frame, x: 25, y: 0, rotation: 1 }, frame.id), '');
  assert.equal(state.graph.links.length, 1);
  assert.notDeepEqual(worldPorts(state).map(port => port.cell), old);
  assert.equal(allPipes(state)[0].faces.includes('ny'), true);
});
test('pipes occupy free cells inside a hollow frame, but cannot overlap equipment or another pipe', () => {
  const { state, frame } = pair();
  assert.equal(putPipe(state, { ...cell(4,4,4), faces: ['nx','px'] }, frame.id), '');
  assert.match(putPipe(state, { ...cell(0,1,0), faces: ['nx','px'] }, frame.id), /оборудованием/);
  assert.equal(putPipe(state, { x: 15, y: 5, z: 4, faces: ['nx','px'] }), '');
  assert.match(putEquipment(state, frame.id, machine({ x: 4, y: 4, z: 4 })), /оборудованием/);
  assert.match(putPipe(state, { x: 14, y: 5, z: 4, faces: ['nx','px'] }), /занята/);
  const before = serialize(state);
  assert.match(updateFrame(state, frame.id, { height: 4 }), /границы/);
  assert.equal(serialize(state), before);
});
test('blocked route drawing is atomic and preserves every existing segment and open face', () => {
  const { state, frame } = pair(); paintPipeRoute(state, frame.id, cell(2), cell(4));
  const before = serialize(state);
  assert.match(paintPipeRoute(state, frame.id, cell(4), cell(9)), /оборудованием/);
  assert.equal(serialize(state), before);
  assert.match(paintPipeRoute(state, frame.id, cell(4), cell(100)), /границы/);
  assert.equal(serialize(state), before);
});
test('low pipes block the character and pipes at two metres permit passage underneath', () => {
  const state = createState(false);
  assert.equal(putPipe(state, { x: 10, y: 6, z: 8, faces: ['nx','px'] }), '');
  assert.ok(canStand(state, { x: 10.5, y: 6.5 }));
  state.player = { x: 10.5, y: 6.5, angle: 0 };
  assert.match(putPipe(state, { x: 10, y: 6, z: 7, faces: ['nx','px'] }), /персонаж/);
  state.player = { x: 3, y: 6.5, angle: 0 };
  assert.equal(putPipe(state, { x: 10, y: 6, z: 7, faces: ['nx','px'] }), '');
  for (let step=0;step<120;step++) movePlayer(state,1,0,1/60);
  assert.ok(state.player.x <= 9.001);
});
test('v5 round trip rebuilds graph and migrates v2 layouts without losing geometry', () => {
  const { state, frame } = pair(); paintPipeRoute(state, frame.id, cell(2), cell(7));
  const text = serialize(state), loaded = deserialize(text);
  assert.equal(serialize(loaded), text);
  assert.equal(loaded.graph.links.length, 1);
  assert.equal(JSON.parse(text).version, 5);
  const old = JSON.parse(text); old.version = 2; delete old.nextPipeId; delete old.pipes;
  for (const object of old.objects) { delete object.pipes; for (const item of object.children || []) { delete item.ports; delete item.nextPortId; } }
  const migrated = deserialize(JSON.stringify(old));
  assert.equal(migrated.version, 5); assert.equal(migrated.objects[0].children[0].ports.length, 2);
});
test('invalid ports and corrupt pipes are rejected without replacing the current state', () => {
  const { state, frame } = pair(); paintPipeRoute(state, frame.id, cell(2), cell(7));
  for (const mutate of [
    data => { data.objects[0].children[0].ports[0].u = 99; },
    data => { data.objects[0].children[0].ports[0].face = 'diagonal'; },
    data => { data.objects[0].children[0].ports[1].id = 'port-1'; },
    data => { data.objects[0].pipes[0].faces = ['px','px']; },
    data => { data.objects[0].pipes[0].faces = ['sideways']; },
    data => { data.objects[0].pipes.push({ ...data.objects[0].pipes[0], id: 'pipe-99' }); data.nextPipeId=100; },
    data => { data.objects[0].pipes = null; },
    data => { data.pipes = null; },
    data => { data.nextPipeId=1; }
  ]) { const data=JSON.parse(serialize(state)); mutate(data); assert.throws(()=>deserialize(JSON.stringify(data))); }
});
