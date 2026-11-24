import 'fake-indexeddb/auto';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LibraryDB } from './db';
import { planImport } from './importer';
import { applyImport } from './store';
import { buildEditionIndex } from './search';
import { buildArmy, canonRole, groupByRole, makeLookup, matchUnit, nameScore, parseGear, unitModels, unitPoints, SURE, type ArmyUnit } from './army';
import { joinOverlap, readArmyText } from './armyRead';
import { buildCombo } from './views';

describe('New Recruit table lists', () => {
  it('reads role headings, (N) squad sizes and wrapped options', () => {
    const r = readArmyText(['The Fall', '3000', '++ Command ++', 'Master of Descent 140 pts', '++ Troops ++', '(10) Tactical Squad 100 pts', '• 9x Legionary', '• Prime Unit',
      '(10) Tactical Squad 100 pts', '• 9x Legionary', '++ Heavy Transport ++', 'Spartan Assault Tank 2660 pts'].join('\n'));
    expect(r.units.map((u) => [u.slot, u.name, u.models])).toEqual([['Command', 'Master of Descent', 1], ['Troops', 'Tactical Squad', 10], ['Troops', 'Tactical Squad', 10], ['Heavy Transport', 'Spartan Assault Tank', 1]]);
    expect(r.units[1].details).toEqual(['9× Legionary', 'Prime Unit']);
    const l = readArmyText(['The Fall', '1000', '++ Troops | Blood Angels ++', 'Tactical Squad 100 pts', '++ Troops | Space Wolves ++', 'Tactical Squad 100 pts'].join('\n'));
    expect(l.units.map((u) => [u.slot, u.legion])).toEqual([['Troops', 'Blood Angels'], ['Troops', 'Space Wolves']]);
  });
});

describe('prime unit', () => {
  it('links "Prime Unit" to the Prime Slots rule through its alias', () => {
    const rule = { id: 'r1', name: 'Prime Slots', aliases: ['Prime Unit'] } as any;
    const g = parseGear(['Prime Unit'], 'Tactical Squad', makeLookup([], [rule]));
    expect(g[0]).toMatchObject({ kind: 'rule', ruleId: 'r1' });
  });
});

describe('gear aliases', () => {
  it('resolves a generic name through an entity alias', () => {
    const e = (name: string, aliases?: string[]) => ({ id: name, name, aliases, type: 'weapon' } as any);
    const look = makeLookup([e('Power sword', ['Power weapon']), e('Pair of lightning claws', ['Lightning claws'])], []);
    expect(look.gear('power weapon')?.name).toBe('Power sword');
    expect(look.gear('Lightning claws')?.name).toBe('Pair of lightning claws');
  });
});

describe('roles and names', () => {
  it('reads a role from a list heading, and ignores detachment names', () => {
    expect(canonRole('HQ')).toBe('Command');
    expect(canonRole('Heavy Support')).toBe('Heavy Support');
    expect(canonRole('Dedicated Transport')).toBe('Transport');
    expect(canonRole('Fast-Attack Slot')).toBe('Fast Attack');
    expect(canonRole('Fortifications')).toBe('Fortification');
    expect(canonRole('War-engine')).toBe('War-engine');
    expect(canonRole('Linebreaker Primary Detachment')).toBeUndefined();
  });
  it('treats "Legion Tactical Squad" and "Tactical Squad" as the same unit', () => {
    expect(nameScore('Legion Tactical Squad', 'Tactical Squad')).toBe(1);
    expect(nameScore('Rhino', 'Land Raider')).toBeLessThan(0.5);
  });
  it('joins screenshots, dropping the lines repeated where one overlaps the next', () => {
    expect(joinOverlap([['a', 'b', 'c', 'd'], ['c', 'd', 'e']])).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('wargear lines', () => {
  const look = { gear: (s: string) => (/bolt rifle/i.test(s) ? ({ id: 'e#bolt-rifle', name: 'Bolt rifle' } as never) : undefined), rule: () => undefined };
  it('reads counts, labels and models, and skips who is in the unit', () => {
    const g = parseGear(['3 Aquilon Terminators, Prime Advantage: Hetaeron Guard, 3× bolt rifles (+15 pts)'], 'Aquilon Terminator Sodality', look);
    expect(g.map((x) => [x.name, x.kind, x.count, x.label])).toEqual([
      ['Hetaeron Guard', 'text', undefined, 'Prime Advantage'],
      ['bolt rifles', 'weapon', 3, undefined],
    ]);
  });
  it('keeps brackets together and drops the type prefix and [brackets] on list items', () => {
    const g = parseGear(['Infantry (Champion, Heavy) great frost blade, [Legiones Astartes], Infantry (Command) paragon blade'], 'Varagyr', look);
    expect(g.map((x) => x.name)).toEqual(['great frost blade', 'Legiones Astartes', 'paragon blade']);
  });
});

const dir = '/home/claude/out';
const have = fs.existsSync(`${dir}/hh3-core-rulebook.json`) && fs.existsSync(`${dir}/hh3-liber-hereticus.json`);

describe.skipIf(!have)('an army list against the real library', () => {
  const LIST = `Test Heresy List - Horus Heresy (Age of Darkness) - [595pts]

Crusade Force Organisation Chart [595pts]
HQ
Praetor [120pts]: Power weapon, Bolt pistol
Troops
Legion Tactical Squad [175pts]: 15x Legionary, Legion Tactical Sergeant, Combi-melta
Legion Tactical Squad [100pts]: 9x Legionary, Legion Tactical Sergeant
Heavy Support
Predator [130pts]: Predator cannon, Heavy bolter sponsons
Dedicated Transport
Rhino [35pts]
Rhino [35pts]`;

  it('makes one card per unit, groups them by role, and links wargear and rules', async () => {
    const db = new LibraryDB('army-test');
    for (const f of ['hh3-core-rulebook', 'hh3-liber-hereticus', 'hh3-liber-astartes', 'hh3-imperialis-militia']) {
      if (fs.existsSync(`${dir}/${f}.json`)) await applyImport(db, planImport(JSON.parse(fs.readFileSync(`${dir}/${f}.json`, 'utf8'))));
    }
    const edId = (await db.editions.toArray())[0].id;
    const index = await buildEditionIndex(db, edId);
    const ents = await db.entities.where('editionId').equals(edId).toArray();
    const army = buildArmy(readArmyText(LIST), { editionId: edId, units: ents.filter((e) => e.type === 'unit'), look: makeLookup(ents, [...index.rules.values()]) });

    // 6 lines in the list, but Tactical Squad and Rhino each appear twice: 4 cards
    expect(army.units.map((u) => u.listName)).toEqual(['Praetor', 'Legion Tactical Squad', 'Predator', 'Rhino']);
    const tac = army.units[1], rhino = army.units[3];
    expect(tac.copies.map((c) => c.models)).toEqual([16, 10]);
    expect(rhino.copies).toHaveLength(2);
    expect(unitModels(tac)).toBe(26);
    expect(unitPoints(tac)).toBe(275);
    expect(army.total).toBe(595);
    expect(army.sum).toBe(595);

    // each is matched to the library, and the name-only match is trusted
    for (const u of army.units) expect(u.entityId, u.listName).toBeTruthy();
    expect(ents.find((e) => e.id === tac.entityId)!.name).toBe('Tactical Squad');
    expect(tac.matchScore).toBeGreaterThanOrEqual(SURE);

    // roles come from the library (read from the book's role icons); the list's own headings only fill gaps
    const g = groupByRole(army.units, new Map(ents.map((e) => [e.id, e])));
    expect(g.map((x) => x.role)).toEqual(['High Command', 'Troops', 'Armour', 'Transport']);

    // weapons in the list are linked to library weapons; the unit's own models are kept apart from wargear (kind 'model')
    const pred = army.units[2].copies[0].gear;
    expect(pred.find((x) => /predator cannon/i.test(x.name))?.entityId).toBeTruthy();
    expect(tac.copies[0].gear.some((x) => x.kind !== 'model' && /legionary/i.test(x.name))).toBe(false);

    // the rules on a card come from the unit and its wargear, and open on the rule card
    const combo = await buildCombo(db, [`e:${tac.entityId!}`], index.mentions);
    expect(combo.rules.length).toBeGreaterThan(0);
    expect(matchUnit('Predator', ents.filter((e) => e.type === 'unit')).entity?.name).toBe('Predator');
  }, 60000);
});
