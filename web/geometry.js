// Shared construction geometry. Coordinates and dimensions are integer voxels.
export const WAGON = Object.freeze({ width: 48, depth: 12, height: 10, voxel: 0.25 });
export const PLAYER = Object.freeze({ radius: 1, height: 8, speed: 7 });
export const TYPES = Object.freeze({
  frame: Object.freeze({ name: 'Стеллаж', short: 'Стеллаж', width: 6, depth: 4, height: 8, color: '#e8b76b', icon: '⊞', category: 'Стеллаж' }),
  storage: Object.freeze({ name: 'Ящик для деталей', short: 'Ящик', width: 3, depth: 3, height: 3, color: '#9caf8b', icon: '▧', category: 'Свободное сооружение' }),
  workbench: Object.freeze({ name: 'Верстак', short: 'Верстак', width: 4, depth: 3, height: 4, color: '#8db6bc', icon: '⊟', category: 'Свободное сооружение' })
});
export const EQUIPMENT = Object.freeze({
  storage: TYPES.storage, workbench: TYPES.workbench,
  machine: Object.freeze({ name: 'Тестовый модуль', short: 'Модуль', width: 2, depth: 2, height: 2, color: '#88c5ce' }),
  filter: Object.freeze({ name: 'Фильтр', short: 'Фильтр', width: 2, depth: 2, height: 3, color: '#e9ce75' }),
  centrifuge: Object.freeze({ name: 'Центрифуга', short: 'Центрифуга', width: 2, depth: 2, height: 3, color: '#ce9ab6' }),
  tank: Object.freeze({ name: 'Бак', short: 'Бак', width: 2, depth: 2, height: 4, color: '#b5cd8b' })
});
export function localSize(object) {
  if (object.type === 'pipe') return { width: 1, depth: 1, height: 1 };
  const type = TYPES[object.type] || EQUIPMENT[object.type];
  return Object.fromEntries(['width', 'depth', 'height'].map(key => [key, Object.hasOwn(object, key) ? object[key] : type[key]]));
}
export function dimensions(object) {
  const size = Object.values(localSize(object)), result = [];
  orientationOf(object).forEach((axis, i) => { result[Math.abs(axis) - 1] = size[i]; });
  return { width: result[0], depth: result[1], height: result[2] };
}
// Signed permutation: each local axis maps to one oriented parent axis.
export function orientationOf(object) {
  return object?.orientation || [[1,2,3], [2,-1,3], [-1,-2,3], [-2,1,3]][object?.rotation || 0];
}
export function validOrientation(value) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isInteger) || new Set(value.map(Math.abs)).size !== 3 || value.some(v => Math.abs(v) < 1 || Math.abs(v) > 3)) return false;
  const inversions = value.reduce((sum, a, i) => sum + value.slice(i + 1).filter(b => Math.abs(a) > Math.abs(b)).length, 0);
  return (-1) ** inversions * value.reduce((sign, a) => sign * Math.sign(a), 1) === 1;
}
export function inverseOrientation(object) {
  const result = []; orientationOf(object).forEach((axis, i) => { result[Math.abs(axis) - 1] = Math.sign(axis) * (i + 1); }); return result;
}
export function transformCell(cell, size, object) {
  const input = [cell.x, cell.y, cell.z], lengths = [size.width, size.depth, size.height], result = [];
  orientationOf(object).forEach((axis, i) => { result[Math.abs(axis) - 1] = axis > 0 ? input[i] : lengths[i] - 1 - input[i]; });
  return { x: result[0], y: result[1], z: result[2] };
}
export function rotateObject(object, axis = 'z') {
  const turns = { x: [1,3,-2], y: [-3,2,1], z: [2,-1,3] }[axis];
  const orientation = orientationOf(object).map(v => Math.sign(v) * turns[Math.abs(v) - 1]);
  const legacy = [[1,2,3], [2,-1,3], [-1,-2,3], [-2,1,3]].findIndex(o => o.every((v, i) => v === orientation[i]));
  const result = { ...object, rotation: legacy < 0 ? 0 : legacy };
  if (legacy < 0) result.orientation = orientation; else delete result.orientation;
  return result;
}
export function transformBox(frame, item) {
  const box = dimensions(item), corners = [];
  for (const x of [item.x, item.x + box.width - 1]) for (const y of [item.y, item.y + box.depth - 1]) for (const z of [item.z, item.z + box.height - 1]) corners.push(transformCell({ x, y, z }, localSize(frame), frame));
  const parent = orientationOf(frame), orientation = orientationOf(item).map(v => Math.sign(v) * parent[Math.abs(v) - 1]);
  return { ...item, x: frame.x + Math.min(...corners.map(c => c.x)), y: frame.y + Math.min(...corners.map(c => c.y)), z: frame.z + Math.min(...corners.map(c => c.z)), rotation: !frame.orientation && !item.orientation ? (frame.rotation + item.rotation) % 4 : 0, orientation };
}
export function intersects(a, b) {
  const ad = dimensions(a), bd = dimensions(b);
  return a.x < b.x + bd.width && a.x + ad.width > b.x && a.y < b.y + bd.depth && a.y + ad.depth > b.y && a.z < b.z + bd.height && a.z + ad.height > b.z;
}
