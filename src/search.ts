import MiniSearch from 'minisearch';
import type { LibraryDB } from './db';
import type { Rule, SourceKind, Tier } from './model';
import { normName, parseRuleRef } from './normalize';
import { buildMentionIndex, resolveRule, type MentionIndex } from './store';

export type HitKind = 'rule' | 'unit' | 'weapon' | 'wargear' | 'other';
export interface Hit { id: string; ref: string; kind: HitKind; name: string; category: string; faction?: string; tier?: Tier; score: number; snippet: string; page?: string; book?: string }
export interface Book { id: string; title: string; version?: string; kind: SourceKind; rules: number; entities: number }

interface Doc { id: string; kind: HitKind; name: string; aliases: string; tags: string; category: string; text: string; faction: string; tier: string;
  pg: Record<string, string>; cur: string } // pg: book id → page, for every book that prints (or amends) this entry; cur: the book of the current reading

export interface EditionIndex {
  search: (q: string, limit?: number, kinds?: HitKind[], tier?: Tier, bookId?: string) => Hit[];
  list: (bookId: string, kinds?: HitKind[], tier?: Tier) => Hit[]; // everything from one book, in page order
  books: Book[];
  bookPages: Map<string, Record<string, string>>; // rule or unit id → book id → page
  mentions: MentionIndex;
  rules: Map<string, Rule>;
  categories: string[];
  tiers: Map<string, Tier>;   // rule id → Core or Expanded
  pages: Map<string, string>; // rule id → page of current printing (book order)
  count: number;
  entityCount: number;
}

export async function buildEditionIndex(db: LibraryDB, editionId: string): Promise<EditionIndex> {
  const [rules, sources, entities] = await Promise.all([
    db.rules.where('editionId').equals(editionId).toArray(),
    db.sources.where('editionId').equals(editionId).toArray(),
    db.entities.where('editionId').equals(editionId).toArray(),
  ]);
  const srcMap = new Map(sources.map((s) => [s.id, s]));
  const ruleIds = rules.map((r) => r.id);
  const [printings, amendments] = await Promise.all([
    db.printings.where('ruleId').anyOf(ruleIds).toArray(),
    db.amendments.where('ruleId').anyOf(ruleIds).toArray(),
  ]);
  const group = <T extends { ruleId: string }>(xs: T[]) => {
    const m = new Map<string, T[]>();
    xs.forEach((x) => m.set(x.ruleId, [...(m.get(x.ruleId) ?? []), x]));
    return m;
  };
  const pBy = group(printings), aBy = group(amendments);
  const alsoBy = new Map<string, typeof amendments>(); // an FAQ answer that covers several rules counts for each of them
  amendments.forEach((a) => (a.alsoRuleIds ?? []).forEach((id) => alsoBy.set(id, [...(alsoBy.get(id) ?? []), a])));

  const pages = new Map<string, string>();
  const docs: Doc[] = rules
    .filter((r) => pBy.has(r.id)) // only rules that are actually printed somewhere
    .map((r) => {
      const res = resolveRule(r, pBy.get(r.id) ?? [], aBy.get(r.id) ?? [], srcMap);
      if (res.current?.printing.page) pages.set(r.id, res.current.printing.page);
      const pg: Record<string, string> = {};
      (pBy.get(r.id) ?? []).forEach((p) => { pg[p.sourceId] = p.page ?? ''; });
      [...(aBy.get(r.id) ?? []), ...(alsoBy.get(r.id) ?? [])].forEach((a) => { if (!(a.sourceId in pg)) pg[a.sourceId] = a.page ?? ''; });
      return {
        id: 'r:' + r.id, kind: 'rule' as HitKind, name: r.name, aliases: r.aliases.join(' '), tags: r.tags.join(' '), category: r.category,
        faction: r.faction ?? '', tier: res.tier, pg, cur: res.current?.source.id ?? '',
        text: [res.current?.printing.summary, res.current?.text].filter(Boolean).join(' '),
      };
    });

  const entityDocs: Doc[] = entities.map((e) => ({
    id: 'e:' + e.id, kind: e.type as HitKind, name: e.name, aliases: '', faction: e.faction ?? '', tier: '', pg: { [e.sourceId]: e.page ?? '' }, cur: e.sourceId,
    tags: [e.unitType, ...e.subTypes, ...e.keywords, e.role].filter(Boolean).join(' '),
    category: [e.unitType ? `${e.unitType}${e.subTypes.length ? ` (${e.subTypes.join(', ')})` : ''}` : e.type].join(''),
    text: e.stats.map((s) => `${s.label} ${s.value}`).join(' · '),
  }));

  const ms = new MiniSearch<Doc>({
    fields: ['name', 'aliases', 'tags', 'category', 'text', 'faction'],
    storeFields: ['kind', 'name', 'category', 'faction', 'tier', 'text', 'pg', 'cur'],
    searchOptions: {
      boost: { name: 4, aliases: 4, tags: 1.5, category: 1, faction: 1, text: 0.4 },
      prefix: true,
      fuzzy: (term) => (term.length <= 3 ? 0 : term.length <= 5 ? 1 : 0.25),
      combineWith: 'AND',
    },
  });
  ms.addAll(docs);
  ms.addAll(entityDocs);
  const byNorm = new Map(docs.map((d) => [normName(d.name), d.id]));
  const aliasNorm = new Map<string, string>();
  rules.forEach((r) => r.aliases.forEach((a) => aliasNorm.set(normName(a), 'r:' + r.id)));

  const mkFilter = (kinds?: HitKind[], tier?: Tier, bookId?: string) =>
    kinds?.length || tier || bookId
      ? ((r: { kind: HitKind; tier?: string; pg?: Record<string, string> }) =>
        (!kinds?.length || kinds.includes(r.kind)) && (!tier || r.tier === tier) && (!bookId || bookId in (r.pg ?? {}))) as never
      : undefined;
  const toHit = (r: Record<string, any>, terms: string[], bookId: string | undefined, score: number): Hit => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const sid: string = bookId ?? r.cur;
    return {
      ref: r.id as string, id: (r.id as string).slice(2), kind: r.kind as HitKind, name: r.name, category: r.category, faction: r.faction || undefined,
      tier: (r.tier || undefined) as Tier | undefined, score, snippet: snippet(r.text as string, terms),
      page: r.pg?.[sid] || undefined, book: srcMap.get(sid)?.title,
    };
  };
  const pageNo = (h: Hit) => parseFloat(h.page ?? '') || 9999;

  const search = (q: string, limit = 30, kinds?: HitKind[], tier?: Tier, bookId?: string): Hit[] => {
    const query = parseRuleRef(q).name.trim(); // "rending (4+)" searches "rending"
    if (!query) return [];
    const filter = mkFilter(kinds, tier, bookId);
    let res = ms.search(query, { filter });
    if (!res.length) res = ms.search(query, { combineWith: 'OR', filter });
    const exact = byNorm.get(normName(query)) ?? aliasNorm.get(normName(query));
    const hits = res.map((r) => toHit(r, r.terms, bookId,
      r.score * (r.id === exact ? 100 : 1) * (normName(r.name).startsWith(normName(query)) ? 3 : 1) * (r.faction ? 0.8 : 1))); // universal version first
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  };

  const list = (bookId: string, kinds?: HitKind[], tier?: Tier): Hit[] =>
    ms.search(MiniSearch.wildcard, { filter: mkFilter(kinds, tier, bookId) }).map((r) => toHit(r, [], bookId, 0))
      .sort((a, b) => pageNo(a) - pageNo(b) || a.name.localeCompare(b.name));

  const bookPages = new Map<string, Record<string, string>>([...docs, ...entityDocs].map((d) => [d.id.slice(2), d.pg]));
  const books: Book[] = [...sources]
    .sort((a, b) => Number(b.isCore) - Number(a.isCore) || a.published.localeCompare(b.published) || a.title.localeCompare(b.title))
    .map((s) => ({ id: s.id, title: s.title, version: s.version, kind: s.kind,
      rules: docs.filter((d) => s.id in d.pg).length, entities: entityDocs.filter((d) => s.id in d.pg).length }))
    .filter((b) => b.rules + b.entities > 0);

  return {
    search, list, books, bookPages,
    mentions: buildMentionIndex(docs.map((d) => ({ id: d.id.slice(2), name: d.name, text: d.text }))),
    entityCount: entities.length,
    rules: new Map(rules.map((r) => [r.id, r])),
    pages,
    tiers: new Map(docs.filter((d) => d.kind === 'rule').map((d) => [d.id.slice(2), d.tier as Tier])),
    categories: [...new Set(docs.map((d) => d.category))].sort(),
    count: docs.length,
  };
}

function snippet(text: string, terms: string[]): string {
  if (!text) return '';
  const lower = text.toLowerCase();
  const at = terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, at - 30);
  return (start ? '…' : '') + text.slice(start, start + 110).replace(/\s+/g, ' ') + (text.length > start + 110 ? '…' : '');
}
