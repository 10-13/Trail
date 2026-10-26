import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, putObject, putEquipment, putPipe, paintPipeRoute, connectEndpoints, removeObject, serialize, deserialize, canStand } from '../web/core.js';
import { worldPorts, allPipes, worldPipe } from '../web/logistics.js';
import { ensureSimulation, transferInventory, count, resourceTotals, simulationTick } from '../web/simulation.js';
import { createProductionDemo } from '../web/production-demo.js';
import { rotateObject, dimensions, orientationOf } from '../web/geometry.js';
function pair(){const s=createState(false);for(const x of [10,22]){assert.equal(putObject(s,{type:'frame',x,y:1,z:0,rotation:0,width:6,depth:6,height:8,mount:'floor',children:[],nextItemId:1}),'');const f=s.objects.at(-1);assert.equal(putEquipment(s,f.id,{type:'tank',x:1,y:1,z:0,rotation:0,width:2,depth:3,height:4}),'');}const [a,b]=s.objects,ports=worldPorts(s),out=ports.find(p=>p.frameId===a.id&&p.kind==='output'),input=ports.find(p=>p.frameId===b.id&&p.kind==='input');assert.equal(connectEndpoints(s,out,input),'');return {s,a,b,input};}
function fillBridge(s,a,input){const owner=`${a.id}/${a.children[0].id}`;transferInventory(s,owner,'crude',4);s.simulation.containers[owner].stored.crude--;s.simulation.pipes[s.pipes[0].id]=[{resource:'crude',destination:input.id}];}
test('same-rack automatic routes are rack-local and rack deletion collects all stock and removes every pipe',()=>{
  const s=createProductionDemo();for(let i=0;i<35;i++)simulationTick(s);assert.equal(s.pipes.length,0);assert.ok(s.objects[0].pipes.length>0);assert.equal(removeObject(s,s.objects[0].id),'');assert.equal(allPipes(s).length,0);assert.equal(count(resourceTotals(s)),128);assert.deepEqual(s.simulation.containers,{});assert.deepEqual(s.simulation.pipes,{});assert.equal(serialize(deserialize(serialize(s))),serialize(s));
});
test('gap pipes belong to both endpoint racks; deleting either removes the bridge without losing resources',()=>{
  for(const side of ['a','b']){const {s,a,b,input}=pair();fillBridge(s,a,input);const ids=new Set(s.pipes.map(p=>p.id));assert.ok(ids.size>0);assert.ok(s.pipes.every(p=>p.rackIds.includes(a.id)&&p.rackIds.includes(b.id)));assert.equal(removeObject(s,side==='a'?a.id:b.id),'');assert.equal(s.pipes.length,0);assert.ok(allPipes(s).every(p=>!ids.has(p.id)&&p.frameId));assert.equal(count(resourceTotals(s)),64);assert.equal(serialize(deserialize(serialize(s))),serialize(s));}
});
test('moving a rack dismantles its external bridge while keeping local pipes and stock attached',()=>{
  const {s,a,input}=pair();fillBridge(s,a,input);const localIds=a.pipes.map(p=>p.id);assert.equal(putObject(s,{...a,x:32},a.id),'');assert.equal(s.pipes.length,0);assert.ok(localIds.every(id=>allPipes(s).some(p=>p.id===id&&p.x>=32)));assert.equal(count(resourceTotals(s)),64);
});
test('loose blocks and manual world pipes are rejected, even when their coordinates fall inside a rack',()=>{
  const {s,a}=pair();const before=serialize(s);assert.match(putObject(s,{type:'storage',x:1,y:1,z:0,rotation:0}),/только/);assert.match(putPipe(s,{x:14,y:4,z:0,faces:['nx','px']}),/только/);assert.match(paintPipeRoute(s,null,null,{x:14,y:4,z:0}),/только/);assert.equal(serialize(s),before);assert.equal(putEquipment(s,a.id,{type:'storage',x:3,y:3,z:0,rotation:0,width:2,depth:2,height:2}),'');
});
test('racks rotate only around the vertical, while blocks retain three-axis rotation',()=>{
  const {s,a}=pair();const before=serialize(s);for(const axis of ['x','y'])assert.match(putObject(s,rotateObject(a,axis),a.id),/параллельны/);assert.equal(serialize(s),before);assert.equal(putObject(s,rotateObject(a,'z'),a.id),'');assert.equal(orientationOf(s.objects[0])[2],3);
});
test('legacy world routes are adopted into racks and dangling outside tubes return their resources to inventory',()=>{
  const {s,a,input}=pair();fillBridge(s,a,input);const data=JSON.parse(serialize(s));data.version=5;data.pipes=allPipes(s).map(p=>({id:p.id,x:p.x,y:p.y,z:p.z,faces:p.faces}));for(const f of data.objects)f.pipes=[];
  data.pipes.push({id:'pipe-99',x:45,y:10,z:8,faces:['nx','px']});data.nextPipeId=100;data.simulation.inventory.crude--;data.simulation.pipes['pipe-99']=[{resource:'crude',destination:input.id}];
  const loaded=deserialize(JSON.stringify(data));assert.ok(loaded.migrationNotice);assert.ok(loaded.objects.every(f=>f.pipes.length));assert.ok(loaded.pipes.every(p=>p.rackIds.length===2));assert.ok(!allPipes(loaded).some(p=>p.id==='pipe-99'));assert.equal(count(resourceTotals(loaded)),64);assert.equal(removeObject(loaded,a.id),'');assert.equal(loaded.pipes.length,0);assert.equal(count(resourceTotals(loaded)),64);
});
test('legacy free storage gets an enclosing rack and its buffer owner is remapped',()=>{
  const s=createState(false),data=JSON.parse(serialize(s));data.version=5;data.objects=[{id:'object-1',type:'storage',x:10,y:1,z:0,rotation:1}];data.nextId=2;data.simulation.inventory={crude:59};data.simulation.containers={'object-1':{input:{},output:{},stored:{crude:5},progress:0,enabled:true,capacity:32,cursor:0}};
  const loaded=deserialize(JSON.stringify(data));assert.equal(loaded.objects[0].type,'frame');assert.equal(loaded.objects[0].children[0].type,'storage');assert.equal(loaded.simulation.containers['object-1/item-1'].stored.crude,5);assert.equal(count(resourceTotals(loaded)),64);removeObject(loaded,'object-1');assert.equal(loaded.simulation.inventory.crude,64);
});
test('legacy tilted racks are leveled by baking geometry without moving equipment or pipes',()=>{
  const s=createState(false);putObject(s,{type:'frame',x:10,y:1,z:0,rotation:0,width:6,depth:6,height:6,mount:'floor',children:[],nextItemId:1});const f=s.objects[0];putEquipment(s,f.id,{type:'machine',x:1,y:1,z:1,rotation:0,width:2,depth:2,height:3});putPipe(s,{x:4,y:4,z:4,faces:['nx','px']},f.id);
  const data=JSON.parse(serialize(s));data.version=5;data.objects[0]=rotateObject(data.objects[0],'y');const oldPipe=worldPipe(data.objects[0],data.objects[0].pipes[0]),oldPort=worldPorts(data)[0];
  const loaded=deserialize(JSON.stringify(data));assert.equal(orientationOf(loaded.objects[0])[2],3);assert.deepEqual(allPipes(loaded)[0],oldPipe);assert.deepEqual(worldPorts(loaded)[0].cell,oldPort.cell);assert.equal(worldPorts(loaded)[0].face,oldPort.face);
});
test('a managed high bridge preserves walking headroom and disappears with its ceiling rack',()=>{
  const s=createState(false);for(const x of [10,20]){putObject(s,{type:'frame',x,y:1,z:8,rotation:0,width:4,depth:3,height:2,mount:'ceiling',children:[],nextItemId:1});const f=s.objects.at(-1);putEquipment(s,f.id,{type:'tank',x:1,y:1,z:0,rotation:0,width:1,depth:1,height:1});}
  const ports=worldPorts(s);assert.equal(connectEndpoints(s,ports.find(p=>p.frameId===s.objects[0].id&&p.kind==='output'),ports.find(p=>p.frameId===s.objects[1].id&&p.kind==='input')),'');assert.ok(s.pipes.every(p=>p.z>=8));assert.ok(canStand(s,{x:16,y:2.5}));removeObject(s,s.objects[0].id);assert.equal(s.pipes.length,0);
});
test('current saves reject unowned gap pipes, missing owners and tilted rack geometry',()=>{
  const {s}=pair(),text=serialize(s);for(const mutate of [d=>delete d.pipes[0].rackIds,d=>d.pipes[0].rackIds=['missing','object-1'],d=>d.objects[0]=rotateObject(d.objects[0],'x'),d=>d.objects.push({id:'object-9',type:'storage',x:40,y:1,z:0,rotation:0})]){const data=JSON.parse(text);data.nextId=10;mutate(data);assert.throws(()=>deserialize(JSON.stringify(data)));}
});
test('legacy free-container destinations are remapped before a retained bridge is simulated or deleted',()=>{
  const {s,a,b}=pair(),data=JSON.parse(serialize(s));data.version=5;data.pipes=allPipes(s).filter(p=>p.id!==b.pipes[0].id).map(p=>({id:p.id,x:p.x,y:p.y,z:p.z,faces:p.faces}));data.objects[0].pipes=[];
  data.objects[1]={id:b.id,type:'storage',x:b.x,y:b.y,z:0,rotation:0,ports:[{id:'port-1',kind:'input',face:'nx',u:2,v:0}],nextPortId:2};delete data.simulation.containers[`${b.id}/${b.children[0].id}`];
  data.simulation.containers[b.id]={input:{},output:{},stored:{crude:2},progress:0,enabled:true,capacity:32,cursor:0};data.simulation.inventory={crude:61};data.simulation.pipes[s.pipes[0].id]=[{resource:'crude',destination:`${b.id}/port-1`}];
  const loaded=deserialize(JSON.stringify(data));assert.equal(loaded.graph.links.length,1);assert.equal(loaded.simulation.containers[`${b.id}/item-1`].stored.crude,2);assert.equal(loaded.simulation.pipes[s.pipes[0].id][0].destination,`${b.id}/item-1/port-1`);assert.equal(count(resourceTotals(loaded)),64);removeObject(loaded,b.id);assert.equal(loaded.pipes.length,0);assert.equal(loaded.simulation.inventory.crude,64);
});
test('a legacy route left after one rack was already deleted cannot survive as a floating tail',()=>{
  const {s,a,b,input}=pair(),data=JSON.parse(serialize(s));data.version=5;data.pipes=allPipes(s).map(p=>({id:p.id,x:p.x,y:p.y,z:p.z,faces:p.faces}));data.objects=data.objects.filter(o=>o.id!==a.id);data.objects[0].pipes=[];delete data.simulation.containers[`${a.id}/${a.children[0].id}`];data.simulation.inventory={crude:63};data.simulation.pipes[s.pipes[0].id]=[{resource:'crude',destination:input.id}];
  const loaded=deserialize(JSON.stringify(data));assert.equal(loaded.pipes.length,0);assert.equal(loaded.objects.length,1);assert.equal(loaded.objects[0].id,b.id);assert.ok(allPipes(loaded).every(p=>p.frameId===b.id));assert.equal(count(resourceTotals(loaded)),64);
});
