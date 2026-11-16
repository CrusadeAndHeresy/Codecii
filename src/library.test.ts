import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { LibraryDB } from './db';
import { csvToImport, planImport } from './importer';
import { applyImport, eraseAll, loadRuleView, removeSource, removeSystem, setSectionTier } from './store';
import { buildEditionIndex, type EditionIndex } from './search';
import { demoImports } from './fixtures';
import { buildCombo, loadEntityView } from './views';

const db = new LibraryDB('test');
let idx: EditionIndex;
const E2 = 'demo-skirmish@2-0';

beforeAll(async () => {
  for (const f of demoImports) await applyImport(db, planImport(f));
  idx = await buildEditionIndex(db, E2);
});

describe('validation', () => {
  it('gives clear, located errors', () => {
    const p = planImport({ format: 'rules-library/v1', system: { name: 'X' }, edition: { name: '1' },
      source: { title: 'B', kind: 'book', published: '2026' }, rules: [{ name: 'Foo' }, { category: 'a', summary: 'b' }] });
    const msgs = p.errors.map((e) => `${e.path}: ${e.message}`);
    expect(msgs).toContain('source.kind: Must be one of: rulebook, supplement, download, faq, errata, user.');
    expect(msgs.some((m) => m.startsWith('source.published'))).toBe(true);
    expect(msgs.some((m) => m.startsWith('rules[0] (Foo).category'))).toBe(true);
    expect(msgs.some((m) => m.startsWith('rules[0] (Foo): Needs a summary'))).toBe(true);
    expect(msgs).toContain('rules[1].name: Required.');
  });
  it('reads CSV', () => {
    const csv = '#source,My Book,rulebook,2026-01-01,,true,Test,1\nname,category,aliases,parameters,summary,page\n"Rending (X)",Weapon Trait,R|Rend,X:roll,"Ignores, armour",5\n';
    const p = planImport(csvToImport(csv));
    expect(p.errors).toEqual([]);
    expect(p.rules[0]).toMatchObject({ name: 'Rending', aliases: ['R', 'Rend'], parameters: [{ name: 'X', kind: 'roll' }] });
    expect(p.printings[0].summary).toBe('Ignores, armour');
  });
});

describe('search', () => {
  it('finds by 3 letters, alias, typo and parameter', () => {
    expect(idx.search('ren')[0].name).toBe('Rending');
    expect(idx.search('FNP')[0].name).toBe('Resilient');
    expect(idx.search('deep strike')[0].name).toBe('Deep Deployment');
    expect(idx.search('rendng')[0].name).toBe('Rending');
    expect(idx.search('Rending (4+)')[0].name).toBe('Rending');
  });
});

describe('rule card', () => {
  it('applies FAQ amendments to the latest printing', async () => {
    const v = (await loadRuleView(db, `${E2}:rending`, idx.mentions))!;
    expect(v.current!.text).toContain('but not invulnerable saves');
    expect(v.applied).toHaveLength(1);
    expect(v.entities.map((e) => `${e.entity.name} ${e.value ?? ''}${e.via ? ' via ' + e.via : ''}`)).toEqual(
      expect.arrayContaining(['Breaching Axe 5+', 'Warden Breachers 5+ via Breaching Axe']));
    expect(v.related.map((r) => r.name)).toEqual(['Resilient']);
  });
  it('flags reprints with different wording and uses the newest', async () => {
    const v = (await loadRuleView(db, `${E2}:fleet`, idx.mentions))!;
    expect(v.current!.source.title).toBe('Iron Wardens Army Book');
    expect(v.otherReadings).toHaveLength(1);
  });
  it('links faction overrides, editions and mentions', async () => {
    const f = (await loadRuleView(db, `${E2}:fearless`, idx.mentions))!;
    expect(f.factionVersions[0].faction).toBe('Iron Wardens');
    expect(f.mentions.map((r) => r.name)).toContain('Morale');
    const d = (await loadRuleView(db, `${E2}:deep-deployment`, idx.mentions))!;
    expect(d.previous?.name).toBe('Deep Strike');
    expect(d.mentionedBy.map((r) => r.name)).toContain('Ambush');
    const r = (await loadRuleView(db, `${E2}:resilient`, idx.mentions))!;
    expect(r.clarifications[0].a.text).toBe('No. Use the best value.');
  });
  it('re-importing a book replaces only that book', async () => {
    await applyImport(db, planImport(demoImports[2]));
    idx = await buildEditionIndex(db, E2);
    expect(await db.printings.where('ruleId').equals(`${E2}:fleet`).count()).toBe(2);
    expect(await db.rules.where('editionId').equals('demo-skirmish@1-0').count()).toBe(1);
  });
});

describe('units and wargear', () => {
  it('finds units in search and filters by kind', () => {
    const h = idx.search('breach');
    expect(h.map((x) => x.name)).toContain('Warden Breachers');
    expect(idx.search('breach', 10, ['weapon']).map((x) => x.name)).toEqual(['Breaching Axe']);
  });
  it('unit page expands rules, types, wargear (faction-aware)', async () => {
    const v = (await loadEntityView(db, `${E2}#warden-breachers~iron-wardens`))!;
    expect(v.entity.stats.find((s) => s.label === 'Sv')?.value).toBe('3+');
    expect(v.rules.find((r) => r.name === 'Fearless')?.rule?.faction).toBe('Iron Wardens');
    expect(v.typeRules.map((r) => r.name)).toEqual(['Infantry', 'Heavy Sub-Type']);
    expect(v.wargear.map((w) => [w.name, !!w.entity])).toEqual([['Breaching Axe', true], ['Bolt Pistol', true]]);
    const axe = (await loadEntityView(db, `${E2}#breaching-axe~iron-wardens`))!;
    expect(axe.usedBy.map((u) => u.name).sort()).toEqual(['Warden Breachers', 'Warden Castellan']);
  });
  it('Infantry rule card lists units of that type', async () => {
    const v = (await loadRuleView(db, `${E2}:infantry`, idx.mentions))!;
    expect(v.entities.map((e) => e.entity.name).sort()).toEqual(['Warden Breachers', 'Warden Castellan']);
  });
});

describe('rules together', () => {
  it('gathers unit + wargear rules, flags stacking, faction versions and shared FAQs', async () => {
    const c = await buildCombo(db, [`e:${E2}#warden-castellan~iron-wardens`], idx.mentions);
    const names = c.rules.map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(['Resilient', 'Fearless', 'Rending', 'Infantry', 'Character Sub-Type']));
    expect(c.interplay.some((i) => i.kind === 'stacking' && i.text.includes('Resilient'))).toBe(true);
    expect(c.interplay.some((i) => i.kind === 'faction')).toBe(true);
    expect(c.interplay.some((i) => i.kind === 'faq' && i.text.includes('best value'))).toBe(true);
  });
  it('shows mentions and multi-rule Q&As between selected rules', async () => {
    const c = await buildCombo(db, [`e:${E2}#warden-breachers~iron-wardens`, `r:${E2}:charging`], idx.mentions);
    expect(c.interplay.filter((i) => i.kind === 'mentions').map((i) => i.text)).toContain('Ambush refers to Deep Deployment. Both are in play.');
    expect(c.interplay.some((i) => i.kind === 'faq' && i.ruleIds.length >= 2 && i.text.includes('Ambush only changes shooting'))).toBe(true);
    expect(c.byPhase.map(([p]) => p)).toContain('Movement');
  });
});

describe('Journal Tactica: Zone Mortalis import (next to the core rulebook)', () => {
  it('imports cleanly, links to core rules and keeps both books', async () => {
    const fs = await import('node:fs');
    const core = '/home/claude/out/hh3-core-rulebook.json';
    const zmPath = '/home/claude/out/hh3-zone-mortalis.json';
    if (!fs.existsSync(core) || !fs.existsSync(zmPath)) return;
    const zdb = new LibraryDB('hh3-zm');
    await applyImport(zdb, planImport(JSON.parse(fs.readFileSync(core, 'utf8'))));
    const plan = planImport(JSON.parse(fs.readFileSync(zmPath, 'utf8')));
    expect(plan.errors).toEqual([]);
    expect(plan.rules.length).toBe(77);
    expect(plan.entities.length).toBe(10);
    await applyImport(zdb, plan);
    const E = 'horus-heresy@3-0';
    const ix = await buildEditionIndex(zdb, E);
    expect(ix.count).toBe(409 + 77);
    expect(ix.search('doorway').slice(0, 3).map((h) => h.name)).toEqual(expect.arrayContaining(['Doorways', 'Doorway']));
    expect(ix.search('confined')[0].name).toBe('Confined Space');
    expect(ix.search('interface test').map((h) => h.name)).toEqual(expect.arrayContaining(['Interface Test Table', 'Cogitator Terminal']));
    expect(ix.search('sudden death').map((h) => h.name)).toEqual(expect.arrayContaining(['Sudden Death', 'Clearance Protocol Sudden Death']));
    expect(ix.search('crushed')[0].name).toBe('Crushed');
    expect(ix.search('teleport strike')[0].name).toBe('Teleport Strike');
    expect(ix.search('sector dom')[0].name).toBe('Sector Domination');
    // everything in this book is Expanded, and the core rulebook is untouched
    expect(ix.search('doorways')[0].tier).toBe('expanded');
    expect(ix.search('wound table')[0].tier).toBe('core');
    // rules link across books: Doorway (X) mentions the core Bulky rule; the core Reserves rule is unchanged
    const door = (await loadRuleView(zdb, `${E}:doorway`, ix.mentions))!;
    expect(door.current!.text).toContain('Bulky (X)');
    expect(door.current!.printing.page).toBe('9');
    expect(door.mentions.map((r) => r.name)).toContain('Bulky');
    const core1 = (await loadRuleView(zdb, `${E}:reserves`, ix.mentions))!;
    expect(core1.current!.printing.page).not.toBe('10');
    // transcriber's notes travel with the text; picture-only pages are flagged
    const sf = (await loadRuleView(zdb, `${E}:zone-mortalis-strike-force`, ix.mentions))!;
    expect(sf.current!.text).toContain("[Transcriber's note - not rulebook text:");
    // units: stats, rules from core, weapon links, type links
    const ub = (await loadEntityView(zdb, `${E}#veteran-breacher-squad~legiones-astartes`))!;
    expect(ub.entity.stats.find((x) => x.label === 'INV')!.value).toBe('5+');
    expect(ub.rules.map((r) => r.name)).toContain('Vanguard');
    expect(ub.wargear.map((w) => w.name)).toContain('Boarding shield');
    const cx = (await loadEntityView(zdb, `${E}#castellax-infernus-maniple~mechanicum`))!;
    expect(cx.rules.find((r) => r.name === 'Bulky')!.from[0].value).toBe('4');
    expect(cx.wargear[0].entity!.stats.find((x) => x.label === 'RS')!.value).toBe('6');
    // book filter: what's in each book, with pages, and nothing leaks across
    const bk = ix.books;
    expect(bk.map((b) => [b.title.slice(0, 12), b.rules, b.entities])).toEqual([['Age of Darkn', 409, 0], ['Journal Tact', 77, 10]]);
    const zmId = bk[1].id, coreId = bk[0].id;
    const zmList = ix.list(zmId);
    expect(zmList.length).toBe(87);
    expect(zmList.every((h) => h.page)).toBe(true);
    expect(zmList.map((h) => parseFloat(h.page!))).toEqual([...zmList.map((h) => parseFloat(h.page!))].sort((a, b) => a - b));
    expect(ix.list(coreId).length).toBe(409);
    const inZm = ix.search('door', 40, undefined, undefined, zmId);
    expect(inZm.length).toBeGreaterThan(0);
    expect(inZm.every((h) => zmId in (ix.bookPages.get(h.id) ?? {}))).toBe(true);
    expect(ix.search('cover', 40, undefined, undefined, zmId).some((h) => h.name === 'Cover Tests')).toBe(false); // that rule is printed in the core book only
    expect(ix.search('cover', 40, undefined, undefined, coreId).some((h) => h.name === 'Cover Tests')).toBe(true);
    expect(ix.search('door', 40, ['unit'], undefined, zmId)).toEqual([]);
    expect(ix.list(zmId, ['unit']).length).toBe(5);
    // re-importing the same book replaces it rather than doubling it
    await applyImport(zdb, planImport(JSON.parse(fs.readFileSync(zmPath, 'utf8'))));
    expect((await buildEditionIndex(zdb, E)).count).toBe(409 + 77);
  });
});

describe('Horus Heresy 3.0 core rulebook import', () => {
  it('imports cleanly and is searchable', async () => {
    const fs = await import('node:fs');
    const path = '/home/claude/out/hh3-core-rulebook.json';
    if (!fs.existsSync(path)) return;
    const hdb = new LibraryDB('hh3');
    const plan = planImport(JSON.parse(fs.readFileSync(path, 'utf8')));
    expect(plan.errors).toEqual([]);
    await applyImport(hdb, plan);
    const ix = await buildEditionIndex(hdb, 'horus-heresy@3-0');
    expect(ix.count).toBe(409);
    expect(ix.search('fnp')[0].name).toBe('Feel No Pain');
    expect(ix.search('ren')[0].name).toBe('Rending');
    expect(ix.search('deep strik')[0].name).toBe('Deep Strike');
    expect(ix.search('rendng')[0].name).toBe('Rending');
    expect(ix.search('Shred (4+)')[0].name).toBe('Shred');
    expect(ix.search('heavy').slice(0, 2).map((h) => h.name).sort()).toEqual(['Heavy', 'Heavy Sub-Type']);
    const lt = (await loadRuleView(hdb, 'horus-heresy@3-0:light-transport', ix.mentions))!;
    expect(lt.mentions.map((r) => r.name)).toContain('Bulky');
    const rend = (await loadRuleView(hdb, 'horus-heresy@3-0:rending', ix.mentions))!;
    expect(rend.current!.text).toContain("Rending Hit");
    expect(rend.current!.printing.page).toBe('336');
    // core rules: searchable and cross-linked to special rules
    expect(ix.search('overwatch')[0].name).toBe('Overwatch');
    expect(ix.search('invuln')[0].name).toBe('Invulnerable Tests');
    expect(ix.search('los')[0].name).toBe('Line of Sight');
    expect(ix.search('wound table')[0].name).toBe('Wound Table');
    expect(ix.search('glancing').map((h) => h.name)).toContain('Armour Penetration Test');
    expect(ix.search('vehicle')[0].name).toBe('Vehicle');
    expect(ix.search('rhino').length).toBeGreaterThan(0);
    const dtt = (await loadRuleView(hdb, 'horus-heresy@3-0:dangerous-terrain-tests', ix.mentions))!;
    expect(dtt.current!.text).toContain('Invulnerable Saves may still be made');
    const cover = (await loadRuleView(hdb, 'horus-heresy@3-0:cover-tests', ix.mentions))!;
    expect(cover.current!.text).toContain("[Transcriber's note - not rulebook text:");
    expect(ix.search('pinned').map((h) => h.name)).toEqual(expect.arrayContaining(['Pinned', 'Pinning']));
    const dc = (await loadRuleView(hdb, 'horus-heresy@3-0:disordered-charge', ix.mentions))!;
    expect(dc.mentionedBy.map((r) => r.name)).toContain('Assault Vehicle');
    const routed = (await loadRuleView(hdb, 'horus-heresy@3-0:routed', ix.mentions))!;
    expect(routed.mentions.map((r) => r.name)).toEqual(expect.arrayContaining(['Panic', 'Suppressed']));
    // army selection, missions, psychic, modes of play are in and searchable
    expect(ix.search('prime slot')[0].name).toBe('Prime Slots');
    expect(ix.search('take and hold')[0].name).toBe('Take and Hold');
    expect(ix.search('window of opp')[0].name).toBe('Window of Opportunity');
    expect(ix.search('perils')[0].name).toBe('Perils of the Warp');
    expect(ix.search('biomancy').map((h) => h.name)).toContain('Biomancy');
    expect(ix.search('matched play')[0].name).toBe('Matched Play');
    // Core vs Expanded: set by the import, filterable, and your own choice survives a re-import
    expect(ix.search('rending')[0].tier).toBe('expanded');
    expect(ix.search('wound table')[0].tier).toBe('core');
    expect(ix.search('rending', 30, undefined, 'core').map((h) => h.name)).not.toContain('Rending');
    expect(ix.search('rending', 30, undefined, 'expanded')[0].name).toBe('Rending');
    await setSectionTier(hdb, 'horus-heresy@3-0', 'Core Special Rules', 'core');
    await applyImport(hdb, planImport(JSON.parse(fs.readFileSync(path, 'utf8'))));
    const ix2 = await buildEditionIndex(hdb, 'horus-heresy@3-0');
    expect(ix2.search('rending')[0].tier).toBe('core');
    expect(ix2.search('overwatch')[0].tier).toBe('expanded');
    // units with sub-types link to the right rules
    await applyImport(hdb, planImport({ format: 'rules-library/v1', system: { name: 'Horus Heresy' }, edition: { name: '3.0' },
      source: { title: 'Test Units', kind: 'user', published: '2025-08-01' },
      entities: [{ name: 'Test Terminators', type: 'unit', unitType: 'Infantry', subTypes: ['Heavy'], rules: ['Deep Strike'] }] }));
    const ev = (await loadEntityView(hdb, 'horus-heresy@3-0#test-terminators'))!;
    expect(ev.typeRules.map((r) => r.name)).toEqual(['Infantry', 'Heavy Sub-Type']);
  });
});

describe('removing books, games and everything', () => {
  const tiny = (system: string, title: string, rules: string[]) => ({
    format: 'rules-library/v1', system: { name: system }, edition: { name: '1' },
    source: { title, kind: 'rulebook', isCore: true, published: '2026-01-01' },
    rules: rules.map((name) => ({ name, category: 'Rule', fullText: `${name} text.` })),
  });
  const counts = async (d: LibraryDB) => ({
    systems: await d.systems.count(), editions: await d.editions.count(), sources: await d.sources.count(), rules: await d.rules.count(),
    printings: await d.printings.count(), amendments: await d.amendments.count(), entities: await d.entities.count(),
  });

  it('removing a book also removes rules nothing else prints, but keeps shared ones', async () => {
    const d = new LibraryDB('rm-source');
    await applyImport(d, planImport(tiny('G', 'Book A', ['Shared', 'Only A'])));
    await applyImport(d, planImport({ ...tiny('G', 'Book B', ['Shared', 'Only B']), source: { title: 'Book B', kind: 'supplement', isCore: false, published: '2026-02-01' } }));
    expect(await d.rules.count()).toBe(3);
    const a = (await d.sources.toArray()).find((s) => s.title === 'Book A')!;
    await removeSource(d, a.id);
    const names = (await d.rules.toArray()).map((r) => r.name).sort();
    expect(names).toEqual(['Only B', 'Shared']);
    expect(await d.printings.count()).toBe(2);
  });

  it('removing a game leaves other games untouched', async () => {
    const d = new LibraryDB('rm-system');
    for (const f of demoImports) await applyImport(d, planImport(f));
    await applyImport(d, planImport(tiny('Keeper', 'Keeper book', ['K1', 'K2'])));
    const demo = (await d.systems.toArray()).find((s) => s.name === 'Demo Skirmish')!;
    await removeSystem(d, demo.id);
    const c = await counts(d);
    expect(c).toEqual({ systems: 1, editions: 1, sources: 1, rules: 2, printings: 2, amendments: 0, entities: 0 });
  });

  it('erase everything empties every table', async () => {
    const d = new LibraryDB('erase-all');
    for (const f of demoImports) await applyImport(d, planImport(f));
    expect((await counts(d)).rules).toBeGreaterThan(0);
    await eraseAll(d);
    expect(await counts(d)).toEqual({ systems: 0, editions: 0, sources: 0, rules: 0, printings: 0, amendments: 0, entities: 0 });
    expect(await d.editLog.count()).toBe(0);
  });
});

describe('book filter', () => {
  it('lists the books of an edition and what each one prints or amends', async () => {
    const ids = Object.fromEntries(idx.books.map((b) => [b.title, b.id]));
    expect(idx.books.map((b) => b.title)).toEqual(['Demo Rulebook', 'Iron Wardens Army Book', 'Demo FAQ']); // core first, then by date
    const army = idx.list(ids['Iron Wardens Army Book']);
    expect(army.map((h) => h.name)).toEqual(expect.arrayContaining(['Fleet', 'Warden Breachers', 'Breaching Axe']));
    expect(army.map((h) => parseFloat(h.page!))).toEqual([...army.map((h) => parseFloat(h.page!))].sort((a, b) => a - b));
    // an FAQ "contains" the rules it changes, including those a clarification covers as "also"
    const faq = idx.list(ids['Demo FAQ']).map((h) => h.name);
    expect(faq).toEqual(expect.arrayContaining(['Rending', 'Resilient', 'Ambush', 'Deep Deployment', 'Charging']));
    expect(idx.books.find((b) => b.title === 'Demo FAQ')!.entities).toBe(0);
  });
  it('filters search by book, and still combines with kind and tier', async () => {
    const army = idx.books.find((b) => b.title === 'Iron Wardens Army Book')!.id;
    const all = idx.search('fleet', 20);
    const inArmy = idx.search('fleet', 20, undefined, undefined, army);
    expect(inArmy.length).toBeGreaterThan(0);
    expect(inArmy.length).toBeLessThanOrEqual(all.length);
    expect(inArmy.every((h) => h.book === 'Iron Wardens Army Book')).toBe(true);
    expect(idx.search('fleet', 20, ['unit'], undefined, army)).toEqual([]);
    expect(idx.search('breachers', 20, ['unit'], undefined, army)[0].name).toBe('Warden Breachers');
    expect(idx.search('rending', 20, undefined, undefined, army).some((h) => h.name === 'Rending')).toBe(false); // printed in the rulebook, not the army book
  });
  it('shows the page from the picked book, and the current book when none is picked', async () => {
    const [core, army] = [idx.books[0], idx.books[1]];
    const fleetHit = (b?: string) => idx.search('fleet', 20, ['rule'], undefined, b).find((h) => h.name === 'Fleet' && !h.faction)!;
    expect(fleetHit(army.id).page).toBe('88');
    expect(fleetHit().book).toBeTruthy();
    expect(core.rules).toBeGreaterThan(0);
  });
});

describe('FAQ 1.3 (core rulebook FAQ and errata)', () => {
  it('imports onto the core rulebook, and each answer shows on its rule card', async () => {
    const fs = await import('node:fs');
    const corePath = '/home/claude/out/hh3-core-rulebook.json';
    const faqPath = '/home/claude/out/hh3-faq-1-3-core.json';
    if (!fs.existsSync(corePath) || !fs.existsSync(faqPath)) return;
    const fdb = new LibraryDB('faq');
    await applyImport(fdb, planImport(JSON.parse(fs.readFileSync(corePath, 'utf8'))));
    const plan = planImport(JSON.parse(fs.readFileSync(faqPath, 'utf8')));
    expect(plan.errors).toEqual([]);
    await applyImport(fdb, plan);
    const ix = await buildEditionIndex(fdb, 'horus-heresy@3-0');
    const los = await loadRuleView(fdb, 'horus-heresy@3-0:line-of-sight', ix.mentions);
    expect(los!.clarifications.some((c) => c.a.text?.startsWith('Yes. Designer'))).toBe(true);
    const ftf = await loadRuleView(fdb, 'horus-heresy@3-0:core-gambits', ix.mentions);
    expect(ftf!.clarifications.some((c) => c.a.question?.startsWith('Errata: Flurry of Blows'))).toBe(true);
    // the FAQ is its own book in the picker, with the rules it changes listed under it
    expect(ix.books.map((b) => b.title)).toEqual(['Age of Darkness Core Rulebook', 'Age of Darkness Rulebook FAQ & Errata']);
    expect(ix.list(ix.books[1].id).length).toBeGreaterThan(40);
  });
});

describe('Shattered Legions 1.0 and Primary Detachments (supplements)', () => {
  it('import cleanly on the core rulebook and show as their own books', async () => {
    const fs = await import('node:fs');
    const files = [
      '/home/claude/out/hh3-core-rulebook.json',
      '/home/claude/out/hh3-shattered-legions-1-0.json',
      '/home/claude/out/hh3-primary-detachments.json',
    ];
    if (!files.every((f) => fs.existsSync(f))) return;
    const sdb = new LibraryDB('supplements');
    for (const f of files) {
      const plan = planImport(JSON.parse(fs.readFileSync(f, 'utf8')));
      expect(plan.errors).toEqual([]);
      await applyImport(sdb, plan);
    }
    const ix = await buildEditionIndex(sdb, 'horus-heresy@3-0');
    const titles = ix.books.map((b) => b.title);
    expect(titles).toContain('The Shattered Legions');
    expect(titles).toContain('Legiones Astartes Primary Detachments');
    const sl = ix.books.find((b) => b.title === 'The Shattered Legions')!;
    expect(ix.list(sl.id).length).toBeGreaterThanOrEqual(28);
    const hits = ix.search('mutable tactics', 5);
    expect(hits.length).toBeGreaterThan(0);
  });
});

describe('Legacies 1.1 rules addenda', () => {
  it('imports onto the core rulebook with no errors', async () => {
    const fs = await import('node:fs');
    const files = ['/home/claude/out/hh3-core-rulebook.json', '/home/claude/out/hh3-legacies-rules-1-1.json'];
    if (!files.every((f) => fs.existsSync(f))) return;
    const ldb = new LibraryDB('legacies');
    for (const f of files) {
      const plan = planImport(JSON.parse(fs.readFileSync(f, 'utf8')));
      expect(plan.errors).toEqual([]);
      await applyImport(ldb, plan);
    }
    const ix = await buildEditionIndex(ldb, 'horus-heresy@3-0');
    expect(ix.books.map((b) => b.title)).toContain('Legacies of the Age of Darkness');
    expect(ix.search('medic', 5).length).toBeGreaterThan(0);
  });
});

describe('Mounted Legion Champion (two profile lines)', () => {
  it('shows each profile line with its own rules, type and wargear', async () => {
    const fs = await import('node:fs');
    const files = ['/home/claude/out/hh3-core-rulebook.json', '/home/claude/out/hh3-legacies-1-1-test-unit.json'];
    if (!files.every((f) => fs.existsSync(f))) return;
    const udb = new LibraryDB('unit-test');
    for (const f of files) {
      const plan = planImport(JSON.parse(fs.readFileSync(f, 'utf8')));
      expect(plan.errors).toEqual([]);
      await applyImport(udb, plan);
    }
    const v = await loadEntityView(udb, 'horus-heresy@3-0#mounted-legion-champion');
    expect(v).toBeDefined();
    expect(v!.profiles.map((p) => p.names[0])).toEqual(['Outrider Legion Champion', 'Legion Champion on Scimitar Jetbike']);
    expect(v!.profiles[0].rules.map((r) => r.name)).toContain('Outflank');
    expect(v!.profiles[1].rules.map((r) => r.from[0].value)).toContain('3');
    expect(v!.profiles[0].typeRules.length).toBeGreaterThan(0);
    expect(v!.profiles[0].wargear.map((w) => w.name)).toContain('Twin bolter');
    expect(v!.profiles[1].wargear.map((w) => w.name)).toContain('Heavy bolter');
    expect(v!.wargear.every((w) => w.entity)).toBe(true);
    // Heavy bolter is only taken by the jetbike line
    const hb = await loadEntityView(udb, 'horus-heresy@3-0#heavy-bolter');
    expect(hb!.carriedFor['horus-heresy@3-0#mounted-legion-champion']).toBe('Legion Champion on Scimitar Jetbike');
    // Swaps: the Heavy bolter swap applies only to the jetbike line; the model swap links to the jetbike profile
    const sw = v!.swaps;
    expect(sw.map((s) => s.replaces)).toEqual(['Model', 'Twin bolter', 'Heavy bolter']);
    expect(sw[2].for[0].profileIndex).toBe(1);
    expect(sw[2].choices.map((c) => c.name)).toEqual(['Volkite culverin', 'Plasma cannon', 'Multi-melta']);
    expect(sw[0].choices[0].profileIndex).toBe(1);
    expect(sw[1].choices[0].entityId).toBe('horus-heresy@3-0#twin-plasma-gun');
    expect(sw[2].choices[0].entityId).toBe('horus-heresy@3-0#volkite-culverin');
    expect(v!.options[0].entityId).toBe('horus-heresy@3-0#melta-bombs');
  });
});

describe('Legacies 1.1 part 1 (Dark Angels slice)', () => {
  it('imports cleanly and shows the Plasma repeater fire modes as separate profile lines', async () => {
    const fs = await import('node:fs');
    const files = ['/home/claude/out/hh3-core-rulebook.json', '/home/claude/out/hh3-legacies-1-1-part1.json'];
    if (!files.every((f) => fs.existsSync(f))) return;
    const pdb = new LibraryDB('legacies-part1');
    for (const f of files) {
      const plan = planImport(JSON.parse(fs.readFileSync(f, 'utf8')));
      expect(plan.errors).toEqual([]);
      await applyImport(pdb, plan);
    }
    const pr = await loadEntityView(pdb, 'horus-heresy@3-0#plasma-repeater');
    expect(pr!.profiles.map((p) => p.names[0])).toEqual(['Sustained fire', 'Maximal fire']);
    const fw = await loadEntityView(pdb, 'horus-heresy@3-0#firewing-enigmatii');
    expect(fw!.entity.points).toBe('90');
    expect(fw!.options[0].name).toBe('Enigmatus missile launcher');
    expect(fw!.wargear.map((w) => w.name)).toContain('Calibanite charge-blade');
  });
});
