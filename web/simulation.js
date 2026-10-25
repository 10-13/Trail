import { allPipes } from './logistics.js';

export const TICK_SECONDS = .25;
export const RESOURCES = Object.freeze({
  crude: { name: 'Нефть', color: '#d79856', shape: 'circle' },
  filtered: { name: 'Фильтрат', color: '#e9ce75', shape: 'diamond' },
  clean: { name: 'Чистая нефть', color: '#8ed8bf', shape: 'square' },
  sludge: { name: 'Шлам', color: '#a78a75', shape: 'triangle' },
  residue: { name: 'Осадок', color: '#ce9ab6', shape: 'diamond' }
});
export const RECIPES = Object.freeze({
  filter: { name: 'Фильтрация', input: { crude: 4 }, output: { filtered: 3, sludge: 1 }, ticks: 6 },
  centrifuge: { name: 'Разделение', input: { filtered: 3 }, output: { clean: 2, residue: 1 }, ticks: 10 }
});
export const count = stock => Object.values(stock).reduce((sum,n)=>sum+n,0);
export const resourceAllowed = (port, resource) => !port.resources?.length || port.resources.includes(resource);
export function productionObjects(state) {
  return state.objects.flatMap(o => o.type === 'frame' ? o.children.map(object=>({owner:`${o.id}/${object.id}`,object,frameId:o.id})) : [{owner:o.id,object:o,frameId:null}]).filter(({object})=>object.type==='tank'||object.type==='storage'||Object.hasOwn(RECIPES,object.type));
}
function emptyContainer(type) { return { input:{}, output:{}, stored:{}, progress:0, enabled:true, capacity:type==='storage'?64:32, cursor:0 }; }
const synchronized=new WeakMap(),contexts=new WeakMap(),recordCache=new WeakMap();
export function ensureSimulation(state) {
  if (!state.simulation) state.simulation={running:false,rate:4,tick:0,inventory:{crude:64},containers:{},pipes:{}};
  if(state.simulation.rate===undefined)state.simulation.rate=4;
  const sim=state.simulation,cached=synchronized.get(state);
  if(cached?.graph===state.graph&&cached.sim===sim)return sim;
  const objects=productionObjects(state),owners=new Set(objects.map(o=>o.owner)),pipeIds=new Set(allPipes(state).map(p=>p.id));
  for(const {owner,object}of objects) if(!Object.hasOwn(sim.containers,owner))sim.containers[owner]=emptyContainer(object.type);
  for(const owner of Object.keys(sim.containers))if(!owners.has(owner)&&containerCount(sim.containers[owner])===0)delete sim.containers[owner];
  for(const id of Object.keys(sim.pipes))if(!pipeIds.has(id)&&sim.pipes[id].length===0)delete sim.pipes[id];
  synchronized.set(state,{graph:state.graph,sim});return sim;
}
export function containerCount(c) { return count(c.input)+count(c.output)+count(c.stored); }
export function canonicalSimulation(state) { return structuredClone(ensureSimulation(state)); }
const validStock = stock => stock && typeof stock==='object' && !Array.isArray(stock) && Object.entries(stock).every(([r,n])=>Object.hasOwn(RESOURCES,r)&&Number.isSafeInteger(n)&&n>=0&&n<=1_000_000);
export function simulationError(state, sim) {
  if(!sim||typeof sim.running!=='boolean'||(sim.rate!==undefined&&![4,10000].includes(sim.rate))||!Number.isSafeInteger(sim.tick)||sim.tick<0||!validStock(sim.inventory)||!sim.containers||typeof sim.containers!=='object'||Array.isArray(sim.containers)||!sim.pipes||typeof sim.pipes!=='object'||Array.isArray(sim.pipes))return 'Некорректное состояние производства';
  const owners=new Map(productionObjects(state).map(o=>[o.owner,o.object.type])),pipes=new Set(allPipes(state).map(p=>p.id));
  for(const [owner,c]of Object.entries(sim.containers)){
    const type=owners.get(owner),recipe=RECIPES[type];
    if(!type||!c||![c.input,c.output,c.stored].every(validStock)||typeof c.enabled!=='boolean'||!Number.isInteger(c.capacity)||c.capacity<1||c.capacity>256||!Number.isSafeInteger(c.cursor)||c.cursor<0||!Number.isInteger(c.progress)||c.progress<0||c.progress>=(recipe?.ticks||1))return 'Некорректный буфер аппарата';
    if(recipe?(count(c.stored)>0||count(c.input)>8||count(c.output)>8||Object.keys(c.input).some(r=>c.input[r]&&!recipe.input[r])||Object.keys(c.output).some(r=>c.output[r]&&!recipe.output[r])):(count(c.input)+count(c.output)>0||count(c.stored)>c.capacity))return 'Переполненный или неподходящий буфер аппарата';
    if(c.progress>0&&!Object.entries(recipe.input).every(([r,n])=>(c.input[r]||0)>=n))return 'Незавершённому процессу не хватает сохранённого сырья';
  }
  for(const [id,tokens]of Object.entries(sim.pipes))if(!pipes.has(id)||!Array.isArray(tokens)||tokens.length>4||tokens.some(t=>!t||!Object.hasOwn(RESOURCES,t.resource)||typeof t.destination!=='string'||t.destination.length>160||!/^object-[1-9]\d*\/(?:item-[1-9]\d*\/)?port-[1-9]\d*$/.test(t.destination)))return 'Некорректное содержимое трубы';
  return '';
}
export function pipeTokens(state,id) { return state.simulation?.pipes[id]||[]; }
export function deletionError(state,owner,pipeIds=[]) {
  const sim=ensureSimulation(state);
  if(Object.entries(sim.containers).some(([id,c])=>(id===owner||id.startsWith(`${owner}/`))&&containerCount(c)>0)||pipeIds.some(id=>pipeTokens(state,id).length))return 'Сначала забери ресурсы: заполненные аппараты и трубы удалять нельзя';
  return '';
}
function add(stock,r,n=1){stock[r]=(stock[r]||0)+n;if(!stock[r])delete stock[r];}
export function transferInventory(state,owner,resource,amount=4) {
  const sim=ensureSimulation(state),record=productionObjects(state).find(o=>o.owner===owner),c=sim.containers[owner];
  if(!record||!Object.hasOwn(RESOURCES,resource))return 'Выбери бак или аппарат';
  const recipe=RECIPES[record.object.type];if(recipe&&!recipe.input[resource])return 'Этот аппарат не принимает такой ресурс';
  const stock=recipe?c.input:c.stored,limit=recipe?8:c.capacity,n=Math.min(amount,sim.inventory[resource]||0,limit-count(stock));
  if(n<=0)return count(stock)>=limit?'Буфер заполнен':'В запасе нет этого ресурса';
  add(sim.inventory,resource,-n);add(stock,resource,n);return '';
}
export function collectResources(state,ownerOrPipe) {
  const sim=ensureSimulation(state),c=sim.containers[ownerOrPipe];
  if(c){for(const stock of [c.input,c.output,c.stored])for(const [r,n]of Object.entries(stock)){add(sim.inventory,r,n);delete stock[r];}c.progress=0;return '';}
  const tokens=sim.pipes[ownerOrPipe];if(tokens){for(const t of tokens)add(sim.inventory,t.resource);sim.pipes[ownerOrPipe]=[];return '';}
  return 'Нет ресурсов для сбора';
}
export function configureContainer(state,owner,settings) {
  const sim=ensureSimulation(state),current=sim.containers[owner];if(!current)return 'Аппарат не найден';
  const future={...sim,containers:{...sim.containers,[owner]:{...current,...settings}}},error=simulationError(state,future);
  if(error)return 'Вместимость не может быть меньше содержимого (от 1 до 256)';sim.containers[owner]=future.containers[owner];return '';
}
function inputStock(record,c){return RECIPES[record.object.type]?c.input:c.stored;}
function accepts(record,c,port,r){const recipe=RECIPES[record.object.type];return c.enabled&&resourceAllowed(port,r)&&(!recipe||!!recipe.input[r]);}
function inputLimit(record,c){return RECIPES[record.object.type]?8:c.capacity;}
function transportContext(state){
  if(contexts.has(state.graph))return contexts.get(state.graph);
  const graph=state.graph, adjacency=new Map(),reverse=new Map(),ports=new Map(graph.ports.map(p=>[p.id,p]));
  for(const [a,b]of graph.edges){if(!adjacency.has(a))adjacency.set(a,[]);adjacency.get(a).push(b);if(!reverse.has(b))reverse.set(b,[]);reverse.get(b).push(a);}
  const distances=new Map();
  function distance(target){if(distances.has(target))return distances.get(target);const d=new Map([[target,0]]),queue=[target];for(let i=0;i<queue.length;i++)for(const id of reverse.get(queue[i])||[])if(!d.has(id)){d.set(id,d.get(queue[i])+1);queue.push(id);}distances.set(target,d);return d;}
  const context={ports,next(id,target){const d=distance(target);return (adjacency.get(id)||[]).find(n=>d.get(n)===d.get(id)-1);}};contexts.set(graph,context);return context;
}
function simulationRecords(state){
  if(!recordCache.has(state.graph))recordCache.set(state.graph,new Map(productionObjects(state).map(o=>[o.owner,o])));return recordCache.get(state.graph);
}
export function simulationTick(state) {
  const sim=ensureSimulation(state),records=simulationRecords(state);
  // Ingredients stay reserved in the input buffer until an atomic recipe completion.
  for(const [owner,record]of records){const c=sim.containers[owner],recipe=RECIPES[record.object.type];if(!recipe||!c.enabled)continue;
    if(!Object.entries(recipe.input).every(([r,n])=>(c.input[r]||0)>=n)||count(c.output)+count(recipe.output)>8)continue;
    if(++c.progress>=recipe.ticks){for(const [r,n]of Object.entries(recipe.input))add(c.input,r,-n);for(const [r,n]of Object.entries(recipe.output))add(c.output,r,n);c.progress=0;}
  }
  const context=transportContext(state),snapshot=structuredClone(sim.pipes),arrivals=new Map(),incoming=new Map();
  // Reservations use occupancy at the beginning of the tick, independent of traversal order.
  const pipeRoom=id=>(snapshot[id]?.length||0)+(incoming.get(id)||0)<4;
  function receive(portId,r,reserve=true){
    const port=context.ports.get(portId),record=port&&records.get(port.owner),c=record&&sim.containers[port.owner];
    if(!port||port.kind!=='input'||!record||!accepts(record,c,port,r)||count(inputStock(record,c))+(arrivals.get(port.owner)?.length||0)>=inputLimit(record,c))return false;
    if(reserve){if(!arrivals.has(port.owner))arrivals.set(port.owner,[]);arrivals.get(port.owner).push(r);}return true;
  }
  const nextContents=Object.fromEntries(Object.keys(snapshot).map(id=>[id,[]]));
  const enqueue=(id,token)=>{if(!nextContents[id])nextContents[id]=[];nextContents[id].push(token);incoming.set(id,(incoming.get(id)||0)+1);};
  const pipeIds=Object.keys(snapshot).sort(),offset=pipeIds.length?sim.tick%pipeIds.length:0;
  for(const id of [...pipeIds.slice(offset),...pipeIds.slice(0,offset)])for(const token of snapshot[id]){
    const target=context.ports.get(token.destination),record=target&&records.get(target.owner),c=record&&sim.containers[target.owner];
    const next=target?.kind==='input'&&record&&accepts(record,c,target,token.resource)?context.next(id,token.destination):null;
    let moved=false;
    if(next===token.destination)moved=receive(next,token.resource);
    else if(next&&pipeRoom(next)){enqueue(next,token);moved=true;}
    if(!moved)nextContents[id].push(token);
  }
  // Export only stock already present before this tick's arrivals are applied.
  for(const [owner,record]of records){
    const c=sim.containers[owner];if(!c.enabled)continue;
    const stock=RECIPES[record.object.type]?c.output:c.stored;
    const options=state.graph.links.filter(link=>link.from===owner).flatMap(link=>{
      const source=context.ports.get(link.source),target=context.ports.get(link.target),to=records.get(target?.owner);
      return Object.keys(stock).filter(r=>stock[r]>0&&resourceAllowed(source,r)&&to&&accepts(to,sim.containers[to.owner],target,r)).map(resource=>({link,resource}));
    });
    for(let i=0;i<options.length;i++){
      const option=options[(c.cursor+i)%options.length],{link,resource}=option,first=link.pipeIds[0];
      if(first?!pipeRoom(first):!receive(link.target,resource,false))continue;
      if(first)enqueue(first,{resource,destination:link.target});else receive(link.target,resource);
      add(stock,resource,-1);c.cursor=(c.cursor+i+1)%1_000_000;break;
    }
  }
  for(const [owner,resources]of arrivals){const record=records.get(owner),stock=inputStock(record,sim.containers[owner]);for(const r of resources)add(stock,r);}
  sim.pipes=Object.fromEntries(Object.entries(nextContents).filter(([,tokens])=>tokens.length));sim.tick++;
  return true;
}
export function apparatusStatus(state,owner) {
  const sim=ensureSimulation(state),record=productionObjects(state).find(o=>o.owner===owner),c=sim.containers[owner];if(!record)return '';
  if(!c.enabled)return 'Выключен';const recipe=RECIPES[record.object.type];
  if(recipe){if(count(c.output)+count(recipe.output)>8)return 'Выход заполнен';if(c.progress)return 'Обработка';if(!Object.entries(recipe.input).every(([r,n])=>(c.input[r]||0)>=n))return 'Нет сырья';}
  const stock=recipe?c.output:c.stored;
  if(!recipe&&!state.graph.ports.some(p=>p.owner===owner&&p.kind==='output'))return count(c.stored)>=c.capacity?'Бак заполнен':count(c.stored)?'Хранение':'Пусто';
  if(count(stock)&&!state.graph.links.some(l=>l.from===owner))return 'Нет соединения';
  if(count(stock)){const ports=new Map(state.graph.ports.map(p=>[p.id,p]));if(!state.graph.links.some(l=>l.from===owner&&Object.keys(stock).some(r=>stock[r]&&resourceAllowed(ports.get(l.source),r)&&resourceAllowed(ports.get(l.target),r))))return 'Ресурс не разрешён на портах';return 'Передача / ожидание места';}
  return recipe?'Готов к запуску':count(c.stored)>=c.capacity?'Бак заполнен':'Пусто';
}
export function pipeStatus(state,id){
  const tokens=pipeTokens(state,id);if(!tokens.length)return 'Пусто';const context=transportContext(state),sim=ensureSimulation(state),records=new Map(productionObjects(state).map(o=>[o.owner,o]));
  for(const t of tokens){
    const port=context.ports.get(t.destination),record=port&&records.get(port.owner),c=record&&sim.containers[port.owner];
    if(!port||!record||!context.next(id,t.destination))return 'Нет пути к приёмнику';
    if(!c.enabled)return 'Приёмник выключен';
    if(!accepts(record,c,port,t.resource))return 'Приёмник не принимает ресурс';
    if(count(inputStock(record,c))>=inputLimit(record,c))return 'Приёмник заполнен';
  }
  return tokens.length===4?'Заполнена · ожидание места':'Передача / ожидание места';
}
export function resourceTotals(state) {
  const sim=ensureSimulation(state),total={...sim.inventory};for(const c of Object.values(sim.containers))for(const stock of [c.input,c.output,c.stored])for(const [r,n]of Object.entries(stock))add(total,r,n);
  for(const tokens of Object.values(sim.pipes))for(const t of tokens)add(total,t.resource);return total;
}
