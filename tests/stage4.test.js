import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductionDemo } from '../web/production-demo.js';
import { simulationTick, ensureSimulation, resourceTotals, count, collectResources, transferInventory, configureContainer, apparatusStatus, simulationError } from '../web/simulation.js';
import { createState, putObject, putEquipment, removePipe, removeEquipment, removeObject, updatePorts, paintPipeRoute, serialize, deserialize, updatePipeFaces, connectEndpoints } from '../web/core.js';
import { allPipes, worldPorts } from '../web/logistics.js';
const ticks=(s,n)=>{for(let i=0;i<n;i++)simulationTick(s);};
const owner=(s,i)=>`${s.objects[0].id}/${s.objects[0].children[i].id}`;
function conservation(s){assert.equal(count(resourceTotals(s)),128);for(const tokens of Object.values(s.simulation.pipes))assert.ok(tokens.length<=4);assert.equal(simulationError(s,s.simulation),'');}
test('finite oil chain produces cleaned oil and both waste streams without changing material count',()=>{
  const s=createProductionDemo();assert.equal(s.graph.links.length,5);
  for(let i=0;i<350;i++){simulationTick(s);conservation(s);}
  const sim=s.simulation;assert.equal(sim.containers[owner(s,3)].stored.clean,8);assert.ok(sim.containers[owner(s,4)].stored.sludge>0);assert.ok(sim.containers[owner(s,5)].stored.residue>0);
  assert.equal(apparatusStatus(s,owner(s,3)),'Бак заполнен');
});
test('full sink backs up production; collecting its output resumes processing with no loss',()=>{
  const s=createProductionDemo();ticks(s,600);
  const complete=()=>resourceTotals(s).clean||0;
  const produced=complete();ticks(s,100);assert.equal(complete(),produced);
  assert.equal(collectResources(s,owner(s,3)),'');ticks(s,100);assert.ok(complete()>produced);assert.ok(s.simulation.inventory.clean>=8);conservation(s);
});
test('one token travels at most one pipe section per tick regardless of graph ordering',()=>{
  const s=createProductionDemo(),sim=s.simulation;sim.containers[owner(s,0)].stored={crude:1};
  simulationTick(s);const path=s.graph.links.find(l=>l.from===owner(s,0)).pipeIds;
  assert.equal(sim.pipes[path[0]].length,1);assert.ok(!sim.pipes[path[1]]);
  simulationTick(s);assert.ok(!sim.pipes[path[0]]);assert.equal(sim.pipes[path[1]].length,1);
  const a=deserialize(serialize(s)),b=deserialize(serialize(s));b.graph.edges.reverse();b.graph.pipes.reverse();simulationTick(a);simulationTick(b);assert.deepEqual(a.simulation,b.simulation);
});
test('occupied receivers cannot be overbooked and a fifth item never enters a pipe',()=>{
  const s=createProductionDemo();ticks(s,700);conservation(s);
  assert.ok(Object.values(s.simulation.pipes).some(tokens=>tokens.length===4));
  const target=s.simulation.containers[owner(s,3)];assert.equal(count(target.stored),target.capacity);assert.match(configureContainer(s,owner(s,3),{capacity:7}),/меньше/);
});
test('breaking a route freezes tokens safely and repairing it resumes transport',()=>{
  const s=createProductionDemo();ticks(s,12);const path=s.graph.links.find(l=>l.from===owner(s,0)).pipeIds;
  const p=allPipes(s).find(p=>p.id===path[3]);const original=[...p.faces];
  assert.equal(updatePipeFaces(s,p.id,['nz','pz']),'');ticks(s,100);const stopped=s.simulation.containers[owner(s,3)].stored.clean||0;ticks(s,100);assert.equal(s.simulation.containers[owner(s,3)].stored.clean||0,stopped);conservation(s);
  assert.equal(updatePipeFaces(s,p.id,original),'');ticks(s,150);assert.ok(s.simulation.containers[owner(s,3)].stored.clean>0);conservation(s);
});
test('resource and direction filters reject incompatible stock and can be changed live',()=>{
  const s=createProductionDemo(),frame=s.objects[0],source=frame.children[0];
  assert.equal(updatePorts(s,frame.id,source.id,source.ports.map(p=>({...p,resources:['clean']})),source.nextPortId),'');ticks(s,20);assert.equal(s.simulation.containers[owner(s,0)].stored.crude,128);
  assert.equal(updatePorts(s,frame.id,source.id,source.ports.map(p=>({...p,resources:['crude']})),source.nextPortId),'');ticks(s,20);assert.ok(s.simulation.containers[owner(s,0)].stored.crude<128);
  assert.match(transferInventory(s,owner(s,1),'clean'),/не принимает/);conservation(s);
});
test('filled structures and pipes refuse deletion; explicit collection preserves every resource',()=>{
  const s=createProductionDemo();ticks(s,3);const id=Object.keys(s.simulation.pipes)[0],before=serialize(s);
  assert.match(removePipe(s,id),/забери/);assert.match(removeEquipment(s,s.objects[0].id,s.objects[0].children[0].id),/забери/);assert.match(removeObject(s,s.objects[0].id),/забери/);assert.equal(serialize(s),before);
  assert.equal(collectResources(s,id),'');assert.equal(removePipe(s,id),'');conservation(s);
  assert.equal(collectResources(s,owner(s,0)),'');const saved=owner(s,0);assert.equal(removeEquipment(s,s.objects[0].id,s.objects[0].children[0].id),'');assert.ok(!ensureSimulation(s).containers[saved]);conservation(s);
});
test('partial recipe progress, pipe destinations and pause state survive v5 round trip exactly',()=>{
  const s=createProductionDemo();ticks(s,15);assert.ok(Object.values(s.simulation.containers).some(c=>c.progress>0));
  s.simulation.running=true;const text=serialize(s),loaded=deserialize(text);assert.equal(serialize(loaded),text);
  ticks(s,100);ticks(loaded,100);assert.equal(serialize(loaded),serialize(s));conservation(loaded);
});
test('legacy v1-v3 migration adds empty buffers and a finite prototype inventory',()=>{
  const current=JSON.parse(serialize(createState()));for(const version of [1,2,3]){const old={...current,version};delete old.simulation;const state=deserialize(JSON.stringify(old));assert.equal(state.version,5);assert.deepEqual(state.simulation.inventory,{crude:64});assert.equal(state.simulation.running,false);}
});
test('corrupt stocks, overflowing pipes, invalid recipes and resource filters reject atomically',()=>{
  const s=createProductionDemo();ticks(s,15);const text=serialize(s);
  for(const mutate of [
    d=>{d.simulation.inventory.crude=-1;},d=>{d.simulation.inventory.unknown=1;},d=>{d.simulation.containers[owner(s,1)].input={clean:4};},
    d=>{d.simulation.containers[owner(s,1)].progress=999;},d=>{d.simulation.containers[owner(s,0)].capacity=1;},
    d=>{const id=Object.keys(d.simulation.pipes)[0];d.simulation.pipes[id]=Array(5).fill(d.simulation.pipes[id][0]);},
    d=>{const id=Object.keys(d.simulation.pipes)[0];d.simulation.pipes[id][0].destination='evil';},
    d=>{d.objects[0].children[0].ports[0].resources=['electricity'];},d=>{delete d.simulation;},d=>{d.simulation.containers=4;}
  ]){const data=JSON.parse(text);mutate(data);assert.throws(()=>deserialize(JSON.stringify(data)));assert.equal(serialize(s),text);}
});
test('a closed recirculation route moves a finite stock without duplication or multi-hop forwarding',()=>{
  const s=createState(false);putObject(s,{type:'frame',x:8,y:1,z:0,rotation:0,width:20,depth:8,height:8,mount:'floor',children:[],nextItemId:1});const f=s.objects[0];
  for(const x of [2,10])assert.equal(putEquipment(s,f.id,{type:'tank',x,y:2,z:0,rotation:0}),'');
  const ports=worldPorts(s),get=(i,k)=>ports.find(p=>p.owner===owner(s,i)&&p.kind===k);
  assert.equal(connectEndpoints(s,get(0,'output'),get(1,'input')),'');assert.equal(connectEndpoints(s,get(1,'output'),get(0,'input')),'');
  const sim=ensureSimulation(s);sim.inventory={};sim.containers[owner(s,0)].stored={crude:4};
  for(let i=0;i<300;i++){simulationTick(s);assert.equal(count(resourceTotals(s)),4);for(const tokens of Object.values(sim.pipes))assert.ok(tokens.length<=4);}
  assert.equal(s.graph.links.length,2);assert.equal(sim.tick,300);
});
test('an apparatus with two outputs alternates available receivers without branching pipes',()=>{
  const s=createState(false);putObject(s,{type:'frame',x:8,y:1,z:0,rotation:0,width:24,depth:8,height:8,mount:'floor',children:[],nextItemId:1});const f=s.objects[0];
  for(const [x,ports]of [[8,[{id:'port-1',kind:'output',face:'nx',u:1,v:0},{id:'port-2',kind:'output',face:'px',u:1,v:0}]],[1,[{id:'port-1',kind:'input',face:'px',u:1,v:0}]],[17,[{id:'port-1',kind:'input',face:'nx',u:1,v:0}]]])assert.equal(putEquipment(s,f.id,{type:'tank',x,y:2,z:0,rotation:0,ports,nextPortId:3}),'');
  const ports=worldPorts(s);for(const [i,p]of [[1,'port-1'],[2,'port-2']])assert.equal(connectEndpoints(s,ports.find(v=>v.owner===owner(s,0)&&v.portId===p),ports.find(v=>v.owner===owner(s,i))),'');
  const sim=ensureSimulation(s);sim.inventory={};sim.containers[owner(s,0)].stored={crude:8};sim.containers[owner(s,1)].capacity=1;sim.containers[owner(s,2)].capacity=1;
  ticks(s,25);assert.equal(sim.containers[owner(s,1)].stored.crude,1);assert.equal(sim.containers[owner(s,2)].stored.crude,1);assert.equal(count(resourceTotals(s)),8);assert.ok(allPipes(s).every(p=>p.faces.length===2));
});
