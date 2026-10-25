import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulationRunner } from '../web/simulation-runner.js';
import { createProductionDemo } from '../web/production-demo.js';
import { simulationTick, count, resourceTotals } from '../web/simulation.js';
import { serialize, deserialize } from '../web/core.js';
function fixture(rate=4,cost=0){
  const state={simulation:{running:true,rate,tick:0}};let clock=0;
  const runner=createSimulationRunner({getState:()=>state,step:s=>{s.simulation.tick++;clock+=cost;},now:()=>clock,budgetMs:8});
  return {state,runner};
}
test('ordinary mode advances four ticks per second and reports completed TPS',()=>{
  const {state,runner}=fixture();for(let t=0;t<=1000;t+=10)runner.advance(t);
  assert.equal(state.simulation.tick,4);assert.equal(runner.metrics.tps,4);
});
test('10k mode advances 10000 real ticks per second without per-tick renders',()=>{
  const {state,runner}=fixture(10000);for(let t=0;t<=1000;t+=10)runner.advance(t);
  assert.equal(state.simulation.tick,10000);assert.equal(runner.metrics.tps,10000);
});
test('time budget yields for input and reports achieved TPS below the target when overloaded',()=>{
  const {state,runner}=fixture(10000,1);for(let t=0;t<=1000;t+=10)assert.ok(runner.advance(t)<=8);
  assert.equal(state.simulation.tick,800);assert.equal(runner.metrics.tps,800);
});
test('pause, normal restart and tab visibility reset accumulated time and TPS',()=>{
  const {state,runner}=fixture(10000);runner.advance(0);runner.advance(100);state.simulation.running=false;runner.advance(200);const tick=state.simulation.tick;
  assert.equal(runner.metrics.tps,0);state.simulation.running=true;state.simulation.rate=4;runner.reset();runner.advance(10000);assert.equal(state.simulation.tick,tick);
  runner.advance(10250);assert.equal(state.simulation.tick,tick+1);
});
test('fast batches keep exactly the same resource state as single ticks, including save/reload',()=>{
  const fast=createProductionDemo(),single=deserialize(serialize(fast));fast.simulation.rate=10000;fast.simulation.running=true;
  const runner=createSimulationRunner({getState:()=>fast,step:simulationTick,now:()=>0});runner.advance(0);runner.advance(100);
  for(let i=0;i<1000;i++)simulationTick(single);
  single.simulation.rate=10000;single.simulation.running=true;assert.equal(serialize(fast),serialize(single));assert.equal(count(resourceTotals(fast)),128);
  assert.equal(deserialize(serialize(fast)).simulation.rate,10000);
  const corrupt=JSON.parse(serialize(fast));corrupt.simulation.rate=-1;assert.throws(()=>deserialize(JSON.stringify(corrupt)));
  const previous=JSON.parse(serialize(fast));delete previous.simulation.rate;assert.equal(deserialize(JSON.stringify(previous)).simulation.rate,4);
});
