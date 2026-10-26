import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFactoryDemo } from '../web/production-demo.js';
import { serialize, deserialize, dimensions } from '../web/core.js';
import { simulationTick, resourceTotals, count, simulationError } from '../web/simulation.js';
const owner=(frame,index)=>`${frame.id}/${frame.children[index].id}`;

test('two lines cross racks and shelves, consume finite feed, and conserve every resource',()=>{
  const s=createFactoryDemo(),[feed,process,products]=s.objects;
  assert.equal(s.objects.length,3);assert.equal(s.graph.links.length,10);assert.equal(s.graph.pipes.length,88);
  assert.deepEqual(s.pipes,[]);assert.ok(s.graph.pipes.every(p=>p.faces.length===2));
  for(const pipe of s.graph.pipes){const rack=s.objects.find(f=>f.id===pipe.frameId),size=dimensions(rack);assert.ok(rack);assert.ok(pipe.x>=rack.x&&pipe.x<rack.x+size.width&&pipe.y>=rack.y&&pipe.y<rack.y+size.depth&&pipe.z>=rack.z&&pipe.z<rack.z+size.height);}
  assert.deepEqual(process.children.map(o=>o.shelfId),['shelf-1','shelf-2','shelf-1','shelf-2']);
  assert.ok(s.graph.links.filter(l=>l.from.startsWith(process.id)&&l.to.startsWith(process.id)).every(l=>{
    const pipes=s.graph.pipes.filter(p=>l.pipeIds.includes(p.id));return pipes.some(p=>p.faces.includes('pz'));
  }));
  for(let i=0;i<2000;i++){
    simulationTick(s);assert.equal(count(resourceTotals(s)),256);
    assert.ok(Object.values(s.simulation.pipes).every(tokens=>tokens.length<=4));assert.equal(simulationError(s,s.simulation),'');
  }
  assert.deepEqual(resourceTotals(s),{sludge:64,clean:128,residue:64});
  for(const index of [0,2]){assert.equal(s.simulation.containers[owner(products,index)].stored.clean,64);assert.deepEqual(s.simulation.containers[owner(feed,index)].stored,{});}
  for(const index of [1,3]){assert.equal(s.simulation.containers[owner(feed,index)].stored.sludge,32);assert.equal(s.simulation.containers[owner(products,index)].stored.residue,32);}
});

test('a disabled line does not stop the other; save/load preserves active transport',()=>{
  const s=createFactoryDemo(),[,process,products]=s.objects;
  s.simulation.containers[owner(process,0)].enabled=false;
  for(let i=0;i<75;i++)simulationTick(s);
  const resumed=deserialize(serialize(s));
  for(let i=0;i<1000;i++){simulationTick(s);simulationTick(resumed);}
  assert.equal(serialize(resumed),serialize(s));assert.equal(count(resourceTotals(s)),256);
  assert.deepEqual(s.simulation.containers[owner(products,0)].stored,{});
  assert.equal(s.simulation.containers[owner(products,2)].stored.clean,64);
});

test('downloadable factory opens as exactly the same editable example',()=>{
  const loaded=deserialize(readFileSync(new URL('../web/examples/two-line-factory.json',import.meta.url),'utf8'));
  assert.equal(serialize(loaded),serialize(createFactoryDemo()));
});
