// Unit/wargear pages and the "rules together" view.
import type { LibraryDB } from './db';
import type { Entity, Rule, Source, Stat } from './model';
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
async function pickVersion(db: LibraryDB, ruleId: string, faction?: string) {
  if (faction) {
    const fv = await db.rules.get(`${ruleId}~${slug(faction)}`);
    if (fv) return { rule: fv, replaced: await db.rules.get(ruleId) };
  }
  return { rule: await db.rules.get(ruleId) };
}

async function getEntity(db: LibraryDB, id: string, faction?: string) {
  if (faction) {
    const f = await db.entities.get(`${id}~${slug(faction)}`);
    if (f) return f;
  }
  return db.entities.get(id);
}

const nameFromId = (id: string) => id.split(/[:#]/).pop()!.split('~')[0].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export interface WargearView { id: string; name: string; entity?: Entity; rules: InPlay[] }

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

// Rule ids for a unit type and its sub-types, in the same order as their labels.
function typeRuleIds(editionId: string, unitType?: string, subTypes: string[] = []) {
  return [
    ...(unitType ? [ids.rule(editionId, unitType)] : []),
    ...subTypes.map((n) => ids.rule(editionId, /sub-type$/i.test(n) ? n : `${n} Sub-Type`)),
  ];
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
    return { id: e?.id ?? id, name: e?.name ?? nameFromId(id), entity: e, rules };
  }));
  const typesOf = async (unitType: string | undefined, subTypes: string[]) => {
    const labels = [...(unitType ? [unitType] : []), ...subTypes];
    const found = await Promise.all(typeRuleIds(entity.editionId, unitType, subTypes).map((id) => expandRule(db, entity, sources, id)));
    return found.map((x, i) => ({ ...x, name: x.rule?.name ?? labels[i] ?? x.name }));
  };
  const traitsOf = (refs: { ruleId: string; value?: string }[]) =>
    Promise.all(refs.map((r) => expandRule(db, entity, sources, r.ruleId, r.value)));

  const profiles: ProfileView[] = await Promise.all((entity.profiles ?? []).map(async (p) => ({
    names: p.names,
    stats: p.stats,
    rules: await Promise.all(p.rules.map((r) => expandRule(db, entity, sources, r.ruleId, r.value))),
    typeRules: await typesOf(p.unitType, p.subTypes),
    traits: await traitsOf(p.traits ?? []),
    wargear: await wargearOf(p.wargearIds),
  })));

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
