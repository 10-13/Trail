// Shared construction geometry. Coordinates and dimensions are integer voxels.
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
  if (object.type === 'pipe') return { width: 1, depth: 1, height: 1 };
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
