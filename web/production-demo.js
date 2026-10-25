import { createState, putObject, putEquipment, connectEndpoints } from './core.js';
import { worldPorts } from './logistics.js';
import { ensureSimulation } from './simulation.js';
export function createProductionDemo(){
  const state=createState(false);
  const check=error=>{if(error)throw new Error(error);};
  check(putObject(state,{type:'frame',x:7,y:1,z:0,rotation:0,width:32,depth:10,height:8,mount:'floor',children:[],nextItemId:1}));
  const frame=state.objects[0];
  const input={id:'port-1',kind:'input',face:'nx',u:1,v:0},output={id:'port-2',kind:'output',face:'px',u:1,v:0};
  for(const [type,x,y,ports]of [
    ['tank',1,1,[{...output,resources:['crude']}]],['filter',9,1],['centrifuge',17,1],
    ['tank',25,1,[{...input,resources:['clean']}]],
    ['tank',9,6,[{...input,face:'ny',u:0,resources:['sludge']}]],
    ['tank',17,6,[{...input,face:'ny',u:0,resources:['residue']}]]
  ])check(putEquipment(state,frame.id,{type,x,y,z:0,rotation:0,...(ports?{ports,nextPortId:3}:{})}));
  const ports=worldPorts(state),get=(i,id)=>ports.find(p=>p.objectId===frame.children[i].id&&p.portId===id);
  for(const [a,ap,b,bp]of [[0,'port-2',1,'port-1'],[1,'port-2',2,'port-1'],[2,'port-2',3,'port-1'],[1,'port-3',4,'port-1'],[2,'port-3',5,'port-1']])check(connectEndpoints(state,get(a,ap),get(b,bp)));
  const sim=ensureSimulation(state);sim.inventory={};
  const source=sim.containers[`${frame.id}/${frame.children[0].id}`];source.capacity=128;source.stored={crude:128};
  sim.containers[`${frame.id}/${frame.children[3].id}`].capacity=8;
  sim.running=false;return state;
}
