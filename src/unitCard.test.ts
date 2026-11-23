// The unit card model, against the real Horus Heresy library files.
import 'fake-indexeddb/auto';
import fs from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { LibraryDB } from './db';
import { planImport } from './importer';
import { applyImport } from './store';
import { buildArmy, makeLookup, parseGear, type ArmyCopy, type ArmyUnit } from './army';
import { buildUnitCard, chooseLines } from './unitCard';
import type { Entity } from './model';

const dir = '/home/claude/out';
// the 23 active files; the three retired ones and any .bak are ignored
const RETIRED = ['hh3-generic-astartes-units-pt1.json', 'hh3-generic-astartes-units-pt2.json', 'hh3-core-special-rules.json'];
const FILES = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.endsWith('.bak.json') && !RETIRED.includes(f)).sort().map((f) => `${dir}/${f}`) : [];
const have = FILES.length > 0;

describe.skipIf(!have)('unit card (real library)', () => {
  const db = new LibraryDB('unitcard-test');
  let ents: Entity[] = [];
  let look: ReturnType<typeof makeLookup>;
  const unitNamed = (n: string) => ents.find((e) => e.type === 'unit' && e.name === n)!;
  const copy = (gear: string[], entity: Entity, listName = entity.name): ArmyCopy => ({
    id: 'c1', models: 1, gear: parseGear(gear, entity.name, look, [entity.name, ...(entity.profiles ?? []).flatMap((p) => p.names)]),
  });
  const army = (entity: Entity, gear: string[], listName = entity.name): ArmyUnit => ({ id: 'u1', listName, entityId: entity.id, matchScore: 1, copies: [copy(gear, entity, listName)] });

  beforeAll(async () => {
    for (const f of FILES) await applyImport(db, planImport(JSON.parse(fs.readFileSync(f, 'utf8'))));
    ents = await db.entities.toArray();
    look = makeLookup(ents, await db.rules.toArray());
  }, 120000);

  it('shows only the selected profile line', () => {
    const praetor = unitNamed('Praetor');
    expect(praetor.profiles?.length).toBe(2);
    const plain = chooseLines(praetor, copy([], praetor), 'Praetor');
    expect(plain.indexes.map((i) => praetor.profiles![i].names[0])).toEqual(['Praetor']);
    const jump = chooseLines(praetor, copy(['Jump Pack'], praetor), 'Praetor');
    expect(jump.indexes.map((i) => praetor.profiles![i].names[0])).toEqual(['Praetor with Jump Pack']);
  });

  it('keeps every model line of a squad, and swaps a whole model for its mounted version', () => {
    const squad = unitNamed('Assault Squad');
    expect(chooseLines(squad, copy([], squad), squad.name).indexes).toEqual([0, 1]);
    const mounted = unitNamed('Mounted Praetor');
    const picked = chooseLines(mounted, copy(['Scimitar Jetbike'], mounted), mounted.name);
    expect(picked.indexes.map((i) => mounted.profiles![i].names[0])).toEqual(['Praetor on Scimitar Jetbike']);
  });

  it('shows all four lines of a titan', () => {
    const t = unitNamed('Warhound Titan');
    expect(chooseLines(t, copy([], t), t.name).indexes).toHaveLength(t.profiles!.length);
  });

  it('keeps a unit’s own rules apart from the gear it took', async () => {
    const scouts = unitNamed('Scout Squad');
    const m = await buildUnitCard(db, army(scouts, ['Scout Sergeant: melta bombs']), scouts, look);
    const own = [...m.rules, ...m.traits, ...m.types].map((r) => r.name.toLowerCase());
    expect(own).not.toContain('armourbane');
    expect(own).not.toContain('melta');
    const bombs = m.taken[0].items.find((i) => /melta bomb/i.test(i.name));
    expect(bombs).toBeTruthy();
    expect(bombs!.lines.flatMap((l) => l.rules.map((r) => r.name.toLowerCase()))).toContain('armourbane');
  });

  it('gives every taken item a dropdown, even one the library does not know', async () => {
    const scouts = unitNamed('Scout Squad');
    const m = await buildUnitCard(db, army(scouts, ['Scout Sergeant: melta bombs, a thing nobody printed']), scouts, look);
    const names = m.taken[0].items.map((i) => i.name);
    expect(names.some((n) => /melta bomb/i.test(n))).toBe(true);
    const lost = m.taken[0].items.find((i) => i.name === 'a thing nobody printed');
    expect(lost?.missing).toBe(true);
    expect(lost?.note).toMatch(/not in your library/i);
  });

  it('gives each profile line the unit-level wargear and rules nobody else claims', async () => {
    const pred = unitNamed('Predator');
    const m = await buildUnitCard(db, army(pred, []), pred, look);
    expect(m.wargear.map((g) => g.name)).toEqual(expect.arrayContaining(['Predator cannon', 'Heavy bolter']));
    expect(m.rules.map((r) => r.name)).toEqual(expect.arrayContaining(['Weapon Mounts', 'Smokescreen']));
  });

  it('a Praetor with a Jump Pack gets the jump pack rules; one without does not', async () => {
    const praetor = unitNamed('Praetor');
    const plain = await buildUnitCard(db, army(praetor, ['Bolt pistol, melta bombs']), praetor, look);
    expect(plain.lines.map((l) => l.label)).toEqual(['Praetor']);
    expect(plain.rules.map((r) => r.name)).not.toContain('Deep Strike');
    expect(plain.rules.map((r) => r.name)).not.toContain('Armourbane');
    expect(plain.wargear.map((g) => g.name)).toEqual(expect.arrayContaining(['Bolter', 'Bolt pistol']));
    expect(plain.types.map((t) => t.name)).toContain('Command Sub-Type');
    expect(plain.taken[0].items.find((i) => /melta bomb/i.test(i.name))?.lines[0].rules.map((r) => r.name)).toContain('Armourbane');

    const jump = await buildUnitCard(db, army(praetor, ['Jump Pack, melta bombs']), praetor, look);
    expect(jump.lines.map((l) => l.label)).toEqual(['Praetor with Jump Pack']);
    expect(jump.rules.map((r) => r.name)).toContain('Deep Strike');
    expect(jump.taken[0].items.map((i) => i.name).join()).toMatch(/jump pack/i);
  });

  it('reads who has an item from "5 Scouts, Scout Sergeant: melta bombs"', () => {
    const scouts = unitNamed('Scout Squad');
    const g = copy(['5 Scouts, Scout Sergeant: melta bombs'], scouts).gear;
    expect(g.find((x) => /melta/i.test(x.name))).toMatchObject({ forModel: 'Scout Sergeant', kind: 'weapon' });
  });

  it('matches "Meltabombs" to Melta bombs', () => {
    expect(look.gear('Meltabombs')?.name).toMatch(/melta bombs/i);
  });

  it('every unit has something to show for its profile', async () => {
    const empty: string[] = [];
    for (const u of ents.filter((e) => e.type === 'unit')) {
      const m = await buildUnitCard(db, army(u, []), u, look);
      if (!m.lines.length || !m.lines.some((l) => l.stats.length)) empty.push(u.name);
    }
    expect(empty.sort()).toEqual([]);
  }, 120000);
});
