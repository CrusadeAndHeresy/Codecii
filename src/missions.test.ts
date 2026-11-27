import { describe, expect, it } from 'vitest';
import { allMissions, missionTree, pickOne } from './missions';
import { planImport } from './importer';
import type { Rule } from './model';

const r = (name: string, gameType: string, path: string[]) => ({ id: name, name, mission: { gameType, path } }) as unknown as Rule;

describe('missions', () => {
  it('builds game type > sub-type > sub-sub-type, Legendary last', () => {
    const t = missionTree([r('Kol', 'Zone Mortalis', ['Legendary']), r('Wave', 'Pitched Battle', ['Legendary']), r('Quarter', 'Pitched Battle', ['Imperium at War', 'Annihilation']),
      r('Line', 'Pitched Battle', ['Onslaught']), r('Khal', 'Leviathan', ['Leviathan Missions', 'Legendary']), { id: 'x', name: 'untagged' } as Rule]);
    expect(t[0].name).toBe('Pitched Battle');
    expect(t[0].children.map((c) => c.name)).toEqual(['Imperium at War', 'Onslaught', 'Legendary']);
    expect(allMissions(t[0])).toHaveLength(3);
    expect(t.find((x) => x.name === 'Leviathan')!.children[0].children[0].missions[0].name).toBe('Khal');
    expect(pickOne([1, 2, 3], () => 0.99)).toBe(3);
  });
  it('carries the mission tag through import and rejects a malformed one', () => {
    const file = (mission: unknown) => ({ format: 'rules-library/v1', system: { name: 'S' }, edition: { name: '1' }, source: { title: 'B', kind: 'supplement', published: '2026-01-01' },
      rules: [{ name: 'M', category: 'Mission', mission }] }) as never;
    expect(planImport(file({ gameType: 'Pitched Battle', path: ['Onslaught'] })).rules[0].mission?.path).toEqual(['Onslaught']);
    expect(planImport(file({ path: 'x' })).errors.length).toBeGreaterThan(0);
    expect(planImport(file({ gameType: 'Z', maps: ['A', 'B'], mapDefault: 'A' })).rules[0].mission?.maps).toEqual(['A', 'B']);
    expect(planImport(file({ gameType: 'Z', maps: 'A' })).errors.length).toBeGreaterThan(0);
  });
});
