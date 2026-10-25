import { WAGON, PLAYER, TYPES, dimensions, createState, placementError, putObject, removeObject, movePlayer, serialize, deserialize } from './core.js';

const $ = id => document.getElementById(id);
const canvas = $('game'), ctx = canvas.getContext('2d');
const STORAGE_KEY = 'trail.stage1.layout.v1';
let state = createState(), mode = 'walk', selectedId = null, ghost = null, movingId = null;
let showGrid = true, pointer = null, dirty = false, toastTimer, previousTime = 0;
let view = { width: 1, height: 1, scale: 1, vertical: false };
const keys = new Set();
const meters = voxels => (voxels * WAGON.voxel).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
const objectSize = object => { const size = dimensions(object); return `${meters(size.width)} × ${meters(size.depth)} × ${meters(size.height)} м`; };
const selected = () => state.objects.find(object => object.id === selectedId);

function toast(message, error = false) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').classList.toggle('error', error);
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4000);
}
function markDirty() {
  if (!dirty) { dirty = true; $('save-state').textContent = 'Есть изменения'; }
}
function updateUI() {
  $('walk-mode').classList.toggle('active', mode === 'walk');
  $('build-mode').classList.toggle('active', mode === 'build');
  $('walk-mode').setAttribute('aria-pressed', mode === 'walk');
  $('build-mode').setAttribute('aria-pressed', mode === 'build');
  $('mode-label').textContent = mode === 'walk' ? 'ХОДЬБА' : movingId ? 'ПЕРЕМЕЩЕНИЕ' : 'СТРОИТЕЛЬСТВО';
  document.querySelectorAll('.catalog-card').forEach(button => {
    const active = ghost?.type === button.dataset.type && !movingId;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active);
  });
  const object = ghost || selected();
  $('object-actions').hidden = !selected() || !!ghost;
  $('build-actions').hidden = !ghost;
  $('selection-icon').textContent = object ? TYPES[object.type].icon : '↟';
  $('selection-icon').style.color = object ? TYPES[object.type].color : '#93d7cf';
  $('selection-label').textContent = ghost ? movingId ? 'ПЕРЕМЕЩЕНИЕ · ЛКМ ДЛЯ УСТАНОВКИ' : 'СТРОИТЕЛЬСТВО · ЛКМ ДЛЯ УСТАНОВКИ' : object ? TYPES[object.type].category.toUpperCase() : 'ПЕРСОНАЖ';
  $('selection-title').textContent = object ? TYPES[object.type].name : 'Осмотрись внутри';
  $('selection-detail').textContent = object ? `${objectSize(object)} · ${ghost ? 'выбери свободное место на сетке' : `X ${meters(object.x)} м · Y ${meters(object.y)} м · поворот ${object.rotation * 90}°`}` : 'Передвигайся по вагону и выбирай место для строительства.';
  $('object-count').textContent = String(state.objects.length).padStart(2, '0');
  const area = state.objects.reduce((sum, object) => { const d = dimensions(object); return sum + d.width * d.depth; }, 0);
  $('occupancy').innerHTML = `${Math.round(area / (WAGON.width * WAGON.depth) * 100)}<small>%</small>`;
  $('control-hints').innerHTML = ghost
    ? '<span><kbd>ЛКМ</kbd> установить</span><span><kbd>R</kbd> поворот</span><span><kbd>Esc</kbd> отменить</span><span><kbd>W A S D</kbd> движение</span>'
    : '<span><kbd>W A S D</kbd> / <kbd>↑ ↓ ← →</kbd> движение</span><span><kbd>2</kbd> строительство</span><span><kbd>ЛКМ</kbd> выбрать объект</span>';
  updatePlacement();
}
function updatePlacement() {
  $('placement').hidden = !ghost;
  if (!ghost) return;
  const error = placementError(state, ghost, movingId);
  $('placement').classList.toggle('invalid', !!error);
  $('placement').textContent = error ? `× ${error}` : '✓ Можно установить · ЛКМ';
}
function setMode(next) {
  mode = next;
  ghost = null; movingId = null;
  updateUI();
}
function cancel() {
  if (ghost) { ghost = null; movingId = null; }
  else selectedId = null;
  updateUI();
}
function snapGhost() {
  if (!ghost || !pointer) return;
  const size = dimensions(ghost);
  ghost.x = Math.floor(pointer.x - size.width / 2);
  ghost.y = Math.floor(pointer.y - size.depth / 2);
  updatePlacement();
}
function chooseType(type) {
  mode = 'build'; movingId = null; selectedId = null;
  ghost = { type, x: 26, y: 5, z: 0, rotation: 0 };
  snapGhost();
  updateUI();
}
function startMove() {
  const object = selected();
  if (!object) return;
  mode = 'build'; movingId = object.id; ghost = { ...object };
  // The original remains solid until the player confirms the new position.
  updateUI();
}
function rotate() {
  if (ghost) { ghost.rotation = (ghost.rotation + 1) % 4; snapGhost(); updateUI(); return; }
  const object = selected();
  if (!object) return;
  const error = putObject(state, { ...object, rotation: (object.rotation + 1) % 4 }, object.id);
  if (error) toast(error, true);
  else { markDirty(); updateUI(); }
}
function deleteSelected() {
  if (!selectedId) return;
  removeObject(state, selectedId);
  selectedId = null; ghost = null; movingId = null;
  markDirty(); updateUI(); toast('Объект удалён');
}
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, serialize(state));
    dirty = false; $('save-state').textContent = 'Сохранено в браузере';
    toast('Компоновка и положение персонажа сохранены');
  } catch { toast('Браузер не разрешает сохранение. Используй экспорт JSON.', true); }
}
function restore(text, message) {
  const restored = deserialize(text); // Validate everything before replacing current state.
  state = restored; selectedId = null; ghost = null; movingId = null; keys.clear();
  dirty = false; $('save-state').textContent = message;
  updateUI();
}
function load() {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    if (!text) { toast('Сохранения ещё нет — сначала нажми «Сохранить»', true); return; }
    restore(text, 'Загружено из браузера'); toast('Компоновка восстановлена');
  } catch (error) { toast(`Не удалось загрузить: ${error.message}`, true); }
}
for (const [index, [type, definition]] of Object.entries(Object.entries(TYPES))) {
  const button = document.createElement('button');
  button.className = 'catalog-card'; button.dataset.type = type;
  button.style.setProperty('--object-color', definition.color);
  button.setAttribute('aria-pressed', 'false');
  button.innerHTML = `<span class="catalog-art">${definition.icon}</span><span class="catalog-copy"><strong>${definition.short}</strong><small>${type === 'frame' ? 'Крепление к полу' : 'Свободное сооружение'}</small><em>${objectSize({ type, rotation: 0 })}</em></span><span class="catalog-key">${Number(index) + 3}</span>`;
  button.addEventListener('click', () => chooseType(type));
  $('catalog').append(button);
}
$('walk-mode').onclick = () => setMode('walk');
$('build-mode').onclick = () => setMode('build');
$('move-object').onclick = startMove;
$('rotate-object').onclick = rotate;
$('rotate-ghost').onclick = rotate;
$('delete-object').onclick = deleteSelected;
$('cancel-build').onclick = cancel;
$('save').onclick = save;
$('load').onclick = load;
$('grid-toggle').onclick = () => {
  showGrid = !showGrid;
  $('grid-toggle').setAttribute('aria-pressed', showGrid);
  $('grid-toggle').innerHTML = `${showGrid ? 'Сетка' : 'Без сетки'} <span>0,25 м</span>`;
};
$('export').onclick = () => {
  const url = URL.createObjectURL(new Blob([serialize(state)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'trail-wagon-001.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Компоновка экспортирована в JSON');
};
$('import').onclick = () => $('import-file').click();
$('import-file').onchange = async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 1_000_000) throw new Error('Файл слишком большой');
    restore(await file.text(), 'Импортировано · не сохранено');
    markDirty(); toast('Компоновка импортирована. Нажми «Сохранить», чтобы запомнить её.');
  } catch (error) { toast(`Импорт отклонён: ${error.message}`, true); }
  event.target.value = '';
};

function resize() {
  const rect = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
  view = { width: rect.width, height: rect.height, vertical: rect.width < 570,
    scale: rect.width < 570 ? Math.min((rect.height - 100) / WAGON.width, (rect.width - 80) / WAGON.depth) : Math.min((rect.width - 110) / WAGON.width, (rect.height - 120) / WAGON.depth), dpr };
  document.querySelector('.scale span').style.width = `${view.scale * 4}px`;
}
function screenToWorld(event) {
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left - view.width / 2) / view.scale;
  const y = (event.clientY - rect.top - view.height / 2) / view.scale;
  return view.vertical ? { x: y + WAGON.width / 2, y: -x + WAGON.depth / 2 } : { x: x + WAGON.width / 2, y: y + WAGON.depth / 2 };
}
function objectAt(point) {
  return [...state.objects].reverse().find(object => { const size = dimensions(object); return point.x >= object.x && point.y >= object.y && point.x < object.x + size.width && point.y < object.y + size.depth; });
}
canvas.addEventListener('pointermove', event => {
  pointer = screenToWorld(event); snapGhost();
  canvas.style.cursor = ghost ? 'crosshair' : objectAt(pointer) ? 'pointer' : 'default';
});
canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  event.preventDefault(); canvas.focus({ preventScroll: true });
  pointer = screenToWorld(event); snapGhost();
  if (ghost) {
    const wasMoving = !!movingId;
    const error = putObject(state, ghost, movingId);
    if (error) { toast(error, true); return; }
    selectedId = wasMoving ? movingId : state.objects.at(-1).id;
    if (wasMoving) { ghost = null; movingId = null; }
    markDirty(); updateUI();
    toast(wasMoving ? 'Объект перемещён' : 'Объект установлен · Esc завершить строительство');
  } else {
    selectedId = objectAt(pointer)?.id || null;
    updateUI();
  }
});
canvas.addEventListener('contextmenu', event => { event.preventDefault(); cancel(); });
const movement = { KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0] };
window.addEventListener('keydown', event => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target.isContentEditable) return;
  if ((event.ctrlKey || event.metaKey) && event.code === 'KeyS') { event.preventDefault(); save(); return; }
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (movement[event.code]) { event.preventDefault(); keys.add(event.code); return; }
  if (event.repeat) return;
  const actions = { Digit1: () => setMode('walk'), Digit2: () => setMode('build'), Digit3: () => chooseType('frame'), Digit4: () => chooseType('storage'), Digit5: () => chooseType('workbench'), KeyR: rotate, KeyM: startMove, Escape: cancel, Delete: deleteSelected };
  if (actions[event.code]) { event.preventDefault(); actions[event.code](); }
});
window.addEventListener('keyup', event => keys.delete(event.code));
window.addEventListener('blur', () => keys.clear());
document.addEventListener('visibilitychange', () => { keys.clear(); previousTime = 0; });
for (const button of document.querySelectorAll('[data-direction]')) {
  const key = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' }[button.dataset.direction];
  button.addEventListener('pointerdown', event => { event.preventDefault(); button.setPointerCapture(event.pointerId); keys.add(key); });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(name, () => keys.delete(key));
}

function rect(x, y, width, height, fill, stroke = null, line = 0.05) {
  if (fill) { ctx.fillStyle = fill; ctx.fillRect(x, y, width, height); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = line; ctx.strokeRect(x, y, width, height); }
}
function textWorld(text, x, y, color = '#aebba1', size = 0.5) {
  ctx.save(); ctx.translate(x, y); if (view.vertical) ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = color; ctx.font = `${size}px monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 0, 0); ctx.restore();
}
function drawObject(object, isGhost = false) {
  const d = dimensions(object), type = TYPES[object.type];
  const error = isGhost && placementError(state, object, movingId);
  const color = isGhost ? error ? '#ef8d78' : '#b6dd9a' : type.color;
  ctx.save(); ctx.translate(object.x, object.y);
  if (!isGhost) rect(0.14, 0.18, d.width, d.depth, '#00000048');
  rect(0.06, 0.06, d.width - 0.12, d.depth - 0.12, isGhost ? error ? '#c6645535' : '#99cb7738' : object.type === 'frame' ? '#403c2b' : object.type === 'storage' ? '#46523f' : '#35494a', color, isGhost ? 0.09 : 0.06);
  if (object.type === 'frame') {
    const corner = 0.35;
    for (const [x, y] of [[0, 0], [d.width - corner, 0], [0, d.depth - corner], [d.width - corner, d.depth - corner]]) rect(x, y, corner, corner, color);
    rect(0.4, 0.4, d.width - 0.8, d.depth - 0.8, null, `${color}66`, 0.035);
    textWorld('КАРКАС', d.width / 2, d.depth / 2, color, Math.max(0.35, Math.min(d.width / 8, 0.55)));
  } else if (object.type === 'storage') {
    rect(0.35, 0.35, d.width - 0.7, d.depth - 0.7, null, `${color}88`);
    rect(d.width / 2 - 0.12, 0.2, 0.24, d.depth - 0.4, `${color}88`);
  } else {
    rect(0.35, 0.4, d.width - 0.7, 0.5, `${color}55`);
    textWorld('ВЕРСТАК', d.width / 2, d.depth / 2 + 0.2, color, 0.4);
  }
  if (object.rotation) textWorld('↗', d.width - 0.5, d.depth - 0.5, color, 0.5);
  if (object.id === selectedId && !isGhost) {
    ctx.setLineDash([0.24, 0.16]); rect(-0.16, -0.16, d.width + 0.32, d.depth + 0.32, null, '#eee5c0', 0.065); ctx.setLineDash([]);
  }
  ctx.restore();
}
function render() {
  const { width, height, scale, dpr, vertical } = view;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
  ctx.save(); ctx.translate(width / 2, height / 2); if (vertical) ctx.rotate(Math.PI / 2); ctx.scale(scale, scale); ctx.translate(-WAGON.width / 2, -WAGON.depth / 2);
  // The wagon, rails and objects deliberately use only simple geometric shapes.
  for (let x = -5; x < WAGON.width + 6; x += 2) rect(x, -2.4, 0.45, WAGON.depth + 4.8, '#1d271f');
  for (const y of [-1.7, WAGON.depth + 1.4]) rect(-6, y, WAGON.width + 12, 0.14, '#364131');
  rect(-0.8, -0.9, WAGON.width + 1.6, WAGON.depth + 1.8, '#080d0988');
  for (const x of [-1.6, WAGON.width + 0.4]) { rect(x, 4.7, 1.2, 2.6, '#30392e', '#66705a', 0.07); rect(x - 0.25, 5.35, 1.7, 1.3, '#46503d'); }
  rect(-0.5, -0.5, WAGON.width + 1, WAGON.depth + 1, '#3d4834', '#778063', 0.1);
  rect(0, 0, WAGON.width, WAGON.depth, '#283127', '#8b9473', 0.07);
  if (showGrid) {
    for (let x = 1; x < WAGON.width; x++) { ctx.beginPath(); ctx.strokeStyle = x % 4 ? '#70806321' : '#9eac8040'; ctx.lineWidth = 0.035; ctx.moveTo(x, 0); ctx.lineTo(x, WAGON.depth); ctx.stroke(); }
    for (let y = 1; y < WAGON.depth; y++) { ctx.beginPath(); ctx.strokeStyle = y % 4 ? '#70806321' : '#9eac8040'; ctx.lineWidth = 0.035; ctx.moveTo(0, y); ctx.lineTo(WAGON.width, y); ctx.stroke(); }
  }
  for (let x = 2; x < WAGON.width; x += 8) {
    rect(x, -0.45, 1.6, 0.16, '#d5b36a'); rect(x, WAGON.depth + 0.29, 1.6, 0.16, '#d5b36a');
  }
  for (let x = 0; x <= WAGON.width; x += 4) textWorld(String(x / 4).padStart(2, '0'), x, -1, '#79866a', 0.42);
  for (const object of state.objects) {
    if (movingId === object.id) ctx.globalAlpha = 0.35;
    drawObject(object); ctx.globalAlpha = 1;
  }
  const player = state.player;
  ctx.save(); ctx.translate(player.x, player.y);
  ctx.fillStyle = '#0005'; ctx.beginPath(); ctx.ellipse(0.12, 0.2, PLAYER.radius, PLAYER.radius, 0, 0, Math.PI * 2); ctx.fill();
  ctx.rotate(player.angle);
  ctx.fillStyle = '#93d7cf'; ctx.strokeStyle = '#dae9cb'; ctx.lineWidth = 0.06;
  ctx.beginPath(); ctx.arc(0, 0, PLAYER.radius * 0.8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  rect(0.3, -0.42, 0.5, 0.84, '#33554e');
  ctx.fillStyle = '#d4f0d6'; ctx.beginPath(); ctx.arc(0.28, 0, 0.35, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  if (ghost) drawObject(ghost, true);
  ctx.restore();
}
let accumulator = 0;
function frame(time) {
  if (previousTime) accumulator += Math.min((time - previousTime) / 1000, 0.1);
  previousTime = time;
  let dx = 0, dy = 0;
  for (const key of keys) { const vector = movement[key]; if (vector) { dx += vector[0]; dy += vector[1]; } }
  // Screen directions follow the wagon's portrait orientation on small screens.
  if (view.vertical) [dx, dy] = [dy, -dx];
  const beforeX = state.player.x, beforeY = state.player.y;
  while (accumulator >= 1 / 60) { movePlayer(state, dx, dy, 1 / 60); accumulator -= 1 / 60; }
  if (beforeX !== state.player.x || beforeY !== state.player.y) { markDirty(); updatePlacement(); }
  render(); requestAnimationFrame(frame);
}
new ResizeObserver(resize).observe(canvas);
try { const saved = localStorage.getItem(STORAGE_KEY); if (saved) restore(saved, 'Загружено из браузера'); }
catch { toast('Сохранение недоступно или повреждено. Открыт тестовый вагон.', true); }
resize(); updateUI(); requestAnimationFrame(frame);
