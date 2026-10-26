import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, putObject, putEquipment, putPipe, paintPipeRoute, connectEndpoints, removeObject, serialize, deserialize, canStand } from '../web/core.js';
import { worldPorts, allPipes, worldPipe, networkError } from '../web/logistics.js';
import { transferInventory, count, resourceTotals, simulationTick } from '../web/simulation.js';
import { createProductionDemo } from '../web/production-demo.js';
import { rotateObject, orientationOf } from '../web/geometry.js';
function pair(gap=0,connect=true){
  const s=createState(false);
  for(const x of [10,16+gap]){
    assert.equal(putObject(s,{type:'frame',x,y:1,z:0,rotation:0,width:6,depth:6,height:8,mount:'floor',children:[],nextItemId:1}),'');
    const f=s.objects.at(-1);assert.equal(putEquipment(s,f.id,{type:'tank',x:1,y:1,z:0,rotation:0,width:2,depth:3,height:4}),'');
  }
  const [a,b]=s.objects,ports=worldPorts(s),out=ports.find(p=>p.frameId===a.id&&p.kind==='output'),input=ports.find(p=>p.frameId===b.id&&p.kind==='input');
  if(connect)assert.equal(connectEndpoints(s,out,input),'');
  return {s,a,b,input};
}
function fillLocalPipe(s,a,input){const owner=`${a.id}/${a.children[0].id}`;transferInventory(s,owner,'crude',4);s.simulation.containers[owner].stored.crude--;s.simulation.pipes[a.pipes[0].id]=[{resource:'crude',destination:input.id}];}
function legacyPipes(data,a,b,input,managed=false){
  data.nextPipeId=3;data.pipes=[{id:'pipe-1',x:14,y:4,z:0,faces:['nx','px']},{id:'pipe-2',x:18,y:4,z:0,faces:['nx','px'],...(managed?{rackIds:[a.id,b.id]}:{})}];
  data.simulation.inventory={crude:62};data.simulation.pipes={'pipe-1':[{resource:'crude',destination:input.id}],'pipe-2':[{resource:'crude',destination:input.id}]};
}
test('same-rack routes are local; deletion collects all stock and removes every owned pipe',()=>{
  const s=createProductionDemo();for(let i=0;i<35;i++)simulationTick(s);assert.equal(s.pipes.length,0);assert.ok(s.objects[0].pipes.length>0);assert.equal(removeObject(s,s.objects[0].id),'');assert.equal(allPipes(s).length,0);assert.equal(count(resourceTotals(s)),128);assert.deepEqual(s.simulation.containers,{});assert.deepEqual(s.simulation.pipes,{});assert.equal(serialize(deserialize(serialize(s))),serialize(s));
});
test('touching racks connect using only their own cells; deletion never leaves outside pipes',()=>{
  for(const side of ['a','b']){
    const {s,a,b,input}=pair();fillLocalPipe(s,a,input);const removed=side==='a'?a:b,ids=new Set(removed.pipes.map(p=>p.id));
    assert.deepEqual(s.pipes,[]);assert.equal(removeObject(s,removed.id),'');assert.ok(allPipes(s).every(p=>p.frameId&&!ids.has(p.id)));
    assert.equal(s.graph.links.length,0);assert.equal(count(resourceTotals(s)),64);assert.equal(serialize(deserialize(serialize(s))),serialize(s));
  }
});
test('moving a rack keeps local pipes and stock attached and disconnects its former neighbor',()=>{
  const {s,a,input}=pair();fillLocalPipe(s,a,input);const localIds=a.pipes.map(p=>p.id);assert.equal(putObject(s,{...a,x:32},a.id),'');assert.deepEqual(s.pipes,[]);assert.ok(localIds.every(id=>allPipes(s).some(p=>p.id===id&&p.x>=32)));assert.equal(s.graph.links.length,0);assert.equal(count(resourceTotals(s)),64);
});
test('loose blocks, world pipe tools and fake two-owner outside pipes are rejected',()=>{
  const {s,a}=pair();const before=serialize(s);assert.match(putObject(s,{type:'storage',x:1,y:1,z:0,rotation:0}),/только/);assert.match(putPipe(s,{x:14,y:4,z:0,faces:['nx','px']}),/только/);assert.match(paintPipeRoute(s,null,null,{x:14,y:4,z:0}),/только/);assert.equal(serialize(s),before);
  const future=structuredClone(s);future.nextPipeId=100;future.pipes=[{id:'pipe-99',x:30,y:4,z:0,faces:['nx','px'],rackIds:s.objects.map(o=>o.id)}];assert.match(networkError(future),/только внутри/);
  assert.equal(putEquipment(s,a.id,{type:'storage',x:3,y:3,z:0,rotation:0,width:2,depth:2,height:2}),'');
});
test('racks rotate only around the vertical, while blocks retain three-axis rotation',()=>{
  const {s,a}=pair();const before=serialize(s);for(const axis of ['x','y'])assert.match(putObject(s,rotateObject(a,axis),a.id),/параллельны/);assert.equal(serialize(s),before);assert.equal(putObject(s,rotateObject(a,'z'),a.id),'');assert.equal(orientationOf(s.objects[0])[2],3);
});
test('old v5 and v6 saves adopt inside pipes and recover every outside pipe, including managed bridges',()=>{
  for(const version of [5,6])for(const managed of [false,true]){
    const {s,a,b,input}=pair(6,false),data=JSON.parse(serialize(s));data.version=version;legacyPipes(data,a,b,input,managed);
    const loaded=deserialize(JSON.stringify(data));assert.match(loaded.migrationNotice,/вне стеллажей/);assert.deepEqual(loaded.pipes,[]);assert.equal(loaded.objects[0].pipes[0].id,'pipe-1');assert.ok(!allPipes(loaded).some(p=>p.id==='pipe-2'));
    assert.equal(loaded.simulation.inventory.crude,63);assert.equal(loaded.simulation.pipes['pipe-1'].length,1);assert.equal(count(resourceTotals(loaded)),64);
    assert.equal(serialize(deserialize(serialize(loaded))),serialize(loaded));removeObject(loaded,a.id);assert.equal(loaded.simulation.inventory.crude,64);
  }
});
test('legacy free storage gets an enclosing rack and its buffer owner is remapped',()=>{
  const s=createState(false),data=JSON.parse(serialize(s));data.version=5;data.objects=[{id:'object-1',type:'storage',x:10,y:1,z:0,rotation:1}];data.nextId=2;data.simulation.inventory={crude:59};data.simulation.containers={'object-1':{input:{},output:{},stored:{crude:5},progress:0,enabled:true,capacity:32,cursor:0}};
  const loaded=deserialize(JSON.stringify(data));assert.equal(loaded.objects[0].type,'frame');assert.equal(loaded.objects[0].children[0].type,'storage');assert.equal(loaded.simulation.containers['object-1/item-1'].stored.crude,5);assert.equal(count(resourceTotals(loaded)),64);removeObject(loaded,'object-1');assert.equal(loaded.simulation.inventory.crude,64);
});
test('legacy tilted racks are leveled without moving equipment or pipes',()=>{
  const s=createState(false);putObject(s,{type:'frame',x:10,y:1,z:0,rotation:0,width:6,depth:6,height:6,mount:'floor',children:[],nextItemId:1});const f=s.objects[0];putEquipment(s,f.id,{type:'machine',x:1,y:1,z:1,rotation:0,width:2,depth:2,height:3});putPipe(s,{x:4,y:4,z:4,faces:['nx','px']},f.id);
  const data=JSON.parse(serialize(s));data.version=5;data.objects[0]=rotateObject(data.objects[0],'y');const oldPipe=worldPipe(data.objects[0],data.objects[0].pipes[0]),oldPort=worldPorts(data)[0];
  const loaded=deserialize(JSON.stringify(data));assert.equal(orientationOf(loaded.objects[0])[2],3);assert.deepEqual(allPipes(loaded)[0],oldPipe);assert.deepEqual(worldPorts(loaded)[0].cell,oldPort.cell);assert.equal(worldPorts(loaded)[0].face,oldPort.face);
});
test('headroom does not grant an exception to the outside-pipe restriction',()=>{
  const s=createState(false);for(const x of [10,20]){putObject(s,{type:'frame',x,y:1,z:8,rotation:0,width:4,depth:3,height:2,mount:'ceiling',children:[],nextItemId:1});const f=s.objects.at(-1);putEquipment(s,f.id,{type:'tank',x:1,y:1,z:0,rotation:0,width:1,depth:1,height:1});}
  const ports=worldPorts(s),before=serialize(s);assert.match(connectEndpoints(s,ports.find(p=>p.frameId===s.objects[0].id&&p.kind==='output'),ports.find(p=>p.frameId===s.objects[1].id&&p.kind==='input')),/внутри стеллажей/);assert.equal(serialize(s),before);assert.ok(canStand(s,{x:16,y:2.5}));
});
test('invalid pipe geometry, tilted racks and free structures still reject atomically on load',()=>{
  const {s}=pair(),text=serialize(s);for(const mutate of [d=>d.objects[0].pipes[0].x=-1,d=>d.objects[0].pipes[0].faces=['nx','px','py'],d=>d.objects[0]=rotateObject(d.objects[0],'x'),d=>d.objects.push({id:'object-9',type:'storage',x:40,y:1,z:0,rotation:0})]){const data=JSON.parse(text);data.nextId=10;mutate(data);assert.throws(()=>deserialize(JSON.stringify(data)));}assert.equal(serialize(s),text);
});
test('legacy free-container destinations are remapped in retained inside pipes while outside contents are recovered',()=>{
  const {s,a,b,input}=pair(6,false),data=JSON.parse(serialize(s));data.version=5;legacyPipes(data,a,b,input,true);
  data.objects[1]={id:b.id,type:'storage',x:b.x,y:b.y,z:0,rotation:0,ports:[{id:'port-1',kind:'input',face:'nx',u:2,v:0}],nextPortId:2};delete data.simulation.containers[`${b.id}/${b.children[0].id}`];
  data.simulation.containers[b.id]={input:{},output:{},stored:{crude:2},progress:0,enabled:true,capacity:32,cursor:0};data.simulation.inventory={crude:60};for(const tokens of Object.values(data.simulation.pipes))tokens[0].destination=`${b.id}/port-1`;
  const loaded=deserialize(JSON.stringify(data));assert.equal(loaded.simulation.containers[`${b.id}/item-1`].stored.crude,2);assert.equal(loaded.simulation.pipes['pipe-1'][0].destination,`${b.id}/item-1/port-1`);assert.deepEqual(loaded.pipes,[]);assert.equal(count(resourceTotals(loaded)),64);removeObject(loaded,b.id);removeObject(loaded,a.id);assert.equal(loaded.simulation.inventory.crude,64);
});
test('a legacy route left after rack deletion retains only the surviving rack cells and all material',()=>{
  const {s,a,b,input}=pair(6,false),data=JSON.parse(serialize(s));data.version=5;legacyPipes(data,a,b,input);data.pipes[1].x=b.x;data.pipes[1].y=3;data.objects=data.objects.filter(o=>o.id!==a.id);delete data.simulation.containers[`${a.id}/${a.children[0].id}`];
  const loaded=deserialize(JSON.stringify(data));assert.deepEqual(loaded.pipes,[]);assert.equal(loaded.objects.length,1);assert.equal(loaded.objects[0].id,b.id);assert.ok(allPipes(loaded).every(p=>p.frameId===b.id));assert.equal(loaded.objects[0].pipes.length,1);assert.equal(count(resourceTotals(loaded)),64);
});
