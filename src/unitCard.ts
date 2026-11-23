// What one army-list unit shows on its card.
// Two separate parts, so nothing bleeds from one into the other:
//   1. the unit's OWN data (type, special rules, traits, standard wargear), for the profile line(s) this list actually uses;
//   2. the options TAKEN in the list, each with its own weapon profile and rules.
// Rules are only named here; their text and sub-rules are loaded when a dropdown is opened.
import type { LibraryDB } from './db';
import type { Entity, EntityProfile, RuleRef, Stat } from './model';
import { nameScore, squashKey, tokens, type ArmyCopy, type ArmyGear, type ArmyUnit, type GearLookup } from './army';
import { getEntity, mergedLine, nameFromId, pickVersion, resolveTypeIds } from './views';

export interface RuleItem { ruleId: string; name: string; value?: string; faction?: string; missing?: boolean; trait?: boolean; tag?: string }
export interface GearLine { label: string; stats: Stat[]; rules: RuleItem[] }
export interface GearItem {
  key: string;
  name: string;
  entityId?: string;
  rule?: RuleItem;           // the item is a rule in the library rather than a weapon/wargear entry
  lines: GearLine[];         // weapon profile line(s) with their rules
  children: GearItem[];      // wargear this item itself carries
  missing?: boolean;         // not in the library
  count?: number;
  by?: string;               // who has it ("Sergeant", "Prime Advantage")
  matched?: string;          // the library item a differently worded list entry was matched to
  note?: string;
  tag?: string;              // shown when only some of the unit's profile lines / copies have it
}
export interface ShownLine { index: number; label: string; stats: Stat[]; tag?: string }
export interface UnitCardModel {
  lines: ShownLine[];
  types: RuleItem[];
  rules: RuleItem[];
  traits: RuleItem[];
  wargear: GearItem[];
  taken: { copyId: string; label: string; items: GearItem[] }[];
  notes: string[];
}

// ---------- Which profile line(s) does this copy use? ----------

const NOISE = new Set(['with', 'on', 'in', 'and', 'for']);
export const sameName = (a: string, b: string) => !!a && !!b && (squashKey(a) === squashKey(b) || nameScore(a, b) >= 0.9);
// "Replace with Praetor with Jump Pack +20" → "Praetor with Jump Pack"
const cleanChoice = (s: string) => s
  .replace(/^\s*(?:replace|swap|exchange)[a-z]*\s+with\s+/i, '')
  .replace(/\s*[(\[]?\s*(?:\+\s*\d+\s*(?:pts?|points?)?|free)\s*[)\]]?\s*$/i, '')
  .replace(/\s*\([^)]*\)\s*$/, '')
  .trim();

interface Hint { name: string; profile?: string; replaces?: string; forNames: string[]; swap: boolean }
function hintsOf(e: Entity): Hint[] {
  return [
    ...(e.swaps ?? []).flatMap((sw) => sw.choices.map((c) => ({ name: cleanChoice(c.name), profile: c.profile, replaces: sw.replaces, forNames: sw.for, swap: true }))),
    ...(e.options ?? []).map((o) => ({ name: cleanChoice(o.name), profile: o.profile, forNames: [] as string[], swap: false })),
  ];
}

// Terms of the printed composition: "1 Assault Sergeant, 9 Assault Legionaries" → ["Assault Sergeant", "Assault Legionaries"]
function compositionTerms(comp?: string): string[] {
  if (!comp) return [];
  const first = comp.replace(/^\s*composition\s*:\s*/i, '').split(/\.\s|;\s*up to|\bmay include\b/i)[0];
  return first.replace(/[()]/g, ',').split(/,|\band\b/i)
    .map((t) => t.replace(/^\s*(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*[×x]?\s+/i, '').replace(/\bmodels?\b/i, '').trim())
    .filter((t) => /[a-z]/i.test(t));
}

export interface LineChoice {
  indexes: number[];                 // profile lines to show, in library order
  via: Map<number, number>;          // gear index → the profile line it selected
}

export function chooseLines(entity: Entity, copy: ArmyCopy | undefined, listName: string): LineChoice {
  const ps = entity.profiles ?? [];
  const via = new Map<number, number>();
  if (ps.length <= 1) return { indexes: ps.length ? [0] : [], via };
  const names = (i: number) => ps[i].names;
  const hints = hintsOf(entity);
  const all = ps.map((_, i) => i);

  // 1. the lines named in the printed composition are always there
  let base: number[] = [];
  for (const term of compositionTerms(entity.composition)) {
    const exact = all.filter((i) => names(i).some((n) => sameName(n, term)));
    const tt = tokens(term);
    const contain = tt.length ? all.filter((i) => names(i).some((n) => { const nt = new Set(tokens(n)); return tt.every((t) => nt.has(t)); })) : [];
    // a variant ("Mounted Force Commander") also contains the term, but an exact line wins
    base.push(...(exact.length ? exact : contain.slice().sort((a, b) => tokens(names(a)[0]).length - tokens(names(b)[0]).length).slice(0, 1)));
  }
  base = [...new Set(base)];
  // 2. no usable composition: lines the options/swaps offer are alternates, everything else is there
  const offered = (i: number) => hints.some((h) => (h.profile ? names(i).some((n) => sameName(n, h.profile!)) : names(i).some((n) => sameName(n, h.name))));
  if (!base.length) {
    const alt = all.filter((i) => offered(i));
    base = all.filter((i) => !alt.includes(i));
    if (!base.length) base = all;
  }
  const alts = all.filter((i) => !base.includes(i));
  if (!alts.length) return { indexes: all, via };

  // 3. which alternates does this copy take?
  const gear = copy?.gear ?? [];
  const gearNames = [...gear.map((g) => g.name), listName].filter(Boolean);
  const gearTokens = new Set(gearNames.flatMap(tokens));
  const baseTokens = new Set(base.flatMap((i) => names(i).flatMap(tokens)));
  const chosen = new Set<number>();
  for (const a of alts) {
    const mine = names(a);
    const dist = [...new Set(mine.flatMap(tokens))].filter((t) => !baseTokens.has(t) && !NOISE.has(t));
    // (a) the list names the model, or the library's own swap/option for it
    if (gearNames.some((g) => mine.some((n) => sameName(n, g)))) chosen.add(a);
    for (const h of hints) {
      if (!(h.profile ? mine.some((n) => sameName(n, h.profile!)) : mine.some((n) => sameName(n, h.name)))) continue;
      gear.forEach((g, gi) => { if (sameName(g.name, h.name)) { chosen.add(a); if (!mine.some((n) => sameName(n, g.name))) via.set(gi, a); } });
    }
    // (b) the list names what sets this line apart ("Jump Pack", "Tartaros", "Scimitar Jetbike")
    if (dist.length && dist.every((t) => gearTokens.has(t))) {
      chosen.add(a);
      gear.forEach((g, gi) => { if (!mine.some((n) => sameName(n, g.name)) && tokens(g.name).some((t) => dist.includes(t))) via.set(gi, a); });
    }
  }
  // 4. an alternate that is a variant of a base line ("Praetor with Jump Pack") takes its place
  const replaced = new Set<number>();
  for (const a of chosen) {
    const at = new Set(names(a).flatMap(tokens));
    for (const b of base) {
      const bt = [...new Set(names(b).flatMap(tokens))];
      if (bt.length && bt.every((t) => at.has(t)) && at.size > bt.length) replaced.add(b);
    }
    for (const h of hints) {
      if (!(h.profile ? names(a).some((n) => sameName(n, h.profile!)) : names(a).some((n) => sameName(n, h.name)))) continue;
      const targets = [h.replaces, ...h.forNames].filter((x): x is string => !!x && !/^model$/i.test(x));
      for (const b of base) if (targets.some((t) => names(b).some((n) => sameName(n, t)))) replaced.add(b);
      if (h.replaces && /^model$/i.test(h.replaces) && !h.forNames.length && base.length === 1) replaced.add(base[0]);
    }
  }
  const shown = all.filter((i) => (base.includes(i) && !replaced.has(i)) || chosen.has(i));
  return { indexes: shown.length ? shown : base, via };
}

// ---------- Loading ----------

type RuleCache = Map<string, RuleItem>;

async function ruleItem(db: LibraryDB, ref: RuleRef, faction: string | undefined, cache: RuleCache, label?: string): Promise<RuleItem> {
  const key = `${ref.ruleId}|${faction ?? ''}|${ref.value ?? ''}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { rule } = await pickVersion(db, ref.ruleId, faction);
  const item: RuleItem = { ruleId: rule?.id ?? ref.ruleId, name: rule?.name ?? label ?? nameFromId(ref.ruleId), value: ref.value, faction: rule?.faction, missing: !rule };
  cache.set(key, item);
  return item;
}

async function typeItems(db: LibraryDB, editionId: string, unitType: string | undefined, subTypes: string[], faction: string | undefined, cache: RuleCache) {
  const found = await resolveTypeIds(db, editionId, unitType, subTypes);
  return Promise.all(found.map((f) => ruleItem(db, { ruleId: f.id }, faction, cache, f.label)));
}

async function gearFromEntity(db: LibraryDB, id: string, faction: string | undefined, cache: RuleCache, seen: Set<string>, depth = 0): Promise<GearItem> {
  const e = await getEntity(db, id, faction);
  if (!e) return { key: id, name: nameFromId(id), lines: [], children: [], missing: true };
  const fac = e.faction ?? faction;
  const refs = (xs: RuleRef[]) => Promise.all(xs.map((r) => ruleItem(db, r, fac, cache)));
  const lineOf = async (label: string, stats: Stat[], rules: RuleRef[], traits: RuleRef[], unitType?: string, subTypes: string[] = []): Promise<GearLine> =>
    ({ label, stats, rules: [...(await typeItems(db, e.editionId, unitType, subTypes, fac, cache)), ...(await refs(rules)), ...(await refs(traits))] });
  const lines = e.profiles?.length
    ? await Promise.all(e.profiles.map((p: EntityProfile) => lineOf(p.names.join(' / '), p.stats, p.rules, p.traits ?? [], p.unitType, p.subTypes)))
    : [await lineOf('', e.stats, e.rules, e.traits ?? [], e.unitType, e.subTypes)];
  seen.add(e.id.split('~')[0]);
  const childIds = [...new Set([...e.wargearIds, ...(e.profiles ?? []).flatMap((p) => p.wargearIds)])].filter((c) => !seen.has(c.split('~')[0]));
  childIds.forEach((c) => seen.add(c.split('~')[0]));
  const children = depth < 1 ? await Promise.all(childIds.map((c) => gearFromEntity(db, c, fac, cache, seen, depth + 1))) : [];
  return { key: e.id, name: e.name, entityId: e.id, lines, children };
}

const plain = (id: string) => id.split('~')[0];

// Standard wargear of the shown profile line(s), tagged when only some of them carry it.
function mergeGear(per: GearItem[][], labels: string[]): GearItem[] {
  const out = new Map<string, { item: GearItem; at: Set<number> }>();
  per.forEach((items, li) => items.forEach((it) => {
    const k = plain(it.key);
    const hit = out.get(k);
    if (hit) hit.at.add(li); else out.set(k, { item: it, at: new Set([li]) });
  }));
  return [...out.values()].map(({ item, at }) => ({ ...item, tag: per.length > 1 && at.size < per.length ? [...at].map((i) => labels[i]).join(' / ') : undefined }));
}
function mergeRules(per: RuleItem[][], labels: string[]): RuleItem[] {
  const out = new Map<string, { item: RuleItem; at: Set<number> }>();
  per.forEach((items, li) => items.forEach((it) => {
    const k = `${it.ruleId}|${it.value ?? ''}`;
    const hit = out.get(k);
    if (hit) hit.at.add(li); else out.set(k, { item: it, at: new Set([li]) });
  }));
  return [...out.values()].map(({ item, at }) => ({ ...item, tag: per.length > 1 && at.size < per.length ? [...at].map((i) => labels[i]).join(' / ') : undefined }));
}

// A thing taken in the list → its own dropdown (weapon profile + rules), however much of it the library knows.
async function resolveTaken(
  db: LibraryDB, g: ArmyGear, gi: number, entity: Entity | undefined, look: GearLookup, hints: Hint[],
  cache: RuleCache, selectedVia: Map<number, number>, lineLabels: Map<number, string>,
): Promise<GearItem | undefined> {
  const by = [g.label, g.forModel].filter(Boolean).join(' · ') || undefined;
  const base = { count: g.count, by };
  if (g.kind === 'model') {
    // the list naming one of the unit's own models: only worth a row when it chose a profile line
    const line = selectedVia.get(gi);
    return line === undefined ? undefined
      : { key: `${gi}:m:${g.name}`, name: g.name, lines: [], children: [], ...base, note: `This is the “${lineLabels.get(line) ?? 'profile'}” profile shown above.` };
  }
  const faction = entity?.faction;
  // A library match: what the list was matched to, then the library's own item of that name, then the unit's own option of that name.
  let entityId = g.kind === 'weapon' ? g.entityId : undefined;
  entityId ??= look.gear(g.name)?.id;
  if (!entityId && entity) {
    const opt = [...(entity.options ?? []).map((o) => ({ name: cleanChoice(o.name), wargearId: o.wargearId })),
      ...(entity.swaps ?? []).flatMap((s) => s.choices.map((c) => ({ name: cleanChoice(c.name), wargearId: c.wargearId })))]
      .find((o) => o.wargearId && sameName(o.name, g.name));
    entityId = opt?.wargearId;
  }
  if (entityId) {
    const item = await gearFromEntity(db, entityId, faction, cache, new Set());
    if (!item.missing) return { ...item, ...base, key: `${gi}:${item.key}`, name: sameName(g.name, item.name) ? item.name : g.name, matched: sameName(g.name, item.name) ? undefined : item.name };
  }
  const ruleId = g.kind === 'rule' ? g.ruleId : look.rule(g.name)?.id;
  if (ruleId) {
    const r = await ruleItem(db, { ruleId }, faction, cache, g.name);
    if (!r.missing) return { key: `${gi}:r:${r.ruleId}`, name: r.name, rule: r, lines: [], children: [], ...base };
  }
  const line = selectedVia.get(gi);
  const hint = hints.find((h) => sameName(h.name, g.name));
  if (line !== undefined) return { key: `${gi}:t:${g.name}`, name: g.name, lines: [], children: [], ...base, note: `This is the “${lineLabels.get(line) ?? 'profile'}” profile shown above.` };
  return { key: `${gi}:t:${g.name}`, name: g.name, lines: [], children: [], ...base, missing: true,
    note: hint ? 'This option is in the unit’s entry, but the item itself is not in your library yet.' : 'Not in your library yet. Tap Edit to match it to a library item.' };
}

export async function buildUnitCard(db: LibraryDB, unit: ArmyUnit, entity: Entity | undefined, look: GearLookup): Promise<UnitCardModel> {
  const cache: RuleCache = new Map();
  const hints = entity ? hintsOf(entity) : [];
  const notes: string[] = [];
  const copies = unit.copies;
  const choices = copies.map((c) => (entity ? chooseLines(entity, c, unit.listName) : { indexes: [], via: new Map<number, number>() }));

  let lines: ShownLine[] = [];
  let types: RuleItem[] = [], rules: RuleItem[] = [], traits: RuleItem[] = [], wargear: GearItem[] = [];
  const lineLabels = new Map<number, string>();
  if (entity) {
    const ps = entity.profiles ?? [];
    const idxs = ps.length > 1 ? [...new Set(choices.flatMap((c) => c.indexes))].sort((a, b) => a - b) : [0];
    const fac = entity.faction;
    const parts = await Promise.all(idxs.map(async (i) => {
      const p = ps.length ? ps[i] : undefined;
      const label = p && ps.length > 1 ? p.names.join(' / ') : '';
      lineLabels.set(i, label);
      const stats = p ? p.stats : entity.stats;
      const src = mergedLine(entity, p);
      const [t, r, tr, w] = await Promise.all([
        typeItems(db, entity.editionId, src.unitType, src.subTypes, fac, cache),
        Promise.all(src.rules.map((x) => ruleItem(db, x, fac, cache))),
        Promise.all(src.traits.map(async (x) => ({ ...(await ruleItem(db, x, fac, cache)), trait: true }))),
        Promise.all(src.wargearIds.map((id) => gearFromEntity(db, id, fac, cache, new Set()))),
      ]);
      return { label, stats, t, r, tr, w };
    }));
    // a line that only some copies use says so
    const usedBy = (i: number) => choices.map((c, ci) => (c.indexes.includes(i) ? ci + 1 : 0)).filter(Boolean);
    lines = parts.map((x, k) => {
      const who = usedBy(idxs[k]);
      return { index: idxs[k], label: x.label, stats: x.stats, tag: copies.length > 1 && who.length < copies.length ? `copy ${who.join(', ')}` : undefined };
    });
    const labels = parts.map((x) => x.label || entity.name);
    types = mergeRules(parts.map((x) => x.t), labels);
    rules = mergeRules(parts.map((x) => x.r), labels);
    traits = mergeRules(parts.map((x) => x.tr), labels);
    wargear = mergeGear(parts.map((x) => x.w), labels);
    if (!lines.some((l) => l.stats.length)) notes.push('No profile is printed for this entry in your library.');
  } else {
    notes.push('This unit is not matched to your library yet. Tap Edit, then “Change this unit”.');
  }

  // Options taken, per copy. Anything the unit already carries as standard is in "Wargear", not repeated here.
  const stdName = (n: string) => n.toLowerCase().replace(/[\[\]]/g, '').replace(/\([^)]*\)/g, ' ').replace(/\bsub-?types?\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  const stdNames = new Set([...types, ...rules, ...traits].map((x) => stdName(x.name)).filter(Boolean));
  const standard = new Set(wargear.flatMap((w) => [plain(w.key), ...w.children.map((c) => plain(c.key))]));
  const taken = await Promise.all(copies.map(async (c, ci) => {
    const items = (await Promise.all(c.gear.map((g, gi) => resolveTaken(db, g, gi, entity, look, hints, cache, choices[ci].via, lineLabels))))
      .filter((x): x is GearItem => !!x)
      .filter((x) => !(x.entityId && standard.has(plain(x.entityId))))
      .filter((x) => !stdNames.has(stdName(x.name)));
    return { copyId: c.id, label: `${copies.length > 1 ? `Copy ${ci + 1} · ` : ''}${c.models} model${c.models === 1 ? '' : 's'}`, items };
  }));
  return { lines, types, rules, traits, wargear, taken, notes };
}
