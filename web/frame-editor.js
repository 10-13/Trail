import { WAGON, EQUIPMENT, dimensions, localSize, equipmentError, putEquipment, removeEquipment, updateFrame } from './core.js';
import { el, numberField, readVoxels } from './ui.js';

const PLANES = [
  { key: 'xy', title: 'Сверху · XY', axes: ['x', 'y'], depth: 'z', sizes: ['width', 'depth'], flip: false },
  { key: 'xz', title: 'Спереди · XZ', axes: ['x', 'z'], depth: 'y', sizes: ['width', 'height'], flip: true },
  { key: 'yz', title: 'Сбоку · YZ', axes: ['y', 'z'], depth: 'x', sizes: ['depth', 'height'], flip: true }
];
const meter = value => (value / 4).toLocaleString('ru-RU', { maximumFractionDigits: 2 });

export function createFrameEditor({ getState, onChange, onClose }) {
  const screen = document.getElementById('frame-editor');
  const wagon = document.getElementById('viewport'), hud = document.querySelector('.hud');
  let frameId = null, selectedId = null, draft = null, drag = null;
  const layers = { x: 0, y: 0, z: 0 }, views = [], inputs = {};
  const frame = () => getState().objects.find(item => item.id === frameId);
  const selected = () => frame()?.children.find(item => item.id === selectedId);
  const message = (text = '', invalid = false) => {
    document.getElementById('editor-message').textContent = text;
    document.getElementById('editor-message').classList.toggle('error', invalid);
  };
  const frameInputs = {};
  for (const [key, label, value, max] of [['width', 'X, м', 1.5, 12], ['depth', 'Y, м', 1, 3], ['height', 'Z, м', 2, 2.5]]) {
    const field = numberField(label, `edit-frame-${key}`, value, 0.25, max);
    document.getElementById('frame-size-fields').append(field.row); frameInputs[key] = field.input;
  }
  for (const [key, label, min, max] of [['x', 'X, м', 0, 12], ['y', 'Y, м', 0, 3], ['z', 'Z, м', 0, 2.5], ['width', 'Ширина X, м', 0.25, 12], ['depth', 'Длина Y, м', 0.25, 3], ['height', 'Высота Z, м', 0.25, 2.5]]) {
    const field = numberField(label, `item-${key}`, 0.25, min, max);
    document.getElementById('item-fields').append(field.row); inputs[key] = field.input;
  }
  for (const plane of PLANES) {
    const article = el('section', 'ortho-view');
    article.dataset.plane = plane.key;
    article.append(el('h3', '', plane.title));
    const canvas = el('canvas'); canvas.id = `view-${plane.key}`; canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', `${plane.title}: выбери объект и перетащи по сетке`);
    article.append(canvas);
    const row = el('label', 'slice-control'), label = el('span');
    const slider = el('input'); slider.type = 'range'; slider.min = 0; slider.step = 1; slider.value = 0;
    slider.id = `slice-${plane.key}`;
    row.append(label, slider); article.append(row);
    document.getElementById('editor-views').append(article);
    const view = { ...plane, canvas, slider, label, scale: 1, ox: 0, oy: 0, width: 0, height: 0 };
    views.push(view);
    slider.addEventListener('input', () => { layers[plane.depth] = slider.valueAsNumber; drawAll(); });
    canvas.addEventListener('pointerdown', event => beginDrag(event, view));
    canvas.addEventListener('pointermove', event => moveDrag(event, view));
    canvas.addEventListener('pointerup', event => endDrag(event, view));
    canvas.addEventListener('pointercancel', () => { draft = null; drag = null; drawAll(); });
    canvas.addEventListener('lostpointercapture', () => { if (drag) { draft = null; drag = null; drawAll(); } });
    new ResizeObserver(() => { if (!screen.hidden) drawAll(); }).observe(canvas);
  }
  function syncLayers(item) {
    if (item) for (const axis of ['x', 'y', 'z']) layers[axis] = item[axis];
  }
  function refresh(updateFrameFields = false) {
    const current = frame(); if (!current) return;
    const size = localSize(current);
    if (updateFrameFields) {
      for (const key of ['width', 'depth', 'height']) frameInputs[key].value = size[key] / 4;
      document.getElementById('edit-frame-mount').value = current.mount;
    }
    document.getElementById('frame-editor-title').textContent = `Каркас ${current.id.replace('object-', '№ ')} · ${current.mount === 'ceiling' ? 'потолок' : 'пол'}`;
    document.getElementById('frame-clearance').textContent = current.mount === 'ceiling'
      ? `Нижняя граница ${meter(current.z)} м · ${current.z >= 8 ? 'проход свободен' : 'проход перекрыт (нужно 2 м)'}`
      : `От пола до ${meter(current.height)} м · поворот ${current.rotation * 90}°`;
    document.getElementById('item-list').replaceChildren();
    for (const item of current.children) {
      const button = el('button', item.id === selectedId ? 'item-row active' : 'item-row');
      button.type = 'button'; button.dataset.itemId = item.id;
      button.append(el('span', 'item-swatch'), el('span', '', `${EQUIPMENT[item.type].short} ${item.id.slice(5)}`));
      button.firstChild.style.background = EQUIPMENT[item.type].color;
      const d = dimensions(item);
      button.append(el('small', '', `${meter(d.width)}×${meter(d.depth)}×${meter(d.height)}`));
      button.setAttribute('aria-pressed', item.id === selectedId);
      button.onclick = () => { selectedId = item.id; syncLayers(item); message(); refresh(); };
      document.getElementById('item-list').append(button);
    }
    if (!current.children.length) document.getElementById('item-list').append(el('p', 'muted', 'Каркас пуст. Добавь оборудование.'));
    const item = selected();
    document.getElementById('item-form').hidden = !item;
    document.getElementById('item-empty').hidden = !!item;
    if (item) {
      document.getElementById('item-title').textContent = `${EQUIPMENT[item.type].name} ${item.id.slice(5)}`;
      for (const [key, input] of Object.entries(inputs)) input.value = item[key] / 4;
      document.getElementById('item-rotation').textContent = `${item.rotation * 90}°`;
    }
    for (const view of views) {
      const max = size[{ x: 'width', y: 'depth', z: 'height' }[view.depth]] - 1;
      layers[view.depth] = Math.min(layers[view.depth], max);
      view.slider.max = max; view.slider.value = layers[view.depth];
    }
    drawAll();
  }
  function changed() { onChange(); refresh(); }
  function drawAll() {
    if (screen.hidden || !frame()) return;
    const bounds = localSize(frame());
    // One pixel/voxel scale keeps X aligned in the left column and Z in the bottom row.
    const scale = Math.max(0.1, Math.min(...views.flatMap(view => {
      const area = view.canvas.getBoundingClientRect();
      return [(area.width - 44) / bounds[view.sizes[0]], (area.height - 44) / bounds[view.sizes[1]]];
    })));
    for (const view of views) drawView(view, scale);
  }
  function drawView(view, scale) {
    const current = frame(), bounds = localSize(current), area = view.canvas.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2), ctx = view.canvas.getContext('2d');
    const w = area.width, h = area.height;
    view.canvas.width = Math.round(w * dpr); view.canvas.height = Math.round(h * dpr);
    view.width = bounds[view.sizes[0]]; view.height = bounds[view.sizes[1]];
    view.scale = scale;
    view.ox = (w - view.width * view.scale) / 2;
    view.oy = (h - view.height * view.scale) / 2;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#111c23'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#b9a270'; ctx.lineWidth = 1;
    ctx.strokeRect(view.ox, view.oy, view.width * view.scale, view.height * view.scale);
    ctx.strokeStyle = '#34454d'; ctx.lineWidth = 0.5;
    for (let x = 1; x < view.width; x++) { const px = view.ox + x * view.scale; ctx.beginPath(); ctx.moveTo(px, view.oy); ctx.lineTo(px, view.oy + view.height * view.scale); ctx.stroke(); }
    for (let y = 1; y < view.height; y++) { const py = view.oy + y * view.scale; ctx.beginPath(); ctx.moveTo(view.ox, py); ctx.lineTo(view.ox + view.width * view.scale, py); ctx.stroke(); }
    view.label.textContent = `Срез ${view.depth.toUpperCase()} = ${meter(layers[view.depth])} м`;
    ctx.font = '10px monospace'; ctx.fillStyle = '#82959d'; ctx.textAlign = 'center';
    ctx.fillText(`${view.axes[0].toUpperCase()} · ${meter(view.width)} м`, w / 2, h - 5);
    ctx.textAlign = 'left'; ctx.fillText(`${view.axes[1].toUpperCase()} ${view.flip ? '↑' : '↓'} ${meter(view.height)} м`, 4, 12);
    const objects = [...current.children].sort((a, b) => Number(a.id === selectedId) - Number(b.id === selectedId));
    for (const item of objects) drawItem(ctx, view, item, false);
    if (draft) drawItem(ctx, view, draft, true);
  }
  function inSlice(view, item) {
    const d = dimensions(item), sizeKey = { x: 'width', y: 'depth', z: 'height' }[view.depth];
    return item[view.depth] <= layers[view.depth] && item[view.depth] + d[sizeKey] > layers[view.depth];
  }
  function projected(view, item) {
    const d = dimensions(item), width = d[view.sizes[0]], height = d[view.sizes[1]];
    return { x: view.ox + item[view.axes[0]] * view.scale, y: view.oy + (view.flip ? view.height - item[view.axes[1]] - height : item[view.axes[1]]) * view.scale, width: width * view.scale, height: height * view.scale };
  }
  function drawItem(ctx, view, item, preview) {
    const box = projected(view, item), active = item.id === selectedId;
    const error = preview && equipmentError(frame(), item, selectedId);
    const color = preview ? error ? '#edaa9e' : '#b5cd8b' : EQUIPMENT[item.type].color;
    ctx.globalAlpha = preview ? 0.85 : drag && active ? 0.2 : inSlice(view, item) ? 1 : 0.18;
    ctx.fillStyle = `${color}45`; ctx.strokeStyle = color; ctx.lineWidth = active ? 2 : 1;
    ctx.fillRect(box.x + 1, box.y + 1, box.width - 2, box.height - 2);
    ctx.strokeRect(box.x + 1, box.y + 1, box.width - 2, box.height - 2);
    if (box.width > 24 && box.height > 15) {
      ctx.font = '10px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = color;
      ctx.fillText(item.id.slice(5), box.x + box.width / 2, box.y + box.height / 2 + 3);
    }
    ctx.globalAlpha = 1;
  }
  function point(event, view) {
    const box = view.canvas.getBoundingClientRect();
    const x = (event.clientX - box.left - view.ox) / view.scale;
    const y = (event.clientY - box.top - view.oy) / view.scale;
    return [x, view.flip ? view.height - y : y];
  }
  function beginDrag(event, view) {
    if (event.button !== 0 || drag) return;
    event.preventDefault();
    const p = point(event, view);
    const hits = frame().children.filter(item => {
      const d = dimensions(item);
      return inSlice(view, item) && p[0] >= item[view.axes[0]] && p[0] < item[view.axes[0]] + d[view.sizes[0]] && p[1] >= item[view.axes[1]] && p[1] < item[view.axes[1]] + d[view.sizes[1]];
    });
    const item = hits.find(item => item.id === selectedId) || hits.at(-1);
    if (!item) { selectedId = null; message('На этом срезе нет объекта. Измени срез или выбери объект в списке.'); refresh(); return; }
    selectedId = item.id; syncLayers(item); refresh();
    drag = { view, pointerId: event.pointerId, start: p, original: { ...item } };
    draft = { ...item }; view.canvas.setPointerCapture(event.pointerId);
    message('Перетащи объект. Изменяются только две оси текущего вида.');
  }
  function moveDrag(event, view) {
    if (!drag || drag.view !== view || drag.pointerId !== event.pointerId) return;
    const p = point(event, view); draft = { ...drag.original };
    for (let index = 0; index < 2; index++) draft[view.axes[index]] += Math.round(p[index] - drag.start[index]);
    const error = equipmentError(frame(), draft, selectedId);
    message(error || 'Можно разместить · отпусти указатель', !!error); drawAll();
  }
  function endDrag(event, view) {
    if (!drag || drag.view !== view || drag.pointerId !== event.pointerId) return;
    moveDrag(event, view);
    const error = putEquipment(getState(), frameId, draft, selectedId);
    drag = null; draft = null;
    if (view.canvas.hasPointerCapture(event.pointerId)) view.canvas.releasePointerCapture(event.pointerId);
    if (!error) { syncLayers(selected()); changed(); }
    else refresh();
    message(error || 'Положение обновлено во всех трёх видах', !!error);
  }
  function add(type) {
    const current = frame(), bounds = localSize(current), definition = EQUIPMENT[type];
    const item = { type, x: 0, y: 0, z: 0, rotation: 0, width: Math.min(definition.width, bounds.width), depth: Math.min(definition.depth, bounds.depth), height: Math.min(definition.height, bounds.height) };
    for (let z = 0; z <= bounds.height - item.height; z++) for (let y = 0; y <= bounds.depth - item.depth; y++) for (let x = 0; x <= bounds.width - item.width; x++) {
      const candidate = { ...item, x, y, z };
      if (!equipmentError(current, candidate)) {
        putEquipment(getState(), frameId, candidate);
        selectedId = current.children.at(-1).id; syncLayers(selected()); changed(); message('Объект добавлен. Размеры и координаты — в свойствах.'); return;
      }
    }
    message('В каркасе нет места для этого объекта. Освободи объём или увеличь каркас.', true);
  }
  document.getElementById('add-machine').onclick = () => add('machine');
  document.getElementById('add-tank').onclick = () => add('tank');
  document.getElementById('item-form').onsubmit = event => {
    event.preventDefault(); const item = selected(); if (!item) return;
    try {
      const candidate = { ...item };
      for (const [key, input] of Object.entries(inputs)) candidate[key] = readVoxels(input);
      const error = putEquipment(getState(), frameId, candidate, selectedId);
      if (error) { message(error, true); return; }
      syncLayers(selected()); changed(); message('Свойства применены');
    } catch (error) { message(error.message, true); }
  };
  document.getElementById('item-rotate').onclick = () => {
    const item = selected(); if (!item) return;
    const error = putEquipment(getState(), frameId, { ...item, rotation: (item.rotation + 1) % 4 }, selectedId);
    if (!error) changed();
    message(error || 'Поворот на 90° применён', !!error);
  };
  document.getElementById('item-delete').onclick = () => {
    removeEquipment(getState(), frameId, selectedId); selectedId = null; changed(); message('Оборудование удалено');
  };
  document.getElementById('frame-form').onsubmit = event => {
    event.preventDefault();
    try {
      const settings = { mount: document.getElementById('edit-frame-mount').value };
      for (const [key, input] of Object.entries(frameInputs)) settings[key] = readVoxels(input);
      const error = updateFrame(getState(), frameId, settings);
      if (!error) { onChange(); refresh(true); }
      message(error || 'Габариты и крепление каркаса обновлены', !!error);
    } catch (error) { message(error.message, true); }
  };
  function cancelDrag() {
    const previous = drag;
    draft = null; drag = null;
    if (previous?.view.canvas.hasPointerCapture(previous.pointerId)) previous.view.canvas.releasePointerCapture(previous.pointerId);
  }
  const close = () => {
    cancelDrag(); screen.hidden = true; wagon.hidden = false; hud.hidden = false;
    document.body.dataset.screen = 'wagon'; onClose();
  };
  document.getElementById('close-frame-editor').onclick = close;
  screen.addEventListener('keydown', event => {
    // Numeric fields use native text editing; shortcuts never move the player.
    if (event.key !== 'Escape') return;
    event.preventDefault(); event.stopPropagation();
    if (drag) { cancelDrag(); drawAll(); message('Перемещение отменено'); }
    else close();
  });
  return {
    get isOpen() { return !screen.hidden; },
    open(id) {
      if (!getState().objects.some(item => item.id === id && item.type === 'frame')) return;
      frameId = id; selectedId = null; draft = null; drag = null;
      layers.x = layers.y = layers.z = 0;
      wagon.hidden = true; hud.hidden = true; screen.hidden = false;
      document.body.dataset.screen = 'editor';
      refresh(true); message('Координаты оборудования локальны каркасу. Перетаскивай в любом из трёх видов.');
      document.getElementById('close-frame-editor').focus({ preventScroll: true });
    },
    close
  };
}
