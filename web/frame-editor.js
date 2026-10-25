import { ensureSimulation, pipeTokens } from './simulation.js';
import { createSimulationControls, createProductionInspector, drawProductionGlyph } from './production-ui.js';
import { EQUIPMENT, dimensions, localSize, equipmentPlacementError, putEquipment, removeEquipment, updateFrame, updatePorts, putPipe, pipePlacementError, paintPipeRoute, removePipe, findPipe, updatePipeFaces, connectEndpoints } from './core.js';
import { rotateObject } from './geometry.js';
import { el, numberField, readVoxels } from './ui.js';
import { rotateFace, pipesInFrame, localFace, portsInFrame, neighboringConnections, worldPipe, DIRECTIONS, openPipeEnds, localCell } from './logistics.js';
import { createRotationControl, createPipePalette, createPortsEditor, createPipeInspector, createNetworkPanel, drawProjectedPipe, drawProjectedPort } from './network-ui.js';

const PLANES = [
  { key: 'xz', title: 'Вдоль поезда', axes: ['x', 'z'], depth: 'y', sizes: ['width', 'height'], flip: true },
  { key: 'yz', title: 'Поперёк поезда', axes: ['y', 'z'], depth: 'x', sizes: ['depth', 'height'], flip: true },
  { key: 'xy', title: 'Сверху', axes: ['x', 'y'], depth: 'z', sizes: ['width', 'depth'], flip: false }
];
const SIZE_KEY = { x: 'width', y: 'depth', z: 'height' };
const meter = value => (value / 4).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
const $ = id => document.getElementById(id);

export function createFrameEditor({ getState, onChange, onClose, onSimulationStep, onSimulationChange, onDemo, demoActive, getSimulationMetrics }) {
  const screen = $('frame-editor'), wagon = $('viewport'), hud = document.querySelector('.hud');
  let frameId = null, selectedId = null, draft = null, drag = null, brush = null, erase = false, menuOpen = false;
  let pointerView = null, pointerPoint = null, hoverId = null, stroke = null, movingId = null;
  let selectedPipeId = null, pipeAnchor = null, highlightedPipes = new Set();
  const layers = { x: 0, y: 0, z: 0 }, views = [], inputs = {}, frameInputs = {}, brushInputs = {};
  const frame = () => getState().objects.find(item => item.id === frameId);
  const selected = () => frame()?.children.find(item => item.id === selectedId);
  const equipmentError = (unused, item, ignoreId = null) => equipmentPlacementError(getState(), frameId, item, ignoreId);
  const message = (text = '', invalid = false) => { $('editor-message').textContent = text; $('editor-message').classList.toggle('error', invalid); };
  const simulationControls=createSimulationControls($('editor-simulation'),{getMetrics:getSimulationMetrics,getState,changed:onSimulationChange,step:onSimulationStep,demo:onDemo,demoActive});
  const productionInspector=createProductionInspector($('item-production'),{getState,getSelection:()=>!brush&&!erase?(selectedPipeId?{pipeId:selectedPipeId}:selected()?{owner:`${frameId}/${selectedId}`,type:selected().type}:null):null,changed,message});
  const portsEditor = createPortsEditor($('item-ports'), {
    getObject: () => !brush && !erase ? selected() : null,
    apply: (ports, next) => updatePorts(getState(), frameId, selectedId, ports, next), changed, message
  });
  const pipeInspector = createPipeInspector($('editor-pipe-inspector'), {
    getPipe: () => !brush && !erase && selectedPipeId ? pipesInFrame(getState(), frame()).find(pipe => pipe.id === selectedPipeId) : null,
    apply: faces => { const found = findPipe(getState(), selectedPipeId); const owner = found?.frameId ? getState().objects.find(item => item.id === found.frameId) : null; return updatePipeFaces(getState(), selectedPipeId, faces.map(face => localFace(owner, rotateFace(face, frame())))); }, changed, message
  });
  let nearby = [], ownConnections = [];
  const neighborDetails=el('details','nearby-connections'), neighborSummary=el('summary'), neighborBody=el('div','network-links');
  const ownSelect=el('select'), neighborSelect=el('select'), connectButton=el('button','','Проложить соединение');
  ownSelect.setAttribute('aria-label','Подключение этого каркаса');neighborSelect.setAttribute('aria-label','Соседнее подключение');connectButton.type='button';connectButton.dataset.connectFrames='';
  const ownLabel=el('label','field'),neighborLabel=el('label','field');ownLabel.append(el('span','field-label','В этом каркасе'),ownSelect);neighborLabel.append(el('span','field-label','Рядом'),neighborSelect);
  neighborBody.append(ownLabel,neighborLabel,connectButton,el('p','muted','Порты и свободные концы соседних труб отмечены у границ видов. Соединение прокладывается и в промежутке между каркасами.'));
  neighborDetails.append(neighborSummary,neighborBody);$('neighbor-connections').append(neighborDetails);
  neighborDetails.ontoggle=()=>drawAll();
  function focusConnection(){const port=ownConnections.find(p=>p.id===ownSelect.value);if(port)syncLayers(port.cell);drawAll();}
  ownSelect.onchange=neighborSelect.onchange=focusConnection;
  connectButton.onclick=()=>{
    const first=ownConnections.find(p=>p.id===ownSelect.value),second=nearby.find(p=>p.id===neighborSelect.value);
    if(!first||!second)return;
    const error=connectEndpoints(getState(),toWorldEndpoint(first),toWorldEndpoint(second));
    if(!error){changed();message('Каркасы соединены. Труба проходит через промежуток между ними.');}else message(error,true);
  };
  function toWorldEndpoint(point){return {...point,cell:worldPipe(frame(),{...point.cell,faces:[]}),neighbor:worldPipe(frame(),{...point.neighbor,faces:[]}),face:rotateFace(point.face,frame())};}
  function refreshNearby(){
    nearby=neighboringConnections(getState(),frame());ownConnections=portsInFrame(getState(),frame()).filter(p=>p.frameId===frameId);
    const bounds=localSize(frame());
    ownConnections.push(...openPipeEnds(getState()).map(p=>({...p,cell:localCell(frame(),p.cell),neighbor:localCell(frame(),p.neighbor),face:localFace(frame(),p.face)})).filter(p=>p.cell.x>=0&&p.cell.y>=0&&p.cell.z>=0&&p.cell.x<bounds.width&&p.cell.y<bounds.depth&&p.cell.z<bounds.height));
    neighborSummary.textContent=`Рядом: ${nearby.length} подключений`;
    const fill=(select,points,isOwn)=>{
      const old=select.value;select.replaceChildren();
      for(const [i,p]of points.entries()){const option=el('option','',`${isOwn?'':`${i+1}. `}${p.label} · ${p.kind==='pipe'?'труба':p.kind==='input'?'вход':'выход'} · ${meter(p.cell.z)} м${p.attached?' · подключён':''}`);option.value=p.id;select.append(option);}
      if(points.some(p=>p.id===old))select.value=old;else if(isOwn&&points.some(p=>p.kind==='output'))select.value=points.find(p=>p.kind==='output').id;
    };fill(ownSelect,ownConnections,true);fill(neighborSelect,nearby,false);connectButton.disabled=!nearby.length||!ownConnections.length;
  }
  const rotationAxis = createRotationControl($('editor-rotation'), rotate);
  const networkPanel = createNetworkPanel($('editor-network'), { getState, onHighlight: ids => { highlightedPipes = ids; drawAll(); } });
  createPipePalette($('editor-pipe-palette'), config => {
    brush = { ...config, x: 0, y: 0, z: 0, rotation: 0 }; erase = false; selectedId = null; selectedPipeId = null; movingId = null; menuOpen = false; draft = null; pipeAnchor = null;
    neighborDetails.open=true; refresh(); message('Начни у порта или на конце трубы и веди маршрут. Высота задаётся линиями срезов.');
    (pointerView?.canvas || views[0].canvas).focus({ preventScroll: true });
  });
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
      ? `Низ ${meter(current.z)} м · ${current.z >= 8 ? 'проход свободен' : 'проход перекрыт'}` : `Напольный · высота ${meter(dimensions(current).height)} м`;
    for (const axis of ['x', 'y', 'z']) layers[axis] = Math.max(0, Math.min(layers[axis], size[SIZE_KEY[axis]] - 1));
    // Keep the top view under the larger elevation, aligned to its long dimension.
    const wide = size.width >= size.depth, top = views.find(view => view.key === 'xy');
    top.axes = wide ? ['x', 'y'] : ['y', 'x']; top.sizes = wide ? ['width', 'depth'] : ['depth', 'width'];
    $('editor-views').dataset.topSide = wide ? 'left' : 'right';screen.dataset.menuSide=wide?'left':'right';
    $('editor-views').style.gridTemplateColumns = `minmax(min(130px, 40vw), ${size.width}fr) minmax(min(130px, 40vw), ${size.depth}fr)`;
    $('editor-views').style.gridTemplateRows = `minmax(min(150px, 30vh), ${size.height}fr) minmax(min(150px, 30vh), ${Math.min(size.width, size.depth)}fr)`;
    const item = selected();
    $('item-form').hidden = !item || !!brush || erase;
    $('item-empty').hidden = !!item && !brush && !erase;
    $('item-empty').textContent = erase ? 'Удаление: нажимай на блоки и трубы. Esc — убрать кисть.' : brush ? `${brush.type === 'pipe' ? 'Труба' : EQUIPMENT[brush.type].short} · ставь кликом или веди кисть. R — поворот. Высота задаётся линией среза на боковых видах.` : 'Tab — выбрать блок. Backspace — удалять по клику. Линии на видах задают срезы: перетаскивай их за ручки.';
    if (item) {
      $('item-title').textContent = EQUIPMENT[item.type].name;
      for (const [key, input] of Object.entries(inputs)) input.value = item[key] / 4;
      $('item-rotation').textContent = '';
    }
    $('editor-menu').hidden = !menuOpen;
    $('editor-menu-button').setAttribute('aria-expanded', menuOpen);
    $('editor-erase').classList.toggle('active', erase);
    $('editor-erase').setAttribute('aria-pressed', erase);
    simulationControls.refresh(); productionInspector.refresh(); refreshNearby(); portsEditor.refresh(); pipeInspector.refresh(); networkPanel.refresh();
    drawAll();
  }
  function changed() { onChange(); refresh(); }
  function toggleMenu() {
    menuOpen = !menuOpen; refresh();
    if (menuOpen) $('close-editor-menu').focus({ preventScroll: true });
    else (pointerView?.canvas || $('editor-menu-button')).focus({ preventScroll: true });
  }
  function clearTool() {
    cancelDrag(); brush = null; draft = null; erase = false; movingId = null; menuOpen = false; selectedPipeId = null; pipeAnchor = null; refresh(); message();
  }
  function toggleErase() {
    cancelDrag(); erase = !erase; brush = null; draft = null; movingId = null; selectedId = null; selectedPipeId = null; menuOpen = false; pipeAnchor = null;
    refresh(); message(erase ? 'Удаление · нажми на блок · Esc отменить' : 'Кисть удаления выключена');
    (pointerView?.canvas || $('editor-menu-button')).focus({ preventScroll: true });
  }
  function choose(type) {
    try {
      const size = {};
      for (const [key, input] of Object.entries(brushInputs)) size[key] = readVoxels(input);
      brush = { type, x: 0, y: 0, z: 0, rotation: 0, ...size }; erase = false; selectedId = null; selectedPipeId = null; movingId = null; menuOpen = false;
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
    for (const pipe of pipesInFrame(getState(), frame())) drawProjectedPipe(ctx, pipe, view, { alpha: inSlice(view, { ...pipe, type: 'pipe', rotation: 0 }) ? 1 : .18, highlight: highlightedPipes.has(pipe.id) || selectedPipeId === pipe.id, contents: pipeTokens(getState(),pipe.id) });
    const localPorts = portsInFrame(getState(), frame()).filter(port => port.frameId === frameId);
    for (const port of localPorts) {
      ctx.save(); ctx.globalAlpha = port.cell[view.depth] === layers[view.depth] ? 1 : .18;
      drawProjectedPort(ctx, port, view, getState().graph.ports.find(p => p.id === port.id)?.attached); ctx.restore();
    }
    if(neighborDetails.open || brush?.type==='pipe') for(const [index,port]of nearby.entries()){
      const cell={...port.cell};
      for(const [i,axis]of view.axes.entries())cell[axis]=Math.max(-.5-DIRECTIONS[port.face][{x:0,y:1,z:2}[axis]]/2,Math.min(cell[axis],(i===0?view.width:view.height)-.5-DIRECTIONS[port.face][{x:0,y:1,z:2}[axis]]/2));
      ctx.save();ctx.globalAlpha=port.id===neighborSelect.value?1:.4;
      drawProjectedPort(ctx,{...port,cell},view,port.attached);
      const x=view.ox+(cell[view.axes[0]]+.5)*scale,y=view.oy+(view.flip?view.height-cell[view.axes[1]]-.5:cell[view.axes[1]]+.5)*scale;
      ctx.fillStyle='#d7e1df';ctx.font='10px monospace';ctx.fillText(String(index+1),x+5,y-5);ctx.restore();
    }
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
    if (item.type === 'pipe') {
      const error = item.autoRoute ? paintPipeRoute(getState(), frameId, pipeAnchor, item, true) : pipePlacementError(getState(), item, frameId);
      drawProjectedPipe(ctx, item, view, { preview: true, error: !!error }); return;
    }
    const box = projected(view, item), active = item.id === selectedId;
    const error = preview && equipmentError(frame(), item, drag?.kind === 'item' ? selectedId : movingId);
    const color = preview ? error ? '#edaa9e' : '#b5cd8b' : erase && hoverId === item.id ? '#ed6b5d' : EQUIPMENT[item.type].color;
    ctx.globalAlpha = preview ? .8 : drag?.kind === 'item' && active ? .2 : inSlice(view, item) ? 1 : .18;
    ctx.fillStyle = `${color}45`; ctx.strokeStyle = color; ctx.lineWidth = active ? 2 : 1;
    ctx.fillRect(box.x + 1, box.y + 1, Math.max(0, box.width - 2), Math.max(0, box.height - 2));
    ctx.strokeRect(box.x + 1, box.y + 1, Math.max(0, box.width - 2), Math.max(0, box.height - 2));
    drawProductionGlyph(ctx,item.type,box,preview?null:ensureSimulation(getState()).containers[`${frameId}/${item.id}`]);ctx.globalAlpha = 1;
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
  function pipeAt(view, p) {
    return pipesInFrame(getState(), frame()).find(pipe => pipe[view.depth] === layers[view.depth] && Math.floor(p[0]) === pipe[view.axes[0]] && Math.floor(p[1]) === pipe[view.axes[1]]);
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
    for (let index = 0; index < 2; index++) draft[view.axes[index]] = Math.floor(p[index] - (draft.type === 'pipe' ? 0 : d[view.sizes[index]] / 2) + 1e-8);
  }
  function applyBrush(view, p, report = true) {
    updateDraft(view, p);
    const key = draft ? `${draft.x},${draft.y},${draft.z}` : `${view.key},${Math.floor(p[0])},${Math.floor(p[1])}`;
    if (stroke?.cells.has(key)) return;
    stroke?.cells.add(key);
    if (erase) {
      const pipe = pipeAt(view, p);
      if (pipe) { const error=removePipe(getState(),pipe.id);if(error){message(error,true);return;} if (selectedPipeId === pipe.id) selectedPipeId = null; changed(); return; }
      const item = itemAt(view, p);
      if (item) { const error=removeEquipment(getState(),frameId,item.id);if(error){message(error,true);return;} if (selectedId === item.id) selectedId = null; changed(); }
      return;
    }
    if (!draft) return;
    if (draft.type === 'pipe') {
      const error = draft.autoRoute ? paintPipeRoute(getState(), frameId, pipeAnchor, draft) : putPipe(getState(), draft, frameId);
      if (error) { message(error, true); return; }
      pipeAnchor = { x: draft.x, y: draft.y, z: draft.z }; changed(); message('Труба установлена. Связи обновлены.'); return;
    }
    const error = putEquipment(getState(), frameId, draft, movingId);
    if (error) { if (report) message(error, true); return; }
    if (movingId) { selectedId = movingId; brush = null; draft = null; movingId = null; stroke = null; }
    changed(); message('Блок установлен · Tab — другой блок · Esc — убрать кисть');
  }
  function beginPointer(event, view) {
    if (event.button !== 0 || drag || stroke) return;
    event.preventDefault(); view.canvas.focus({ preventScroll: true });
    pointerView = view; pointerPoint = point(event, view);
    const hit = itemAt(view, pointerPoint), hitPipe = pipeAt(view, pointerPoint), slice = sliceHit(event, view, !brush && !erase && !hit && !hitPipe);
    if (slice >= 0) {
      drag = { kind: 'slice', view, index: slice, pointerId: event.pointerId }; draft = null;
      view.canvas.setPointerCapture(event.pointerId); return;
    }
    if (brush || erase) {
      pipeAnchor = null; stroke = { view, pointerId: event.pointerId, cells: new Set() }; view.canvas.setPointerCapture(event.pointerId); applyBrush(view, pointerPoint); drawAll(); return;
    }
    if (hitPipe) { selectedPipeId = hitPipe.id; selectedId = null; refresh(); message(); return; }
    selectedPipeId = null;
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
    stroke = null; pipeAnchor = null;
    if (view.canvas.hasPointerCapture(event.pointerId)) view.canvas.releasePointerCapture(event.pointerId);
  }
  function rotate() {
    const axis=rotationAxis();
    if (brush?.type === 'pipe') { brush.faces = brush.faces.map(face => rotateFace(face,rotateObject({rotation:0},axis))); if (pointerView && pointerPoint) updateDraft(pointerView, pointerPoint); refresh(); return; }
    if (brush) { brush = rotateObject(brush,axis); if (pointerView && pointerPoint) updateDraft(pointerView, pointerPoint); refresh(); return; }
    if(selectedPipeId){
      const found=findPipe(getState(),selectedPipeId),owner=found?.frameId?getState().objects.find(o=>o.id===found.frameId):null;
      const faces=found.pipe.faces.map(face=>localFace(owner,rotateFace(rotateFace(localFace(frame(),rotateFace(face,owner)),rotateObject({rotation:0},axis)),frame())));
      const error=updatePipeFaces(getState(),selectedPipeId,faces);if(!error)changed();message(error||'Труба повёрнута',!!error);return;
    }
    const item = selected(); if (!item) return;
    const error = putEquipment(getState(), frameId, rotateObject(item,axis), selectedId);
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
    const previous = drag || stroke; draft = null; drag = null; stroke = null; pipeAnchor = null;
    if (previous?.view.canvas.hasPointerCapture(previous.pointerId)) previous.view.canvas.releasePointerCapture(previous.pointerId);
  }
  const close = () => {
    cancelDrag(); screen.hidden = true; wagon.hidden = false; hud.hidden = false;
    document.body.dataset.screen = 'wagon'; onClose();
  };
  $('close-frame-editor').onclick = close;
  window.addEventListener('keydown', event => {
    if (screen.hidden) return;
    if (event.code === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.metaKey) { event.preventDefault(); event.stopImmediatePropagation(); if (!event.repeat) toggleMenu(); return; }
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation();
      if (drag || stroke) { cancelDrag(); drawAll(); }
      else if (menuOpen) toggleMenu();
      else if (brush || erase) clearTool();
      else close();
      return;
    }
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target.isContentEditable || event.ctrlKey || event.metaKey || event.altKey) return;
    const actions = { Backspace: toggleErase, Delete: toggleErase, KeyR: rotate, KeyM: moveSelected };
    if (actions[event.code]) { event.preventDefault(); event.stopImmediatePropagation(); if (!event.repeat) actions[event.code](); }
  });
  return {
    tick(){if(!screen.hidden){productionInspector.refresh();simulationControls.refresh();drawAll();}},
    get isOpen() { return !screen.hidden; },
    open(id) {
      if (!getState().objects.some(item => item.id === id && item.type === 'frame')) return;
      frameId = id; selectedId = null; selectedPipeId = null; pipeAnchor = null; brush = null; erase = false; movingId = null; menuOpen = false; draft = null; drag = null; stroke = null; pointerView = null; pointerPoint = null;
      neighborDetails.open=false; ownSelect.replaceChildren(); neighborSelect.replaceChildren();
      layers.x = layers.y = layers.z = 0;
      const size = localSize(frame());
      for (const [key, input] of Object.entries(brushInputs)) { input.max = size[key] / 4; input.value = Math.min(2, size[key]) / 4; }
      wagon.hidden = true; hud.hidden = true; screen.hidden = false; document.body.dataset.screen = 'editor';
      refresh(true); message(); $('close-frame-editor').focus({ preventScroll: true });
    }, close
  };
}
