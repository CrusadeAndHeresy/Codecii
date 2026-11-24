// Unit/wargear pages and the "rules together" view.
import type { LibraryDB } from './db';
import type { Entity, EntityProfile, Rule, RuleRef, Source, Stat } from './model';
import { ids, slug } from './normalize';
import { resolveById, type MentionIndex, type ResolvedRule } from './store';

export interface InPlay {
  ruleId: string;            // the version actually used (faction version if one applies)
  rule?: Rule;               // missing = not in your library yet
  name: string;
  resolved?: ResolvedRule;
  from: { label: string; value?: string; entityId?: string }[];
  replaced?: Rule;           // universal rule this faction version replaces
}

// Prefer the carrier's faction version of a rule when there is one.
export async function pickVersion(db: LibraryDB, ruleId: string, faction?: string) {
  if (faction) {
    const fv = await db.rules.get(`${ruleId}~${slug(faction)}`);
    if (fv) return { rule: fv, replaced: await db.rules.get(ruleId) };
  }
  return { rule: await db.rules.get(ruleId) };
}

export async function getEntity(db: LibraryDB, id: string, faction?: string) {
  if (faction) {
    const f = await db.entities.get(`${id}~${slug(faction)}`);
    if (f) return f;
  }
  return db.entities.get(id);
}

export const nameFromId = (id: string) => id.split(/[:#]/).pop()!.split('~')[0].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export interface WargearView { id: string; name: string; entity?: Entity; rules: InPlay[]; traits: InPlay[]; lines: { name?: string; stats: Stat[] }[] }

// One profile line of a unit, expanded for display.
export interface ProfileView {
  names: string[];
  stats: Stat[];
  rules: InPlay[];
  typeRules: InPlay[];
  traits: InPlay[];
  wargear: WargearView[];
}

// A swap as shown: profile links are indexes into profiles (-1 = not a profile line of this unit).
export interface SwapView {
  replaces: string;
  for: { name: string; profileIndex: number }[];
  choices: { name: string; points?: string; entityId?: string; profileIndex: number }[];
}

export interface OptionView { name: string; points?: string; entityId?: string; profileIndex: number }

export interface EntityView {
  entity: Entity;
  source?: Source;
  rules: InPlay[];           // the entry's own special rules, expanded (single-profile view)
  typeRules: InPlay[];       // unit type + sub-types
  traits: InPlay[];          // [Allegiance]-style traits
  wargear: WargearView[];
  usedBy: Entity[];          // units that carry this weapon/wargear
  carriedFor: Record<string, string>; // carrier id → the profile line(s) that take this item
  swaps: SwapView[];
  options: OptionView[];
  profiles: ProfileView[];   // empty unless the entry has several profile lines
}

async function sourcesMap(db: LibraryDB) {
  return new Map((await db.sources.toArray()).map((s) => [s.id, s]));
}

// Type and sub-types as the books print them are messy: "Infantry (Command, Antigrav)", a sub-type written "Vehicle (Super-heavy, Transport)",
// or a sub-type that just repeats the type. One clean list: the type, then each sub-type once.
export function typeParts(unitType?: string, subTypes: string[] = []): { label: string; isType: boolean }[] {
  const inner = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
  const m = unitType ? /^([^(]+?)\s*\(([^)]*)\)\s*$/.exec(unitType) : null;
  const type = (m ? m[1] : unitType ?? '').trim();
  const subs: string[] = m ? inner(m[2]) : [];
  for (const raw of subTypes) {
    const sm = /^([^(]+?)\s*\(([^)]*)\)\s*$/.exec(raw.trim());
    if (sm && !/^\d/.test(sm[2].trim())) { if (sm[1].trim().toLowerCase() !== type.toLowerCase()) subs.push(sm[1].trim()); subs.push(...inner(sm[2])); }
    else subs.push(raw.trim());
  }
  const seen = new Set<string>([type.toLowerCase()]);
  const out = type ? [{ label: type, isType: true }] : [];
  for (const x of subs) if (x && !seen.has(x.toLowerCase())) { seen.add(x.toLowerCase()); out.push({ label: x, isType: false }); }
  return out;
}
export const typeLabels = (unitType?: string, subTypes: string[] = []) => typeParts(unitType, subTypes).map((p) => p.label);
// Rule ids a type or sub-type may be stored under, best first.
export function typeIdCandidates(editionId: string, p: { label: string; isType: boolean }) {
  const names = p.isType ? [p.label, `${p.label} Type`]
    : [/sub-type$/i.test(p.label) ? p.label : `${p.label} Sub-Type`, `Fortification - Sub-Type ${p.label}`, p.label];
  return names.map((n) => ids.rule(editionId, n));
}
// Rule ids for a unit type and its sub-types, in the same order as their labels (the first candidate of each).
export function typeRuleIds(editionId: string, unitType?: string, subTypes: string[] = []) {
  return typeParts(unitType, subTypes).map((p) => typeIdCandidates(editionId, p)[0]);
}
// The same, but each id is the one the library actually has when it has any of the candidates.
export async function resolveTypeIds(db: LibraryDB, editionId: string, unitType?: string, subTypes: string[] = []) {
  return Promise.all(typeParts(unitType, subTypes).map(async (p) => {
    const cands = typeIdCandidates(editionId, p);
    const found = (await db.rules.bulkGet(cands)).findIndex(Boolean);
    return { id: cands[found >= 0 ? found : 0], label: p.label };
  }));
}

// What one profile line of a unit really has: its own entries plus the unit-level ones that no profile line claims
// (a unit's wargear, shared special rules and traits are often printed once for the whole unit).
export function mergedLine(entity: Entity, p?: EntityProfile) {
  const key = (r: RuleRef) => `${r.ruleId}|${r.value ?? ''}`;
  const dedupe = (xs: RuleRef[]) => [...new Map(xs.map((r) => [key(r), r])).values()];
  if (!p) return { rules: entity.rules, traits: entity.traits ?? [], wargearIds: entity.wargearIds, unitType: entity.unitType, subTypes: entity.subTypes };
  const ps = entity.profiles ?? [];
  const inProfiles = new Set(ps.flatMap((x) => x.rules.map(key)));
  const wargearInProfiles = new Set(ps.flatMap((x) => x.wargearIds));
  return {
    rules: dedupe([...entity.rules.filter((r) => !inProfiles.has(key(r))), ...p.rules]),
    traits: dedupe([...(entity.traits ?? []), ...(p.traits ?? [])]),
    wargearIds: [...new Set([...entity.wargearIds.filter((id) => !wargearInProfiles.has(id)), ...p.wargearIds])],
    unitType: p.unitType ?? entity.unitType,
    subTypes: [...new Set([...entity.subTypes, ...p.subTypes])],
  };
}

async function expandRule(db: LibraryDB, owner: Entity, sources: Map<string, Source>, ruleId: string, value?: string): Promise<InPlay> {
  const { rule, replaced } = await pickVersion(db, ruleId, owner.faction);
  const id = rule?.id ?? ruleId;
  return {
    ruleId: id, rule, name: rule?.name ?? nameFromId(ruleId), resolved: rule ? await resolveById(db, id, sources) : undefined,
    from: [{ label: owner.name, value, entityId: owner.id }], replaced,
  };
}

export async function loadEntityView(db: LibraryDB, entityId: string): Promise<EntityView | undefined> {
  const entity = await db.entities.get(entityId);
  if (!entity) return;
  const sources = await sourcesMap(db);
  const wargearOf = (wargearIds: string[]) => Promise.all(wargearIds.map(async (id): Promise<WargearView> => {
    const e = await getEntity(db, id, entity.faction);
    const rules = e ? await Promise.all(e.rules.map((r) => expandRule(db, e, sources, r.ruleId, r.value))) : [];
    const traitRefs = e ? [...(e.traits ?? []), ...(e.profiles ?? []).flatMap((p) => p.traits ?? [])] : [];
    const seen = new Set<string>();
    const traits = e ? await Promise.all(traitRefs.filter((r) => { const k = `${r.ruleId}|${r.value ?? ''}`; return !seen.has(k) && !!seen.add(k); }).map((r) => expandRule(db, e, sources, r.ruleId, r.value))) : [];
    const lines = e ? ((e.profiles ?? []).length ? e.profiles!.map((p) => ({ name: p.names.join(' / '), stats: p.stats })) : [{ stats: e.stats }]).filter((l) => l.stats.length) : [];
    return { id: e?.id ?? id, name: e?.name ?? nameFromId(id), entity: e, rules, traits, lines };
  }));
  const typesOf = async (unitType: string | undefined, subTypes: string[]) => {
    const found = await resolveTypeIds(db, entity.editionId, unitType, subTypes);
    const items = await Promise.all(found.map((f) => expandRule(db, entity, sources, f.id)));
    return items.map((x, i) => ({ ...x, name: x.rule?.name ?? found[i].label ?? x.name }));
  };
  const traitsOf = (refs: { ruleId: string; value?: string }[]) =>
    Promise.all(refs.map((r) => expandRule(db, entity, sources, r.ruleId, r.value)));

  const profiles: ProfileView[] = await Promise.all((entity.profiles ?? []).map(async (p) => {
    const line = mergedLine(entity, p);
    return {
      names: p.names,
      stats: p.stats,
      rules: await Promise.all(line.rules.map((r) => expandRule(db, entity, sources, r.ruleId, r.value))),
      typeRules: await typesOf(line.unitType, line.subTypes),
      traits: await traitsOf(line.traits),
      wargear: await wargearOf(line.wargearIds),
    };
  }));

  const plain = entity.id.split('~')[0];
  const usedBy = (await db.entities.where('wargearIds').anyOf([entity.id, plain]).toArray()).filter((u) => u.id !== entity.id);
  const profileIndexOf = (name?: string) => (name ? (entity.profiles ?? []).findIndex((p) => p.names.includes(name)) : -1);
  const swaps: SwapView[] = await Promise.all((entity.swaps ?? []).map(async (sw) => ({
    replaces: sw.replaces,
    for: sw.for.map((name) => ({ name, profileIndex: profileIndexOf(name) })),
    choices: await Promise.all(sw.choices.map(async (c) => {
      const w = c.wargearId ? await getEntity(db, c.wargearId, entity.faction) : undefined;
      return { name: c.name, points: c.points, entityId: w?.id, profileIndex: profileIndexOf(c.profile) };
    })),
  })));
  const options: OptionView[] = await Promise.all((entity.options ?? []).map(async (o) => {
    const w = o.wargearId ? await getEntity(db, o.wargearId, entity.faction) : undefined;
    return { name: o.name, points: o.points, entityId: w?.id, profileIndex: profileIndexOf(o.profile) };
  }));
  const carriedFor: Record<string, string> = {};
  for (const u of usedBy) {
    const lines = (u.profiles ?? [])
      .filter((p) => p.wargearIds.some((w) => w === entity.id || w === plain))
      .map((p) => p.names.join(' / '));
    if (lines.length) carriedFor[u.id] = lines.join('; ');
  }
  return {
    entity, source: sources.get(entity.sourceId),
    rules: await Promise.all(entity.rules.map((r) => expandRule(db, entity, sources, r.ruleId, r.value))),
    typeRules: await typesOf(entity.unitType, entity.subTypes),
    traits: await traitsOf(entity.traits ?? []),
    wargear: await wargearOf(entity.wargearIds),
    usedBy, carriedFor, profiles, swaps, options,
  };
}

// ---------- Rules together ----------

export type TrayRef = `r:${string}` | `e:${string}`;

export interface Interplay {
  kind: 'mentions' | 'stacking' | 'faction' | 'faq' | 'missing';
  text: string;
  ruleIds: string[];
}

export interface Combo {
  items: { ref: TrayRef; label: string; sub?: string }[];
  rules: InPlay[];
  byPhase: [string, InPlay[]][];
  interplay: Interplay[];
}

export async function buildCombo(db: LibraryDB, refs: TrayRef[], mentions: MentionIndex): Promise<Combo> {
  const sources = await sourcesMap(db);
  const items: Combo['items'] = [];
  const map = new Map<string, InPlay>();
  const add = async (ruleId: string, from: InPlay['from'][number], faction?: string) => {
    const { rule, replaced } = await pickVersion(db, ruleId, faction);
    const id = rule?.id ?? ruleId;
    const hit = map.get(id);
    if (hit) { hit.from.push(from); return; }
    map.set(id, {
      ruleId: id, rule, name: rule?.name ?? nameFromId(ruleId), from: [from], replaced,
      resolved: rule ? await resolveById(db, id, sources) : undefined,
    });
  };
  const addEntity = async (e: Entity, via?: string) => {
    const label = via ? `${e.name} (${via})` : e.name;
    for (const r of e.rules) await add(r.ruleId, { label, value: r.value, entityId: e.id }, e.faction);
    for (const id of e.ruleIds) if (!e.rules.some((r) => r.ruleId === id)) await add(id, { label: `${label}: type`, entityId: e.id }, e.faction);
  };

  for (const ref of refs) {
    const id = ref.slice(2);
    if (ref.startsWith('r:')) {
      const rule = await db.rules.get(id);
      items.push({ ref, label: rule?.name ?? nameFromId(id), sub: rule?.faction ?? 'rule' });
      await add(id, { label: 'added directly' });
    } else {
      const e = await db.entities.get(id);
      if (!e) continue;
      items.push({ ref, label: e.name, sub: [e.type, e.faction].filter(Boolean).join(' · ') });
      await addEntity(e);
      for (const wid of e.wargearIds) {
        const w = await getEntity(db, wid, e.faction);
        if (w) await addEntity({ ...w, faction: w.faction ?? e.faction }, e.name);
      }
    }
  }

  const rules = [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  const inSet = new Set(rules.map((r) => r.ruleId));
  const interplay: Interplay[] = [];
  const name = (id: string) => map.get(id)?.name ?? nameFromId(id);

  for (const r of rules) {
    for (const m of mentions.mentions.get(r.ruleId) ?? []) {
      if (inSet.has(m)) interplay.push({ kind: 'mentions', ruleIds: [r.ruleId, m], text: `${r.name} refers to ${name(m)}. Both are in play.` });
    }
    const values = [...new Set(r.from.map((f) => f.value).filter(Boolean))];
    if (values.length > 1 || (r.from.length > 1 && r.rule?.parameters.length)) {
      interplay.push({ kind: 'stacking', ruleIds: [r.ruleId],
        text: `${r.name} comes from more than one place (${r.from.map((f) => f.label + (f.value ? ` ${f.value}` : '')).join('; ')}). Check whether it stacks.` });
    }
    if (r.replaced) interplay.push({ kind: 'faction', ruleIds: [r.ruleId, r.replaced.id], text: `${r.rule?.faction} version of ${r.replaced.name} is used instead of the universal one.` });
    if (!r.rule) interplay.push({ kind: 'missing', ruleIds: [r.ruleId], text: `${r.name} isn't in your library yet, so it can't be checked.` });
  }
  const seenFaq = new Set<string>();
  for (const r of rules) for (const c of r.resolved?.clarifications ?? []) {
    if (seenFaq.has(c.a.id)) continue;
    seenFaq.add(c.a.id);
    const covers = [c.a.ruleId, ...(c.a.alsoRuleIds ?? [])].filter((id) => inSet.has(id));
    interplay.push({ kind: 'faq', ruleIds: covers, text: `FAQ (${c.source.title}${c.a.page ? `, p.${c.a.page}` : ''}): ${c.a.question ? `Q: ${c.a.question} ` : ''}A: ${c.a.text}` });
  }
  // dedupe A→B / B→A mentions
  const keyed = new Map<string, Interplay>();
  for (const i of interplay) keyed.set(i.kind === 'mentions' ? 'm:' + [...i.ruleIds].sort().join() : i.kind + i.text, i);

  const phases = new Map<string, InPlay[]>();
  for (const r of rules) {
    const ph = r.rule?.phase ?? 'Unknown phase';
    phases.set(ph, [...(phases.get(ph) ?? []), r]);
  }
  const order = (p: string) => (p === 'Unknown phase' ? 'zz' : p === 'Any' ? 'a' : p);
  return { items, rules, byPhase: [...phases.entries()].sort((a, b) => order(a[0]).localeCompare(order(b[0]))), interplay: [...keyed.values()] };
}
