import test from 'node:test';
import assert from 'node:assert/strict';
import { rackOverviewLayout, rackShelfAt } from '../web/rack-overview.js';
import { makeShelves } from '../web/shelves.js';
const frame={type:'frame',width:12,depth:6,height:8,shelves:makeShelves([2,4,2]),children:[],pipes:[]};
test('hover expansion adds space above one floor while its base and lower floors stay stable',()=>{
  const base=rackOverviewLayout(frame,1000,700),expanded=rackOverviewLayout(frame,1000,700,{'shelf-2':1});
  assert.deepEqual(base.floors[0],expanded.floors[0]);assert.equal(base.floors[1].bottom,expanded.floors[1].bottom);assert.ok(expanded.floors[1].height>base.floors[1].height);assert.equal(expanded.floors[2].height,base.floors[2].height);assert.ok(expanded.floors[2].bottom<base.floors[2].bottom);
  const originalPoint={x:base.floors[1].x+base.floors[1].width/2,y:(base.floors[1].top+base.floors[1].bottom)/2};assert.equal(rackShelfAt(expanded,originalPoint.x,originalPoint.y),'shelf-2');
});
test('leaving restores the collapsed geometry and never changes shelf definitions',()=>{
  const saved=JSON.stringify(frame),base=rackOverviewLayout(frame,900,600);rackOverviewLayout(frame,900,600,{'shelf-1':1});const reset=rackOverviewLayout(frame,900,600);assert.deepEqual(reset.floors,base.floors);assert.equal(JSON.stringify(frame),saved);assert.equal(rackShelfAt(base,-100,-100),null);
});
test('front hit areas and projected shelf bases agree at desktop and phone sizes',()=>{
  for(const [w,h]of [[1440,850],[390,550]]){
    const layout=rackOverviewLayout(frame,w,h,{'shelf-3':1});
    for(const f of layout.floors){assert.equal(rackShelfAt(layout,f.x+f.width/2,(f.top+f.bottom)/2),f.id);assert.equal(layout.project(0,0,f.z).y,f.bottom);assert.equal(rackShelfAt(layout,f.x-layout.dx/2,(f.top+f.bottom)/2-layout.dy/2),f.id);assert.ok(f.top>=0);assert.ok(f.bottom<h);assert.ok(f.x>=0&&f.x+f.width<w);}
  }
});

test('deep narrow racks fit in a phone viewport without clipping their rear posts',()=>{
  const narrow={...frame,width:1,depth:12,height:10,shelves:makeShelves(Array(10).fill(1))},layout=rackOverviewLayout(narrow,390,500,{'shelf-5':1});
  for(const x of [0,1])for(const y of [0,12])for(const z of [0,10]){const point=layout.project(x,y,z);assert.ok(point.x>=0&&point.x<=390);assert.ok(point.y>=0&&point.y<=500);}
});
