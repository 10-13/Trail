import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, putObject, putEquipment, putPipe, paintPipeRoute, connectEndpoints, serialize, deserialize, worldEquipment, updatePipeFaces, updateFrame } from '../web/core.js';
import { dimensions, localSize, rotateObject, orientationOf, validOrientation, transformCell, inverseOrientation } from '../web/geometry.js';
import { worldPorts, allPipes, pipesInFrame, portsInFrame, neighboringConnections, rotateFace, localCell, OPPOSITE } from '../web/logistics.js';
const frame=(extra={})=>({type:'frame',x:10,y:1,z:0,rotation:0,width:6,depth:6,height:8,mount:'floor',children:[],nextItemId:1,...extra});
const item=(extra={})=>({type:'machine',x:1,y:1,z:1,rotation:0,width:2,depth:3,height:4,...extra});
function neighbors(){
  const state=createState(false);
  assert.equal(putObject(state,frame({width:10})),'');assert.equal(putObject(state,frame({x:20,width:10})),'');
  for(const f of state.objects)assert.equal(putEquipment(state,f.id,item()),'');
  return {state,a:state.objects[0],b:state.objects[1]};
}
test('all 24 solid orientations are right handed and invert cells and faces exactly',()=>{
  const queue=[item()],seen=new Set();
  for(let i=0;i<queue.length;i++){
    const object=queue[i],key=orientationOf(object).join();if(seen.has(key))continue;seen.add(key);
    assert.ok(validOrientation(orientationOf(object)));
    const cell={x:0,y:2,z:3},rotated=transformCell(cell,localSize(object),object);
    assert.deepEqual(transformCell(rotated,dimensions(object),{orientation:inverseOrientation(object)}),cell);
    for(const face of ['nx','px','ny','py','nz','pz'])assert.equal(rotateFace(rotateFace(face,object),{orientation:inverseOrientation(object)}),face);
    for(const axis of ['x','y','z'])queue.push(rotateObject(object,axis));
  }
  assert.equal(seen.size,24);assert.equal(validOrientation([1,1,3]),false);assert.equal(validOrientation([-1,2,3]),false);
});
test('four turns about each axis restore dimensions and port locations; mixed turns are ordered',()=>{
  const base=item();
  for(const axis of ['x','y','z']){let rotated=base;for(let i=0;i<4;i++)rotated=rotateObject(rotated,axis);assert.deepEqual(orientationOf(rotated),orientationOf(base));}
  assert.notDeepEqual(orientationOf(rotateObject(rotateObject(base,'x'),'y')),orientationOf(rotateObject(rotateObject(base,'y'),'x')));
  assert.deepEqual(dimensions(rotateObject(base,'x')),{width:2,depth:4,height:3});
  assert.deepEqual(dimensions(rotateObject(base,'y')),{width:4,depth:3,height:2});
});
test('pitched equipment in upright racks retains ports, bounds, pipes and orientation through save/load',()=>{
  const state=createState(false),base=frame({width:6,depth:6,height:6});
  assert.equal(putObject(state,base),'');const f=state.objects[0];
  assert.equal(putEquipment(state,f.id,rotateObject(item({width:2,depth:2,height:3}),'x')),'');
  assert.equal(putPipe(state,{x:4,y:4,z:4,faces:['nx','px']},f.id),'');
  assert.equal(putObject(state,rotateObject(f,'z'),f.id),'');const turned=state.objects[0];
  const pipe=allPipes(state)[0];assert.deepEqual(localCell(turned,pipe),{x:4,y:4,z:4});
  assert.deepEqual(pipesInFrame(state,turned)[0].faces,['nx','px']);
  const world=worldEquipment(turned,turned.children[0]);
  for(const port of worldPorts(state)){const d=dimensions(world);assert.ok(port.cell.x>=world.x&&port.cell.x<world.x+d.width);assert.ok(port.cell.z>=world.z&&port.cell.z<world.z+d.height);}
  const local=portsInFrame(state,turned);assert.equal(local[0].face,rotateFace('nx',turned.children[0]));
  assert.equal(serialize(deserialize(serialize(state))),serialize(state));
});
test('rack pitch is refused and ceiling mounting follows the configured height',()=>{
  const state=createState(false);assert.equal(putObject(state,frame({width:8,depth:4,height:2,z:8,mount:'ceiling'})),'');
  const f=state.objects[0];assert.match(updateFrame(state,f.id,rotateObject(f,'x')),/параллельны/);assert.equal(updateFrame(state,f.id,{height:4}),'');
  assert.equal(state.objects[0].z,6);assert.equal(dimensions(state.objects[0]).height,4);
  const before=serialize(state),broken=JSON.parse(before);broken.objects[0].orientation=[1,1,3];assert.throws(()=>deserialize(JSON.stringify(broken)),/поворот/);assert.equal(serialize(state),before);
});
test('incremental brush turns replace only a free terminal face and finish with a straight segment',()=>{
  const state=createState(false);putObject(state,frame({width:16,height:10}));const parent=state.objects[0],frameId=parent.id,c=(x,y)=>({x,y,z:8});
  assert.equal(paintPipeRoute(state,frameId,null,c(10,3)),'');
  assert.equal(paintPipeRoute(state,frameId,c(10,3),c(12,3)),'');
  assert.equal(paintPipeRoute(state,frameId,c(12,3),c(12,5)),'');
  const at=(x,y)=>parent.pipes.find(p=>p.x===x&&p.y===y);
  assert.deepEqual(new Set(at(12,3).faces),new Set(['nx','py']));
  for(const p of [at(10,3),at(12,5)])assert.equal(p.faces[0],OPPOSITE[p.faces[1]]);
  const before=serialize(state);assert.match(paintPipeRoute(state,frameId,c(11,3),c(11,5)),/Ответвление/);assert.equal(serialize(state),before);
  assert.match(updatePipeFaces(state,at(11,3).id,['nx','px','py']),/две грани/);
});
test('neighbor list includes other frame ports and free pipe ends; connection stays inside two touching frames',()=>{
  const {state,a,b}=neighbors();
  const near=neighboringConnections(state,a);assert.equal(near.filter(p=>p.frameId===b.id).length,2);
  const ports=worldPorts(state),out=ports.find(p=>p.frameId===a.id&&p.kind==='output'),input=ports.find(p=>p.frameId===b.id&&p.kind==='input');
  const before=serialize(state);assert.equal(connectEndpoints(state,out,input,true),'');assert.equal(serialize(state),before);
  assert.equal(connectEndpoints(state,out,input),'');assert.equal(state.graph.links.length,1);
  assert.deepEqual(state.pipes,[]);assert.ok(pipesInFrame(state,a).length);assert.ok(pipesInFrame(state,b).length);
  for(const id of [state.graph.links[0].pipeIds[0],state.graph.links[0].pipeIds.at(-1)]){const p=allPipes(state).find(p=>p.id===id);assert.equal(p.faces[0],OPPOSITE[p.faces[1]]);}
  assert.equal(serialize(deserialize(serialize(state))),serialize(state));
});
test('automatic connection navigates an internal obstacle and keeps ends straight',()=>{
  const {state,a,b}=neighbors();assert.equal(putEquipment(state,a.id,{type:'machine',x:6,y:2,z:1,rotation:0,width:1,depth:1,height:2,ports:[],nextPortId:1}),'');
  const ports=worldPorts(state),out=ports.find(p=>p.frameId===a.id&&p.kind==='output'),input=ports.find(p=>p.frameId===b.id&&p.kind==='input');
  assert.equal(connectEndpoints(state,out,input),'');assert.equal(state.graph.links.length,1);
  assert.deepEqual(state.pipes,[]);assert.ok(allPipes(state).some(p=>p.z!==1||p.y!==3));
  for(const id of [state.graph.links[0].pipeIds[0],state.graph.links[0].pipeIds.at(-1)]){const p=allPipes(state).find(p=>p.id===id);assert.equal(p.faces[0],OPPOSITE[p.faces[1]]);}
});
test('joining a dangling neighbor pipe extends it, and a blocked connection is atomic',()=>{
  const {state,a,b}=neighbors();const ports=worldPorts(state),input=ports.find(p=>p.frameId===b.id&&p.kind==='input');
  assert.equal(paintPipeRoute(state,a.id,{x:3,y:2,z:1},{x:5,y:2,z:1}),'');
  const end=neighboringConnections(state,b).find(p=>p.kind==='pipe'&&p.face==='px');assert.ok(end);
  const worldEnd={...end,cell:{x:a.x+5,y:a.y+2,z:a.z+1},face:'px',neighbor:{x:a.x+6,y:a.y+2,z:a.z+1}};
  assert.equal(connectEndpoints(state,worldEnd,input),'');assert.equal(state.graph.links.length,1);
  const before=serialize(state);assert.match(connectEndpoints(state,{...input,id:'bad',neighbor:{x:999,y:0,z:0}},input),/выход|занято/);assert.equal(serialize(state),before);
});
test('legacy branching saves are normalized without rejecting the whole layout',()=>{
  const {state,a}=neighbors();paintPipeRoute(state,a.id,{x:3,y:2,z:1},{x:5,y:2,z:1});const data=JSON.parse(serialize(state));
  data.version=3;data.objects[0].pipes[1].faces=['nx','px','py'];data.objects[0].pipes[0].faces=[];
  const loaded=deserialize(JSON.stringify(data));assert.ok(loaded.migrationNotice);assert.ok(allPipes(loaded).every(p=>p.faces.length===2));
  assert.equal(loaded.objects.length,2);
});

test('separated racks cannot be joined through unowned space, even in preview',()=>{
  const state=createState(false);for(const x of [10,22]){assert.equal(putObject(state,frame({x})),'');assert.equal(putEquipment(state,state.objects.at(-1).id,item({x:x===10?1:3})),'');}
  const ports=worldPorts(state),out=ports.find(p=>p.frameId===state.objects[0].id&&p.kind==='output'),input=ports.find(p=>p.frameId===state.objects[1].id&&p.kind==='input'),before=serialize(state);
  for(const preview of [true,false]){assert.match(connectEndpoints(state,out,input,preview),/внутри стеллажей/);assert.equal(serialize(state),before);}
});
