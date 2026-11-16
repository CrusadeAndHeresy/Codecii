// TEST FIXTURES ONLY. Not imported by the app, so none of this is in the build.
// Fictional sample data written for this app (no publisher text). It exercises the edge cases:
// parameterised rules, FAQ amendments, clarifications, conflicting reprints, faction overrides,
// renames across editions and units that carry rules.
const system = { name: 'Demo Skirmish', publisher: 'Sample data' };

export const demoImports = [
  {
    format: 'rules-library/v1', system, edition: { name: '1.0' },
    source: { title: 'Demo Rulebook (1st ed.)', kind: 'rulebook', isCore: true, published: '2024-02-01' },
    rules: [
      { name: 'Deep Strike', category: 'Special Rule', phase: 'Movement', page: 40,
        fullText: 'Units with Deep Strike may be held in reserve and arrive anywhere more than 9" from enemy units. Roll a D6 for scatter on arrival.' },
    ],
  },
  {
    format: 'rules-library/v1', system, edition: { name: '2.0' },
    source: { title: 'Demo Rulebook', kind: 'rulebook', isCore: true, published: '2026-01-10' },
    rules: [
      { name: 'Rending (X)', category: 'Weapon Trait', phase: 'Shooting / Assault', page: 112,
        parameters: [{ name: 'X', kind: 'roll', note: 'wound roll needed, e.g. 5+' }],
        fullText: 'When rolling to wound with this weapon, each result of X or more is a Rending hit. Rending hits ignore armour saves.',
        related: ['Resilient'] },
      { name: 'Fearless', category: 'Special Rule', phase: 'Any', page: 104,
        fullText: 'This unit automatically passes Morale checks and cannot be Pinned.' },
      { name: 'Morale', category: 'Rule', phase: 'Any', page: 60,
        summary: 'Units that lose a quarter of their models test on Leadership or fall back.' },
      { name: 'Resilient (X)', aliases: ['FNP', 'Feel No Pain'], category: 'Special Rule', phase: 'Any', page: 108,
        parameters: [{ name: 'X', kind: 'roll' }],
        fullText: 'Each time a model with this rule loses a wound, roll a D6. On X or more the wound is ignored.' },
      { name: 'Deep Deployment', aliases: ['Deep Strike', 'DS'], category: 'Special Rule', phase: 'Movement', page: 102,
        supersedes: { edition: '1.0', name: 'Deep Strike' },
        fullText: 'This unit may start in reserve. When it arrives, place it anywhere more than 6" from enemy units. It cannot charge that turn.' },
      { name: 'Ambush', category: 'Special Rule', phase: 'Movement', page: 101,
        fullText: 'A unit with Ambush that arrives using Deep Deployment may shoot at full effect that turn.', related: ['Deep Deployment'] },
      { name: 'Fleet', category: 'Special Rule', phase: 'Movement', page: 106,
        fullText: 'This unit may re-roll its run distance.' },
      { name: 'Shrouded (X)', category: 'Special Rule', phase: 'Shooting', page: 110,
        parameters: [{ name: 'X', kind: 'roll' }],
        fullText: 'Gains a save of X against shooting attacks. This save cannot be combined with cover.' },
      { name: 'Allocating Wounds', category: 'Rule', section: 'Shooting Phase', phase: 'Shooting', page: 52,
        fullText: 'Wounds are allocated to the closest model first. A model may make only one save against each wound, choosing the best save available.' },
      { name: 'Charging', category: 'Rule', section: 'Assault Phase', phase: 'Assault', page: 70,
        fullText: 'A unit that arrived from reserve this turn cannot declare a charge unless a special rule says otherwise.' },
      { name: 'Running', category: 'Rule', section: 'Movement Phase', phase: 'Movement', page: 34,
        fullText: 'Instead of shooting, a unit may run D6". A unit that runs cannot charge in the same turn.' },
      { name: 'Infantry', category: 'Model Type', phase: 'Any', page: 90,
        fullText: 'Infantry may run. Infantry units can be Pinned.' },
      { name: 'Heavy Sub-Type', aliases: ['Heavy'], category: 'Model Sub-Type', phase: 'Movement', page: 92,
        fullText: 'Heavy units cannot run.' },
      { name: 'Character Sub-Type', aliases: ['Character'], category: 'Model Sub-Type', phase: 'Any', page: 91,
        fullText: 'A Character may join a unit. While joined, it counts as part of that unit for all rules.' },
    ],
    entities: [
      { name: 'Bolt Pistol', type: 'weapon', page: 130, stats: { Range: '12"', S: 4, AP: 5 }, rules: [] },
      { name: 'Refractor Field', type: 'wargear', page: 134, rules: ['Resilient (6+)'] },
    ],
  },
  {
    format: 'rules-library/v1', system, edition: { name: '2.0' },
    source: { title: 'Iron Wardens Army Book', kind: 'supplement', published: '2026-03-01' },
    rules: [
      { name: 'Fleet', category: 'Special Rule', phase: 'Movement', page: 88,
        fullText: 'This unit may re-roll its run distance and may run and charge in the same turn.' },
      { name: 'Fearless', faction: 'Iron Wardens', overrides: 'Fearless', category: 'Special Rule', phase: 'Any', page: 12,
        fullText: 'Iron Wardens units with Fearless automatically pass Morale checks but may be Pinned.' },
    ],
    entities: [
      { name: 'Warden Breachers', type: 'unit', faction: 'Iron Wardens', page: 30, unitType: 'Infantry', subTypes: ['Heavy'], role: 'Elites',
        stats: { M: 5, WS: 4, BS: 4, S: 4, T: 4, W: 1, Sv: '3+' },
        rules: ['Fearless', 'Deep Deployment', 'Ambush', 'Fleet'], wargear: ['Breaching Axe', 'Bolt Pistol'] },
      { name: 'Warden Castellan', type: 'unit', faction: 'Iron Wardens', page: 28, unitType: 'Infantry', subTypes: ['Character'], role: 'Command',
        stats: { M: 6, WS: 5, BS: 5, S: 4, T: 4, W: 3, Sv: '2+' },
        rules: ['Resilient (5+)', 'Fearless'], wargear: ['Breaching Axe', 'Refractor Field'] },
      { name: 'Breaching Axe', type: 'weapon', faction: 'Iron Wardens', page: 70, stats: { Range: 'Melee', S: '+1', AP: 4 }, rules: ['Rending (5+)'] },
    ],
  },
  {
    format: 'rules-library/v1', system, edition: { name: '2.0' },
    source: { title: 'Demo FAQ', kind: 'faq', version: '1.1', published: '2026-05-01' },
    amendments: [
      { rule: 'Rending', type: 'replace', find: 'Rending hits ignore armour saves.', text: 'Rending hits ignore armour saves but not invulnerable saves.', page: 2 },
      { rule: 'Resilient', type: 'clarification', question: 'Do two Resilient rules stack?', text: 'No. Use the best value.', page: 3 },
      { rule: 'Ambush', alsoRules: ['Deep Deployment', 'Charging'], type: 'clarification', page: 3,
        question: 'Does Ambush let a unit charge after arriving by Deep Deployment?', text: 'No. Ambush only changes shooting.' },
    ],
  },
];
