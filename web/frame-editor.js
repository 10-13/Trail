import { ensureSimulation, pipeTokens, collectResources } from './simulation.js';
import { createSimulationControls, createProductionInspector, drawProductionGlyph } from './production-ui.js';
import { EQUIPMENT, dimensions, localSize, equipmentPlacementError, putEquipment, removeEquipment, setFrameShelves, updatePorts, putPipe, pipePlacementError, paintPipeRoute, removePipe, findPipe, updatePipeFaces, connectEndpoints, connectShelfLevels, removePipeColumn, pipeColumnIds } from './core.js';
import { rotateObject } from './geometry.js';
import { shelvesOf, shelfForItem, shelfUsage } from './shelves.js';
import { el, numberField, readVoxels } from './ui.js';
import { rotateFace, pipesInFrame, localFace, portsInFrame, neighboringConnections, worldPipe, DIRECTIONS, openPipeEnds, localCell } from './logistics.js';
import { createRotationControl, createPipePalette, createPortsEditor, createPipeInspector, createNetworkPanel, drawProjectedPipe, drawProjectedPort } from './network-ui.js';

const $=id=>document.getElementById(id);
const meter=n=>(n/4).toLocaleString('ru-RU');
export function createFrameEditor({getState,onChange,onClose,onSimulationStep,onSimulationChange,onDemo,demoActive,getSimulationMetrics}){
  const screen=$('frame-editor'),canvas=$('shelf-canvas'),ctx=canvas.getContext('2d'),wagon=$('viewport'),hud=document.querySelector('.hud');
  let frameId=null,shelfId=null,selectedId=null,selectedPipeId=null,brush=null,erase=false,draft=null,pointer=null,stroke=null,drag=null,movingId=null,pipeAnchor=null,continueAnchor=false,connectionStart=null;
  let zoom=1,pan={x:0,y:0},highlightedPipes=new Set(),heightInputs=[],nearby=[],ownConnections=[];
  const view={axes:['x','y'],flip:false,scale:1,ox:0,oy:0,width:1,height:1};
  const inputs={},brushInputs={},frameInputs={};
  const frame=()=>getState().objects.find(o=>o.id===frameId);
  const shelf=()=>shelvesOf(frame()).find(s=>s.id===shelfId)||shelvesOf(frame())[0];
  const selected=()=>frame()?.children.find(o=>o.id===selectedId);
  const message=(text='',error=false)=>{$('editor-message').textContent=text||'Tab — блоки · ⌫ — удаление · PageUp / PageDown — полки · пустое место — перетащить вид';$('editor-message').classList.toggle('error',error);};
  const simulationControls=createSimulationControls($('editor-simulation'),{getState,changed:onSimulationChange,step:onSimulationStep,demo:onDemo,demoActive,getMetrics:getSimulationMetrics});
  const productionInspector=createProductionInspector($('item-production'),{getState,getSelection:()=>!brush&&!erase?(selectedPipeId?{pipeId:selectedPipeId}:selected()?{owner:`${frameId}/${selectedId}`,type:selected().type}:null):null,changed,message});
  const portsEditor=createPortsEditor($('item-ports'),{getObject:()=>!brush&&!erase?selected():null,apply:(ports,next)=>updatePorts(getState(),frameId,selectedId,ports,next),changed,message});
  const localPipes=()=>pipesInFrame(getState(),frame());
  const selectedPipe=()=>localPipes().find(p=>p.id===selectedPipeId);
  function applyFaces(faces){const found=findPipe(getState(),selectedPipeId),owner=found?.frameId?getState().objects.find(o=>o.id===found.frameId):null;return updatePipeFaces(getState(),selectedPipeId,faces.map(f=>localFace(owner,rotateFace(f,frame()))));}
  const pipeInspector=createPipeInspector($('editor-pipe-inspector'),{getPipe:()=>!brush&&!erase?selectedPipe():null,apply:applyFaces,changed,message});
  const rotationAxis=createRotationControl($('editor-rotation'),rotate);
  const networkPanel=createNetworkPanel($('editor-network'),{getState,onHighlight:ids=>{highlightedPipes=ids;draw();}});
  for(const [key,name,max]of [['width','Длина, м',12],['depth','Ширина, м',3],['height','Высота, м',2.5]]){
    const field=numberField(name,`item-${key}`,.5,.25,max);inputs[key]=field.input;$('item-fields').append(field.row);
    const tool=numberField(name,`brush-${key}`,.5,.25,max);brushInputs[key]=tool.input;$('brush-fields').append(tool.row);
    if(key!=='height'){const setting=numberField(name,`edit-frame-${key}`,1,.25,max);frameInputs[key]=setting.input;$('frame-size-fields').append(setting.row);}
  }
  createPipePalette($('editor-pipe-palette'),config=>{brush={...config,z:shelf().z,rotation:0};erase=false;movingId=null;clearSelection();closePopovers();pipeAnchor=null;refresh();message('Веди трубу по полке. Для перехода выбери «Труба ↑» или «Труба ↓».');canvas.focus();});

  const neighbors=el('details','nearby-connections'),neighborSummary=el('summary'),ownSelect=el('select'),neighborSelect=el('select'),connect=el('button','','Проложить соединение');
  ownSelect.setAttribute('aria-label','Подключение этого стеллажа');neighborSelect.setAttribute('aria-label','Соседнее подключение');connect.type='button';connect.dataset.connectFrames='';
  neighbors.append(neighborSummary,ownSelect,neighborSelect,connect);$('neighbor-connections').append(neighbors);
  neighbors.ontoggle=()=>draw();neighborSelect.onchange=()=>draw();
  const toWorld=p=>({...p,cell:worldPipe(frame(),{...p.cell,faces:[]}),neighbor:worldPipe(frame(),{...p.neighbor,faces:[]}),face:rotateFace(p.face,frame())});
  connect.onclick=()=>{const a=ownConnections.find(p=>p.id===ownSelect.value),b=nearby.find(p=>p.id===neighborSelect.value);if(a&&b){const error=connectEndpoints(getState(),toWorld(a),toWorld(b));if(error)message(error,true);else{changed();message('Соединение проложено');}}};
  function refreshNeighbors(){
    nearby=neighboringConnections(getState(),frame());ownConnections=portsInFrame(getState(),frame()).filter(p=>p.frameId===frameId&&onShelf(p.cell.z));
    ownConnections.push(...openPipeEnds(getState()).map(p=>({...p,cell:localCell(frame(),p.cell),neighbor:localCell(frame(),p.neighbor),face:localFace(frame(),p.face)})).filter(p=>p.cell.x>=0&&p.cell.y>=0&&p.cell.x<view.width&&p.cell.y<view.height&&onShelf(p.cell.z)));
    neighborSummary.textContent=`Соседние подключения · ${nearby.length}`;
    for(const [select,points]of [[ownSelect,ownConnections],[neighborSelect,nearby]]){const previous=select.value;select.replaceChildren();for(const p of points){const option=el('option','',`${p.label} · ${p.kind==='input'?'вход':p.kind==='output'?'выход':'труба'} · ${meter(p.cell.z)} м`);option.value=p.id;select.append(option);}if(points.some(p=>p.id===previous))select.value=previous;}
    connect.disabled=!nearby.length||!ownConnections.length;
  }
  function onShelf(z){return z>=shelf().z&&z<shelf().z+shelf().height;}
  function clearSelection(){selectedId=selectedPipeId=null;}
  function closePopovers(){$('editor-menu').hidden=$('shelf-settings').hidden=true;$('editor-menu-button').setAttribute('aria-expanded','false');$('shelf-settings-button').setAttribute('aria-expanded','false');}
  function clearTool(){cancelGesture();brush=draft=null;erase=false;movingId=null;pipeAnchor=null;continueAnchor=false;connectionStart=null;closePopovers();refresh();message();}
  function changed(){onChange();refresh();}
  function switchShelf(id){cancelGesture();shelfId=id;clearSelection();pipeAnchor=null;continueAnchor=false;draft=null;if(brush?.type!=='connect')connectionStart=null;if(brush?.type==='riser')brush=null;refresh();message();}
  function stepShelf(delta){const all=shelvesOf(frame()),index=all.findIndex(s=>s.id===shelf().id),next=all[index+delta];if(next)switchShelf(next.id);}
  function refresh(){
    if(!frame())return;
    const all=shelvesOf(frame());if(!all.some(s=>s.id===shelfId))shelfId=all[0].id;
    const active=shelf(),size=localSize(frame()),usage=shelfUsage(frame(),active,localPipes());view.width=size.width;view.height=size.depth;
    $('rack-title').textContent=`Стеллаж ${frameId.slice(7)}`;
    for(const select of [$('shelf-select'),$('item-shelf-select')]){select.replaceChildren();for(const [i,s]of all.entries()){const option=el('option','',`Полка ${i+1} · ${meter(s.height)} м`);option.value=s.id;select.append(option);}select.value=select.id==='shelf-select'?active.id:(selected()?.shelfId||shelfForItem(frame(),selected()||{z:active.z,type:'pipe'})?.id||active.id);}
    $('shelf-usage').textContent=`Высота ${meter(active.height)} м · свободно ${usage.free} / ${usage.total} ячеек`;
    $('shelf-riser-up').disabled=all.at(-1).id===active.id;$('shelf-riser-down').disabled=all[0].id===active.id;
    for(const [id,direction]of [['shelf-riser-up',1],['shelf-riser-down',-1]])$(id).classList.toggle('active',brush?.type==='riser'&&brush.direction===direction);
    $('editor-erase').classList.toggle('active',erase);$('editor-erase').setAttribute('aria-pressed',erase);
    const item=selected();$('item-form').hidden=!item||!!brush||erase;
    $('shelf-inspector').hidden=(!item&&!selectedPipeId)||!!brush||erase;
    if(item){$('item-title').textContent=EQUIPMENT[item.type].name;for(const [key,input]of Object.entries(inputs))input.value=item[key]/4;}
    for(const [key,input]of Object.entries(brushInputs)){input.max=(key==='height'?active.height:key==='width'?size.width:size.depth)/4;if(input.valueAsNumber>Number(input.max))input.value=input.max;}
    $('collect-column').hidden=!selectedPipe()?.faces.some(f=>f==='nz'||f==='pz');
    productionInspector.refresh();portsEditor.refresh();pipeInspector.refresh();simulationControls.refresh();refreshNeighbors();networkPanel.refresh();draw();
  }
  function toggleMenu(){const opening=$('editor-menu').hidden;closePopovers();$('editor-menu').hidden=!opening;$('editor-menu-button').setAttribute('aria-expanded',opening);if(opening)$('close-editor-menu').focus();else canvas.focus();}
  function settings(){const opening=$('shelf-settings').hidden;closePopovers();$('shelf-settings').hidden=!opening;$('shelf-settings-button').setAttribute('aria-expanded',opening);if(opening){for(const [k,input]of Object.entries(frameInputs))input.value=frame()[k]/4;$('edit-frame-mount').value=frame().mount;renderHeights(shelvesOf(frame()).map(s=>s.height));}}
  function renderHeights(heights){$('shelf-height-fields').replaceChildren();heightInputs=[];for(const [i,h]of heights.entries()){const field=numberField(`Полка ${i+1}, м`,`shelf-height-${i+1}`,h/4,.25,2.5);field.input.oninput=heightTotal;heightInputs.push(field.input);$('shelf-height-fields').append(field.row);}heightTotal();}
  function heightTotal(){const total=heightInputs.reduce((n,i)=>n+(i.valueAsNumber||0),0);$('shelf-height-total').textContent=`Общая высота: ${total.toLocaleString('ru-RU')} / 2,5 м`;$('remove-shelf').disabled=heightInputs.length<2;$('add-shelf').disabled=heightInputs.length>=10;}
  $('add-shelf').onclick=()=>{try{const h=heightInputs.map(readVoxels),last=h.pop();if(last>=2){const lower=Math.ceil(last/2);h.push(lower,last-lower);}else if(h.reduce((a,b)=>a+b,0)+2<=10)h.push(1,1);else{message('Увеличь высоту верхней полки, чтобы разделить её',true);return;}renderHeights(h);}catch(error){message(error.message,true);}};
  $('remove-shelf').onclick=()=>{try{const h=heightInputs.map(readVoxels);if(h.length>1){const last=h.pop();h[h.length-1]+=last;renderHeights(h);}}catch(error){message(error.message,true);}};
  $('frame-form').onsubmit=event=>{event.preventDefault();try{const heights=heightInputs.map(readVoxels);if(heights.reduce((a,b)=>a+b,0)>10){message('Стеллаж должен помещаться в высоту 2,5 м',true);return;}const params={mount:$('edit-frame-mount').value};for(const [k,input]of Object.entries(frameInputs))params[k]=readVoxels(input);const error=setFrameShelves(getState(),frameId,heights,params);if(error)message(error,true);else{changed();closePopovers();message('Разметка полок сохранена');}}catch(error){message(error.message,true);}};
  function choose(type){try{const size=Object.fromEntries(Object.entries(brushInputs).map(([k,input])=>[k,readVoxels(input)]));size.height=Math.min(size.height,shelf().height);brush={type,...size,rotation:0,z:shelf().z,shelfId:shelf().id};erase=false;movingId=null;clearSelection();draft=null;closePopovers();refresh();message('Нажимай или веди кисть по полке. R — повернуть.');canvas.focus();}catch(error){message(error.message,true);}}
  for(const button of document.querySelectorAll('[data-equipment-type]'))button.onclick=()=>choose(button.dataset.equipmentType);
  function chooseRiser(direction){brush={type:'riser',direction};erase=false;movingId=null;clearSelection();draft=null;closePopovers();refresh();message(`Нажми, где труба должна перейти на полку ${direction>0?'выше':'ниже'}`);canvas.focus();}
  function toggleErase(){cancelGesture();erase=!erase;brush=draft=null;movingId=null;clearSelection();closePopovers();pipeAnchor=null;continueAnchor=false;refresh();message(erase?'Нажимай на блоки и трубы для удаления':'');canvas.focus();}
  function updateDraft(){
    if(!brush||!pointer||brush.type==='connect'){draft=null;return;}
    if(brush.type==='riser'||brush.type==='pipe')draft={...brush,x:Math.floor(pointer.x),y:Math.floor(pointer.y),z:shelf().z};
    else{const size=dimensions(brush);draft={...brush,x:Math.floor(pointer.x-size.width/2+1e-8),y:Math.floor(pointer.y-size.depth/2+1e-8),z:shelf().z,shelfId:shelf().id};}
  }
  function draftError(){if(!draft)return '';if(draft.type==='riser')return connectShelfLevels(getState(),frameId,shelfId,draft.x,draft.y,draft.direction,true);if(draft.type==='pipe')return draft.autoRoute?paintPipeRoute(getState(),frameId,pipeAnchor,draft,true):pipePlacementError(getState(),draft,frameId);return equipmentPlacementError(getState(),frameId,draft,movingId||selectedId);}
  function itemAt(p){return [...frame().children].reverse().find(item=>{const d=dimensions(item);return item.z<shelf().z+shelf().height&&item.z+d.height>shelf().z&&p.x>=item.x&&p.y>=item.y&&p.x<item.x+d.width&&p.y<item.y+d.depth;});}
  function pipeAt(p){return localPipes().filter(pipe=>onShelf(pipe.z)&&pipe.x===Math.floor(p.x)&&pipe.y===Math.floor(p.y)).sort((a,b)=>Number(b.z===shelf().z)-Number(a.z===shelf().z)||a.z-b.z)[0];}
  function portAt(p){const candidates=portsInFrame(getState(),frame()).filter(port=>port.frameId===frameId&&onShelf(port.cell.z));return candidates.find(port=>{const v=DIRECTIONS[port.face];return Math.hypot(port.cell.x+.5+v[0]/2-p.x,port.cell.y+.5+v[1]/2-p.y)<Math.max(.25,9/view.scale);});}
  function applyBrush(){
    updateDraft();const key=draft?`${draft.x},${draft.y},${draft.z}`:`${Math.floor(pointer.x)},${Math.floor(pointer.y)}`;if(stroke?.cells.has(key))return;stroke?.cells.add(key);
    if(erase){const pipe=pipeAt(pointer);if(pipe){const error=pipe.faces.some(f=>f==='nz'||f==='pz')?removePipeColumn(getState(),pipe.id,frameId):removePipe(getState(),pipe.id);if(error)message(error,true);else changed();return;}const item=itemAt(pointer);if(item){const error=removeEquipment(getState(),frameId,item.id);if(error)message(error,true);else changed();}return;}
    if(!draft)return;
    if(draft.type==='riser'){
      const error=connectShelfLevels(getState(),frameId,shelfId,draft.x,draft.y,draft.direction);if(error){message(error,true);return;}
      const all=shelvesOf(frame()),target=all[all.findIndex(s=>s.id===shelfId)+draft.direction];shelfId=target.id;pipeAnchor={x:draft.x,y:draft.y,z:target.z};continueAnchor=true;brush={type:'pipe',autoRoute:true,faces:['nx','px'],rotation:0};draft=null;stroke=null;changed();message('Переход готов. Продолжи трубу на этой полке.');return;
    }
    const error=draft.type==='pipe'?(draft.autoRoute?paintPipeRoute(getState(),frameId,pipeAnchor,draft):putPipe(getState(),draft,frameId)):putEquipment(getState(),frameId,draft,movingId);
    if(error){message(error,true);return;}
    if(draft.type==='pipe')pipeAnchor={x:draft.x,y:draft.y,z:draft.z};
    if(movingId){selectedId=movingId;brush=draft=null;movingId=null;stroke=null;}
    changed();message('Установлено');
  }
  function point(event){const r=canvas.getBoundingClientRect();return{x:(event.clientX-r.left-view.ox)/view.scale,y:(event.clientY-r.top-view.oy)/view.scale};}
  canvas.addEventListener('pointerdown',event=>{
    if(event.button!==0&&event.button!==1)return;event.preventDefault();canvas.focus();pointer=point(event);
    if(event.button===1){drag={kind:'pan',start:{x:event.clientX,y:event.clientY},pan:{...pan},pointerId:event.pointerId};canvas.setPointerCapture(event.pointerId);return;}
    if(brush?.type==='connect'){const port=portAt(pointer);if(!port){message('Нажми на цветной порт блока',true);return;}if(!connectionStart){connectionStart=port;message('Теперь выбери второй порт на этой или другой полке');}else{const start=portsInFrame(getState(),frame()).find(p=>p.id===connectionStart.id);if(!start){connectionStart=null;message('Первый порт изменился. Выбери его снова',true);return;}const error=connectEndpoints(getState(),toWorld(start),toWorld(port));if(error)message(error,true);else{connectionStart=null;changed();message('Блоки соединены');}}draw();return;}
    if(brush||erase){if(!continueAnchor)pipeAnchor=null;continueAnchor=false;stroke={cells:new Set(),pointerId:event.pointerId};canvas.setPointerCapture(event.pointerId);applyBrush();draw();return;}
    const pipe=pipeAt(pointer),item=itemAt(pointer);if(pipe){selectedPipeId=pipe.id;selectedId=null;refresh();return;}
    selectedPipeId=null;
    if(item){selectedId=item.id;drag={kind:'item',original:{...item},start:{...pointer},pointerId:event.pointerId};refresh();}
    else{clearSelection();drag={kind:'pan',start:{x:event.clientX,y:event.clientY},pan:{...pan},pointerId:event.pointerId};refresh();}
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove',event=>{
    pointer=point(event);
    if(drag?.kind==='pan'){pan={x:drag.pan.x+event.clientX-drag.start.x,y:drag.pan.y+event.clientY-drag.start.y};draw();return;}
    if(drag?.kind==='item'){draft={...drag.original,x:drag.original.x+Math.round(pointer.x-drag.start.x),y:drag.original.y+Math.round(pointer.y-drag.start.y),z:shelf().z,shelfId:shelfId};const error=equipmentPlacementError(getState(),frameId,draft,selectedId);message(error||'Отпусти, чтобы переместить',!!error);draw();return;}
    if(stroke&&(event.buttons&1))applyBrush();else updateDraft();canvas.style.cursor=brush||erase?'crosshair':itemAt(pointer)?'move':'grab';draw();
  });
  function endPointer(event){if(drag?.kind==='item'&&draft){const error=putEquipment(getState(),frameId,draft,selectedId);if(error)message(error,true);else{onChange();message('Блок перемещён');}}drag=null;draft=null;stroke=null;if(!continueAnchor)pipeAnchor=null;if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);refresh();}
  canvas.addEventListener('pointerup',endPointer);canvas.addEventListener('pointercancel',()=>{cancelGesture();draw();});canvas.addEventListener('lostpointercapture',()=>{if(drag||stroke){cancelGesture();draw();}});canvas.addEventListener('pointerleave',()=>{if(!drag&&!stroke){draft=null;draw();}});canvas.addEventListener('contextmenu',event=>{event.preventDefault();clearTool();});
  function cancelGesture(){const id=drag?.pointerId||stroke?.pointerId;drag=stroke=draft=null;if(id!==undefined&&canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);}
  function setZoom(value,anchor=null){const old=view.scale;zoom=Math.max(.5,Math.min(6,value));draw();if(anchor){pan.x+=(anchor.x-view.width/2)*(old-view.scale);pan.y+=(anchor.y-view.height/2)*(old-view.scale);draw();}}
  canvas.addEventListener('wheel',event=>{event.preventDefault();setZoom(zoom*(event.deltaY<0?1.2:1/1.2),point(event));},{passive:false});
  $('shelf-zoom-in').onclick=()=>setZoom(zoom*1.35);$('shelf-zoom-out').onclick=()=>setZoom(zoom/1.35);$('shelf-fit').onclick=()=>{zoom=1;pan={x:0,y:0};draw();};
  function rotate(){const axis=rotationAxis();if(brush?.type==='pipe'){brush.faces=brush.faces.map(f=>rotateFace(f,rotateObject({rotation:0},axis)));updateDraft();refresh();return;}if(brush&&brush.type!=='riser'&&brush.type!=='connect'){brush=rotateObject(brush,axis);updateDraft();refresh();return;}if(selectedPipeId){const error=applyFaces(selectedPipe().faces.map(f=>rotateFace(f,rotateObject({rotation:0},axis))));if(error)message(error,true);else changed();return;}const item=selected();if(item){const error=putEquipment(getState(),frameId,{...rotateObject(item,axis),z:shelf().z,shelfId},item.id);if(error)message(error,true);else changed();}}
  function moveSelected(){if(!selected())return;brush={...selected()};movingId=selectedId;erase=false;draft=null;refresh();message('Выбери место на этой или другой полке');}
  $('item-form').onsubmit=event=>{event.preventDefault();const item=selected();if(!item)return;try{const candidate={...item,z:shelf().z,shelfId};for(const [key,input]of Object.entries(inputs))candidate[key]=readVoxels(input);const error=putEquipment(getState(),frameId,candidate,item.id);if(error)message(error,true);else{changed();message('Размеры применены');}}catch(error){message(error.message,true);}};
  $('item-shelf-select').onchange=()=>{const item=selected(),target=shelvesOf(frame()).find(s=>s.id===$('item-shelf-select').value);if(!item||!target)return;const error=putEquipment(getState(),frameId,{...item,z:target.z,shelfId:target.id},item.id);if(error){refresh();message(error,true);}else{shelfId=target.id;changed();message('Блок перенесён на полку');}};
  $('collect-column').onclick=()=>{for(const id of pipeColumnIds(getState(),selectedPipeId,frameId))if(pipeTokens(getState(),id).length)collectResources(getState(),id);changed();message('Содержимое перехода возвращено в запас');};
  $('item-move').onclick=moveSelected;$('item-delete').onclick=toggleErase;$('editor-erase').onclick=toggleErase;$('editor-rotate').onclick=rotate;
  $('editor-menu-button').onclick=toggleMenu;$('close-editor-menu').onclick=toggleMenu;$('shelf-settings-button').onclick=settings;$('close-shelf-settings').onclick=()=>closePopovers();$('shelf-select').onchange=()=>switchShelf($('shelf-select').value);
  $('shelf-riser-up').onclick=()=>chooseRiser(1);$('shelf-riser-down').onclick=()=>chooseRiser(-1);$('close-shelf-inspector').onclick=()=>{clearSelection();refresh();};
  $('connect-ports-tool').onclick=()=>{brush={type:'connect'};erase=false;clearSelection();closePopovers();connectionStart=null;refresh();message('Выбери выход, затем вход. Труба проложится автоматически.');};
  function draw(){
    if(screen.hidden||!frame())return;const area=canvas.getBoundingClientRect();if(!area.width||!area.height)return;
    const dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(area.width*dpr);canvas.height=Math.round(area.height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);
    const size=localSize(frame());view.width=size.width;view.height=size.depth;view.scale=Math.max(2,Math.min((area.width-64)/size.width,(area.height-64)/size.depth)*zoom);view.ox=(area.width-size.width*view.scale)/2+pan.x;view.oy=(area.height-size.depth*view.scale)/2+pan.y;
    const {scale,ox,oy}=view,right=ox+size.width*scale,bottom=oy+size.depth*scale;
    ctx.fillStyle='#111c23';ctx.fillRect(0,0,area.width,area.height);ctx.fillStyle='#16232a';ctx.fillRect(ox,oy,size.width*scale,size.depth*scale);
    ctx.strokeStyle='#34454d';ctx.lineWidth=.5;ctx.beginPath();for(let x=1;x<size.width;x++){ctx.moveTo(ox+x*scale,oy);ctx.lineTo(ox+x*scale,bottom);}for(let y=1;y<size.depth;y++){ctx.moveTo(ox,oy+y*scale);ctx.lineTo(right,oy+y*scale);}ctx.stroke();
    ctx.strokeStyle='#b9a270';ctx.lineWidth=1;ctx.strokeRect(ox,oy,size.width*scale,size.depth*scale);
    const objects=frame().children.filter(item=>item.z<shelf().z+shelf().height&&item.z+dimensions(item).height>shelf().z).sort((a,b)=>Number(a.id===selectedId)-Number(b.id===selectedId));
    for(const item of objects){const box=boxFor(item),color=EQUIPMENT[item.type].color;ctx.save();ctx.globalAlpha=(drag?.kind==='item'&&item.id===selectedId)? .2 : 1;ctx.fillStyle=`${color}36`;ctx.strokeStyle=item.id===selectedId?'#edf4f6':color;ctx.lineWidth=item.id===selectedId?2:1;ctx.fillRect(box.x+1,box.y+1,box.width-2,box.height-2);ctx.strokeRect(box.x+1,box.y+1,box.width-2,box.height-2);drawProductionGlyph(ctx,item.type,box,ensureSimulation(getState()).containers[`${frameId}/${item.id}`]);if(scale>=23&&box.width>=58){ctx.fillStyle=color;ctx.font='10px monospace';ctx.textAlign='center';ctx.fillText(EQUIPMENT[item.type].short,box.x+box.width/2,box.y+box.height-8);}ctx.restore();}
    const allLocalPipes=localPipes(),pipeCells=new Map(allLocalPipes.map(p=>[`${p.x},${p.y},${p.z}`,p])),buckets=new Map();for(const p of allLocalPipes.filter(p=>onShelf(p.z))){const key=`${p.x},${p.y}`;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(p);}
    for(const list of buckets.values()){
      const p=list.find(p=>p.id===selectedPipeId)||list.find(p=>p.z===shelf().z)||list[0];
      drawProjectedPipe(ctx,p,view,{highlight:list.some(p=>highlightedPipes.has(p.id)||p.id===selectedPipeId),contents:list.flatMap(p=>pipeTokens(getState(),p.id)).slice(0,4)});
      const up=list.some(p=>p.faces.includes('pz')&&p.z===shelf().z+shelf().height-1&&pipeCells.get(`${p.x},${p.y},${p.z+1}`)?.faces.includes('nz')),down=list.some(p=>p.faces.includes('nz')&&p.z===shelf().z&&pipeCells.get(`${p.x},${p.y},${p.z-1}`)?.faces.includes('pz'));
      if(up||down){const x=ox+(p.x+.5)*scale,y=oy+(p.y+.5)*scale;ctx.fillStyle='#d6eee8';ctx.font=`bold ${Math.max(10,Math.min(16,scale*.5))}px monospace`;ctx.textAlign='center';ctx.fillText(up&&down?'↕':up?'↑':'↓',x,y+Math.min(6,scale*.2));}
    }
    for(const port of portsInFrame(getState(),frame()).filter(p=>p.frameId===frameId&&onShelf(p.cell.z)))drawProjectedPort(ctx,port,view,port.attached||port.id===connectionStart?.id);
    if(neighbors.open)for(const [index,port]of nearby.entries()){
      const cell={...port.cell},vector=DIRECTIONS[port.face];cell.x=Math.max(-.5-vector[0]/2,Math.min(size.width-.5-vector[0]/2,cell.x));cell.y=Math.max(-.5-vector[1]/2,Math.min(size.depth-.5-vector[1]/2,cell.y));
      ctx.save();ctx.globalAlpha=port.id===neighborSelect.value?1:.35;drawProjectedPort(ctx,{...port,cell},view,port.attached);ctx.fillStyle='#d3dcdf';ctx.font='10px monospace';ctx.textAlign='left';ctx.fillText(String(index+1),ox+(cell.x+.5)*scale+5,oy+(cell.y+.5)*scale-5);ctx.restore();
    }
    if(draft){const error=draftError();if(draft.type==='pipe')drawProjectedPipe(ctx,draft,view,{preview:true,error:!!error});else if(draft.type==='riser'){const x=ox+draft.x*scale,y=oy+draft.y*scale;ctx.strokeStyle=error?'#ed8275':'#8ed8bf';ctx.lineWidth=2;ctx.strokeRect(x+2,y+2,scale-4,scale-4);ctx.fillStyle=ctx.strokeStyle;ctx.font=`${Math.max(12,scale*.55)}px monospace`;ctx.textAlign='center';ctx.fillText(draft.direction>0?'↑':'↓',x+scale/2,y+scale*.72);}else{const box=boxFor(draft);ctx.fillStyle=error?'#ed827540':'#8ed8bf40';ctx.strokeStyle=error?'#ed8275':'#8ed8bf';ctx.fillRect(box.x+1,box.y+1,box.width-2,box.height-2);ctx.strokeRect(box.x+1,box.y+1,box.width-2,box.height-2);}}
  }
  function boxFor(item){const d=dimensions(item);return{x:view.ox+item.x*view.scale,y:view.oy+item.y*view.scale,width:d.width*view.scale,height:d.depth*view.scale};}
  function close(){cancelGesture();screen.hidden=true;wagon.hidden=false;hud.hidden=false;document.body.dataset.screen='wagon';onClose();}
  $('close-frame-editor').onclick=close;
  window.addEventListener('keydown',event=>{
    if(screen.hidden)return;
    if(event.code==='Tab'&&!event.shiftKey&&!event.ctrlKey&&!event.metaKey){event.preventDefault();event.stopImmediatePropagation();if(!event.repeat)toggleMenu();return;}
    if(event.code==='Escape'){event.preventDefault();event.stopImmediatePropagation();if(drag||stroke){cancelGesture();draw();}else if(!$('editor-menu').hidden||!$('shelf-settings').hidden)closePopovers();else if(brush||erase)clearTool();else if(selectedId||selectedPipeId){clearSelection();refresh();}else close();return;}
    if(event.target instanceof HTMLInputElement||event.target instanceof HTMLSelectElement||event.target.isContentEditable||event.ctrlKey||event.metaKey||event.altKey)return;
    const actions={Backspace:toggleErase,Delete:toggleErase,KeyR:rotate,KeyM:moveSelected,PageUp:()=>stepShelf(1),PageDown:()=>stepShelf(-1)};
    if(actions[event.code]){event.preventDefault();event.stopImmediatePropagation();if(!event.repeat)actions[event.code]();}
  });
  new ResizeObserver(draw).observe(canvas);
  new ResizeObserver(()=>{screen.style.setProperty('--shelf-popover-top',`${document.querySelector('.shelf-toolbar').getBoundingClientRect().height+8}px`);draw();}).observe(document.querySelector('.shelf-toolbar'));
  return{
    tick(){if(!screen.hidden){productionInspector.refresh();simulationControls.refresh();draw();}},
    get isOpen(){return !screen.hidden;},
    open(id){if(!getState().objects.some(o=>o.id===id&&o.type==='frame'))return;frameId=id;shelfId=shelvesOf(frame())[0].id;clearSelection();brush=draft=drag=stroke=null;erase=false;movingId=null;pipeAnchor=null;continueAnchor=false;connectionStart=null;zoom=1;pan={x:0,y:0};closePopovers();neighbors.open=false;
      for(const [key,input]of Object.entries(brushInputs))input.value=Math.min(2,key==='height'?shelf().height:localSize(frame())[key])/4;
      wagon.hidden=true;hud.hidden=true;screen.hidden=false;document.body.dataset.screen='editor';refresh();message();$('close-frame-editor').focus();
    },close
  };
}
