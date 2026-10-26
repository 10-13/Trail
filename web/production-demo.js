import { makeShelves } from './shelves.js';
import { createState, putObject, putEquipment, connectEndpoints } from './core.js';
import { worldPorts } from './logistics.js';
import { ensureSimulation } from './simulation.js';
export function createProductionDemo(){
  const state=createState(false);
  const check=error=>{if(error)throw new Error(error);};
  check(putObject(state,{type:'frame',x:7,y:1,z:0,rotation:0,width:32,depth:10,height:8,shelves:makeShelves([4,4]),mount:'floor',children:[],nextItemId:1}));
  const frame=state.objects[0];
  const input={id:'port-1',kind:'input',face:'nx',u:1,v:0},output={id:'port-2',kind:'output',face:'px',u:1,v:0};
  for(const [type,x,y,ports]of [
    ['tank',1,1,[{...output,resources:['crude']}]],['filter',9,1],['centrifuge',17,1],
    ['tank',25,1,[{...input,resources:['clean']}]],
    ['tank',9,6,[{...input,face:'ny',u:0,resources:['sludge']}]],
    ['tank',17,6,[{...input,face:'ny',u:0,resources:['residue']}]]
  ])check(putEquipment(state,frame.id,{type,x,y,z:y===6?4:0,shelfId:y===6?'shelf-2':'shelf-1',rotation:0,...(ports?{ports,nextPortId:3}:{})}));
  const ports=worldPorts(state),get=(i,id)=>ports.find(p=>p.objectId===frame.children[i].id&&p.portId===id);
  for(const [a,ap,b,bp]of [[0,'port-2',1,'port-1'],[1,'port-2',2,'port-1'],[2,'port-2',3,'port-1'],[1,'port-3',4,'port-1'],[2,'port-3',5,'port-1']])check(connectEndpoints(state,get(a,ap),get(b,bp)));
  const sim=ensureSimulation(state);sim.inventory={};
  const source=sim.containers[`${frame.id}/${frame.children[0].id}`];source.capacity=128;source.stored={crude:128};
  sim.containers[`${frame.id}/${frame.children[3].id}`].capacity=8;
  sim.running=false;return state;
}

// Two independent lines share a wagon, but never share a pipe or a buffer.
// Feed/sludge on the left, filtering below separation in the middle,
// clean oil/residue on the right. Touching racks keep every pipe inside a rack.
export function createFactoryDemo(){
  const state=createState(false),check=error=>{if(error)throw new Error(error);};
  state.player={x:1.5,y:1.5,angle:0};
  for(const [x,width]of [[7,10],[17,14],[31,10]])check(putObject(state,{type:'frame',x,y:3,z:0,rotation:0,width,depth:8,height:8,shelves:makeShelves([4,4]),mount:'floor',children:[],nextItemId:1}));
  const [feed,process,products]=state.objects,lines=[];
  const port=(id,kind,face,u,v,resource)=>({id:`port-${id}`,kind,face,u,v,resources:[resource]});
  function add(frame,type,x,y,level,ports){
    check(putEquipment(state,frame.id,{type,x,y,z:level*4,shelfId:`shelf-${level+1}`,rotation:0,ports,nextPortId:ports.length+1}));
    return {frameId:frame.id,id:frame.children.at(-1).id};
  }
  for(const y of [1,6])lines.push({
    source:add(feed,'tank',1,y,0,[port(1,'output','px',1,0,'crude')]),
    sludge:add(feed,'tank',5,y,1,[port(1,'input','px',1,0,'sludge')]),
    filter:add(process,'filter',2,y,0,[port(1,'input','nx',1,0,'crude'),port(2,'output','pz',0,1,'filtered'),port(3,'output','nx',0,0,'sludge')]),
    centrifuge:add(process,'centrifuge',8,y,1,[port(1,'input','nx',1,0,'filtered'),port(2,'output','px',1,0,'clean'),port(3,'output','px',0,0,'residue')]),
    clean:add(products,'tank',1,y,1,[port(1,'input','nx',1,0,'clean')]),
    residue:add(products,'tank',5,y,0,[port(1,'input','nx',0,0,'residue')])
  });
  const get=(object,index)=>worldPorts(state).find(p=>p.frameId===object.frameId&&p.objectId===object.id&&p.portId===`port-${index}`);
  for(const line of lines)for(const [from,output,to]of [[line.source,1,line.filter],[line.filter,2,line.centrifuge],[line.filter,3,line.sludge],[line.centrifuge,2,line.clean],[line.centrifuge,3,line.residue]])check(connectEndpoints(state,get(from,output),get(to,1)));
  const sim=ensureSimulation(state);sim.inventory={};
  for(const line of lines){
    for(const object of Object.values(line))sim.containers[`${object.frameId}/${object.id}`].capacity=128;
    sim.containers[`${line.source.frameId}/${line.source.id}`].stored={crude:128};
  }
  sim.running=false;return state;
}
