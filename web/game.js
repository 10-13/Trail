import { makeShelves, shelvesOf } from './shelves.js';
import { createSimulationRunner } from './simulation-runner.js';
import { ensureSimulation, simulationTick, pipeTokens } from './simulation.js';
import { createSimulationControls, createProductionInspector, drawProductionGlyph } from './production-ui.js';
import { createProductionDemo, createFactoryDemo } from './production-demo.js';
import { WAGON, PLAYER, TYPES, EQUIPMENT, dimensions, worldEquipment, createState, placementError, putObject, removeObject, movePlayer, serialize, deserialize, removePipe, findPipe, updatePipeFaces } from './core.js';
import { rotateObject } from './geometry.js';
import { createFrameEditor } from './frame-editor.js';
import { numberField, readVoxels } from './ui.js';
import { allPipes, rotateFace, localFace } from './logistics.js';
import { createRotationControl, createPipeInspector, createNetworkPanel, drawProjectedPipe, drawProjectedPort } from './network-ui.js';

const $ = id => document.getElementById(id);
const canvas = $('game'), ctx = canvas.getContext('2d');
const STORAGE_KEY = 'trail.stage1.layout.v1';
let state = createState(), selectedId = null, ghost = null, movingId = null;
let erase = false, stroke = null, hoverId = null;
let selectedPipeId = null, highlightedPipes = new Set();
let buildMenuOpen = false, lastSimulationUI=0, demoBackup=null;
try{demoBackup=sessionStorage.getItem('trail.production.backup');}catch{}
let visibleLayer = 'all';
let showGrid = true, pointer = null, dirty = false, toastTimer, previousTime = 0;
let view = { width: 1, height: 1, scale: 1, vertical: false };
const keys = new Set();
const meters = voxels => (voxels * WAGON.voxel).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
const objectSize = object => { const size = dimensions(object); return `${meters(size.width)} × ${meters(size.depth)} × ${meters(size.height)} м`; };
const selected = () => state.objects.find(object => object.id === selectedId);
const frameFields = {};
for (const [key, label, value, max] of [['width', 'Длина, м', 1.5, 12], ['depth', 'Ширина, м', 1, 3], ['height', 'Высота, м', 2, 2.5]]) {
  const field = numberField(label, `new-frame-${key}`, value, 0.25, max);
  $('frame-config').append(field.row); frameFields[key] = field.input;
}
function newFrameClearance() {
  const height = frameFields.height.valueAsNumber;
  $('new-frame-clearance').textContent = $('frame-mount').value === 'ceiling'
    ? `Низ: ${(2.5 - height).toLocaleString('ru-RU')} м · ${height <= 0.5 ? 'проход свободен' : 'перекрывает проход'}`
    : 'Напольный стеллаж перекрывает проход.';
}
frameFields.height.oninput = newFrameClearance;
$('frame-mount').onchange = () => { if ($('frame-mount').value === 'ceiling') frameFields.height.value = '0.5'; newFrameClearance(); };
newFrameClearance();
const simulationRunner=createSimulationRunner({getState:()=>state,step:simulationTick});
const frameEditor = createFrameEditor({ getSimulationMetrics:()=>simulationRunner.metrics,onSimulationStep:stepSimulation,onSimulationChange:simulationChanged,onDemo:toggleDemo,demoActive:()=>!!demoBackup,getState: () => state, onChange: () => { markDirty(); updateUI(); }, onClose: () => { keys.clear(); resize(); updateUI(); canvas.focus({ preventScroll: true }); } });
const simulationControls=createSimulationControls($('world-simulation'),{getMetrics:()=>simulationRunner.metrics,getState:()=>state,changed:simulationChanged,step:stepSimulation,demo:toggleDemo,demoActive:()=>!!demoBackup});
const productionInspector=createProductionInspector($('world-production'),{getState:()=>state,getSelection:()=>!ghost&&!erase?(selectedPipeId?{pipeId:selectedPipeId}:selected()?{owner:selectedId,type:selected().type}:null):null,changed:()=>{markDirty();updateUI();},message:toast});
function refreshSimulation(){simulationControls.refresh();productionInspector.refresh();frameEditor.tick();}
function simulationChanged(){simulationRunner.reset();markDirty();refreshSimulation();}
function stepSimulation(){simulationRunner.reset();simulationTick(state);markDirty();refreshSimulation();}
function toggleDemo(kind='simple'){
  if(frameEditor.isOpen)frameEditor.close();
  if(demoBackup&&kind!=='factory'){const backup=demoBackup;demoBackup=null;try{sessionStorage.removeItem('trail.production.backup');}catch{}restore(backup,'Твоя схема восстановлена');toast('Твоя схема восстановлена');}
  else{if(!demoBackup){demoBackup=serialize(state);try{sessionStorage.setItem('trail.production.backup',demoBackup);}catch{}}state=kind==='factory'?createFactoryDemo():createProductionDemo();selectedId=null;selectedPipeId=null;ghost=null;erase=false;buildMenuOpen=false;simulationRunner.reset();updateUI();frameEditor.open(state.objects[kind==='factory'?1:0].id);toast(kind==='factory'?'Две линии · три стеллажа. Снизу фильтры, сверху центрифуги. Нажми «Пуск».':'128 нефти → фильтр → центрифуга → бак. Нажми «Пуск». «Вернуть схему» возвращает твою компоновку.');}
  markDirty();refreshSimulation();
}
const rotationAxis = createRotationControl($('world-rotation'), rotate);
const networkPanel = createNetworkPanel($('world-network'), { getState: () => state, onHighlight: ids => { highlightedPipes = ids; } });
const pipeInspector = createPipeInspector($('world-pipe-inspector'), {
  getPipe: () => { const found = selectedPipeId && !ghost && !erase ? findPipe(state, selectedPipeId) : null; const parent = found?.frameId ? state.objects.find(item => item.id === found.frameId) : null; return found ? { ...found.pipe, faces: found.pipe.faces.map(face => rotateFace(face, parent)), worldZ: allPipes(state).find(pipe => pipe.id === selectedPipeId)?.z } : null; },
  apply: faces => { const found = findPipe(state, selectedPipeId); const parent = found?.frameId ? state.objects.find(item => item.id === found.frameId) : null; return updatePipeFaces(state, selectedPipeId, faces.map(face => localFace(parent, face))); }, changed: () => { markDirty(); updateUI(); }, message: toast
});
function editFrame() {
  if (selected()?.type !== 'frame' || ghost) return;
  keys.clear(); buildMenuOpen = false; updateUI(); frameEditor.open(selectedId);
}

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
  $('build-menu').hidden = !buildMenuOpen;
  document.querySelector('.hud').classList.toggle('menu-open', buildMenuOpen);
  $('build-menu-button').setAttribute('aria-expanded', buildMenuOpen);
  $('erase-tool').classList.toggle('active', erase);
  $('erase-tool').setAttribute('aria-pressed', erase);
  $('tool-label').textContent = erase ? 'УДАЛЕНИЕ' : movingId ? 'ПЕРЕНОС' : ghost ? 'КИСТЬ' : '';
  document.querySelectorAll('.catalog-card').forEach(button => {
    const active = ghost?.type === button.dataset.type && !movingId;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active);
  });
  const object = ghost || selected();
  const definition=object?TYPES[object.type]:null;
  $('inspector').hidden = (!object && !selectedPipeId) || erase;
  $('object-actions').hidden = !selected() || !!ghost;
  $('edit-frame').hidden = selected()?.type !== 'frame' || !!ghost;
  $('build-actions').hidden = !ghost;
  $('selection-icon').textContent = definition?.icon || (selectedPipeId ? '━' : '↟');
  $('selection-icon').style.color = definition?.color || '#93d7cf';
  $('selection-label').textContent = ghost ? movingId ? 'ПЕРЕМЕЩЕНИЕ · ЛКМ ДЛЯ УСТАНОВКИ' : 'СТРОИТЕЛЬСТВО · ЛКМ ДЛЯ УСТАНОВКИ' : object ? object.type === 'frame' ? object.mount === 'ceiling' ? 'ПОТОЛОЧНЫЙ СТЕЛЛАЖ' : 'НАПОЛЬНЫЙ СТЕЛЛАЖ' : definition.category.toUpperCase() : '';
  $('selection-title').textContent = definition?.name || (selectedPipeId ? 'Труба' : 'Осмотрись внутри');
  $('selection-detail').textContent = object ? `${objectSize(object)} · ${ghost ? 'выбери свободное место на сетке' : `вдоль ${meters(object.x)} м · поперёк ${meters(object.y)} м`}` : 'Передвигайся по вагону и выбирай место для строительства.';
  if (object?.type === 'frame') $('selection-detail').textContent += ` · низ ${meters(object.z)} м${object.mount === 'ceiling' ? object.z >= PLAYER.height ? ' · проход свободен' : ' · проход перекрыт' : ''} · полок: ${shelvesOf(object).length} · блоков: ${object.children?.length || 0}`;
  const rack=(object?.type==='frame');
  for(const option of document.querySelectorAll('#world-rotation option'))option.disabled=rack&&option.value!=='z';
  if(rack)document.querySelector('#world-rotation select').value='z';
  $('object-count').textContent = String(state.objects.length).padStart(2, '0');
  const occupied = new Set();
  for (const object of state.objects) { const d = dimensions(object); for (let x = object.x; x < object.x + d.width; x++) for (let y = object.y; y < object.y + d.depth; y++) occupied.add(`${x},${y}`); }
  const area = occupied.size;
  $('occupancy').innerHTML = `${Math.round(area / (WAGON.width * WAGON.depth) * 100)}<small>%</small>`;
  $('control-hints').innerHTML = `<span><kbd>W A S D</kbd> движение</span><span><kbd>Tab</kbd> блоки</span><span><kbd>⌫</kbd> удаление</span><span><kbd>Esc</kbd> ${ghost || erase ? 'убрать кисть' : 'снять выбор'}</span>`;
  simulationControls.refresh(); productionInspector.refresh(); pipeInspector.refresh(); networkPanel.refresh();
  updatePlacement();
}
function updatePlacement() {
  $('placement').hidden = !ghost && !erase;
  if (erase) { $('placement').classList.add('invalid'); $('placement').textContent = 'Удаление · нажми на объект · Esc отменить'; return; }
  if (!ghost) return;
  const error=placementError(state,ghost,movingId);
  $('placement').classList.toggle('invalid', !!error);
  $('placement').textContent = error ? `× ${error}` : '✓ Можно установить · ЛКМ';
}
function cancel() {
  if (buildMenuOpen) { closeBuildMenu(); return; }
  if (ghost || erase) { ghost = null; movingId = null; erase = false; hoverId = null; }
  else { selectedId = null; selectedPipeId = null; }
  updateUI();
}
function closeBuildMenu() {
  buildMenuOpen = false;
  updateUI();
  canvas.focus({ preventScroll: true });
}
function toggleBuildMenu() {
  if (buildMenuOpen) closeBuildMenu();
  else { buildMenuOpen = true; stroke = null; updateUI(); $('close-build-menu').focus({ preventScroll: true }); }
}
function toggleErase() {
  erase = !erase; ghost = null; movingId = null; selectedId = null; selectedPipeId = null; buildMenuOpen = false; stroke = null;
  updateUI(); canvas.focus({ preventScroll: true });
}
function snapGhost() {
  if (!ghost || !pointer) return;
  const size = dimensions(ghost);
  ghost.x = Math.floor(pointer.x - size.width / 2);
  ghost.y = Math.floor(pointer.y - size.depth / 2);
  updatePlacement();
}
function chooseType(type) {
  let settings = {};
  if (type === 'frame') {
    try { for (const [key, input] of Object.entries(frameFields)) settings[key] = readVoxels(input); }
    catch (error) { toast(error.message, true); return; }
    settings.mount = $('frame-mount').value;
    settings.children = []; settings.nextItemId = 1;settings.shelves=makeShelves(settings.height>=8?[4,settings.height-4]:[settings.height]);
  }
  erase = false; movingId = null; selectedId = null; selectedPipeId = null;
  buildMenuOpen = false;
  ghost = { type, x: 26, y: 5, z: settings.mount === 'ceiling' ? WAGON.height - settings.height : 0, rotation: 0, ...settings };
  snapGhost();
  updateUI();
  canvas.focus({ preventScroll: true });
}
function startMove() {
  const object = selected();
  if (!object) return;
  erase = false; movingId = object.id; ghost = { ...object };
  buildMenuOpen = false;
  // The original remains solid until the player confirms the new position.
  updateUI();
}
function rotate() {
  const axis=(ghost||selected())?.type==='frame'?'z':rotationAxis();
  if (ghost) { ghost = rotateObject(ghost,axis); if(ghost.type==='frame') ghost.z=ghost.mount==='ceiling'?WAGON.height-dimensions(ghost).height:0; snapGhost(); updateUI(); return; }
  if(selectedPipeId){
    const found=findPipe(state,selectedPipeId),parent=found?.frameId?state.objects.find(o=>o.id===found.frameId):null;
    const faces=found.pipe.faces.map(face=>localFace(parent,rotateFace(rotateFace(face,parent),rotateObject({rotation:0},axis))));
    const error=updatePipeFaces(state,selectedPipeId,faces);if(error)toast(error,true);else{markDirty();updateUI();}return;
  }
  const object = selected(); if (!object) return;
  const candidate=rotateObject(object,axis);if(candidate.type==='frame')candidate.z=candidate.mount==='ceiling'?WAGON.height-dimensions(candidate).height:0;
  const error=putObject(state,candidate,object.id);
  if(error)toast(error,true);else{markDirty();updateUI();}
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
  state = restored; simulationRunner.reset(); selectedId = null; ghost = null; movingId = null; keys.clear();
  erase = false; stroke = null; hoverId = null; selectedPipeId = null;
  dirty = false; $('save-state').textContent = message;
  updateUI();
}
function load() {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    if (!text) { toast('Сохранения ещё нет — сначала нажми «Сохранить»', true); return; }
    restore(text, 'Загружено из браузера'); toast(state.migrationNotice || 'Компоновка восстановлена');
  } catch (error) { toast(`Не удалось загрузить: ${error.message}`, true); }
}
for (const [type, definition] of Object.entries(TYPES).filter(([type])=>type==='frame')) {
  const button = document.createElement('button');
  button.className = 'catalog-card'; button.dataset.type = type;
  button.style.setProperty('--object-color', definition.color);
  button.setAttribute('aria-pressed', 'false');
  button.innerHTML = `<span class="catalog-art">${definition.icon}</span><span class="catalog-copy"><strong>${definition.short}</strong><small>${type === 'frame' ? 'Размеры и крепление — выше' : 'Свободное сооружение'}</small>${type === 'frame' ? '' : `<em>${objectSize({ type, rotation: 0 })}</em>`}</span>`;
  button.addEventListener('click', () => chooseType(type));
  $('catalog').append(button);
}
$('build-menu-button').onclick = toggleBuildMenu;
$('erase-tool').onclick = toggleErase;
$('close-build-menu').onclick = closeBuildMenu;
$('edit-frame').onclick = editFrame;
$('layer-toggle').onclick = () => {
  visibleLayer = { all: 'floor', floor: 'ceiling', ceiling: 'all' }[visibleLayer];
  $('layer-toggle').textContent = `Слой: ${{ all: 'все', floor: 'пол', ceiling: 'потолок' }[visibleLayer]}`;
};
$('move-object').onclick = startMove;
$('rotate-object').onclick = rotate;
$('rotate-ghost').onclick = rotate;
$('delete-object').onclick = toggleErase;
$('cancel-build').onclick = cancel;
$('save').onclick = save;
$('save-editor').onclick = save;
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
    markDirty(); toast(state.migrationNotice || 'Компоновка импортирована. Нажми «Сохранить», чтобы запомнить её.');
  } catch (error) { toast(`Импорт отклонён: ${error.message}`, true); }
  event.target.value = '';
};

function resize() {
  const rect = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
  if(!rect.width||!rect.height)return;
  canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
  view = { width: rect.width, height: rect.height, vertical: rect.width < 570,
    scale: rect.width < 570 ? Math.max(1, Math.min((rect.height - 400) / WAGON.width, (rect.width - 80) / WAGON.depth)) : Math.min((rect.width - 110) / WAGON.width, (rect.height - 120) / WAGON.depth), dpr };
  document.querySelector('.scale span').style.width = `${view.scale * 4}px`;
}
function screenToWorld(event) {
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left - view.width / 2) / view.scale;
  const y = (event.clientY - rect.top - view.height / 2) / view.scale;
  return view.vertical ? { x: y + WAGON.width / 2, y: -x + WAGON.depth / 2 } : { x: x + WAGON.width / 2, y: y + WAGON.depth / 2 };
}
function inLayer(object) { return visibleLayer === 'all' || (object.mount || 'floor') === visibleLayer; }
function objectAt(point, cycle = false) {
  const hits = [...state.objects].filter(object => { const size = dimensions(object); return inLayer(object) && point.x >= object.x && point.y >= object.y && point.x < object.x + size.width && point.y < object.y + size.depth; }).sort((a, b) => b.z - a.z);
  const current = hits.findIndex(object => object.id === selectedId);
  return hits[cycle && current >= 0 ? (current + 1) % hits.length : 0];
}
function pipeAt(point) { return state.graph.pipes.find(pipe=>pipe.x===Math.floor(point.x)&&pipe.y===Math.floor(point.y)); }
canvas.addEventListener('pointermove', event => {
  pointer = screenToWorld(event); snapGhost();
  hoverId = objectAt(pointer)?.id || null;
  canvas.style.cursor = ghost || erase ? 'crosshair' : hoverId ? 'pointer' : 'default';
  if (stroke && (event.buttons & 1)) applyBrush(false);
});
function applyBrush(report = true) {
  const key = ghost ? `${ghost.x},${ghost.y},${ghost.z}` : `${Math.floor(pointer.x)},${Math.floor(pointer.y)}`;
  if (stroke?.has(key)) return;
  stroke?.add(key);
  if(erase){
    const object=objectAt(pointer);
    if(object){const error=removeObject(state,object.id);if(error){toast(error,true);return;}if(selectedId===object.id)selectedId=null;selectedPipeId=null;markDirty();updateUI();toast('Стеллаж разобран, содержимое возвращено в запас');return;}
    const pipe=pipeAt(pointer);if(pipe){const error=removePipe(state,pipe.id);if(error){toast(error,true);return;}selectedPipeId=null;markDirty();updateUI();}return;
  }
  if (!ghost) return;
  const wasMoving = !!movingId;
  const error = putObject(state, ghost, movingId);
  if (error) { if (report) toast(error, true); return; }
  selectedId = wasMoving ? movingId : state.objects.at(-1).id;
  if (wasMoving) { ghost = null; movingId = null; stroke = null; }
  markDirty(); updateUI();
}
canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  event.preventDefault(); canvas.focus({ preventScroll: true });
  pointer = screenToWorld(event); snapGhost();
  if (ghost || erase) {
    stroke = new Set(); canvas.setPointerCapture(event.pointerId); applyBrush();
  } else {
    selectedId=objectAt(pointer,true)?.id||null;selectedPipeId=selectedId?null:pipeAt(pointer)?.id||null;
    updateUI();
  }
});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(name, () => { stroke = null; });
canvas.addEventListener('contextmenu', event => { event.preventDefault(); cancel(); });
const movement = { KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0] };
window.addEventListener('keydown', event => {
  if (frameEditor.isOpen) { if ((event.ctrlKey || event.metaKey) && event.code === 'KeyS') { event.preventDefault(); save(); } return; }
  if (event.code === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.metaKey) { event.preventDefault(); if (!event.repeat) toggleBuildMenu(); return; }
  if ((event.ctrlKey || event.metaKey) && event.code === 'KeyS') { event.preventDefault(); save(); return; }
  if (event.code === 'Escape') { event.preventDefault(); if (!event.repeat) cancel(); return; }
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || event.target.isContentEditable) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (movement[event.code]) { event.preventDefault(); keys.add(event.code); return; }
  if (event.repeat) return;
  const actions = { KeyE: editFrame, KeyR: rotate, KeyM: startMove, Escape: cancel, Backspace: toggleErase, Delete: toggleErase };
  if (actions[event.code]) { event.preventDefault(); actions[event.code](); }
});
window.addEventListener('keyup', event => keys.delete(event.code));
window.addEventListener('blur', () => keys.clear());
document.addEventListener('visibilitychange', () => { keys.clear(); previousTime = 0; simulationRunner.reset(); });
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
  if (object.mount === 'ceiling') { ctx.globalAlpha *= 0.7; ctx.setLineDash([0.25, 0.15]); }
  if (!isGhost) rect(0.14, 0.18, d.width, d.depth, '#00000048');
  rect(0.06, 0.06, d.width - 0.12, d.depth - 0.12, isGhost ? error ? '#c6645535' : '#99cb7738' : object.type === 'frame' ? '#403c2b' : object.type === 'storage' ? '#46523f' : '#35494a', color, isGhost ? 0.09 : 0.06);
  if (object.type === 'frame') {
    const corner = 0.35;
    for (const [x, y] of [[0, 0], [d.width - corner, 0], [0, d.depth - corner], [d.width - corner, d.depth - corner]]) rect(x, y, corner, corner, color);
    rect(0.4, 0.4, d.width - 0.8, d.depth - 0.8, null, `${color}66`, 0.035);
    if (!object.children?.length) textWorld(object.mount === 'ceiling' ? `ПОТОЛОК ${meters(object.z)} м` : 'СТЕЛЛАЖ', d.width / 2, d.depth / 2, color, Math.max(0.25, Math.min(d.width / 13, 0.5)));
    ctx.setLineDash([]);
    for (const item of object.children || []) {
      const world = worldEquipment(object, item), box = dimensions(world), childColor = EQUIPMENT[item.type].color;
      rect(world.x - object.x + 0.08, world.y - object.y + 0.08, box.width - 0.16, box.depth - 0.16, `${childColor}55`, childColor, 0.05);
      drawProductionGlyph(ctx,item.type,{x:world.x-object.x,y:world.y-object.y,width:box.width,height:box.depth},ensureSimulation(state).containers[`${object.id}/${item.id}`]);
    }
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
  if (erase && object.id === hoverId) rect(0, 0, d.width, d.depth, '#ed6b5d35', '#ed6b5d', 0.1);
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
  for (const object of [...state.objects].sort((a, b) => a.z - b.z)) {
    if (!inLayer(object)) ctx.globalAlpha = 0.18;
    if (movingId === object.id) ctx.globalAlpha *= 0.35;
    drawObject(object); ctx.globalAlpha = 1;
  }
  const pipeView = { axes: ['x','y'], scale: 1, ox: 0, oy: 0, height: WAGON.depth, flip: false, unit: true };
  for (const pipe of state.graph.pipes) drawProjectedPipe(ctx, pipe, pipeView, { alpha: 1, highlight: highlightedPipes.has(pipe.id) || selectedPipeId === pipe.id, contents:pipeTokens(state,pipe.id) });
  for (const port of state.graph.ports) drawProjectedPort(ctx, port, pipeView, port.attached);
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
  const simulated=simulationRunner.advance(time);
  if(simulated)markDirty();
  if(time-lastSimulationUI>=250){refreshSimulation();lastSimulationUI=time;}
  previousTime = time;
  let dx = 0, dy = 0;
  if (!frameEditor.isOpen) for (const key of keys) { const vector = movement[key]; if (vector) { dx += vector[0]; dy += vector[1]; } }
  // Screen directions follow the wagon's portrait orientation on small screens.
  if (view.vertical) [dx, dy] = [dy, -dx];
  const beforeX = state.player.x, beforeY = state.player.y;
  while (accumulator >= 1 / 60) { movePlayer(state, dx, dy, 1 / 60); accumulator -= 1 / 60; }
  if (beforeX !== state.player.x || beforeY !== state.player.y) { markDirty(); updatePlacement(); }
  if (!frameEditor.isOpen) render();
  requestAnimationFrame(frame);
}
new ResizeObserver(resize).observe(canvas);
try { const saved = localStorage.getItem(STORAGE_KEY); if (saved) restore(saved, 'Загружено из браузера'); }
catch { toast('Сохранение недоступно или повреждено. Открыт тестовый вагон.', true); }
resize(); updateUI(); if(state.migrationNotice)toast(state.migrationNotice); requestAnimationFrame(frame);
