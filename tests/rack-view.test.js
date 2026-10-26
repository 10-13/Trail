import test from 'node:test';
import assert from 'node:assert/strict';
import { rackView } from '../web/rack-view.js';
import { rackOverviewLayout } from '../web/rack-overview.js';
import { dimensions } from '../web/geometry.js';
import { worldEquipment } from '../web/core.js';
import { worldPipe, DIRECTIONS } from '../web/logistics.js';
import { makeShelves } from '../web/shelves.js';

const frame={type:'frame',x:7,y:1,z:2,width:10,depth:6,height:8,shelves:makeShelves([4,4])};
const rotations=[[1,2,3],[2,-1,3],[-1,-2,3],[-2,1,3]];
test('both rack views keep world -X to the left for every rack yaw, including saved orientations',()=>{
  for(const [rotation,orientation]of rotations.entries())for(const explicit of [false,true]){
    const f={...frame,rotation,...(explicit?{orientation}:{})},view=rackView(f),layout=rackOverviewLayout(f,1000,700);
    assert.deepEqual(layout.size,view.size);
    const left={x:1,y:view.size.depth/2,z:4},right={...left,x:view.size.width-1};
    for(const p of [left,right,{x:0,y:0,z:0},{x:view.size.width,y:view.size.depth,z:8}])assert.deepEqual(view.point(view.unproject(p)),p);
    assert.ok(layout.project(left.x,left.y,left.z).x<layout.project(right.x,right.y,right.z).x);
    // An asymmetric local position must land at these wagon-aligned coordinates.
    assert.deepEqual(view.point({x:2,y:1,z:4}),[{x:2,y:1,z:4},{x:5,y:2,z:4},{x:8,y:5,z:4},{x:1,y:8,z:4}][rotation]);
    assert.deepEqual(view.size,rotation%2?{width:6,depth:10,height:8}:{width:10,depth:6,height:8});
  }
});
test('boxes, voxel centers, pipe arms and ports agree with their physical wagon locations',()=>{
  const item={type:'machine',x:1,y:2,z:0,width:2,depth:3,height:2,rotation:1};
  for(let rotation=0;rotation<4;rotation++){
    const f={...frame,rotation},saved=JSON.stringify(f),view=rackView(f),box=view.box(item),physical=worldEquipment(f,item);
    assert.deepEqual(dimensions(box),dimensions(physical));
    for(const key of ['x','y','z'])assert.equal(box[key],physical[key]-f[key]);
    const pipe={id:'pipe-1',x:3,y:2,z:0,faces:['nx','pz']},shown=view.pipe(pipe),world=worldPipe(f,pipe);
    assert.deepEqual(shown.faces,world.faces);
    for(const key of ['x','y','z'])assert.equal(shown[key],world[key]-f[key]);
    const center=view.point({x:pipe.x+.5,y:pipe.y+.5,z:pipe.z+.5});
    for(const key of ['x','y','z'])assert.equal(center[key],shown[key]+.5);
    const port=view.port({cell:pipe,face:'nx'}),v=DIRECTIONS[port.face];
    assert.deepEqual(view.point({x:pipe.x,y:pipe.y+.5,z:pipe.z+.5}),{x:port.cell.x+.5+v[0]*.5,y:port.cell.y+.5+v[1]*.5,z:port.cell.z+.5+v[2]*.5});
    assert.equal(JSON.stringify(f),saved);
  }
});
