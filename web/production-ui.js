import { el } from './ui.js';
import { RESOURCES, RECIPES, ensureSimulation, count, containerCount, pipeTokens, pipeStatus, apparatusStatus, transferInventory, collectResources, configureContainer } from './simulation.js';

function stockChips(host,stock){
  host.replaceChildren();
  for(const [r,n]of Object.entries(stock))if(n){const chip=el('span','resource-chip');chip.title=RESOURCES[r].name;const icon=el('i',`resource-icon ${RESOURCES[r].shape}`);icon.style.background=RESOURCES[r].color;chip.append(icon,el('span','',`${RESOURCES[r].name} ${n}`));host.append(chip);}
  if(!count(stock))host.append(el('span','muted','—'));
}
export function createSimulationControls(host,{getState,changed,step,demo,demoActive}){
  const row=el('div','simulation-controls panel'),toggle=el('button'),single=el('button','','Один такт'),clock=el('span','simulation-clock'),inventory=el('details','inventory'),summary=el('summary'),stock=el('div','resource-stock');
  toggle.type=single.type='button';toggle.dataset.simToggle='';single.dataset.simStep='';toggle.onclick=()=>{const sim=ensureSimulation(getState());sim.running=!sim.running;changed();};single.onclick=step;
  inventory.append(summary,stock);row.append(toggle,single,clock,inventory);
  let sample;if(demo){sample=el('button','','Пример');sample.type='button';sample.dataset.productionDemo='';sample.onclick=demo;row.append(sample);}
  host.append(row);
  return {refresh(){const sim=ensureSimulation(getState());toggle.textContent=sim.running?'Ⅱ Пауза':'▶ Пуск';toggle.setAttribute('aria-pressed',sim.running);single.disabled=sim.running;clock.textContent=`${(sim.tick/4).toLocaleString('ru-RU')} с`;summary.textContent=`Запас · ${count(sim.inventory)}`;stockChips(stock,sim.inventory);if(sample)sample.textContent=demoActive()?'Вернуть схему':'Пример';}};
}
export function createProductionInspector(host,{getState,getSelection,changed,message}){
  const box=el('section','production-inspector'),title=el('h3'),recipe=el('p','muted'),status=el('p','production-status'),progress=el('progress'),buffers=el('div','production-buffers');
  const capacityLabel=el('label','capacity-field','Вместимость '),capacity=el('input');capacity.type='number';capacity.min='1';capacity.max='256';capacity.step='1';capacity.required=true;capacity.setAttribute('aria-label','Вместимость бака');const applyCapacity=el('button','','Применить');applyCapacity.type='button';capacityLabel.append(capacity,applyCapacity);
  const loadRow=el('div','tool-row'),resource=el('select'),load=el('button','','Загрузить 4'),collect=el('button','','Забрать всё'),enabled=el('button');
  resource.setAttribute('aria-label','Ресурс для загрузки');for(const [r,def]of Object.entries(RESOURCES)){const option=el('option','',def.name);option.value=r;resource.append(option);}load.type=collect.type=enabled.type='button';load.dataset.resourceLoad='';collect.dataset.resourceCollect='';enabled.dataset.apparatusToggle='';loadRow.append(resource,load,collect,enabled);
  box.append(title,recipe,status,progress,buffers,capacityLabel,loadRow);host.append(box);
  const commit=error=>{if(error)message(error,true);else{changed();refresh();}};
  load.onclick=()=>commit(transferInventory(getState(),getSelection()?.owner,resource.value));collect.onclick=()=>commit(collectResources(getState(),getSelection()?.owner||getSelection()?.pipeId));
  enabled.onclick=()=>{const owner=getSelection()?.owner,c=ensureSimulation(getState()).containers[owner];if(c)commit(configureContainer(getState(),owner,{enabled:!c.enabled}));};
  applyCapacity.onclick=()=>{if(capacity.reportValidity())commit(configureContainer(getState(),getSelection()?.owner,{capacity:capacity.valueAsNumber}));};
  let previous=null;
  function refresh(){
    const selection=getSelection(),sim=ensureSimulation(getState()),c=selection?.owner&&sim.containers[selection.owner];box.hidden=!c&&!selection?.pipeId;if(box.hidden){previous=null;return;}
    const key=selection.owner||selection.pipeId,pipe=!!selection.pipeId,definition=RECIPES[selection.type];
    title.textContent=pipe?`Труба · ${pipeTokens(getState(),selection.pipeId).length} / 4`:definition?definition.name:`${selection.type==='storage'?'Хранилище':'Бак'} · ${count(c.stored)} / ${c.capacity}`;
    recipe.textContent=definition?`${Object.entries(definition.input).map(([r,n])=>`${n} ${RESOURCES[r].name}`).join(' + ')} → ${Object.entries(definition.output).map(([r,n])=>`${n} ${RESOURCES[r].name}`).join(' + ')} · ${definition.ticks/4} с`:pipe?'Одна ячейка · максимум 4 единицы':'Хранение и передача через порты';
    status.textContent=pipe?pipeStatus(getState(),selection.pipeId):apparatusStatus(getState(),selection.owner);progress.hidden=!definition;progress.max=definition?.ticks||1;progress.value=c?.progress||0;
    capacityLabel.hidden=pipe||!!definition;load.hidden=resource.hidden=enabled.hidden=pipe;enabled.textContent=c?.enabled?'Выключить':'Включить';collect.disabled=pipe?!pipeTokens(getState(),selection.pipeId).length:!containerCount(c);
    if(c&&document.activeElement!==capacity)capacity.value=c.capacity;
    if(previous!==key&&definition)resource.value=Object.keys(definition.input)[0];previous=key;
    buffers.replaceChildren();
    const stocks=pipe?[['Содержимое',pipeTokens(getState(),selection.pipeId).reduce((s,t)=>({...s,[t.resource]:(s[t.resource]||0)+1}),{})]]:definition?[['Вход · / 8',c.input],['Выход · / 8',c.output]]:[['Содержимое',c.stored]];
    for(const [label,stock]of stocks){const row=el('div','buffer-row'),chips=el('div','resource-stock');row.append(el('span','muted',label),chips);stockChips(chips,stock);buffers.append(row);}
  }
  return {refresh};
}
export function drawProductionGlyph(ctx,type,box,container,scale=1){
  if(!['tank','filter','centrifuge','storage'].includes(type))return;
  const x=box.x+box.width/2,y=box.y+box.height/2,r=Math.min(box.width,box.height)*.25;
  ctx.save();ctx.strokeStyle='#dbe9e2';ctx.lineWidth=r*.12;ctx.globalAlpha*=.8;
  if(type==='filter'){ctx.beginPath();ctx.moveTo(x-r,y-r);ctx.lineTo(x+r,y-r);ctx.lineTo(x,y+r);ctx.closePath();ctx.stroke();}
  else {ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.stroke();if(type==='centrifuge'){ctx.beginPath();ctx.moveTo(x-r,y);ctx.lineTo(x+r,y);ctx.moveTo(x,y-r);ctx.lineTo(x,y+r);ctx.stroke();}}
  if(container){const definition=RECIPES[type],ratio=definition?container.progress/definition.ticks:count(container.stored)/container.capacity;
    ctx.fillStyle='#8ed8bf';ctx.fillRect(box.x+box.width*.12,box.y+box.height*.85,box.width*.76*ratio,Math.max(scale*.06,box.height*.045));}
  ctx.restore();
}
