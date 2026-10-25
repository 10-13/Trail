// Geometry is expressed in integer 0.25 m voxels; the player moves continuously.
export const WAGON = Object.freeze({ width: 48, depth: 12, height: 10, voxel: 0.25 });
export const PLAYER = Object.freeze({ radius: 1, height: 8, speed: 7 });
export const TYPES = Object.freeze({
  frame: Object.freeze({ name: 'Напольный каркас', short: 'Каркас', width: 6, depth: 4, height: 8, color: '#e8b76b', icon: '⊞', category: 'Каркас · крепление к полу' }),
  storage: Object.freeze({ name: 'Ящик для деталей', short: 'Ящик', width: 3, depth: 3, height: 3, color: '#9caf8b', icon: '▧', category: 'Свободное сооружение' }),
  workbench: Object.freeze({ name: 'Верстак', short: 'Верстак', width: 4, depth: 3, height: 4, color: '#8db6bc', icon: '⊟', category: 'Свободное сооружение' })
});
export function dimensions(object) {
  const type = TYPES[object.type];
  return { width: object.rotation % 2 ? type.depth : type.width, depth: object.rotation % 2 ? type.width : type.depth, height: type.height };
}
export function intersects(a, b) {
  const ad = dimensions(a), bd = dimensions(b);
  return a.x < b.x + bd.width && a.x + ad.width > b.x && a.y < b.y + bd.depth && a.y + ad.depth > b.y && a.z < b.z + bd.height && a.z + ad.height > b.z;
}
export function hitsPlayer(object, player) {
  const size = dimensions(object);
  if (object.z >= PLAYER.height || object.z + size.height <= 0) return false;
  const closestX = Math.max(object.x, Math.min(player.x, object.x + size.width));
  const closestY = Math.max(object.y, Math.min(player.y, object.y + size.depth));
  return (player.x - closestX) ** 2 + (player.y - closestY) ** 2 < PLAYER.radius ** 2 - 1e-9;
}
export function placementError(state, object, ignoreId = null, checkPlayer = true) {
  if (!Object.hasOwn(TYPES, object.type)) return 'Неизвестный тип объекта';
  if (![object.x, object.y, object.z, object.rotation].every(Number.isInteger) || object.rotation < 0 || object.rotation > 3) return 'Объект должен быть привязан к сетке';
  const size = dimensions(object);
  if (object.z !== 0) return 'На этом этапе объекты крепятся к полу';
  if (object.x < 0 || object.y < 0 || object.x + size.width > WAGON.width || object.y + size.depth > WAGON.depth || object.z + size.height > WAGON.height) return 'За границами вагона';
  const other = state.objects.find(item => item.id !== ignoreId && intersects(object, item));
  if (other) return `Место занято: ${TYPES[other.type].short.toLowerCase()}`;
  if (checkPlayer && hitsPlayer(object, state.player)) return 'Здесь стоит персонаж — отойди в сторону';
  return '';
}
export function createState(demo = true) {
  return {
    version: 1,
    nextId: 5,
    player: { x: 3, y: 6, angle: 0 },
    objects: demo ? [
      { id: 'object-1', type: 'frame', x: 7, y: 1, z: 0, rotation: 0 },
      { id: 'object-2', type: 'frame', x: 19, y: 1, z: 0, rotation: 0 },
      { id: 'object-3', type: 'workbench', x: 31, y: 8, z: 0, rotation: 0 },
      { id: 'object-4', type: 'storage', x: 40, y: 1, z: 0, rotation: 0 }
    ] : []
  };
}
export function putObject(state, candidate, movingId = null) {
  if (movingId && !state.objects.some(item => item.id === movingId)) return 'Объект для перемещения не найден';
  const error = placementError(state, candidate, movingId);
  if (error) return error;
  if (movingId) state.objects = state.objects.map(item => item.id === movingId ? { ...candidate, id: movingId } : item);
  else state.objects.push({ ...candidate, id: `object-${state.nextId++}` });
  return '';
}
export function removeObject(state, id) {
  state.objects = state.objects.filter(item => item.id !== id);
}
export function canStand(state, player) {
  return Number.isFinite(player.x) && Number.isFinite(player.y) && player.x >= PLAYER.radius && player.x <= WAGON.width - PLAYER.radius && player.y >= PLAYER.radius && player.y <= WAGON.depth - PLAYER.radius && !state.objects.some(object => hitsPlayer(object, player));
}
export function movePlayer(state, dx, dy, seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  const length = Math.hypot(dx, dy);
  if (!length) return;
  const distance = PLAYER.speed * Math.min(seconds, 0.1);
  const steps = Math.ceil(distance / 0.2);
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
  return JSON.stringify({ version: 1, wagon: WAGON, nextId: state.nextId, player: state.player, objects: state.objects }, null, 2);
}
export function deserialize(text) {
  if (text.length > 1_000_000) throw new Error('Файл слишком большой');
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Файл не содержит корректный JSON'); }
  if (!data || data.version !== 1) throw new Error('Неподдерживаемая версия сохранения');
  if (!data.wagon || Object.keys(WAGON).some(key => data.wagon[key] !== WAGON[key])) throw new Error('Сохранение предназначено для другого вагона');
  if (!Array.isArray(data.objects) || data.objects.length > WAGON.width * WAGON.depth) throw new Error('Некорректный список объектов');
  if (!Number.isSafeInteger(data.nextId) || data.nextId < 1) throw new Error('Некорректный счётчик объектов');
  const result = createState(false), ids = new Set();
  for (const item of data.objects) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !/^object-[1-9]\d*$/.test(item.id) || ids.has(item.id) || Number(item.id.slice(7)) >= data.nextId) throw new Error('Некорректный идентификатор объекта');
    const object = { id: item.id, type: item.type, x: item.x, y: item.y, z: item.z, rotation: item.rotation };
    const error = placementError(result, object, null, false);
    if (error) throw new Error(`Повреждённая компоновка: ${error.toLowerCase()}`);
    ids.add(object.id);
    result.objects.push(object);
  }
  if (!data.player || !Number.isFinite(data.player.angle) || !canStand(result, data.player)) throw new Error('Некорректное положение персонажа');
  result.player = { x: data.player.x, y: data.player.y, angle: data.player.angle };
  result.nextId = data.nextId;
  return result;
}
