// Keep simulation ticks independent of rendering. A bounded batch leaves time for input.
export function createSimulationRunner({ getState, step, now = () => performance.now(), budgetMs = 8 }) {
  let previous = null, debt = 0, sampleStart = null, completed = 0, tps = 0;
  function reset() { previous = sampleStart = null; debt = completed = tps = 0; }
  return {
    reset,
    get metrics() { return { tps }; },
    advance(time) {
      const sim = getState().simulation;
      if (!sim.running) { reset(); return 0; }
      if (previous === null) { previous = sampleStart = time; return 0; }
      const rate = sim.rate || 4;
      debt = Math.min(debt + Math.max(0, Math.min((time - previous) / 1000, .25)) * rate, rate * .25);
      previous = time;
      const started = now(); let steps = 0;
      while (debt >= 1) {
        if (steps && now() - started >= budgetMs) break;
        step(getState()); debt--; steps++; completed++;
      }
      if (time - sampleStart >= 1000) {
        tps = Math.round(completed * 1000 / (time - sampleStart));
        sampleStart = time; completed = 0;
      }
      return steps;
    }
  };
}
