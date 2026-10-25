import { WAGON, PLAYER, EQUIPMENT, dimensions, localSize, orientationOf, transformCell, inverseOrientation, transformBox } from './geometry.js';

export const PIPE_CAPACITY = 4;
export const DIRECTIONS = Object.freeze({ nx: [-1, 0, 0], px: [1, 0, 0], ny: [0, -1, 0], py: [0, 1, 0], nz: [0, 0, -1], pz: [0, 0, 1] });
export const OPPOSITE = Object.freeze({ nx: 'px', px: 'nx', ny: 'py', py: 'ny', nz: 'pz', pz: 'nz' });
export const FACE_NAMES = Object.freeze({ nx: 'Вдоль −', px: 'Вдоль +', ny: 'Поперёк −', py: 'Поперёк +', nz: 'Вниз', pz: 'Вверх' });
export const cellKey = cell => `${cell.x},${cell.y},${cell.z}`;
export const sameCell = (a, b) => a.x === b.x && a.y === b.y && a.z === b.z;
export const adjacent = (cell, face) => { const [x, y, z] = DIRECTIONS[face]; return { x: cell.x + x, y: cell.y + y, z: cell.z + z }; };
export function rotateFace(face, rotation) {
  const object = typeof rotation === 'number' ? { rotation } : rotation;
  const vector = DIRECTIONS[face], index = vector.findIndex(v => v !== 0);
  const axis = orientationOf(object)[index] * vector[index];
  return `${axis < 0 ? 'n' : 'p'}${'xyz'[Math.abs(axis) - 1]}`;
}
export function rotateCell(cell, size, rotation) {
  return transformCell(cell, size, typeof rotation === 'number' ? { rotation } : rotation);
}
export function localCell(frame, world) {
  if (!frame) return { x: world.x, y: world.y, z: world.z };
  return transformCell({ x: world.x-frame.x, y: world.y-frame.y, z: world.z-frame.z }, dimensions(frame), { orientation: inverseOrientation(frame) });
}
export function localFace(frame, face) { return frame ? rotateFace(face, { orientation: inverseOrientation(frame) }) : face; }
export function defaultPorts(object) {
  const size = localSize(object);
  const ports = [
    { id: 'port-1', kind: 'input', face: 'nx', u: Math.floor(size.depth / 2), v: 0 },
    { id: 'port-2', kind: 'output', face: 'px', u: Math.floor(size.depth / 2), v: 0 }
  ];
  if(object.type==='filter'||object.type==='centrifuge'){ports[0].resources=[object.type==='filter'?'crude':'filtered'];ports[1].resources=[object.type==='filter'?'filtered':'clean'];ports.push({id:'port-3',kind:'output',face:'py',u:0,v:0,resources:[object.type==='filter'?'sludge':'residue']});}
  return ports;
}
export const portsOf = object => object.ports === undefined ? defaultPorts(object) : object.ports;
export function portLimits(object, face) {
  const size = localSize(object);
  return face === 'px' || face === 'nx' ? [size.depth, size.height] : face === 'py' || face === 'ny' ? [size.width, size.height] : [size.width, size.depth];
}
export function portsError(object) {
  const ports = portsOf(object), next = object.nextPortId ?? (['filter','centrifuge'].includes(object.type)?4:3);
  if (!Array.isArray(ports) || ports.length > 256 || !Number.isSafeInteger(next) || next < 1) return 'Некорректный список портов';
  const ids = new Set(), positions = new Set();
  for (const port of ports) {
    if (!port || typeof port.id !== 'string' || !/^port-[1-9]\d*$/.test(port.id) || ids.has(port.id) || Number(port.id.slice(5)) >= next) return 'Некорректный идентификатор порта';
    if (!['input', 'output'].includes(port.kind) || !Object.hasOwn(DIRECTIONS, port.face)) return 'Некорректное направление порта';
    if(port.resources!==undefined&&(!Array.isArray(port.resources)||new Set(port.resources).size!==port.resources.length||port.resources.some(r=>!['crude','filtered','clean','sludge','residue'].includes(r))))return 'Некорректный фильтр ресурсов порта';
    const [u, v] = portLimits(object, port.face);
    if (!Number.isInteger(port.u) || !Number.isInteger(port.v) || port.u < 0 || port.v < 0 || port.u >= u || port.v >= v) return 'Порт выходит за границы грани объекта';
    const key = `${port.face},${port.u},${port.v}`;
    if (positions.has(key)) return 'На этой грани в этой ячейке уже есть порт';
    ids.add(port.id); positions.add(key);
  }
  return '';
}
export function canonicalPorts(object) {
  return portsOf(object).map(port => ({ id: port.id, kind: port.kind, face: port.face, u: port.u, v: port.v, resources: [...(port.resources||[])] }));
}
export function portCell(object, port) {
  const size = localSize(object);
  const base = port.face === 'nx' || port.face === 'px'
    ? { x: port.face === 'nx' ? 0 : size.width - 1, y: port.u, z: port.v }
    : port.face === 'ny' || port.face === 'py'
      ? { x: port.u, y: port.face === 'ny' ? 0 : size.depth - 1, z: port.v }
      : { x: port.u, y: port.v, z: port.face === 'nz' ? 0 : size.height - 1 };
  const rotated = rotateCell(base, size, object);
  return { x: object.x + rotated.x, y: object.y + rotated.y, z: object.z + rotated.z };
}
export function worldPorts(state) {
  const result = [];
  function add(object, frame = null) {
    for (const port of portsOf(object)) {
      let cell = portCell(object, port), face = rotateFace(port.face, object);
      if (frame) { cell = rotateCell(cell, localSize(frame), frame); cell = { x: cell.x + frame.x, y: cell.y + frame.y, z: cell.z + frame.z }; face = rotateFace(face, frame); }
      const owner = frame ? `${frame.id}/${object.id}` : object.id;
      result.push({ ...port, id: `${owner}/${port.id}`, portId: port.id, owner, objectId: object.id, frameId: frame?.id || null, cell, face, neighbor: adjacent(cell, face), label: frame ? `Каркас ${frame.id.slice(7)} / ${EQUIPMENT[object.type].short.toLowerCase()} ${object.id.slice(5)}` : `${object.type === 'storage' ? 'Ящик' : 'Верстак'} ${object.id.slice(7)}` });
    }
  }
  for (const object of state.objects) if (object.type === 'frame') { for (const item of object.children || []) add(item, object); } else add(object);
  return result;
}
export function worldPipe(frame, pipe) {
  if (!frame) return { ...pipe, frameId: null };
  const cell = rotateCell(pipe, localSize(frame), frame);
  return { ...pipe, x: frame.x + cell.x, y: frame.y + cell.y, z: frame.z + cell.z, faces: pipe.faces.map(face => rotateFace(face, frame)), frameId: frame.id };
}
export function allPipes(state) {
  return [...(state.pipes || []).map(pipe => worldPipe(null, pipe)), ...state.objects.filter(object => object.type === 'frame').flatMap(frame => (frame.pipes || []).map(pipe => worldPipe(frame, pipe)))];
}
export function pipesInFrame(state, frame) {
  const bounds = localSize(frame);
  return allPipes(state).map(pipe => ({ ...pipe, ...localCell(frame, pipe), faces: pipe.faces.map(face => localFace(frame, face)) }))
    .filter(pipe => pipe.x >= 0 && pipe.y >= 0 && pipe.z >= 0 && pipe.x < bounds.width && pipe.y < bounds.depth && pipe.z < bounds.height);
}
export function portsInFrame(state, frame) {
  return worldPorts(state).map(port => ({ ...port, attached: state.graph?.ports.find(p=>p.id===port.id)?.attached, cell: localCell(frame, port.cell), neighbor: localCell(frame, port.neighbor), face: localFace(frame, port.face) }));
}
// Boundary entry points from nearby ports and unconnected pipe ends.
export function neighboringConnections(state, frame) {
  const bounds = localSize(frame), distance = c => ['x','y','z'].reduce((sum, axis, i) => sum + Math.max(0, -c[axis], c[axis] - Object.values(bounds)[i] + 1), 0);
  const ports = portsInFrame(state, frame).filter(p => p.frameId !== frame.id && distance(p.neighbor) <= 24);
  const ends = openPipeEnds(state).filter(p=>p.frameId!==frame.id).map(p=>({...p,cell:localCell(frame,p.cell),neighbor:localCell(frame,p.neighbor),face:localFace(frame,p.face)})).filter(p=>distance(p.neighbor)<=24 && !(p.cell.x>=0&&p.cell.y>=0&&p.cell.z>=0&&p.cell.x<bounds.width&&p.cell.y<bounds.depth&&p.cell.z<bounds.height));
  return [...ports, ...ends].sort((a,b) => distance(a.neighbor)-distance(b.neighbor));
}
export function openPipeEnds(state) {
  const occupied = new Map(allPipes(state).map(p => [cellKey(p), p]));
  return allPipes(state).flatMap(pipe => pipe.faces.filter(face => {
    const cell = adjacent(pipe, face), next = occupied.get(cellKey(cell));
    return !next?.faces.includes(OPPOSITE[face]) && !state.graph.ports.some(port => sameCell(port.cell, cell) && port.face === OPPOSITE[face]);
  }).map(face => ({ id: `${pipe.id}/${face}`, pipeId: pipe.id, frameId: pipe.frameId, kind: 'pipe', label: pipe.frameId ? `Каркас ${pipe.frameId.slice(7)} · конец трубы` : 'Внешняя труба', cell: {x:pipe.x,y:pipe.y,z:pipe.z}, face, neighbor: adjacent(pipe, face) })));
}
export function pipeScope(state, frameId) {
  return frameId ? state.objects.find(item => item.id === frameId && item.type === 'frame')?.pipes : state.pipes;
}
export function canonicalPipe(pipe) { return { id: pipe.id, x: pipe.x, y: pipe.y, z: pipe.z, faces: [...pipe.faces] }; }
export function pipeShapeError(pipe) {
  if (!pipe || ![pipe.x, pipe.y, pipe.z].every(Number.isInteger)) return 'Труба должна быть привязана к объёмной сетке';
  if (!Array.isArray(pipe.faces) || pipe.faces.length !== 2 || new Set(pipe.faces).size !== pipe.faces.length || pipe.faces.some(face => !Object.hasOwn(DIRECTIONS, face))) return 'Труба соединяет ровно две грани; ответвления запрещены';
  return '';
}
function inside(cell, object) {
  const size = dimensions(object);
  return cell.x >= object.x && cell.x < object.x + size.width && cell.y >= object.y && cell.y < object.y + size.depth && cell.z >= object.z && cell.z < object.z + size.height;
}
export function pipeHitsPlayer(pipe, player) {
  if (pipe.z >= PLAYER.height) return false;
  const x = Math.max(pipe.x, Math.min(player.x, pipe.x + 1)), y = Math.max(pipe.y, Math.min(player.y, pipe.y + 1));
  return (player.x - x) ** 2 + (player.y - y) ** 2 < PLAYER.radius ** 2 - 1e-9;
}
export function networkError(state, checkPlayer = true) {
  if (state.pipes !== undefined && !Array.isArray(state.pipes)) return 'Некорректный список труб';
  const next = state.nextPipeId ?? 1, ids = new Set(), occupied = new Set();
  if (!Number.isSafeInteger(next) || next < 1) return 'Некорректный счётчик труб';
  const solids = state.objects.flatMap(object => object.type === 'frame' ? (object.children || []).map(item => transformBox(object, item)) : [object]);
  const groups = [{ frame: null, pipes: state.pipes || [] }, ...state.objects.filter(o => o.type === 'frame').map(frame => ({ frame, pipes: frame.pipes === undefined ? [] : frame.pipes }))];
  let count = 0;
  for (const group of groups) {
    if (!Array.isArray(group.pipes) || (count += group.pipes.length) > 5760) return 'Некорректный список труб';
    const bounds = group.frame ? localSize(group.frame) : WAGON;
    for (const pipe of group.pipes) {
      const error = pipeShapeError(pipe); if (error) return error;
      if (typeof pipe.id !== 'string' || !/^pipe-[1-9]\d*$/.test(pipe.id) || ids.has(pipe.id) || Number(pipe.id.slice(5)) >= next) return 'Некорректный идентификатор трубы';
      if (pipe.x < 0 || pipe.y < 0 || pipe.z < 0 || pipe.x >= bounds.width || pipe.y >= bounds.depth || pipe.z >= bounds.height) return group.frame ? 'Труба выходит за границы каркаса' : 'Труба выходит за границы вагона';
      const world = worldPipe(group.frame, pipe), key = cellKey(world);
      if (occupied.has(key)) return 'Ячейка уже занята трубой';
      if (world.x < 0 || world.y < 0 || world.z < 0 || world.x >= WAGON.width || world.y >= WAGON.depth || world.z >= WAGON.height) return 'Труба выходит за границы вагона';
      if (solids.some(object => inside(world, object))) return 'Труба пересекается с оборудованием или сооружением';
      if (checkPlayer && pipeHitsPlayer(world, state.player)) return 'Здесь стоит персонаж — отойди в сторону';
      ids.add(pipe.id); occupied.add(key);
    }
  }
  return '';
}
export function buildGraph(state) {
  const pipes = allPipes(state), ports = worldPorts(state), nodes = [...pipes.map(pipe => ({ ...pipe, kind: 'pipe' })), ...ports.map(port => ({ ...port, kind: port.kind }))];
  const adjacency = new Map(nodes.map(node => [node.id, new Set()]));
  const cells = new Map(pipes.map(pipe => [cellKey(pipe), pipe]));
  for (const pipe of pipes) for (const face of pipe.faces) {
    const neighbor = cells.get(cellKey(adjacent(pipe, face)));
    if (neighbor?.faces.includes(OPPOSITE[face])) adjacency.get(pipe.id).add(neighbor.id);
  }
  for (const port of ports) {
    const pipe = cells.get(cellKey(port.neighbor));
    if (pipe?.faces.includes(OPPOSITE[port.face])) adjacency.get(port.kind === 'output' ? port.id : pipe.id).add(port.kind === 'output' ? pipe.id : port.id);
    if (port.kind === 'output') for (const input of ports.filter(p => p.kind === 'input')) {
      if (OPPOSITE[port.face] === input.face && sameCell(port.neighbor, input.cell)) adjacency.get(port.id).add(input.id);
    }
  }
  const nodeMap = new Map(nodes.map(node => [node.id, node])), links = [];
  for (const source of ports.filter(port => port.kind === 'output')) {
    const previous = new Map([[source.id, null]]), queue = [source.id];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const id = queue[cursor], node = nodeMap.get(id);
      if (node.kind === 'input') {
        const path = []; for (let current = id; current !== null; current = previous.get(current)) path.push(current); path.reverse();
        links.push({ id: `${source.id}>${id}`, source: source.id, target: id, from: source.owner, to: node.owner, fromLabel: source.label, toLabel: node.label, pipeIds: path.filter(key => nodeMap.get(key).kind === 'pipe'), path });
        continue;
      }
      for (const neighbor of adjacency.get(id)) if (!previous.has(neighbor)) { previous.set(neighbor, id); queue.push(neighbor); }
    }
  }
  return { pipes, ports: ports.map(port => ({ ...port, attached: adjacency.get(port.id).size > 0 || [...adjacency.values()].some(edges => edges.has(port.id)), links: links.filter(link => link.source === port.id || link.target === port.id).length })), links, edges: [...adjacency].flatMap(([a, neighbors]) => [...neighbors].map(b => [a, b])) };
}
export function rebuildGraph(state) { state.graph = buildGraph(state); return state.graph; }
export function routeCells(from, to) {
  if (!from) return [{ x: to.x, y: to.y, z: to.z }];
  const cells = [{ x: from.x, y: from.y, z: from.z }], current = { ...cells[0] };
  for (const axis of ['x', 'y', 'z']) while (current[axis] !== to[axis]) { current[axis] += Math.sign(to[axis] - current[axis]); cells.push({ ...current }); }
  return cells;
}
export function autoPortFaces(state, cell, frameId = null) {
  const frame = frameId ? state.objects.find(o => o.id === frameId) : null, world = worldPipe(frame, { ...cell, faces: [] });
  return worldPorts(state).filter(port => sameCell(port.neighbor, world)).map(port => {
    const face = OPPOSITE[port.face]; return localFace(frame, face);
  });
}
