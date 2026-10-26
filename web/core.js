import { makeShelves, shelvesOf, shelvesError, shelfPlacementError } from './shelves.js';
import { ensureSimulation, canonicalSimulation, simulationError, deletionError, pipeTokens } from './simulation.js';
import { WAGON, PLAYER, TYPES, EQUIPMENT, localSize, dimensions, intersects, validOrientation, transformBox } from './geometry.js';
export { WAGON, PLAYER, TYPES, EQUIPMENT, localSize, dimensions, intersects } from './geometry.js';
import { portsError, canonicalPorts, networkError, rebuildGraph, canonicalPipe, pipeScope, pipeShapeError, allPipes, pipeHitsPlayer, cellKey, sameCell, routeCells, autoPortFaces, DIRECTIONS, OPPOSITE, worldPipe, rotateFace, localFace, adjacent, worldPorts, pipesInFrame } from './logistics.js';
export { rebuildGraph } from './logistics.js';
function boxError(object, definitions) {
  if (!object || !Object.hasOwn(definitions, object.type)) return 'Неизвестный тип объекта';
  if (![object.x, object.y, object.z, object.rotation].every(Number.isInteger) || object.rotation < 0 || object.rotation > 3) return 'Объект должен быть привязан к сетке';
  if (object.orientation !== undefined && !validOrientation(object.orientation)) return 'Некорректный поворот объекта';
  const size = localSize(object);
  if (!Object.values(size).every(value => Number.isInteger(value) && value > 0)) return 'Размеры должны быть положительными и кратными 0,25 м';
  if (object.type !== 'frame') { const error = portsError(object); if (error) return error; }
  return '';
}
export function hitsPlayer(object, player) {
  const size = dimensions(object);
  if (object.z >= PLAYER.height || object.z + size.height <= 0) return false;
  const closestX = Math.max(object.x, Math.min(player.x, object.x + size.width));
  const closestY = Math.max(object.y, Math.min(player.y, object.y + size.depth));
  return (player.x - closestX) ** 2 + (player.y - closestY) ** 2 < PLAYER.radius ** 2 - 1e-9;
}
export function equipmentError(frame, item, ignoreId = null) {
  const error = boxError(item, EQUIPMENT);
  if (error) return error;
  const size = dimensions(item), bounds = localSize(frame);
  if (item.x < 0 || item.y < 0 || item.z < 0 || item.x + size.width > bounds.width || item.y + size.depth > bounds.depth || item.z + size.height > bounds.height) return 'Оборудование выходит за границы каркаса';
  const shelfError=shelfPlacementError(frame,item);if(shelfError)return shelfError;
  if ((frame.children || []).some(other => other.id !== ignoreId && intersects(item, other))) return 'Оборудование пересекается с другим объектом';
  return '';
}
function contentsError(frame) {
  const children = frame.children === undefined ? [] : frame.children;
  const nextId = frame.nextItemId === undefined ? 1 : frame.nextItemId;
  if (!Array.isArray(children) || children.length > 5760 || !Number.isSafeInteger(nextId) || nextId < 1) return 'Некорректное содержимое каркаса';
  const ids = new Set(), checked = { ...frame, children: [] };
  for (const item of children) {
    if (!item || typeof item.id !== 'string' || !/^item-[1-9]\d*$/.test(item.id) || ids.has(item.id) || Number(item.id.slice(5)) >= nextId) return 'Некорректный идентификатор оборудования';
    const error = equipmentError(checked, item);
    if (error) return error;
    ids.add(item.id); checked.children.push(item);
  }
  return '';
}
export function placementError(state, object, ignoreId = null, checkPlayer = true) {
  const error = boxError(object, TYPES);
  if (error) return error;
  const size = dimensions(object), mount = object.mount === undefined ? 'floor' : object.mount;
  if (object.type === 'frame') {
    if (!['floor', 'ceiling'].includes(mount)) return 'Неизвестное крепление каркаса';
    if (mount === 'floor' && object.z !== 0) return 'Напольный каркас должен крепиться к полу';
    if (mount === 'ceiling' && object.z + size.height !== WAGON.height) return 'Потолочный каркас должен крепиться к потолку';
    const shelfError=shelvesError(object);if(shelfError)return shelfError;
    const contents = contentsError(object);
    if (contents) return contents;
  } else {
    if (object.z !== 0) return 'Свободное сооружение должно стоять на полу';
    if (Object.keys(size).some(key => size[key] !== dimensions({ type: object.type, rotation: object.rotation, orientation: object.orientation })[key])) return 'Размеры свободного сооружения заданы его типом';
  }
  if (object.x < 0 || object.y < 0 || object.z < 0 || object.x + size.width > WAGON.width || object.y + size.depth > WAGON.depth || object.z + size.height > WAGON.height) return 'За границами вагона';
  const other = state.objects.find(item => item.id !== ignoreId && intersects(object, item));
  if (other) return `Место занято: ${TYPES[other.type].short.toLowerCase()}`;
  if (checkPlayer && hitsPlayer(object, state.player)) return 'Здесь стоит персонаж — отойди в сторону';
  const future = { ...state, objects: [...state.objects.filter(item => item.id !== ignoreId), object] };
  const pipeError = networkError(future, checkPlayer);
  if (pipeError) return pipeError;
  return '';
}
function canonicalObject(object) {
  const result = { id: object.id, type: object.type, x: object.x, y: object.y, z: object.z, rotation: object.rotation };
  if(object.shelfId!==undefined)result.shelfId=object.shelfId;
  if (object.orientation) result.orientation = [...object.orientation];
  if (object.type === 'frame' || Object.hasOwn(EQUIPMENT, object.type)) Object.assign(result, localSize(object));
  if (object.type === 'frame') Object.assign(result, { shelves:shelvesOf(object).map(s=>({id:s.id,z:s.z,height:s.height})), mount: object.mount || 'floor', nextItemId: object.nextItemId ?? 1, children: (object.children || []).map(canonicalObject), pipes: (object.pipes || []).map(canonicalPipe) });
  else Object.assign(result, { ports: canonicalPorts(object), nextPortId: object.nextPortId ?? (['filter','centrifuge'].includes(object.type)?4:3) });
  return result;
}
export function createState(demo = true) {
  const state = { version: 5, nextId: 5, nextPipeId: 1, pipes: [], player: { x: 3, y: 6, angle: 0 }, objects: demo ? [
    { id: 'object-1', type: 'frame', x: 7, y: 1, z: 0, rotation: 0, shelves:makeShelves([4,4]) },
    { id: 'object-2', type: 'frame', x: 19, y: 1, z: 0, rotation: 0, shelves:makeShelves([4,4]) },
    { id: 'object-3', type: 'workbench', x: 31, y: 8, z: 0, rotation: 0 },
    { id: 'object-4', type: 'storage', x: 40, y: 1, z: 0, rotation: 0 }
  ].map(canonicalObject) : [] };
  rebuildGraph(state); ensureSimulation(state); return state;
}
export function putObject(state, candidate, movingId = null) {
  if (movingId && !state.objects.some(item => item.id === movingId)) return 'Объект для перемещения не найден';
  const error = placementError(state, candidate, movingId);
  if (error) return error;
  const object = canonicalObject({ ...candidate, id: movingId || `object-${state.nextId}` });
  if (movingId) state.objects = state.objects.map(item => item.id === movingId ? object : item);
  else { state.objects.push(object); state.nextId++; }
  rebuildGraph(state);
  return '';
}
export function updateFrame(state, id, settings) {
  const frame = state.objects.find(item => item.id === id && item.type === 'frame');
  if (!frame) return 'Каркас не найден';
  const object = { ...frame, ...settings };
  if(settings.height!==undefined&&settings.shelves===undefined){object.shelves=shelvesOf(frame).map(s=>({...s}));object.shelves.at(-1).height+=settings.height-localSize(frame).height;}
  object.z = object.mount === 'ceiling' ? WAGON.height - dimensions(object).height : 0;
  return putObject(state, object, id);
}
export function setFrameShelves(state,id,heights,settings={}) {
  const frame=state.objects.find(o=>o.id===id&&o.type==='frame');if(!frame)return 'Стеллаж не найден';
  if(!Array.isArray(heights)||!heights.length||heights.length>10||heights.some(h=>!Number.isInteger(h)||h<1))return 'Высота каждой полки должна быть кратна 0,25 м';
  const shelves=makeShelves(heights),children=[];
  for(const item of frame.children){
    if(item.shelfId){const shelf=shelves.find(s=>s.id===item.shelfId);if(!shelf)return 'Сначала перенеси блоки с удаляемой полки';children.push({...item,z:shelf.z});}
    else children.push({...item});
  }
  return updateFrame(state,id,{...settings,height:heights.reduce((a,b)=>a+b,0),shelves,children});
}
export function connectShelfLevels(state,frameId,shelfId,x,y,direction,preview=false) {
  const frame=state.objects.find(o=>o.id===frameId&&o.type==='frame');if(!frame)return 'Стеллаж не найден';
  if(![-1,1].includes(direction))return 'Выбери соседнюю полку';
  const shelves=shelvesOf(frame),index=shelves.findIndex(s=>s.id===shelfId),from=shelves[index],to=shelves[index+direction];
  if(!from||!to)return 'В этом направлении нет полки';
  return paintPipeRoute(state,frameId,{x,y,z:from.z},{x,y,z:to.z},preview);
}
export function pipeColumnIds(state,id,frameId=null) {
  const frame=frameId?state.objects.find(o=>o.id===frameId):null;
  const all=frame?pipesInFrame(state,frame):allPipes(state),start=all.find(p=>p.id===id);if(!start)return [];
  const cells=new Map(all.map(p=>[cellKey(p),p])),ids=new Set([id]),queue=[start];
  for(let i=0;i<queue.length;i++)for(const face of ['nz','pz'])if(queue[i].faces.includes(face)){
    const next=cells.get(cellKey(adjacent(queue[i],face)));if(next?.faces.includes(OPPOSITE[face])&&!ids.has(next.id)){ids.add(next.id);queue.push(next);}
  }
  return [...ids];
}
export function removePipeColumn(state,id,frameId=null) {
  const ids=new Set(pipeColumnIds(state,id,frameId));
  if([...ids].some(id=>pipeTokens(state,id).length))return 'Сначала забери ресурсы из перехода между полками';
  state.pipes=state.pipes.filter(p=>!ids.has(p.id));for(const frame of state.objects.filter(o=>o.type==='frame'))frame.pipes=frame.pipes.filter(p=>!ids.has(p.id));
  rebuildGraph(state);return '';
}
export function putEquipment(state, frameId, candidate, movingId = null) {
  const frame = state.objects.find(item => item.id === frameId && item.type === 'frame');
  if (!frame) return 'Каркас не найден';
  if (movingId && !frame.children.some(item => item.id === movingId)) return 'Оборудование не найдено';
  const error = equipmentPlacementError(state, frameId, candidate, movingId);
  if (error) return error;
  const item = canonicalObject({ ...candidate, id: movingId || `item-${frame.nextItemId}` });
  if (movingId) frame.children = frame.children.map(other => other.id === movingId ? item : other);
  else { frame.children.push(item); frame.nextItemId++; }
  rebuildGraph(state);
  return '';
}
export function removeEquipment(state, frameId, id) {
  const error=deletionError(state,`${frameId}/${id}`);if(error)return error;
  const frame = state.objects.find(item => item.id === frameId && item.type === 'frame');
  if (frame) { frame.children = frame.children.filter(item => item.id !== id); rebuildGraph(state); }
  return "";
}
export function equipmentPlacementError(state, frameId, candidate, ignoreId = null) {
  const frame = state.objects.find(item => item.id === frameId && item.type === 'frame');
  if (!frame) return 'Каркас не найден';
  const error = equipmentError(frame, candidate, ignoreId);
  if (error) return error;
  const changed = { ...frame, children: [...frame.children.filter(item => item.id !== ignoreId), candidate] };
  return networkError({ ...state, objects: state.objects.map(object => object.id === frameId ? changed : object) });
}
export function updatePorts(state, frameId, objectId, ports, nextPortId) {
  const parent = frameId ? state.objects.find(item => item.id === frameId) : null;
  const object = (frameId ? parent?.children : state.objects)?.find(item => item.id === objectId);
  if (!object || object.type === 'frame') return 'Объект с портами не найден';
  const candidate = { ...object, ports, nextPortId };
  return frameId ? putEquipment(state, frameId, candidate, objectId) : putObject(state, candidate, objectId);
}
export function pipePlacementError(state, candidate, frameId = null) {
  const error = pipeShapeError(candidate); if (error) return error;
  const future = structuredClone(state), pipes = pipeScope(future, frameId);
  if (!pipes) return 'Каркас не найден';
  if (pipes.some(pipe => sameCell(pipe, candidate))) return 'Ячейка уже занята трубой';
  pipes.push({ ...candidate, id: `pipe-${future.nextPipeId++}` });
  return networkError(future);
}
export function putPipe(state, candidate, frameId = null) {
  const error = pipePlacementError(state, candidate, frameId); if (error) return error;
  pipeScope(state, frameId).push(canonicalPipe({ ...candidate, id: `pipe-${state.nextPipeId++}` }));
  rebuildGraph(state); return '';
}
export function paintPipeRoute(state, frameId, from, to, preview = false) {
  if (![to?.x, to?.y, to?.z, ...(from ? [from.x, from.y, from.z] : [])].every(Number.isInteger)) return 'Маршрут должен быть привязан к сетке';
  return paintPipeCells(state, frameId, routeCells(from, to), preview, to.faces);
}
function paintPipeCells(state, frameId, cells, preview = false, heading = ['nx','px']) {
  const future = structuredClone(state), pipes = pipeScope(future, frameId); if (!pipes) return 'Каркас не найден';
  const parent = frameId ? future.objects.find(item => item.id === frameId) : null, limit = parent ? localSize(parent) : WAGON;
  if (cells.some(c => c.x < 0 || c.y < 0 || c.z < 0 || c.x >= limit.width || c.y >= limit.depth || c.z >= limit.height)) return 'Маршрут выходит за границы';
  const worldMap = new Map(allPipes(future).map(pipe => [cellKey(pipe), pipe])), ports = worldPorts(future), refs = new Map();
  const solids = future.objects.flatMap(o => o.type==='frame' ? o.children.map(item=>transformBox(o,item)) : [o]);
  if(cells.some(cell=>solids.some(o=>{const w=worldPipe(parent,{...cell,faces:[]}),d=dimensions(o);return w.x>=o.x&&w.y>=o.y&&w.z>=o.z&&w.x<o.x+d.width&&w.y<o.y+d.depth&&w.z<o.z+d.height;})))return 'Труба пересекается с оборудованием или сооружением';
  const readFaces = ref => ref.raw.faces.map(face => localFace(parent, rotateFace(face, ref.owner)));
  const writeFaces = (ref, faces) => { ref.raw.faces = faces.map(face => localFace(ref.owner, rotateFace(face, parent))); };
  for (const cell of cells) {
    const world = worldPipe(parent, { ...cell, faces: [] }), existing = worldMap.get(cellKey(world));
    if (existing) {
      const owner = existing.frameId ? future.objects.find(item => item.id === existing.frameId) : null;
      refs.set(cellKey(cell), { raw: (owner ? owner.pipes : future.pipes).find(pipe => pipe.id === existing.id), owner, existing });
    } else {
      const pipe = { ...cell, id: `pipe-${future.nextPipeId++}`, faces: [] }; pipes.push(pipe); refs.set(cellKey(cell), { raw: pipe, owner: parent });
    }
  }
  const direction = (a,b) => Object.keys(DIRECTIONS).find(face => sameCell(adjacent(a,face), b));
  for (let index = 0; index < cells.length; index++) {
    const cell = cells[index], ref = refs.get(cellKey(cell)), existing = ref.existing;
    // Preserve physically attached faces; a dangling terminal face may turn as the stroke continues.
    const attached = existing ? existing.faces.filter(face => {
      const neighbor = adjacent(existing, face), pipe = worldMap.get(cellKey(neighbor));
      return pipe?.faces.includes(OPPOSITE[face]) || ports.some(port => sameCell(port.cell, neighbor) && port.face === OPPOSITE[face]);
    }).map(face => localFace(parent, face)) : [];
    const faces = new Set([...attached, ...autoPortFaces(future, cell, frameId)]);
    if (index > 0) faces.add(direction(cell, cells[index-1]));
    if (index+1 < cells.length) faces.add(direction(cell, cells[index+1]));
    if (faces.size > 2) return 'Ответвление запрещено: труба соединяет только два направления';
    let result = [...faces];
    if (!result.length) result = existing ? readFaces(ref) : heading?.length === 2 ? [...heading] : ['nx','px'];
    if (result.length === 1) result.push(OPPOSITE[result[0]]);
    if (autoPortFaces(future,cell,frameId).length && result[0] !== OPPOSITE[result[1]]) return 'У порта труба должна заканчиваться прямым участком';
    writeFaces(ref, result);
  }
  const error = networkError(future); if (error) return error;
  if (!preview) {
    state.pipes = future.pipes;
    for (const frame of state.objects.filter(item => item.type === 'frame')) frame.pipes = future.objects.find(item => item.id === frame.id).pipes;
    state.nextPipeId = future.nextPipeId; rebuildGraph(state);
  }
  return '';
}
// Join two visible connection points, including the gap outside both frames.
// Endpoints have an outward face; the first and last cells stay straight.
export function connectEndpoints(state, first, second, preview = false) {
  if (!first || !second || first.id === second.id) return 'Выбери два разных подключения';
  if (first.kind !== 'pipe' && second.kind !== 'pipe' && first.kind === second.kind) return 'Соедини выход со входом';
  const start = first.neighbor, end = second.neighbor;
  const lead = adjacent(start, first.face), tail = adjacent(end, second.face);
  const solids = state.objects.flatMap(o => o.type === 'frame' ? o.children.map(item => transformBox(o,item)) : [o]);
  const occupied = new Set(allPipes(state).map(cellKey));
  const free = c => c.x >= 0 && c.y >= 0 && c.z >= 0 && c.x < WAGON.width && c.y < WAGON.depth && c.z < WAGON.height && !solids.some(o => {
    const d=dimensions(o); return c.x>=o.x && c.y>=o.y && c.z>=o.z && c.x<o.x+d.width && c.y<o.y+d.depth && c.z<o.z+d.height;
  }) && !pipeHitsPlayer(c,state.player) && (!occupied.has(cellKey(c)) || sameCell(c,start) || sameCell(c,end));
  if (!free(start) || !free(end)) return 'Подключение занято оборудованием, трубой или персонажем';
  let cells;
  if (sameCell(start,end)) {
    if (first.face !== OPPOSITE[second.face]) return 'Недостаточно места для прямого подключения';
    cells = [start];
  } else if (sameCell(adjacent(start,first.face),end) && first.face === OPPOSITE[second.face]) cells = [start,end];
  else {
    if (!free(lead) || !free(tail) || sameCell(lead,end) || sameCell(tail,start)) return 'Для прямых концов нужно свободное место перед подключениями';
    const queue=[lead], previous=new Map([[cellKey(lead),null]]);
    for(let cursor=0;cursor<queue.length && !previous.has(cellKey(tail));cursor++) for(const face of Object.keys(DIRECTIONS)) {
      const next=adjacent(queue[cursor],face),key=cellKey(next);
      if(previous.has(key)||sameCell(next,start)||sameCell(next,end)||!free(next)) continue;
      previous.set(key,queue[cursor]);queue.push(next);
    }
    if(!previous.has(cellKey(tail))) return 'Нет свободного пути между подключениями';
    cells=[];for(let c=tail;c;c=previous.get(cellKey(c)))cells.push(c);cells.reverse();cells=[start,...cells,end];
  }
  const error=paintPipeCells(state,null,cells,preview,[OPPOSITE[first.face],first.face]);
  return error;
}
export function removePipe(state, id) {
  if(pipeTokens(state,id).length)return 'Сначала забери содержимое трубы: ресурсы не должны теряться';
  state.pipes = state.pipes.filter(pipe => pipe.id !== id);
  for (const frame of state.objects.filter(item => item.type === 'frame')) frame.pipes = frame.pipes.filter(pipe => pipe.id !== id);
  rebuildGraph(state); return "";
}
export function findPipe(state, id) {
  const outside = state.pipes.find(pipe => pipe.id === id);
  if (outside) return { pipe: outside, frameId: null };
  for (const frame of state.objects.filter(item => item.type === 'frame')) {
    const pipe = frame.pipes.find(pipe => pipe.id === id);
    if (pipe) return { pipe, frameId: frame.id };
  }
  return null;
}
export function updatePipeFaces(state, id, faces) {
  const found = findPipe(state, id); if (!found) return 'Труба не найдена';
  const error = pipeShapeError({ ...found.pipe, faces }); if (error) return error;
  found.pipe.faces = [...faces]; rebuildGraph(state); return '';
}
// Convert a local child box to wagon coordinates, including the parent's rotation.
export function worldEquipment(frame, item) { return transformBox(frame, item); }
export function removeObject(state, id) { const object=state.objects.find(o=>o.id===id),error=deletionError(state,id,(object?.pipes||[]).map(p=>p.id));if(error)return error;state.objects = state.objects.filter(item => item.id !== id); rebuildGraph(state);return ""; }
export function canStand(state, player) {
  return Number.isFinite(player.x) && Number.isFinite(player.y) && player.x >= PLAYER.radius && player.x <= WAGON.width - PLAYER.radius && player.y >= PLAYER.radius && player.y <= WAGON.depth - PLAYER.radius && !state.objects.some(object => hitsPlayer(object, player)) && !allPipes(state).some(pipe => pipeHitsPlayer(pipe, player));
}
export function movePlayer(state, dx, dy, seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  const length = Math.hypot(dx, dy);
  if (!length) return;
  const distance = PLAYER.speed * Math.min(seconds, 0.1), steps = Math.ceil(distance / 0.2);
  const stepX = dx / length * distance / steps, stepY = dy / length * distance / steps;
  state.player.angle = Math.atan2(dy, dx);
  for (let step = 0; step < steps; step++) {
    const horizontal = { ...state.player, x: state.player.x + stepX };
    if (canStand(state, horizontal)) state.player.x = horizontal.x;
    const vertical = { ...state.player, y: state.player.y + stepY };
    if (canStand(state, vertical)) state.player.y = vertical.y;
  }
}
export function serialize(state) {
  return JSON.stringify({ version: 5, wagon: WAGON, nextId: state.nextId, nextPipeId: state.nextPipeId, simulation: canonicalSimulation(state), pipes: state.pipes.map(canonicalPipe), player: state.player, objects: state.objects.map(canonicalObject) }, null, 2);
}
export function deserialize(text) {
  if (text.length > 1_000_000) throw new Error('Файл слишком большой');
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Файл не содержит корректный JSON'); }
  if (!data || ![1, 2, 3, 4, 5].includes(data.version)) throw new Error('Неподдерживаемая версия сохранения');
  if (!data.wagon || Object.keys(WAGON).some(key => data.wagon[key] !== WAGON[key])) throw new Error('Сохранение предназначено для другого вагона');
  if (!Array.isArray(data.objects) || data.objects.length > 5760) throw new Error('Некорректный список объектов');
  if (!Number.isSafeInteger(data.nextId) || data.nextId < 1) throw new Error('Некорректный счётчик объектов');
  let migratedPipes = 0;
  function migratePipes(pipes) {
    if (!Array.isArray(pipes)) return;
    for (const pipe of pipes) if (pipe && Array.isArray(pipe.faces) && pipe.faces.length !== 2 && pipe.faces.length <= 6 && new Set(pipe.faces).size === pipe.faces.length && pipe.faces.every(f => Object.hasOwn(DIRECTIONS,f))) {
      const first = pipe.faces.find(f => pipe.faces.includes(OPPOSITE[f])) || pipe.faces[0] || 'nx';
      pipe.faces = [first, pipe.faces.includes(OPPOSITE[first]) || pipe.faces.length < 2 ? OPPOSITE[first] : pipe.faces.find(f => f !== first)]; migratedPipes++;
    }
  }
  if(data.version<4)migratePipes(data.pipes); for (const object of data.objects) if (data.version<4&&object?.type === 'frame') migratePipes(object.pipes);
  const result = createState(false), ids = new Set();
  if (migratedPipes) result.migrationNotice = `Старые трубы обновлены: ${migratedPipes}. Ответвления убраны — проверь соединения.`;
  result.nextPipeId = data.nextPipeId ?? 1;
  if (data.pipes !== undefined && !Array.isArray(data.pipes)) throw new Error('Некорректный список труб');
  for (const item of data.objects) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !/^object-[1-9]\d*$/.test(item.id) || ids.has(item.id) || Number(item.id.slice(7)) >= data.nextId) throw new Error('Некорректный идентификатор объекта');
    const error = placementError(result, item, null, false);
    if (error) throw new Error(`Повреждённая компоновка: ${error.toLowerCase()}`);
    ids.add(item.id); result.objects.push(canonicalObject(item));
  }
  result.pipes = data.pipes ?? [];
  const pipeError = networkError(result, false); if (pipeError) throw new Error(pipeError);
  result.pipes = result.pipes.map(canonicalPipe);
  if (!data.player || !Number.isFinite(data.player.angle) || !canStand(result, data.player)) throw new Error('Некорректное положение персонажа');
  result.player = { x: data.player.x, y: data.player.y, angle: data.player.angle };
  result.nextId = data.nextId;
  rebuildGraph(result);
  if(data.version>=4){const error=simulationError(result,data.simulation);if(error)throw new Error(error);result.simulation=structuredClone(data.simulation);}
  ensureSimulation(result);return result;
}
