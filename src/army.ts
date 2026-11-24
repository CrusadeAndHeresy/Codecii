// Army lists: turn what the list reader found into saved armies of unit cards.
// One card per unit, however many times it appears in the list; each copy keeps its own models and wargear.
import type { Entity, Rule } from './model';
import { normName } from './normalize';

export type GearKind = 'weapon' | 'rule' | 'text' | 'model';
export interface ArmyGear {
  name: string;           // as printed in the list (counts and labels removed)
  kind: GearKind;         // weapon = a weapon/wargear entry in the library; rule = a rule in the library; text = not found;
                          // model = the list names one of the unit's own models ("Militia Mastiff", "Praetor with Jump Pack")
  entityId?: string;
  ruleId?: string;
  count?: number;
  label?: string;         // "Prime Advantage" in "Prime Advantage: Hetaeron Guard"
  forModel?: string;      // "Sergeant" in "Sergeant: power sword"
  added?: boolean;        // added by hand in the app, not read from the list
}
export interface ArmyCopy {
  id: string;
  models: number;
  modelsGuessed?: boolean;
  pts?: number;
  legion?: string;        // the Legion the list's detachment names ("Blood Angels"); can be set by hand
  gear: ArmyGear[];
}
export interface ArmyUnit {
  id: string;
  listName: string;       // the name as the list printed it
  entityId?: string;      // the library unit it was matched to
  matchScore?: number;    // below 0.85 the card asks you to check the match
  roleOverride?: string;  // set by hand; otherwise the library's role, then the list's own heading
  slot?: string;          // the list's heading above the unit (a role, a detachment, or anything)
  copies: ArmyCopy[];
}
export interface Army {
  id: string;
  editionId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  total?: number;         // the total the list printed
  sum?: number;           // what the units added up to
  notes: string[];        // reading checks, shown on the army page
  sourceName?: string;
  units: ArmyUnit[];
}

// ---------- Battlefield roles ----------

// Order the cards are shown in. Heavy Support is kept for lists from other systems.
export const ROLES = ['Warlord', 'High Command', 'Command', 'Retinue', 'Elites', 'Troops', 'Support', 'Recon', 'Fast Attack',
  'Heavy Assault', 'Heavy Support', 'War-engine', 'Armour', 'Lord of War', 'Transport', 'Heavy Transport', 'Fortification'];
export const UNASSIGNED = 'No role yet';

const ROLE_KEYS: Record<string, string> = {
  warlord: 'Warlord', highcommand: 'High Command', command: 'Command', hq: 'Command', headquarters: 'Command', retinue: 'Retinue',
  elites: 'Elites', elite: 'Elites', troops: 'Troops', troop: 'Troops', line: 'Troops', support: 'Support', recon: 'Recon',
  fastattack: 'Fast Attack', heavyassault: 'Heavy Assault', heavysupport: 'Heavy Support', warengine: 'War-engine', warengines: 'War-engine',
  armour: 'Armour', armor: 'Armour', lordofwar: 'Lord of War', lordsofwar: 'Lord of War',
  transport: 'Transport', dedicatedtransport: 'Transport', heavytransport: 'Heavy Transport',
  fortification: 'Fortification', fortifications: 'Fortification',
};
// "Heavy Support", "HQ", "Fast-Attack Slot" → the role's own name; anything else (a detachment name) is not a role.
export function canonRole(s?: string): string | undefined {
  if (!s) return;
  const k = s.toLowerCase().replace(/\b(slots?|choices?|force organi[sz]ation)\b/g, '').replace(/[^a-z]/g, '');
  return ROLE_KEYS[k];
}

export function roleOf(u: ArmyUnit, e?: Entity): string {
  return canonRole(u.roleOverride) ?? canonRole(e?.role) ?? canonRole(u.slot) ?? UNASSIGNED;
}

export function roleRank(role: string): number {
  const i = ROLES.indexOf(role);
  return i < 0 ? ROLES.length + 1 : i;
}

// ---------- Names ----------

// "Legion Tactical Squad" (list builders) and "Tactical Squad" (the book) are the same unit.
const STOP = new Set(['the', 'of', 'and', 'a', 'an', 'legion', 'legiones', 'astartes']);
const stem = (w: string) => (w.endsWith('ies') ? w.slice(0, -3) + 'y' : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
export const tokens = (s: string) => normName(s).split(' ').filter((w) => w && !STOP.has(w)).map(stem);
export const nameKey = (s: string) => tokens(s).join(' ');
// Same key with the spaces gone, so "Meltabombs" and "Melta bombs" are one thing.
export const squashKey = (s: string) => tokens(s).join('');

export function nameScore(a: string, b: string): number {
  if (normName(a) === normName(b)) return 1;
  const ta = new Set(tokens(a)), tb = new Set(tokens(b));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  ta.forEach((t) => { if (tb.has(t)) inter++; });
  const union = ta.size + tb.size - inter;
  const contain = inter / Math.min(ta.size, tb.size);
  return Math.round((0.6 * (inter / union) + 0.4 * contain) * 100) / 100;
}

export interface UnitMatch { entity?: Entity; score: number; candidates: { entity: Entity; score: number }[] }

// Best library unit for a name from a list. Same-name units from different factions are all candidates.
export function matchUnit(name: string, units: Entity[]): UnitMatch {
  const scored = units.map((entity) => ({ entity, score: nameScore(name, entity.name) }))
    .filter((c) => c.score >= 0.4)
    .sort((a, b) => b.score - a.score || (a.entity.faction ? 1 : 0) - (b.entity.faction ? 1 : 0) || a.entity.name.localeCompare(b.entity.name));
  return { entity: scored[0]?.entity, score: scored[0]?.score ?? 0, candidates: scored.slice(0, 6) };
}
export const SURE = 0.85;

// ---------- Wargear lines ----------

export interface GearLookup {
  gear: (item: string) => Entity | undefined;
  rule: (item: string) => Rule | undefined;
}

const MOUNT_WORDS = new Set(['sponson', 'pintle', 'turret', 'hull', 'mounted', 'centreline', 'front', 'rear', 'co-axial', 'coaxial', 'boresight']);
const WORD_NUMS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const LABELS = /^(prime advantage|prime slot|rite of war|warlord trait|enhancement|upgrades?|wargear|options?|selections?)\s*:\s*/i;

export function makeLookup(entities: Entity[], rules: Rule[]): GearLookup {
  const gearEntities = entities.filter((e) => e.type !== 'unit');
  const gearBy = new Map<string, Entity>();
  const gearSquash = new Map<string, Entity>();
  gearEntities.forEach((e) => {
    [e.name, ...(e.aliases ?? [])].forEach((n) => {
      const k = nameKey(n); if (k && !gearBy.has(k)) gearBy.set(k, e);
      const q = squashKey(n); if (q && !gearSquash.has(q)) gearSquash.set(q, e);
    });
  });
  const ruleBy = new Map<string, Rule>();
  const ruleSquash = new Map<string, Rule>();
  rules.forEach((r) => {
    [r.name, ...(r.aliases ?? [])].forEach((n) => {
      const k = nameKey(n); if (k && !ruleBy.has(k)) ruleBy.set(k, r);
      const q = squashKey(n); if (q && !ruleSquash.has(q)) ruleSquash.set(q, r);
    });
  });
  const stripMounts = (item: string) => tokens(item).filter((t) => !MOUNT_WORDS.has(t)).join(' ');
  return {
    gear: (item) => {
      const k = nameKey(item);
      const hit = gearBy.get(k) ?? gearBy.get(stripMounts(item)) ?? gearSquash.get(squashKey(item));
      if (hit) return hit;
      let best: Entity | undefined, bs = 0;
      for (const e of gearEntities) { const s = nameScore(item, e.name); if (s > bs) { bs = s; best = e; } }
      return bs >= 0.8 ? best : undefined;
    },
    rule: (item) => ruleBy.get(nameKey(item)) ?? ruleSquash.get(squashKey(item)),
  };
}

let gid = 0;
const newId = (p: string) => `${p}${Date.now().toString(36)}${(gid++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// split a list line on commas/semicolons/plus, but not inside brackets: "Infantry (Champion, Heavy) great frost blade"
function splitTop(text: string): string[] {
  const out: string[] = []; let depth = 0; let cur = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === ',' || ch === ';')) { out.push(cur); cur = ''; continue; }
    if (depth === 0 && ch === '+' && /\s/.test(text[i - 1] ?? '') && /\s/.test(text[i + 1] ?? '')) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

// "3× lastrum storm bolter", "Prime Advantage: Hetaeron Guard", "Sergeant: power sword, bolt pistol (+5 pts)"
export function parseGear(details: string[], unitName: string, look: GearLookup, modelNames: string[] = []): ArmyGear[] {
  const out: ArmyGear[] = [];
  const unitTokens = new Set(tokens(unitName));
  const known = new Set([...unitTokens, ...modelNames.flatMap(tokens)]);
  for (const line of details) {
    let rest = line.replace(/^[•·▪●◦\-–+*]\s*/, '').trim();
    let lineLabel: string | undefined;
    let forModel: string | undefined;
    const pretty = (x: string) => x.replace(/\b\w/g, (c) => c.toUpperCase());
    const lm = LABELS.exec(rest);
    if (lm) { lineLabel = pretty(lm[1]); rest = rest.slice(lm[0].length); }
    else {
      const m = /^([^:,]{2,40}):\s*(.+)$/.exec(rest);
      if (m) { forModel = m[1].trim(); rest = m[2]; }
    }
    // "mixed weapons ( chainsword , chainaxe )" is a way of saying which weapons: list each one.
    const parts = splitTop(rest).flatMap((x) => {
      const mm = /^(?:mixed|assorted|various)\s+(?:weapons?|wargear|equipment)\s*\(\s*(.+?)\s*\)$/i.exec(x.trim());
      return mm ? splitTop(mm[1]) : [x];
    });
    for (let item of parts) {
      let label = lineLabel;
      const im = LABELS.exec(item.trim());           // "…, Prime Advantage: Hetaeron Guard, …" inside one line
      if (im) { label = pretty(im[1]); item = item.trim().slice(im[0].length); }
      item = item.trim().replace(/^\[(.+)\]$/, '$1').replace(/^(?:infantry|cavalry|vehicle|walker|automata|monstrous creature|bike|jetbike|jump infantry)\s*\([^)]*\)\s+(?=\S)/i, '');
      item = item.replace(/\(\s*\+?\s*\d+\s*(?:pts?|points?)\s*\)|\+\s*\d+\s*(?:pts?|points?)/gi, '').replace(/\s+/g, ' ').trim();
      if (!item || !/[A-Za-z]/.test(item)) continue;
      let model = forModel;
      const pm = !label && !forModel ? /^([^:]{2,40}):\s*(.+)$/.exec(item) : null;   // "5 Scouts, Scout Sergeant: melta bombs"
      if (pm) { model = pm[1].trim(); item = pm[2].trim(); }
      let count: number | undefined;
      let m: RegExpExecArray | null;
      if ((m = /^(\d+)\s*[×xX]?\s+(.+)$/.exec(item))) { count = +m[1]; item = m[2]; }
      else if ((m = /^(one|two|three|four|five|six|seven|eight|nine|ten)\s+(.+)$/i.exec(item))) { count = WORD_NUMS[m[1].toLowerCase()]; item = m[2]; }
      else if ((m = /^(.+?)\s*[×xX]\s*(\d+)$/.exec(item)) || (m = /^(.+?)\s*\(\s*[×xX]\s*(\d+)\s*\)$/.exec(item))) { item = m[1]; count = +m[2]; }
      item = item.trim();
      if (/^legion$/i.test(item)) continue;   // a stray heading word, not an item
      // "3 Aquilon Terminators" is who is in the unit, not wargear
      if (!label && tokens(item).some((t) => unitTokens.has(t)) && count !== undefined && !look.gear(item)) continue;
      if (!label && modelNames.some((n) => nameScore(item, n) >= 0.8) && !look.gear(item)) {
        out.push({ name: item, kind: 'model', count, forModel: model }); // a model of this unit: not wargear, but it says which profile line applies
        continue;
      }
      const g = look.gear(item);
      // "Legion Tactical Sergeant" is a model of Tactical Squad, not wargear: every word is the unit's or a model's own
      if (!g && !look.rule(item) && !label && tokens(item).length && tokens(item).every((t) => known.has(t))) {
        out.push({ name: item, kind: 'model', count, forModel: model }); // "Jump Pack" on "Praetor with Jump Pack": says which profile line applies
        continue;
      }
      if (g) { out.push({ name: item, kind: 'weapon', entityId: g.id, count, label, forModel: model }); continue; }
      const r = look.rule(item);
      if (r) { out.push({ name: item, kind: 'rule', ruleId: r.id, count, label, forModel: model }); continue; }
      out.push({ name: item, kind: 'text', count, label, forModel: model });
    }
  }
  return out;
}

// Gear already stored from an older reading: split "mixed weapons ( a , b )" into its weapons and drop a stray "Legion".
export function normalizeGear(gear: ArmyGear[], look: GearLookup): ArmyGear[] {
  return gear.flatMap((g) => {
    if (g.kind !== 'text') return [g];
    if (/^legion$/i.test(g.name.trim())) return [];
    if (/^(?:mixed|assorted|various)\s+(?:weapons?|wargear|equipment)\s*\(/i.test(g.name)) return parseGear([g.name], '', look).map((x) => ({ ...x, forModel: x.forModel ?? g.forModel }));
    return [g];
  });
}

// ---------- Building an army from a reading ----------

export interface ReadUnit { slot?: string; legion?: string; name: string; models: number; countSrc?: string; pts?: number; details?: string[] }
export interface Reading { name: string; system?: string; units: ReadUnit[]; check?: { total?: number | null; sum?: number; notes?: string[] } }
export interface ArmyContext { editionId: string; units: Entity[]; look: GearLookup }

export function buildArmy(reading: Reading, ctx: ArmyContext, sourceName?: string, now = Date.now()): Army {
  const groups = new Map<string, ArmyUnit>();
  const order: ArmyUnit[] = [];
  for (const r of reading.units) {
    const m = matchUnit(r.name, ctx.units);
    const matched = m.score >= 0.5 ? m.entity : undefined;
    const key = matched ? matched.id : 'x:' + nameKey(r.name);
    const copy: ArmyCopy = {
      id: newId('c'), models: Math.max(1, r.models || 1), modelsGuessed: r.countSrc === 'guessed' || undefined, pts: r.pts, legion: r.legion,
      gear: parseGear(r.details ?? [], matched?.name ?? r.name, ctx.look, matched ? [matched.name, ...(matched.profiles ?? []).flatMap((p) => p.names)] : []),
    };
    let u = groups.get(key);
    if (!u) {
      u = { id: newId('u'), listName: r.name, entityId: matched?.id, matchScore: matched ? m.score : undefined, slot: r.slot, copies: [] };
      groups.set(key, u); order.push(u);
    }
    u.copies.push(copy);
  }
  return {
    id: newId('a'), editionId: ctx.editionId, name: reading.name || 'Imported list', createdAt: now, updatedAt: now,
    total: reading.check?.total ?? undefined, sum: reading.check?.sum, notes: reading.check?.notes ?? [], sourceName, units: order,
  };
}

// Rebuild which copies/units a card shows after wargear or counts change.
export const unitPoints = (u: ArmyUnit) => u.copies.reduce((t, c) => t + (c.pts ?? 0), 0);
export const unitModels = (u: ArmyUnit) => u.copies.reduce((t, c) => t + c.models, 0);

export interface RoleGroup { role: string; units: ArmyUnit[]; pts: number }
export function groupByRole(units: ArmyUnit[], entities: Map<string, Entity>): RoleGroup[] {
  const by = new Map<string, ArmyUnit[]>();
  for (const u of units) {
    const role = roleOf(u, u.entityId ? entities.get(u.entityId) : undefined);
    by.set(role, [...(by.get(role) ?? []), u]);
  }
  return [...by.entries()]
    .sort((a, b) => roleRank(a[0]) - roleRank(b[0]))
    .map(([role, us]) => ({ role, units: us, pts: us.reduce((t, u) => t + unitPoints(u), 0) }));
}
