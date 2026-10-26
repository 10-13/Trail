import { dimensions, localSize, orientationOf, transformCell, transformBox } from './geometry.js';
import { rotateFace } from './logistics.js';

// Both editors follow the wagon axes: the train's front (world -X) is left.
// Keep continuous points separate from voxel cells: their reflected origins
// differ by one voxel. Construction and saves remain in rack-local coordinates.
export function rackView(frame) {
  const size=dimensions(frame),local=localSize(frame),axes=orientationOf(frame);
  const origin={...frame,x:0,y:0,z:0};
  function point(p) {
    const input=[p.x,p.y,p.z??0],lengths=[local.width,local.depth,local.height],result=[];
    axes.forEach((axis,i)=>{result[Math.abs(axis)-1]=axis>0?input[i]:lengths[i]-input[i];});
    return {x:result[0],y:result[1],z:result[2]};
  }
  function unproject(p) {
    const input=[p.x,p.y,p.z??0],lengths=[local.width,local.depth,local.height];
    const result=axes.map((axis,i)=>axis>0?input[Math.abs(axis)-1]:lengths[i]-input[Math.abs(axis)-1]);
    return {x:result[0],y:result[1],z:result[2]};
  }
  const cell=p=>({...p,...transformCell(p,local,frame)});
  const pipe=p=>({...cell(p),faces:p.faces.map(f=>rotateFace(f,frame))});
  const port=p=>({...p,cell:cell(p.cell),face:rotateFace(p.face,frame)});
  return {size,point,unproject,cell,pipe,port,box:item=>transformBox(origin,item)};
}
