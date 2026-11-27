// Missions by game type > sub-type > sub-sub-type, built from whatever books this device holds.
import type { Rule } from './model';

export interface MissionRef { id: string; name: string; maps?: string[]; mapDefault?: string; variants?: string[] }
export interface MissionNode { name: string; missions: MissionRef[]; children: MissionNode[] }

const LAST = 'Legendary';
const order = (a: MissionNode, b: MissionNode) => Number(a.name === LAST) - Number(b.name === LAST) || a.name.localeCompare(b.name);

export const allMissions = (n: MissionNode): MissionRef[] => [...n.missions, ...n.children.flatMap(allMissions)];

// One node per game type. Types with the most missions come first.
export function missionTree(rules: Iterable<Rule>): MissionNode[] {
  const root: MissionNode = { name: '', missions: [], children: [] };
  const child = (n: MissionNode, name: string) => {
    let c = n.children.find((x) => x.name === name);
    if (!c) n.children.push((c = { name, missions: [], children: [] }));
    return c;
  };
  for (const r of rules) {
    if (!r.mission) continue;
    [r.mission.gameType, ...(r.mission.path ?? [])].reduce(child, root).missions.push({ id: r.id, name: r.name, maps: r.mission.maps, mapDefault: r.mission.mapDefault, variants: r.mission.variants });
  }
  const sort = (n: MissionNode) => { n.missions.sort((a, b) => a.name.localeCompare(b.name)); n.children.sort(order); n.children.forEach(sort); };
  sort(root);
  return root.children.sort((a, b) => allMissions(b).length - allMissions(a).length || a.name.localeCompare(b.name));
}

export const pickOne = <T,>(xs: T[], random = Math.random): T | undefined => xs[Math.floor(random() * xs.length)];

// Deployment map entries are found by name, so a map printed in one book serves missions from another.
export function findMap(rules: Iterable<Rule>, name: string): MissionRef | undefined {
  for (const r of rules) if (r.name === name && !r.faction) return { id: r.id, name: r.name };
}
