import { dimensions, localSize, orientationOf, transformBox } from './geometry.js';
import { makeShelves } from './shelves.js';
import { worldPipe, rackAtCell, localCell, localFace } from './logistics.js';
import { collectResources, ensureSimulation } from './simulation.js';

// Legacy free structures retain their physical footprint inside an enclosing rack.
export function wrapLegacyObject(object) {
  const size=dimensions(object);
  return {id:object.id,type:'frame',x:object.x,y:object.y,z:object.z,rotation:0,...size,mount:'floor',shelves:makeShelves([size.height]),nextItemId:2,pipes:[],children:[{...object,id:'item-1',x:0,y:0,z:0,shelfId:'shelf-1'}]};
}
export function uprightLegacyFrame(frame) {
  if(orientationOf(frame)[2]===3)return frame;
  const size=dimensions(frame);
  const children=(frame.children||[]).map(item=>{const world=transformBox(frame,item);const result={...world,x:world.x-frame.x,y:world.y-frame.y,z:world.z-frame.z};delete result.shelfId;return result;});
  const pipes=(frame.pipes||[]).map(pipe=>{const world=worldPipe(frame,pipe);return {...world,x:world.x-frame.x,y:world.y-frame.y,z:world.z-frame.z};});
  const result={...frame,...size,rotation:0,children,pipes,shelves:makeShelves([size.height])};delete result.orientation;return result;
}
export function remapLegacyOwners(simulation,owners) {
  if(!simulation)return;
  for(const [before,after]of owners){if(Object.hasOwn(simulation.containers||{},before)){simulation.containers[after]=simulation.containers[before];delete simulation.containers[before];}}
  for(const tokens of Object.values(simulation.pipes||{}))if(Array.isArray(tokens))for(const token of tokens)if(typeof token?.destination==='string')for(const [before,after]of owners)if(token.destination.startsWith(`${before}/port-`))token.destination=after+token.destination.slice(before.length);
}
export function migrateOwnedPipes(state) {
  let recovered=0,adopted=0;
  for(const pipe of state.pipes){
    const rack=rackAtCell(state,pipe);
    if(rack){rack.pipes.push({...pipe,...localCell(rack,pipe),faces:pipe.faces.map(face=>localFace(rack,face))});adopted++;continue;}
    if(state.simulation?.pipes[pipe.id]?.length)collectResources(state,pipe.id);recovered++;
  }
  state.pipes=[];ensureSimulation(state);return {recovered,adopted};
}
