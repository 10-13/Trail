import { RESOURCES } from './simulation.js';
import { el, numberField, readVoxels } from './ui.js';
import { DIRECTIONS, FACE_NAMES, OPPOSITE, portLimits, portsOf, PIPE_CAPACITY } from './logistics.js';

const SHAPES = { route: ['nx','px'], straight: ['nx','px'], corner: ['nx','py'], vertical: ['nz','pz'], custom: ['nx','px'] };
const SHAPE_NAMES = { route: 'Маршрут кистью', straight: 'Прямой участок', corner: 'Поворот', vertical: 'Вертикальный', custom: 'Свои грани' };
export function createRotationControl(host, rotate) {
  const row=el('div','tool-row rotation-tools'), label=el('label','','Ось '), select=el('select');
  select.setAttribute('aria-label','Ось вращения'); select.dataset.rotationAxis='';
  for(const [value,name] of [['z','Z · вертикаль'],['x','X · вдоль'],['y','Y · поперёк']]){const option=el('option','',name);option.value=value;select.append(option);}
  label.append(select);const button=el('button','','Повернуть · R');button.type='button';button.dataset.rotateActive='';button.onclick=()=>rotate();
  row.append(label,button);host.append(row);return ()=>select.value;
}
export function createPipePalette(host, onChoose) {
  const details = el('details', 'pipe-palette'); details.open = true;
  details.append(el('summary', '', 'Трубы'));
  const label = el('label', 'field'); label.append(el('span','field-label','Элемент'));
  const select = el('select'); select.setAttribute('aria-label','Форма трубы'); select.dataset.pipeShape = '';
  for (const [key, name] of Object.entries(SHAPE_NAMES)) { const option=el('option','',name); option.value=key; select.append(option); }
  label.append(select); details.append(label);
  const faces=el('div','face-options'), checks={};
  for (const face of Object.keys(DIRECTIONS)) {
    const row=el('label'), input=el('input'); input.type='checkbox'; input.value=face; input.dataset.pipeFace=face;
    row.append(input,el('span','',FACE_NAMES[face])); faces.append(row); checks[face]=input;
    input.onchange=()=>{select.value='custom';};
  }
  details.append(faces);
  const sync=()=>{ const shape=SHAPES[select.value]; faces.hidden=select.value==='route'; for(const [face,input] of Object.entries(checks)) input.checked=shape.includes(face); };
  select.onchange=sync; sync();
  details.append(el('p','muted','Маршрут соединяет нарисованные подряд ячейки. Для продолжения начни с конца трубы. Концы остаются прямыми. Пересечение и третье направление запрещены.'));
  const button=el('button','','Труба · 0,25 м'); button.type='button'; button.dataset.pipeChoose='';
  button.onclick=()=>onChoose({type:'pipe',faces:Object.entries(checks).filter(([,input])=>input.checked).map(([face])=>face),autoRoute:select.value==='route'});
  details.append(button); host.append(details);
}
export function createPortsEditor(host, { getObject, apply, changed, message }) {
  const details=el('details','ports-editor'); details.append(el('summary','','Порты'));
  const rows=el('div'), tools=el('div','tool-row');
  for(const kind of ['input','output']) {
    const button=el('button','',kind==='input'?'+ Вход':'+ Выход'); button.type='button';
    button.onclick=()=>{
      const object=getObject(); if(!object)return;
      const ports=portsOf(object).map(p=>({...p}));
      for(const face of Object.keys(DIRECTIONS)) {
        const [uMax,vMax]=portLimits(object,face);
        for(let v=0;v<vMax;v++) for(let u=0;u<uMax;u++) if(!ports.some(p=>p.face===face&&p.u===u&&p.v===v)) {
          const next=object.nextPortId??3;
          commit([...ports,{id:`port-${next}`,kind,face,u,v}],next+1); return;
        }
      }
      message('На гранях нет свободного места для порта',true);
    }; tools.append(button);
  }
  details.append(rows,tools,el('p','muted','Грани и сдвиги заданы до поворота блока.')); host.append(details);
  function commit(ports,next) { const error=apply(ports,next); if(error)message(error,true); else {changed();message('Порты обновлены');} }
  function refresh() {
    const object=getObject(); details.hidden=!object; if(!object)return;
    rows.replaceChildren();
    for(const port of portsOf(object)) {
      const row=el('div','port-row'); row.dataset.portId=port.id;
      const kind=el('select'); kind.setAttribute('aria-label','Тип порта');
      for(const [key,name] of [['input','Вход'],['output','Выход']]){const option=el('option','',name);option.value=key;kind.append(option);} kind.value=port.kind;
      const face=el('select'); face.setAttribute('aria-label','Грань порта');
      for(const [key,name] of Object.entries(FACE_NAMES)){const option=el('option','',name);option.value=key;face.append(option);} face.value=port.face;
      const resource=el('select');resource.setAttribute('aria-label','Ресурс порта');
      for(const [key,name]of [['','Все ресурсы'],...Object.entries(RESOURCES).map(([r,d])=>[r,d.name])]){const option=el('option','',name);option.value=key;resource.append(option);}
      if(port.resources?.length>1){const option=el('option','','Несколько ресурсов');option.value=port.resources.join(',');resource.append(option);}resource.value=(port.resources||[]).join(',');
      const [a,b]=portLimits(object,port.face);
      const u=numberField('Сдвиг 1, м',`${host.id}-${port.id}-u`,port.u/4,0,(a-1)/4);
      const v=numberField('Сдвиг 2, м',`${host.id}-${port.id}-v`,port.v/4,0,(b-1)/4);
      const coordinates=()=>{const [a,b]=portLimits(object,face.value);u.input.max=(a-1)/4;v.input.max=(b-1)/4;};face.onchange=coordinates;
      const save=el('button','','Применить'), remove=el('button','danger','×'); save.type=remove.type='button';remove.setAttribute('aria-label','Удалить порт');
      save.onclick=()=>{try{commit(portsOf(object).map(p=>p.id===port.id?{...p,kind:kind.value,face:face.value,resources:resource.value?resource.value.split(','):[],u:readVoxels(u.input),v:readVoxels(v.input)}:{...p}),object.nextPortId??3);}catch(error){message(error.message,true);}};
      remove.onclick=()=>commit(portsOf(object).filter(p=>p.id!==port.id),object.nextPortId??3);
      row.append(kind,face,resource,u.row,v.row,save,remove);rows.append(row);
    }
  }
  return { refresh };
}
export function createNetworkPanel(host, { getState, onHighlight }) {
  const details=el('details','network-panel panel'), summary=el('summary','','Связи: 0'), body=el('div','network-links');
  details.append(summary,body);host.append(details);let highlighted=null;
  function refresh() {
    const focused=body.contains(document.activeElement)?document.activeElement.dataset.networkLink:null;
    const graph=getState().graph;summary.textContent=`Связи: ${graph.links.length} · трубы: ${graph.pipes.length}`;body.replaceChildren();
    if(!graph.links.some(link=>link.id===highlighted)){highlighted=null;onHighlight(new Set());}
    else onHighlight(new Set(graph.links.find(link=>link.id===highlighted).pipeIds));
    if(!graph.links.length)body.append(el('p','muted','Нет пути от выхода ко входу. Проверь грани труб и направления портов.'));
    for(const link of graph.links){
      const button=el('button',highlighted===link.id?'active':'',`${link.fromLabel} → ${link.toLabel}`);button.type='button';button.dataset.networkLink=link.id;
      button.title=`${link.source} → ${link.target}; участков: ${link.pipeIds.length}`;
      button.onclick=()=>{highlighted=highlighted===link.id?null:link.id;refresh();};body.append(button);if(focused===link.id)button.focus({preventScroll:true});
    }
    const dangling=graph.ports.filter(port=>!port.attached).length;
    if(dangling)body.append(el('p','muted',`Неподключённых портов: ${dangling}`));
  }
  return {refresh};
}
export function createPipeInspector(host,{getPipe,apply,changed,message}) {
  const wrapper=el('div','pipe-inspector'), label=el('p','muted'), options=el('div','face-options'), checks={};
  for(const face of Object.keys(DIRECTIONS)){const row=el('label'),input=el('input');input.type='checkbox';input.value=face;row.append(input,el('span','',FACE_NAMES[face]));options.append(row);checks[face]=input;}
  const button=el('button','','Применить грани');button.type='button';button.onclick=()=>{const pipe=getPipe();if(!pipe)return;const error=apply(Object.entries(checks).filter(([,input])=>input.checked).map(([face])=>face));if(error)message(error,true);else{changed();message('Грани трубы обновлены');}};
  wrapper.append(label,options,button);host.append(wrapper);
  return {refresh(){const pipe=getPipe();wrapper.hidden=!pipe;if(!pipe)return;label.textContent=`Труба · вместимость ${PIPE_CAPACITY} ед. · высота ${((pipe.worldZ??pipe.z)/4).toLocaleString('ru-RU')} м${pipe.rackIds?` · соединение стеллажей ${pipe.rackIds.map(id=>id.slice(7)).join(' ↔ ')}`:''}`;for(const [face,input] of Object.entries(checks))input.checked=pipe.faces.includes(face);}};
}
export function drawProjectedPipe(ctx,pipe,view,{alpha=1,highlight=false,preview=false,error=false,contents=[]}={}) {
  const scale=view.scale,x=view.ox+(pipe[view.axes[0]]+.5)*scale,y=view.oy+(view.flip?view.height-pipe[view.axes[1]]-.5:pipe[view.axes[1]]+.5)*scale;
  const color=error?'#ed8275':highlight?'#f0d888':preview?'#b5cd8b':'#77c8bc';ctx.save();ctx.globalAlpha*=alpha;ctx.strokeStyle=color;ctx.fillStyle=color;
  ctx.lineWidth=Math.max(scale*.14,view.unit?0.08:2);ctx.lineCap='round';
  ctx.fillStyle=`${color}20`;ctx.fillRect(x-scale*.5,y-scale*.5,scale,scale);ctx.fillStyle=color;
  for(const face of pipe.faces){const vector=DIRECTIONS[face],dx=vector[{x:0,y:1,z:2}[view.axes[0]]],dy=vector[{x:0,y:1,z:2}[view.axes[1]]]*(view.flip?-1:1);ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+dx*scale*.5,y+dy*scale*.5);ctx.stroke();}
  ctx.beginPath();ctx.arc(x,y,scale*.17,0,Math.PI*2);ctx.fill();
  for(const [i,token]of contents.entries()){
    const def=RESOURCES[token.resource],r=scale*.105,cx=x+(i%2?1:-1)*scale*.15,cy=y+(i<2?-1:1)*scale*.15;
    ctx.fillStyle=def.color;ctx.beginPath();
    if(def.shape==='circle')ctx.arc(cx,cy,r,0,Math.PI*2);
    else if(def.shape==='diamond'){ctx.moveTo(cx,cy-r);ctx.lineTo(cx+r,cy);ctx.lineTo(cx,cy+r);ctx.lineTo(cx-r,cy);ctx.closePath();}
    else if(def.shape==='triangle'){ctx.moveTo(cx,cy-r);ctx.lineTo(cx+r,cy+r);ctx.lineTo(cx-r,cy+r);ctx.closePath();}
    else ctx.rect(cx-r,cy-r,r*2,r*2);ctx.fill();
  }
  if(preview||highlight){ctx.lineWidth=view.unit ? .04 : 1;ctx.strokeRect(x-scale*.46,y-scale*.46,scale*.92,scale*.92);}ctx.restore();
}
export function drawProjectedPort(ctx,port,view,attached=false) {
  const vector=DIRECTIONS[port.face],a={x:0,y:1,z:2}[view.axes[0]],b={x:0,y:1,z:2}[view.axes[1]],scale=view.scale;
  const x=view.ox+(port.cell[view.axes[0]]+.5+vector[a]*.5)*scale,y=view.oy+(view.flip?view.height-port.cell[view.axes[1]]-.5-vector[b]*.5:port.cell[view.axes[1]]+.5+vector[b]*.5)*scale;
  ctx.save();ctx.fillStyle=port.kind==='output'?'#e5b676':'#86cde2';ctx.strokeStyle=attached?'#f3f2d7':'#34454d';ctx.lineWidth=view.unit ? .035 : 1;
  const r=scale*.14;ctx.fillRect(x-r,y-r,r*2,r*2);ctx.strokeRect(x-r,y-r,r*2,r*2);ctx.restore();
}
