import test from 'node:test';
import assert from 'node:assert/strict';
import { makeShelves, shelvesOf, shelfUsage } from '../web/shelves.js';
import { createState, putObject, putEquipment, setFrameShelves, connectShelfLevels, paintPipeRoute, pipeColumnIds, removePipeColumn, serialize, deserialize } from '../web/core.js';
import { ensureSimulation, transferInventory, simulationTick, count, resourceTotals } from '../web/simulation.js';
const cell=(x,y=2,z=0)=>({x,y,z});
const block=(extra={})=>({type:'tank',x:0,y:1,z:0,rotation:0,width:2,depth:2,height:4,shelfId:'shelf-1',...extra});
function setup(){const state=createState(false);assert.equal(putObject(state,{type:'frame',x:10,y:1,z:0,rotation:0,width:10,depth:6,height:8,mount:'floor',shelves:makeShelves([4,4]),children:[],nextItemId:1}),'');return{state,frame:state.objects[0]};}
test('shelves partition height and allow the same footprint on separate floors',()=>{
  const {state,frame}=setup();assert.equal(putEquipment(state,frame.id,block()),'');assert.equal(putEquipment(state,frame.id,block({z:4,shelfId:'shelf-2'})),'');
  assert.deepEqual(shelvesOf(frame).map(s=>[s.z,s.height]),[[0,4],[4,4]]);assert.equal(shelfUsage(frame,frame.shelves[0]).free,56);assert.equal(shelfUsage(frame,frame.shelves[1]).used,4);
});
test('new blocks stand on the chosen shelf and cannot pierce its ceiling',()=>{
  const {state,frame}=setup();for(const extra of [{height:5},{z:1},{shelfId:'shelf-99'},{shelfId:null}])assert.ok(putEquipment(state,frame.id,block(extra)));assert.equal(frame.children.length,0);
});
test('changing shelf height preserves stock and moves its attached blocks to the new base atomically',()=>{
  const {state,frame}=setup();putEquipment(state,frame.id,block({z:4,shelfId:'shelf-2'}));const owner=`${frame.id}/${frame.children[0].id}`;transferInventory(state,owner,'crude',4);
  assert.equal(setFrameShelves(state,frame.id,[3,5]),'');assert.equal(state.objects[0].children[0].z,3);assert.equal(ensureSimulation(state).containers[owner].stored.crude,4);
  const before=serialize(state);assert.ok(setFrameShelves(state,frame.id,[6,2]));assert.equal(serialize(state),before);assert.match(setFrameShelves(state,frame.id,[8]),/перенеси/);
});
test('an upper block can move between shelves without changing its identity or buffer',()=>{
  const {state,frame}=setup();putEquipment(state,frame.id,block());const item=frame.children[0],owner=`${frame.id}/${item.id}`;transferInventory(state,owner,'crude',4);
  assert.equal(putEquipment(state,frame.id,{...item,z:4,shelfId:'shelf-2'},item.id),'');assert.equal(frame.children[0].id,item.id);assert.equal(ensureSimulation(state).containers[owner].stored.crude,4);
});
test('a riser joins horizontal pipes on two shelves and transports resources through the actual graph',()=>{
  const {state,frame}=setup();putEquipment(state,frame.id,block());putEquipment(state,frame.id,block({x:6,z:4,shelfId:'shelf-2'}));
  assert.equal(paintPipeRoute(state,frame.id,cell(2),cell(3)),'');assert.equal(connectShelfLevels(state,frame.id,'shelf-1',3,2,1),'');assert.equal(paintPipeRoute(state,frame.id,cell(3,2,4),cell(5,2,4)),'');
  assert.equal(state.graph.links.length,1);const owner=`${frame.id}/${frame.children[0].id}`;transferInventory(state,owner,'crude',4);for(let i=0;i<35;i++)simulationTick(state);
  assert.equal(state.simulation.containers[`${frame.id}/${frame.children[1].id}`].stored.crude,4);assert.equal(count(resourceTotals(state)),64);assert.ok(frame.pipes.every(p=>p.faces.length===2));
});
test('blocked risers and attempted branches leave all pipes and resources unchanged',()=>{
  const {state,frame}=setup();putEquipment(state,frame.id,block({x:4,z:4,shelfId:'shelf-2'}));const before=serialize(state);
  assert.ok(connectShelfLevels(state,frame.id,'shelf-1',4,2,1));assert.equal(serialize(state),before);assert.match(connectShelfLevels(state,frame.id,'shelf-2',3,4,1),/нет полки/);
  paintPipeRoute(state,frame.id,cell(2,4),cell(6,4));const path=serialize(state);assert.match(connectShelfLevels(state,frame.id,'shelf-1',4,4,1),/Ответвление/);assert.equal(serialize(state),path);
});
test('a vertical transition is removed as a unit and cannot lose its contents',()=>{
  const {state,frame}=setup();connectShelfLevels(state,frame.id,'shelf-1',5,4,1);const seed=frame.pipes[0].id,ids=pipeColumnIds(state,seed,frame.id);assert.equal(ids.length,5);
  const sim=ensureSimulation(state);sim.pipes[ids[2]]=[{resource:'crude',destination:`${frame.id}/item-99/port-1`}];const before=serialize(state);assert.match(removePipeColumn(state,seed,frame.id),/забери/);assert.equal(serialize(state),before);
  sim.inventory.crude++;sim.pipes[ids[2]]=[];assert.equal(removePipeColumn(state,seed,frame.id),'');assert.equal(frame.pipes.length,0);
});
test('v5 saves preserve shelf layout, IDs, risers and buffers; v4 loads without moving any geometry',()=>{
  const {state,frame}=setup();putEquipment(state,frame.id,block({z:4,shelfId:'shelf-2'}));connectShelfLevels(state,frame.id,'shelf-1',7,4,1);const text=serialize(state);assert.equal(serialize(deserialize(text)),text);assert.equal(JSON.parse(text).version,5);
  const old=JSON.parse(text);old.version=4;delete old.objects[0].shelves;delete old.objects[0].children[0].shelfId;old.objects[0].children[0].z=3;
  const loaded=deserialize(JSON.stringify(old));assert.equal(loaded.objects[0].children[0].z,3);assert.deepEqual(loaded.objects[0].shelves,makeShelves([8]));assert.deepEqual(loaded.simulation,old.simulation);
});
test('corrupt shelf layouts reject gaps, overlaps, duplicate IDs and unsupported block references',()=>{
  const {state,frame}=setup();putEquipment(state,frame.id,block());const text=serialize(state);
  for(const change of [f=>f.shelves=[],f=>f.shelves[0].height=0,f=>f.shelves[1].z=3,f=>f.shelves[1].id='shelf-1',f=>f.children[0].shelfId='missing',f=>f.shelves=null]){const data=JSON.parse(text);change(data.objects[0]);assert.throws(()=>deserialize(JSON.stringify(data)));assert.equal(serialize(state),text);}
});
