import type { LibraryDB } from './db';
import type { Amendment, Entity, Printing, Rule, Source, Tier } from './model';
import type { ImportPlan } from './importer';

const uniq = <T,>(a: T[]) => [...new Set(a)];

// Writes an import plan. Same source re-imported → its old printings/amendments/entities are replaced.
// A rule reprinted in another book merges into one Rule (aliases/tags/links are combined).
export async function applyImport(db: LibraryDB, plan: ImportPlan) {
  if (plan.errors.length) throw new Error('Import has errors; fix them first.');
  await db.transaction('rw', [db.systems, db.editions, db.sources, db.rules, db.printings, db.amendments, db.entities, db.images, db.editLog], async () => {
    if (!(await db.systems.get(plan.system.id))) await db.systems.put(plan.system);
    if (!(await db.editions.get(plan.edition.id))) await db.editions.put(plan.edition);
    const replacing = !!(await db.sources.get(plan.source.id));
    await db.sources.put(plan.source);
    await db.printings.where('sourceId').equals(plan.source.id).delete();
    await db.amendments.where('sourceId').equals(plan.source.id).delete();
    await db.entities.where('sourceId').equals(plan.source.id).delete();
    await db.images.where('sourceId').equals(plan.source.id).delete();
    if (plan.images.length) await db.images.bulkPut(plan.images);

    for (const r of plan.rules) {
      const old = await db.rules.get(r.id);
      const merged: Rule = old
        ? {
            ...old,
            aliases: uniq([...old.aliases, ...r.aliases]),
            tags: uniq([...old.tags, ...r.tags]),
            relatedRuleIds: uniq([...old.relatedRuleIds, ...r.relatedRuleIds]),
            parameters: r.parameters.length ? r.parameters : old.parameters,
            phase: r.phase ?? old.phase,
            ...(old.tierBy === 'user' || !r.tier ? {} : { tier: r.tier, tierBy: 'import' as const }),
            category: r.category || old.category,
            supersedes: r.supersedes ?? old.supersedes,
            overridesRuleId: r.overridesRuleId ?? old.overridesRuleId,
            updatedAt: r.updatedAt,
          }
        : r;
      await db.rules.put(merged);
    }
    await db.printings.bulkPut(plan.printings);
    await db.amendments.bulkPut(plan.amendments);
    await db.entities.bulkPut(plan.entities);
    await db.editLog.add({
      at: Date.now(), recordType: 'source', recordId: plan.source.id, action: replacing ? 'reimport' : 'import',
      after: { rules: plan.rules.length, amendments: plan.amendments.length, entities: plan.entities.length },
    });
  });
}

export interface Reading { printing: Printing; source: Source; text: string }

export interface ResolvedRule {
  rule: Rule;
  tier: Tier;                        // Core or Expanded (the rule's own tier, else from its source)
  current?: Reading;                 // what to play with
  applied: { a: Amendment; source: Source }[];
  failed: { a: Amendment; source: Source }[]; // couldn't be applied automatically: shown in full
  earlier: { a: Amendment; source: Source }[]; // older than the base printing: may already be included
  clarifications: { a: Amendment; source: Source }[];
  otherReadings: Reading[];          // printings whose wording differs from the current one
  samePrintings: Reading[];          // reprints with identical wording
}

const textOf = (p: Printing) => p.fullText ?? p.summary ?? '';

export function sortSourcesNewestFirst(a: Source, b: Source) {
  if (a.published !== b.published) return a.published < b.published ? 1 : -1;
  return (parseFloat(b.version ?? '0') || 0) - (parseFloat(a.version ?? '0') || 0);
}

export function resolveRule(rule: Rule, printings: Printing[], amendments: Amendment[], sources: Map<string, Source>): ResolvedRule {
  const readings = printings
    .map((p) => ({ printing: p, source: sources.get(p.sourceId)! }))
    .filter((r) => r.source)
    .sort((x, y) => sortSourcesNewestFirst(x.source, y.source))
    .map((r) => ({ ...r, text: textOf(r.printing) }));

  // Newest wins, but a printing nobody has checked (e.g. a raw AI extraction) never outranks one that has been:
  // it shows up as a differing reading instead, so a fresh dump can't quietly replace verified text.
  const base = readings.find((r) => r.printing.id === rule.preferredPrintingId)
    ?? readings.find((r) => r.printing.fullText && r.printing.status !== 'unverified')
    ?? readings.find((r) => r.printing.fullText) ?? readings[0];
  const out: ResolvedRule = {
    rule, tier: rule.tier ?? (readings.some((r) => r.source.isCore) ? 'core' : 'expanded'), applied: [], failed: [], earlier: [], clarifications: [],
    otherReadings: [], samePrintings: [],
  };
  if (!base) return out;

  for (const r of readings) {
    if (r === base) continue;
    const same = r.printing.textHash && r.printing.textHash === base.printing.textHash;
    (same || (!r.printing.fullText && !base.printing.fullText) ? out.samePrintings : out.otherReadings).push(r);
  }

  let text = base.text;
  const ams = amendments
    .map((a) => ({ a, source: sources.get(a.sourceId)! }))
    .filter((x) => x.source)
    .sort((x, y) => -sortSourcesNewestFirst(x.source, y.source)); // oldest first

  for (const x of ams) {
    if (x.a.type === 'clarification') { out.clarifications.push(x); continue; }
    if (x.a.ruleId !== rule.id) continue; // text changes only apply to their own rule
    if (sortSourcesNewestFirst(x.source, base.source) > 0) { out.earlier.push(x); continue; } // amendment older than base
    if (!base.printing.fullText) { out.failed.push(x); continue; } // only a summary: can't patch text
    const before = text;
    if (x.a.type === 'insert') text = `${text}\n\n${x.a.text}`;
    else if (x.a.type === 'replace' && !x.a.find) text = x.a.text ?? text;
    else if (x.a.find && text.includes(x.a.find)) text = text.replace(x.a.find, x.a.type === 'delete' ? '' : x.a.text ?? '');
    (text === before ? out.failed : out.applied).push(x);
  }
  out.current = { ...base, text };
  return out;
}

export interface RuleView extends ResolvedRule {
  related: Rule[];
  mentions: Rule[];       // rules this text names
  mentionedBy: Rule[];    // rules whose text names this one
  factionVersions: Rule[];
  overrides?: Rule;
  previous?: Rule;        // same rule in an older edition
  next?: Rule;
  entities: { entity: Entity; value?: string; via?: string }[]; // via = carried on a weapon/wargear
}

export async function loadRuleView(db: LibraryDB, ruleId: string, mentionIndex: MentionIndex): Promise<RuleView | undefined> {
  const rule = await db.rules.get(ruleId);
  if (!rule) return;
  const [printings, amendments, entities, sources] = await Promise.all([
    db.printings.where('ruleId').equals(ruleId).toArray(),
    loadAmendments(db, ruleId),
    db.entities.where('ruleIds').equals(ruleId).toArray(),
    db.sources.toArray(),
  ]);
  const resolved = resolveRule(rule, printings, amendments, new Map(sources.map((s) => [s.id, s])));
  const get = async (ids: string[]) => (await db.rules.bulkGet(uniq(ids))).filter((r): r is Rule => !!r && r.id !== ruleId);
  return {
    ...resolved,
    related: await get(rule.relatedRuleIds),
    mentions: (await get(mentionIndex.mentions.get(ruleId) ?? [])).filter((r) => r.id !== rule.overridesRuleId),
    mentionedBy: await get(mentionIndex.mentionedBy.get(ruleId) ?? []),
    factionVersions: await db.rules.where('overridesRuleId').equals(ruleId).toArray(),
    overrides: rule.overridesRuleId ? await db.rules.get(rule.overridesRuleId) : undefined,
    previous: rule.supersedes ? await db.rules.get(rule.supersedes) : undefined,
    next: await db.rules.where('supersedes').equals(ruleId).first(),
    entities: await withCarriers(db, entities.map((entity) => ({ entity, value: entity.rules.find((r) => r.ruleId === ruleId)?.value }))),
  };
}

// Which rules name other rules in their text: computed per edition from current text.
export interface MentionIndex { mentions: Map<string, string[]>; mentionedBy: Map<string, string[]> }

export function buildMentionIndex(rules: { id: string; name: string; text: string }[]): MentionIndex {
  const mentions = new Map<string, string[]>();
  const mentionedBy = new Map<string, string[]>();
  const named = rules.filter((r) => r.name.length >= 4).sort((a, b) => b.name.length - a.name.length);
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = named.map((r) => ({ id: r.id, re: new RegExp(`\\b${esc(r.name)}\\b`, 'i') }));
  for (const r of rules) {
    const found = patterns.filter((p) => p.id !== r.id && p.re.test(r.text)).map((p) => p.id);
    if (!found.length) continue;
    mentions.set(r.id, found);
    for (const id of found) mentionedBy.set(id, [...(mentionedBy.get(id) ?? []), r.id]);
  }
  return { mentions, mentionedBy };
}

export async function setStatus(db: LibraryDB, printingId: string, status: Printing['status']) {
  const p = await db.printings.get(printingId);
  if (!p) return;
  await db.printings.update(printingId, { status, updatedAt: Date.now() });
  await db.editLog.add({ at: Date.now(), recordType: 'printing', recordId: printingId, action: 'status', before: p.status, after: status });
}

export async function preferPrinting(db: LibraryDB, ruleId: string, printingId: string | undefined) {
  const r = await db.rules.get(ruleId);
  if (!r) return;
  await db.rules.update(ruleId, { preferredPrintingId: printingId, updatedAt: Date.now() });
  await db.editLog.add({ at: Date.now(), recordType: 'rule', recordId: ruleId, action: 'prefer-printing', before: r.preferredPrintingId, after: printingId });
}

export async function loadAmendments(db: LibraryDB, ruleId: string) {
  const [own, shared] = await Promise.all([
    db.amendments.where('ruleId').equals(ruleId).toArray(),
    db.amendments.where('alsoRuleIds').equals(ruleId).toArray(),
  ]);
  const seen = new Set(own.map((a) => a.id));
  return [...own, ...shared.filter((a) => !seen.has(a.id))];
}

export async function resolveById(db: LibraryDB, ruleId: string, sources?: Map<string, Source>) {
  const rule = await db.rules.get(ruleId);
  if (!rule) return;
  const [printings, amendments] = await Promise.all([db.printings.where('ruleId').equals(ruleId).toArray(), loadAmendments(db, ruleId)]);
  if (!printings.length) return;
  sources ??= new Map((await db.sources.toArray()).map((s) => [s.id, s]));
  return resolveRule(rule, printings, amendments, sources);
}

// Units that get a rule through their weapons/wargear are listed too.
async function withCarriers(db: LibraryDB, direct: { entity: Entity; value?: string }[]) {
  const out: { entity: Entity; value?: string; via?: string }[] = [...direct];
  const seen = new Set(direct.map((d) => d.entity.id));
  for (const d of direct) {
    if (d.entity.type === 'unit') continue;
    const ids = [d.entity.id, d.entity.id.split('~')[0]];
    for (const u of await db.entities.where('wargearIds').anyOf(ids).toArray()) {
      if (seen.has(u.id)) continue;
      seen.add(u.id);
      out.push({ entity: u, value: d.value, via: d.entity.name });
    }
  }
  return out;
}

// You decide which sections are Core and which are Expanded. Applies to every rule in that section
// of the edition and survives re-imports (tierBy = 'user').
export async function setSectionTier(db: LibraryDB, editionId: string, section: string, tier: Tier) {
  await db.transaction('rw', [db.rules, db.editLog], async () => {
    const rs = (await db.rules.where('editionId').equals(editionId).toArray()).filter((r) => (r.section ?? 'Other') === section);
    await db.rules.bulkPut(rs.map((r) => ({ ...r, tier, tierBy: 'user' as const, updatedAt: Date.now() })));
    await db.editLog.add({ at: Date.now(), recordType: 'section', recordId: `${editionId}#${section}`, action: 'set-tier', after: { tier, rules: rs.length } });
  });
}


// Removes one book. Rules that no longer have a printing anywhere are removed with it.
export async function removeSource(db: LibraryDB, sourceId: string) {
  await db.transaction('rw', [db.sources, db.rules, db.printings, db.amendments, db.entities, db.images, db.editLog], async () => {
    const src = await db.sources.get(sourceId);
    await db.printings.where('sourceId').equals(sourceId).delete();
    await db.amendments.where('sourceId').equals(sourceId).delete();
    await db.entities.where('sourceId').equals(sourceId).delete();
    await db.images.where('sourceId').equals(sourceId).delete();
    await db.sources.delete(sourceId);
    if (src) {
      for (const r of await db.rules.where('editionId').equals(src.editionId).toArray()) {
        if ((await db.printings.where('ruleId').equals(r.id).count()) === 0) await db.rules.delete(r.id);
      }
    }
    await db.editLog.add({ at: Date.now(), recordType: 'source', recordId: sourceId, action: 'delete' });
  });
}

// Removes a game: every edition, book, rule, printing, FAQ change and unit that belongs to it.
export async function removeSystem(db: LibraryDB, systemId: string) {
  await db.transaction('rw', [db.systems, db.editions, db.sources, db.rules, db.printings, db.amendments, db.entities, db.images, db.editLog], async () => {
    for (const ed of await db.editions.where('systemId').equals(systemId).toArray()) {
      for (const src of await db.sources.where('editionId').equals(ed.id).toArray()) {
        await db.printings.where('sourceId').equals(src.id).delete();
        await db.amendments.where('sourceId').equals(src.id).delete();
        await db.images.where('sourceId').equals(src.id).delete();
      }
      for (const r of await db.rules.where('editionId').equals(ed.id).toArray()) {
        await db.printings.where('ruleId').equals(r.id).delete();
        await db.amendments.where('ruleId').equals(r.id).delete();
      }
      await db.rules.where('editionId').equals(ed.id).delete();
      await db.entities.where('editionId').equals(ed.id).delete();
      await db.sources.where('editionId').equals(ed.id).delete();
      await db.editions.delete(ed.id);
    }
    await db.systems.delete(systemId);
    await db.editLog.add({ at: Date.now(), recordType: 'system', recordId: systemId, action: 'delete' });
  });
}

// Empties the library on this device.
export async function eraseAll(db: LibraryDB) {
  await db.transaction('rw', [db.systems, db.editions, db.sources, db.rules, db.printings, db.amendments, db.entities, db.images, db.editLog, db.meta], async () => {
    for (const t of [db.systems, db.editions, db.sources, db.rules, db.printings, db.amendments, db.entities, db.images, db.editLog, db.meta]) await t.clear();
  });
}
