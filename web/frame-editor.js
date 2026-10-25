import { EQUIPMENT, dimensions, localSize, equipmentError, putEquipment, removeEquipment, updateFrame } from './core.js';
import { el, numberField, readVoxels } from './ui.js';

const PLANES = [
  { key: 'xz', title: 'Вдоль поезда', axes: ['x', 'z'], depth: 'y', sizes: ['width', 'height'], flip: true },
  { key: 'yz', title: 'Поперёк поезда', axes: ['y', 'z'], depth: 'x', sizes: ['depth', 'height'], flip: true },
  { key: 'xy', title: 'Сверху', axes: ['x', 'y'], depth: 'z', sizes: ['width', 'depth'], flip: false }
];
const SIZE_KEY = { x: 'width', y: 'depth', z: 'height' };
const meter = value => (value / 4).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
const $ = id => document.getElementById(id);

export function createFrameEditor({ getState, onChange, onClose }) {
  const screen = $('frame-editor'), wagon = $('viewport'), hud = document.querySelector('.hud');
  let frameId = null, selectedId = null, draft = null, drag = null, brush = null, erase = false, menuOpen = false;
  let pointerView = null, pointerPoint = null, hoverId = null, stroke = null, movingId = null;
  const layers = { x: 0, y: 0, z: 0 }, views = [], inputs = {}, frameInputs = {}, brushInputs = {};
  const frame = () => getState().objects.find(item => item.id === frameId);
  const selected = () => frame()?.children.find(item => item.id === selectedId);
  const message = (text = '', invalid = false) => { $('editor-message').textContent = text; $('editor-message').classList.toggle('error', invalid); };
  for (const [key, label, value, max] of [['width', 'Длина, м', 1.5, 12], ['depth', 'Ширина, м', 1, 3], ['height', 'Высота, м', 2, 2.5]]) {
    const field = numberField(label, `edit-frame-${key}`, value, 0.25, max);
    $('frame-size-fields').append(field.row); frameInputs[key] = field.input;
    const brushField = numberField(label, `brush-${key}`, 0.5, 0.25, max);
    $('brush-fields').append(brushField.row); brushInputs[key] = brushField.input;
  }
  for (const [key, label, min, max] of [['x', 'Вдоль, м', 0, 12], ['y', 'Поперёк, м', 0, 3], ['z', 'От дна, м', 0, 2.5], ['width', 'Длина, м', 0.25, 12], ['depth', 'Ширина, м', 0.25, 3], ['height', 'Высота, м', 0.25, 2.5]]) {
    const field = numberField(label, `item-${key}`, 0.25, min, max);
    $('item-fields').append(field.row); inputs[key] = field.input;
  }
  for (const plane of PLANES) {
    const article = el('section', 'ortho-view'); article.dataset.plane = plane.key;
    const name = el('span', 'view-name', plane.title); article.append(name);
    const canvas = el('canvas'); canvas.id = `view-${plane.key}`; canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', `${plane.title}. Tab — блоки, Backspace — удаление. Линии срезов перетаскиваются за ручки.`);
    article.append(canvas); $('editor-views').append(article);
    const view = { ...plane, canvas, scale: 1, ox: 0, oy: 0, width: 0, height: 0 };
    views.push(view);
    canvas.addEventListener('pointerdown', event => beginPointer(event, view));
    canvas.addEventListener('pointermove', event => movePointer(event, view));
    canvas.addEventListener('pointerup', event => endPointer(event, view));
    canvas.addEventListener('pointercancel', () => { cancelDrag(); drawAll(); });
    canvas.addEventListener('lostpointercapture', () => { if (drag || stroke) { cancelDrag(); drawAll(); } });
    canvas.addEventListener('pointerleave', () => { if (!drag && !stroke) { draft = null; hoverId = null; drawAll(); } });
    canvas.addEventListener('contextmenu', event => { event.preventDefault(); clearTool(); });
    new ResizeObserver(() => { if (!screen.hidden) drawAll(); }).observe(canvas);
  }
  function syncLayers(item) { if (item) for (const axis of ['x', 'y', 'z']) layers[axis] = item[axis]; }
  function refresh(frameFields = false) {
    const current = frame(); if (!current) return;
    const size = localSize(current);
    for (const [key, input] of Object.entries(brushInputs)) input.max = (key === 'height' ? size.height : Math.max(size.width, size.depth)) / 4;
    if (frameFields) {
      for (const key of ['width', 'depth', 'height']) frameInputs[key].value = size[key] / 4;
      $('edit-frame-mount').value = current.mount;
    }
    $('frame-clearance').textContent = current.mount === 'ceiling'
      ? `Низ ${meter(current.z)} м · ${current.z >= 8 ? 'проход свободен' : 'проход перекрыт'}` : `Напольный · высота ${meter(size.height)} м`;
    for (const axis of ['x', 'y', 'z']) layers[axis] = Math.max(0, Math.min(layers[axis], size[SIZE_KEY[axis]] - 1));
    // Keep the top view under the larger elevation, aligned to its long dimension.
    const wide = size.width >= size.depth, top = views.find(view => view.key === 'xy');
    top.axes = wide ? ['x', 'y'] : ['y', 'x']; top.sizes = wide ? ['width', 'depth'] : ['depth', 'width'];
    $('editor-views').dataset.topSide = wide ? 'left' : 'right';
    $('editor-views').style.gridTemplateColumns = `minmax(min(130px, 40vw), ${size.width}fr) minmax(min(130px, 40vw), ${size.depth}fr)`;
    $('editor-views').style.gridTemplateRows = `minmax(min(150px, 30vh), ${size.height}fr) minmax(min(150px, 30vh), ${Math.min(size.width, size.depth)}fr)`;
    const item = selected();
    $('item-form').hidden = !item || !!brush || erase;
    $('item-empty').hidden = !!item && !brush && !erase;
    $('item-empty').textContent = erase ? 'Удаление: нажимай на блоки. Esc — убрать кисть.' : brush ? `${EQUIPMENT[brush.type].short} · ставь кликом или веди кисть. R — поворот. Высота задаётся линией среза на боковых видах.` : 'Tab — выбрать блок. Backspace — удалять по клику. Линии на видах задают срезы: перетаскивай их за ручки.';
    if (item) {
      $('item-title').textContent = EQUIPMENT[item.type].name;
      for (const [key, input] of Object.entries(inputs)) input.value = item[key] / 4;
      $('item-rotation').textContent = `${item.rotation * 90}°`;
    }
    $('editor-menu').hidden = !menuOpen;
    $('editor-menu-button').setAttribute('aria-expanded', menuOpen);
    $('editor-erase').classList.toggle('active', erase);
    $('editor-erase').setAttribute('aria-pressed', erase);
    drawAll();
  }
  function changed() { onChange(); refresh(); }
  function toggleMenu() {
    menuOpen = !menuOpen; refresh();
    if (menuOpen) $('close-editor-menu').focus({ preventScroll: true });
    else (pointerView?.canvas || $('editor-menu-button')).focus({ preventScroll: true });
  }
  function clearTool() {
    cancelDrag(); brush = null; draft = null; erase = false; movingId = null; menuOpen = false; refresh(); message();
  }
  function toggleErase() {
    cancelDrag(); erase = !erase; brush = null; draft = null; movingId = null; selectedId = null; menuOpen = false;
    refresh(); message(erase ? 'Удаление · нажми на блок · Esc отменить' : 'Кисть удаления выключена');
    (pointerView?.canvas || $('editor-menu-button')).focus({ preventScroll: true });
  }
  function choose(type) {
    try {
      const size = {};
      for (const [key, input] of Object.entries(brushInputs)) size[key] = readVoxels(input);
      brush = { type, x: 0, y: 0, z: 0, rotation: 0, ...size }; erase = false; selectedId = null; movingId = null; menuOpen = false;
      draft = null; refresh(); message('Выбран блок. Нажимай на свободные места в любом виде.');
      (pointerView?.canvas || views[0].canvas).focus({ preventScroll: true });
    } catch (error) { message(error.message, true); }
  }
  function drawAll() {
    if (screen.hidden || !frame()) return;
    const bounds = localSize(frame());
    const scale = Math.max(0.1, Math.min(...views.flatMap(view => {
      const area = view.canvas.getBoundingClientRect();
      return [(area.width - 44) / bounds[view.sizes[0]], (area.height - 44) / bounds[view.sizes[1]]];
    })));
    for (const view of views) drawView(view, scale);
  }
  function drawView(view, scale) {
    const bounds = localSize(frame()), area = view.canvas.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2), ctx = view.canvas.getContext('2d'), w = area.width, h = area.height;
    view.canvas.width = Math.round(w * dpr); view.canvas.height = Math.round(h * dpr);
    view.width = bounds[view.sizes[0]]; view.height = bounds[view.sizes[1]]; view.scale = scale;
    view.ox = (w - view.width * scale) / 2; view.oy = (h - view.height * scale) / 2;
    const right = view.ox + view.width * scale, bottom = view.oy + view.height * scale;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = '#111c23'; ctx.fillRect(0, 0, w, h);
    if (view.key === 'xy') {
      ctx.save(); ctx.beginPath(); ctx.rect(view.ox, view.oy, view.width * scale, view.height * scale); ctx.clip();
      ctx.strokeStyle = '#d5535355'; ctx.lineWidth = 1;
      for (let x = view.ox - h; x < right + h; x += 10) { ctx.beginPath(); ctx.moveTo(x, view.oy); ctx.lineTo(x + h, view.oy + h); ctx.stroke(); }
      ctx.restore();
    }
    ctx.strokeStyle = '#34454d'; ctx.lineWidth = .5;
    for (let x = 1; x < view.width; x++) { ctx.beginPath(); ctx.moveTo(view.ox + x * scale, view.oy); ctx.lineTo(view.ox + x * scale, bottom); ctx.stroke(); }
    for (let y = 1; y < view.height; y++) { ctx.beginPath(); ctx.moveTo(view.ox, view.oy + y * scale); ctx.lineTo(right, view.oy + y * scale); ctx.stroke(); }
    ctx.strokeStyle = '#b9a270'; ctx.lineWidth = 1; ctx.strokeRect(view.ox, view.oy, view.width * scale, view.height * scale);
    if (view.flip) { ctx.strokeStyle = '#ec6262'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(view.ox, bottom); ctx.lineTo(right, bottom); ctx.stroke(); }
    const objects = [...frame().children].sort((a, b) => Number(a.id === selectedId) - Number(b.id === selectedId));
    for (const item of objects) drawItem(ctx, view, item, false);
    if (draft) drawItem(ctx, view, draft, true);
    for (let index = 0; index < 2; index++) drawSlice(ctx, view, index);
  }
  function inSlice(view, item) {
    return item[view.depth] <= layers[view.depth] && item[view.depth] + dimensions(item)[SIZE_KEY[view.depth]] > layers[view.depth];
  }
  function projected(view, item) {
    const d = dimensions(item), width = d[view.sizes[0]], height = d[view.sizes[1]];
    return { x: view.ox + item[view.axes[0]] * view.scale, y: view.oy + (view.flip ? view.height - item[view.axes[1]] - height : item[view.axes[1]]) * view.scale, width: width * view.scale, height: height * view.scale };
  }
  function drawItem(ctx, view, item, preview) {
    const box = projected(view, item), active = item.id === selectedId;
    const error = preview && equipmentError(frame(), item, drag?.kind === 'item' ? selectedId : movingId);
    const color = preview ? error ? '#edaa9e' : '#b5cd8b' : erase && hoverId === item.id ? '#ed6b5d' : EQUIPMENT[item.type].color;
    ctx.globalAlpha = preview ? .8 : drag?.kind === 'item' && active ? .2 : inSlice(view, item) ? 1 : .18;
    ctx.fillStyle = `${color}45`; ctx.strokeStyle = color; ctx.lineWidth = active ? 2 : 1;
    ctx.fillRect(box.x + 1, box.y + 1, Math.max(0, box.width - 2), Math.max(0, box.height - 2));
    ctx.strokeRect(box.x + 1, box.y + 1, Math.max(0, box.width - 2), Math.max(0, box.height - 2)); ctx.globalAlpha = 1;
  }
  function slicePosition(view, index) {
    const value = layers[view.axes[index]] + .5;
    return index === 0 ? view.ox + value * view.scale : view.oy + (view.flip ? view.height - value : value) * view.scale;
  }
  function drawSlice(ctx, view, index) {
    const position = slicePosition(view, index), color = index === 0 ? '#74afca' : '#d5a96d';
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1; ctx.setLineDash([4, 3]); ctx.beginPath();
    if (index === 0) { ctx.moveTo(position, view.oy); ctx.lineTo(position, view.oy + view.height * view.scale); }
    else { ctx.moveTo(view.ox, position); ctx.lineTo(view.ox + view.width * view.scale, position); }
    ctx.stroke(); ctx.setLineDash([]);
    const x = index === 0 ? position : view.ox - 9, y = index === 0 ? view.oy - 9 : position;
    ctx.fillRect(x - 4, y - 4, 8, 8);
  }
  function point(event, view) {
    const box = view.canvas.getBoundingClientRect();
    const x = (event.clientX - box.left - view.ox) / view.scale, y = (event.clientY - box.top - view.oy) / view.scale;
    return [x, view.flip ? view.height - y : y];
  }
  function itemAt(view, p) {
    return [...frame().children].reverse().find(item => {
      const d = dimensions(item);
      return inSlice(view, item) && p[0] >= item[view.axes[0]] && p[0] < item[view.axes[0]] + d[view.sizes[0]] && p[1] >= item[view.axes[1]] && p[1] < item[view.axes[1]] + d[view.sizes[1]];
    });
  }
  function sliceHit(event, view, allowBody) {
    const rect = view.canvas.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
    for (let index = 0; index < 2; index++) {
      const position = slicePosition(view, index);
      const hx = index === 0 ? position : view.ox - 9, hy = index === 0 ? view.oy - 9 : position;
      if (Math.abs(x - hx) <= 9 && Math.abs(y - hy) <= 9) return index;
      const body = index === 0 ? Math.abs(x - position) <= 4 && y >= view.oy && y <= view.oy + view.height * view.scale : Math.abs(y - position) <= 4 && x >= view.ox && x <= view.ox + view.width * view.scale;
      if (allowBody && body) return index;
    }
    return -1;
  }
  function updateDraft(view, p) {
    if (!brush) return;
    draft = { ...brush }; const d = dimensions(draft);
    draft[view.depth] = layers[view.depth];
    for (let index = 0; index < 2; index++) draft[view.axes[index]] = Math.floor(p[index] - d[view.sizes[index]] / 2 + 1e-8);
  }
  function applyBrush(view, p, report = true) {
    updateDraft(view, p);
    const key = draft ? `${draft.x},${draft.y},${draft.z}` : `${view.key},${Math.floor(p[0])},${Math.floor(p[1])}`;
    if (stroke?.cells.has(key)) return;
    stroke?.cells.add(key);
    if (erase) {
      const item = itemAt(view, p);
      if (item) { removeEquipment(getState(), frameId, item.id); if (selectedId === item.id) selectedId = null; changed(); }
      return;
    }
    if (!draft) return;
    const error = putEquipment(getState(), frameId, draft, movingId);
    if (error) { if (report) message(error, true); return; }
    if (movingId) { selectedId = movingId; brush = null; draft = null; movingId = null; stroke = null; }
    changed(); message('Блок установлен · Tab — другой блок · Esc — убрать кисть');
  }
  function beginPointer(event, view) {
    if (event.button !== 0 || drag || stroke) return;
    event.preventDefault(); view.canvas.focus({ preventScroll: true });
    pointerView = view; pointerPoint = point(event, view);
    const hit = itemAt(view, pointerPoint), slice = sliceHit(event, view, !brush && !erase && !hit);
    if (slice >= 0) {
      drag = { kind: 'slice', view, index: slice, pointerId: event.pointerId }; draft = null;
      view.canvas.setPointerCapture(event.pointerId); return;
    }
    if (brush || erase) {
      stroke = { view, pointerId: event.pointerId, cells: new Set() }; view.canvas.setPointerCapture(event.pointerId); applyBrush(view, pointerPoint); drawAll(); return;
    }
    if (!hit) { selectedId = null; refresh(); message(); return; }
    selectedId = hit.id; syncLayers(hit); refresh();
    drag = { kind: 'item', view, pointerId: event.pointerId, start: pointerPoint, original: { ...hit } }; draft = { ...hit };
    view.canvas.setPointerCapture(event.pointerId);
  }
  function movePointer(event, view) {
    pointerView = view; pointerPoint = point(event, view); hoverId = itemAt(view, pointerPoint)?.id || null;
    if (drag?.view === view && drag.pointerId === event.pointerId) {
      if (drag.kind === 'slice') {
        const axis = view.axes[drag.index], max = localSize(frame())[SIZE_KEY[axis]] - 1;
        layers[axis] = Math.max(0, Math.min(max, Math.floor(pointerPoint[drag.index])));
        message(`Срез: ${meter(layers[axis])} м`); drawAll(); return;
      }
      draft = { ...drag.original };
      for (let index = 0; index < 2; index++) draft[view.axes[index]] += Math.round(pointerPoint[index] - drag.start[index]);
      const error = equipmentError(frame(), draft, selectedId); message(error || 'Отпусти указатель, чтобы переместить', !!error); drawAll(); return;
    }
    if (stroke?.view === view && (event.buttons & 1)) applyBrush(view, pointerPoint, false);
    else updateDraft(view, pointerPoint);
    view.canvas.style.cursor = sliceHit(event, view, !brush && !erase && !hoverId) >= 0 ? 'grab' : brush || erase ? 'crosshair' : hoverId ? 'move' : 'default';
    drawAll();
  }
  function endPointer(event, view) {
    if (drag?.view === view && drag.pointerId === event.pointerId) {
      movePointer(event, view);
      if (drag.kind === 'item') {
        const error = putEquipment(getState(), frameId, draft, selectedId);
        if (!error) { syncLayers(selected()); onChange(); }
        message(error || 'Объект перемещён', !!error);
      }
      drag = null; draft = null; refresh();
    }
    stroke = null;
    if (view.canvas.hasPointerCapture(event.pointerId)) view.canvas.releasePointerCapture(event.pointerId);
  }
  function rotate() {
    if (brush) { brush.rotation = (brush.rotation + 1) % 4; if (pointerView && pointerPoint) updateDraft(pointerView, pointerPoint); refresh(); return; }
    const item = selected(); if (!item) return;
    const error = putEquipment(getState(), frameId, { ...item, rotation: (item.rotation + 1) % 4 }, selectedId);
    if (!error) changed(); message(error || 'Поворот применён', !!error);
  }
  function moveSelected() {
    if (!selected()) return;
    brush = { ...selected() }; movingId = selectedId; erase = false; draft = null; refresh();
  }
  for (const button of document.querySelectorAll('[data-equipment-type]')) button.onclick = () => choose(button.dataset.equipmentType);
  $('editor-menu-button').onclick = toggleMenu; $('close-editor-menu').onclick = toggleMenu;
  $('editor-erase').onclick = toggleErase; $('item-delete').onclick = toggleErase;
  $('item-rotate').onclick = rotate; $('item-move').onclick = moveSelected;
  $('item-form').onsubmit = event => {
    event.preventDefault(); const item = selected(); if (!item) return;
    try {
      const candidate = { ...item }; for (const [key, input] of Object.entries(inputs)) candidate[key] = readVoxels(input);
      const error = putEquipment(getState(), frameId, candidate, selectedId);
      if (error) { message(error, true); return; }
      syncLayers(selected()); changed(); message('Свойства применены');
    } catch (error) { message(error.message, true); }
  };
  $('frame-form').onsubmit = event => {
    event.preventDefault();
    try {
      const settings = { mount: $('edit-frame-mount').value };
      for (const [key, input] of Object.entries(frameInputs)) settings[key] = readVoxels(input);
      const error = updateFrame(getState(), frameId, settings);
      if (!error) { onChange(); refresh(true); }
      message(error || 'Каркас обновлён', !!error);
    } catch (error) { message(error.message, true); }
  };
  function cancelDrag() {
    const previous = drag || stroke; draft = null; drag = null; stroke = null;
    if (previous?.view.canvas.hasPointerCapture(previous.pointerId)) previous.view.canvas.releasePointerCapture(previous.pointerId);
  }
  const close = () => {
    cancelDrag(); screen.hidden = true; wagon.hidden = false; hud.hidden = false;
    document.body.dataset.screen = 'wagon'; onClose();
  };
  $('close-frame-editor').onclick = close;
  screen.addEventListener('keydown', event => {
    if (event.code === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.metaKey) { event.preventDefault(); event.stopPropagation(); if (!event.repeat) toggleMenu(); return; }
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      if (drag || stroke) { cancelDrag(); drawAll(); }
      else if (menuOpen) toggleMenu();
      else if (brush || erase) clearTool();
      else close();
      return;
    }
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target.isContentEditable || event.ctrlKey || event.metaKey || event.altKey) return;
    const actions = { Backspace: toggleErase, Delete: toggleErase, KeyR: rotate, KeyM: moveSelected };
    if (actions[event.code]) { event.preventDefault(); event.stopPropagation(); if (!event.repeat) actions[event.code](); }
  });
  return {
    get isOpen() { return !screen.hidden; },
    open(id) {
      if (!getState().objects.some(item => item.id === id && item.type === 'frame')) return;
      frameId = id; selectedId = null; brush = null; erase = false; movingId = null; menuOpen = false; draft = null; drag = null; stroke = null; pointerView = null; pointerPoint = null;
      layers.x = layers.y = layers.z = 0;
      const size = localSize(frame());
      for (const [key, input] of Object.entries(brushInputs)) { input.max = size[key] / 4; input.value = Math.min(2, size[key]) / 4; }
      wagon.hidden = true; hud.hidden = true; screen.hidden = false; document.body.dataset.screen = 'editor';
      refresh(true); message(); $('close-frame-editor').focus({ preventScroll: true });
    }, close
  };
}
