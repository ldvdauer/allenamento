/* Piano di esempio generico (inventato) nel formato .blokplan, usato solo dai test. */
const ex = (name, slot, prescription, interval) => ({ id: 'custom-' + name, name, slot, location: slot === 'wall' || slot === 'warmup' ? 'wall' : 'off_wall', domain: 'other', intensity: 'moderate', risk: 'low', prescription, summary: prescription, equipment: [], ...(interval ? { interval } : {}) });
const pb = (block, minutes) => ({ selectedDurationMinutes: minutes, block });
const warm = ex('Riscaldamento', 'warmup', 'Progressivo');
const hang = pct => ex('Open hand 20 mm 7"', 'strength', `3 × 7" · ${pct}% max`, { rounds: 3, workSeconds: 7, restSeconds: 180, cues: Array(3).fill(pct + '% max') });
const limit = ex('Limit board', 'wall', 'Qualità');
const press = ex('Press', 'strength', '2 × 6-8', { rounds: 2, workSeconds: 45, restSeconds: 120, selfPaced: true, reps: 6, cues: ['SX', 'DX'] });
const mob = ex('Mobilità', 'mobility', 'Anche');
const week = (pct, period) => [
  { type: 'wall', period, plannedBlocks: [pb(warm, 20), pb(hang(pct), 7), pb(limit, 30)], secondType: 'strength', secondPeriod: period, secondPlannedBlocks: [pb(press, 4)] },
  { type: 'rest' },
  { type: 'skills', period, plannedBlocks: [pb(warm, 20), pb(limit, 40)] },
  { type: 'activeRest', period, plannedBlocks: [pb(mob, 10)] },
  { type: 'rest' }, { type: 'strength', period, plannedBlocks: [pb(press, 4)] }, { type: 'rest' },
];
// 816519600 = lunedì 16 nov 2026, 12:00 CET, in secondi dall'epoca Apple
exports.blokplan = () => ({ title: 'Piano di esempio', isForSelf: true, athleteName: 'Climber', startDate: 816519600, weeks: [week(85, 'strength'), week(90, 'strength'), week(70, 'deload')] });
