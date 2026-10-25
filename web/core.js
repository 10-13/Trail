// Construction uses integer 0.25 m voxels; the player moves continuously.
export const WAGON = Object.freeze({ width: 48, depth: 12, height: 10, voxel: 0.25 });
export const PLAYER = Object.freeze({ radius: 1, height: 8, speed: 7 });
export const TYPES = Object.freeze({
  frame: Object.freeze({ name: 'Каркас', short: 'Каркас', width: 6, depth: 4, height: 8, color: '#e8b76b', icon: '⊞', category: 'Каркас' }),
  storage: Object.freeze({ name: 'Ящик для деталей', short: 'Ящик', width: 3, depth: 3, height: 3, color: '#9caf8b', icon: '▧', category: 'Свободное сооружение' }),
  workbench: Object.freeze({ name: 'Верстак', short: 'Верстак', width: 4, depth: 3, height: 4, color: '#8db6bc', icon: '⊟', category: 'Свободное сооружение' })
});
export const EQUIPMENT = Object.freeze({
  machine: Object.freeze({ name: 'Тестовый модуль', short: 'Модуль', width: 2, depth: 2, height: 2, color: '#88c5ce' }),
  tank: Object.freeze({ name: 'Тестовая ёмкость', short: 'Ёмкость', width: 2, depth: 2, height: 4, color: '#b5cd8b' })
});
export function localSize(object) {
  const type = TYPES[object.type] || EQUIPMENT[object.type];
  return Object.fromEntries(['width', 'depth', 'height'].map(key => [key, Object.hasOwn(object, key) ? object[key] : type[key]]));
}
export function dimensions(object) {
  const size = localSize(object);
  return object.rotation % 2 ? { width: size.depth, depth: size.width, height: size.height } : size;
}
export function intersects(a, b) {
  const ad = dimensions(a), bd = dimensions(b);
  return a.x < b.x + bd.width && a.x + ad.width > b.x && a.y < b.y + bd.depth && a.y + ad.depth > b.y && a.z < b.z + bd.height && a.z + ad.height > b.z;
}
function boxError(object, definitions) {
  if (!object || !Object.hasOwn(definitions, object.type)) return 'Неизвестный тип объекта';
  if (![object.x, object.y, object.z, object.rotation].every(Number.isInteger) || object.rotation < 0 || object.rotation > 3) return 'Объект должен быть привязан к сетке';
  const size = localSize(object);
  if (!Object.values(size).every(value => Number.isInteger(value) && value > 0)) return 'Размеры должны быть положительными и кратными 0,25 м';
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
    const contents = contentsError(object);
    if (contents) return contents;
  } else {
    if (object.z !== 0) return 'Свободное сооружение должно стоять на полу';
    if (Object.keys(size).some(key => size[key] !== dimensions({ type: object.type, rotation: object.rotation })[key])) return 'Размеры свободного сооружения заданы его типом';
  }
  if (object.x < 0 || object.y < 0 || object.z < 0 || object.x + size.width > WAGON.width || object.y + size.depth > WAGON.depth || object.z + size.height > WAGON.height) return 'За границами вагона';
  const other = state.objects.find(item => item.id !== ignoreId && intersects(object, item));
  if (other) return `Место занято: ${TYPES[other.type].short.toLowerCase()}`;
  if (checkPlayer && hitsPlayer(object, state.player)) return 'Здесь стоит персонаж — отойди в сторону';
  return '';
}
function canonicalObject(object) {
  const result = { id: object.id, type: object.type, x: object.x, y: object.y, z: object.z, rotation: object.rotation };
  if (object.type === 'frame' || Object.hasOwn(EQUIPMENT, object.type)) Object.assign(result, localSize(object));
  if (object.type === 'frame') Object.assign(result, { mount: object.mount || 'floor', nextItemId: object.nextItemId ?? 1, children: (object.children || []).map(canonicalObject) });
  return result;
}
export function createState(demo = true) {
  return { version: 2, nextId: 5, player: { x: 3, y: 6, angle: 0 }, objects: demo ? [
    { id: 'object-1', type: 'frame', x: 7, y: 1, z: 0, rotation: 0 },
    { id: 'object-2', type: 'frame', x: 19, y: 1, z: 0, rotation: 0 },
    { id: 'object-3', type: 'workbench', x: 31, y: 8, z: 0, rotation: 0 },
    { id: 'object-4', type: 'storage', x: 40, y: 1, z: 0, rotation: 0 }
  ].map(canonicalObject) : [] };
}
export function putObject(state, candidate, movingId = null) {
  if (movingId && !state.objects.some(item => item.id === movingId)) return 'Объект для перемещения не найден';
  const error = placementError(state, candidate, movingId);
  if (error) return error;
  const object = canonicalObject({ ...candidate, id: movingId || `object-${state.nextId}` });
  if (movingId) state.objects = state.objects.map(item => item.id === movingId ? object : item);
  else { state.objects.push(object); state.nextId++; }
  return '';
}
export function updateFrame(state, id, settings) {
  const frame = state.objects.find(item => item.id === id && item.type === 'frame');
  if (!frame) return 'Каркас не найден';
  const object = { ...frame, ...settings };
  object.z = object.mount === 'ceiling' ? WAGON.height - object.height : 0;
  return putObject(state, object, id);
}
export function putEquipment(state, frameId, candidate, movingId = null) {
  const frame = state.objects.find(item => item.id === frameId && item.type === 'frame');
  if (!frame) return 'Каркас не найден';
  if (movingId && !frame.children.some(item => item.id === movingId)) return 'Оборудование не найдено';
  const error = equipmentError(frame, candidate, movingId);
  if (error) return error;
  const item = canonicalObject({ ...candidate, id: movingId || `item-${frame.nextItemId}` });
  if (movingId) frame.children = frame.children.map(other => other.id === movingId ? item : other);
  else { frame.children.push(item); frame.nextItemId++; }
  return '';
}
export function removeEquipment(state, frameId, id) {
  const frame = state.objects.find(item => item.id === frameId && item.type === 'frame');
  if (frame) frame.children = frame.children.filter(item => item.id !== id);
}
// Convert a local child box to wagon coordinates, including the parent's rotation.
export function worldEquipment(frame, item) {
  const size = localSize(frame), box = dimensions(item);
  const positions = [
    [item.x, item.y], [size.depth - item.y - box.depth, item.x],
    [size.width - item.x - box.width, size.depth - item.y - box.depth], [item.y, size.width - item.x - box.width]
  ];
  const [x, y] = positions[frame.rotation];
  return { ...item, x: frame.x + x, y: frame.y + y, z: frame.z + item.z, rotation: (frame.rotation + item.rotation) % 4 };
}
export function removeObject(state, id) { state.objects = state.objects.filter(item => item.id !== id); }
export function canStand(state, player) {
  return Number.isFinite(player.x) && Number.isFinite(player.y) && player.x >= PLAYER.radius && player.x <= WAGON.width - PLAYER.radius && player.y >= PLAYER.radius && player.y <= WAGON.depth - PLAYER.radius && !state.objects.some(object => hitsPlayer(object, player));
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
  return JSON.stringify({ version: 2, wagon: WAGON, nextId: state.nextId, player: state.player, objects: state.objects.map(canonicalObject) }, null, 2);
}
export function deserialize(text) {
  if (text.length > 1_000_000) throw new Error('Файл слишком большой');
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Файл не содержит корректный JSON'); }
  if (!data || ![1, 2].includes(data.version)) throw new Error('Неподдерживаемая версия сохранения');
  if (!data.wagon || Object.keys(WAGON).some(key => data.wagon[key] !== WAGON[key])) throw new Error('Сохранение предназначено для другого вагона');
  if (!Array.isArray(data.objects) || data.objects.length > 5760) throw new Error('Некорректный список объектов');
  if (!Number.isSafeInteger(data.nextId) || data.nextId < 1) throw new Error('Некорректный счётчик объектов');
  const result = createState(false), ids = new Set();
  for (const item of data.objects) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !/^object-[1-9]\d*$/.test(item.id) || ids.has(item.id) || Number(item.id.slice(7)) >= data.nextId) throw new Error('Некорректный идентификатор объекта');
    const error = placementError(result, item, null, false);
    if (error) throw new Error(`Повреждённая компоновка: ${error.toLowerCase()}`);
    ids.add(item.id); result.objects.push(canonicalObject(item));
  }
  if (!data.player || !Number.isFinite(data.player.angle) || !canStand(result, data.player)) throw new Error('Некорректное положение персонажа');
  result.player = { x: data.player.x, y: data.player.y, angle: data.player.angle };
  result.nextId = data.nextId;
  return result;
}
