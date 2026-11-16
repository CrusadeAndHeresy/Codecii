import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { db } from './db';
import type { Edition, Entity, GameSystem, LibImage, Rule, Source, Tier } from './model';
import { buildEditionIndex, type EditionIndex, type Hit, type HitKind } from './search';
import { csvToImport, FORMAT, planImport, type ImportFile, type ImportPlan } from './importer';
import { applyImport, eraseAll, loadRuleView, preferPrinting, removeSource, removeSystem, resolveById, setSectionTier, setStatus, type RuleView } from './store';
import { buildCombo, loadEntityView, type Combo, type EntityView, type InPlay, type ProfileView, type SwapView, type TrayRef, type WargearView } from './views';
import type { ReactNode } from 'react';

type Tab = 'search' | 'browse' | 'import' | 'library';
// Navigation: "r:<ruleId>", "e:<entityId>", "c:tray" (rules together from the tray), "c:<TrayRef>" (one item's rules together)
type Nav = string;

const pref = {
  get: (k: string) => { try { return localStorage.getItem(k) ?? undefined; } catch { return undefined; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

export default function App() {
  const [tab, setTab] = useState<Tab>('search');
  const [systems, setSystems] = useState<GameSystem[]>([]);
  const [editions, setEditions] = useState<Edition[]>([]);
  const [editionId, setEditionId] = useState<string | undefined>(pref.get('edition'));
  const [index, setIndex] = useState<EditionIndex>();
  const [bookPick, setBookPick] = useState<string | undefined>(pref.get('book') || undefined);
  const [stack, setStack] = useState<Nav[]>([]);
  const [tray, setTray] = useState<TrayRef[]>(() => { try { return JSON.parse(pref.get('tray') ?? '[]'); } catch { return []; } });
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 900px)').matches);
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 900px)');
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  useEffect(() => { pref.set('tray', JSON.stringify(tray)); }, [tray]);
  useEffect(() => { pref.set('book', bookPick ?? ''); }, [bookPick]);

  useEffect(() => {
    (async () => {
      const [s, e] = await Promise.all([db.systems.toArray(), db.editions.toArray()]);
      setSystems(s); setEditions(e);
      if (!e.length) setTab('library');
      if (!editionId || !e.some((x) => x.id === editionId)) {
        const latest = [...e].sort((a, b) => (a.name < b.name ? 1 : -1))[0];
        if (latest) setEditionId(latest.id);
        else { setEditionId(undefined); setIndex(undefined); }
      }
    })();
  }, [version]);

  useEffect(() => {
    if (!editionId) return;
    pref.set('edition', editionId);
    buildEditionIndex(db, editionId).then(setIndex);
  }, [editionId, version]);

  const open = useCallback((nav: Nav) => { setStack((s) => [...s, nav]); if (!wide) window.scrollTo(0, 0); }, [wide]);
  const openFresh = (nav: Nav) => { setStack([nav]); if (!wide) window.scrollTo(0, 0); };
  const back = () => setStack((s) => s.slice(0, -1));
  const current = stack[stack.length - 1];
  const edition = editions.find((e) => e.id === editionId);
  const inTray = (ref: TrayRef) => tray.includes(ref);
  const toggleTray = (ref: TrayRef) => setTray((t) => (t.includes(ref) ? t.filter((x) => x !== ref) : [...t, ref]));
  const nav = { open, back: wide && stack.length < 2 ? undefined : back, inTray, toggleTray };

  let detail: JSX.Element | null = null;
  if (current && index) {
    const key = current + version;
    if (current.startsWith('r:')) detail = <RuleCard key={key} ruleId={current.slice(2)} index={index} nav={nav} onChange={bump} />;
    else if (current.startsWith('e:')) detail = <EntityCard key={key} entityId={current.slice(2)} nav={nav} />;
    else if (current.startsWith('c:')) detail = (
      <ComboView key={key + tray.join()} refs={current === 'c:tray' ? tray : [current.slice(2) as TrayRef]} fromTray={current === 'c:tray'}
        index={index} nav={nav} onClear={() => { setTray([]); back(); }} />
    );
  }

  // The book filter only exists once there is more than one book; a stale pick (book removed) is ignored.
  const hasBooks = !!index && index.books.length > 1;
  const bookId = hasBooks && index!.books.some((b) => b.id === bookPick) ? bookPick : undefined;
  const picked = index?.books.find((b) => b.id === bookId);
  const counts = picked ? { rules: picked.rules, entities: picked.entities } : index ? { rules: index.count, entities: index.entityCount } : undefined;

  const main = (
    <>
      {tab === 'search' && <SearchPane index={index} bookId={bookId} onOpen={openFresh} selected={current} />}
      {tab === 'browse' && <BrowsePane index={index} bookId={bookId} editionId={editionId} version={version} onOpen={openFresh} />}
      {tab === 'import' && <ImportPane onDone={(edId) => { setEditionId(edId); bump(); setTab('search'); }} />}
      {tab === 'library' && <LibraryPane onChange={bump} version={version} onErased={() => { setTray([]); setStack([]); bump(); }} />}
    </>
  );
  const showDetail = !wide && current && (tab === 'search' || tab === 'browse');

  return (
    <div className="app">
      <header className="top">
        <div className="top-row">
          <select aria-label="Game system and edition" value={editionId ?? ''} onChange={(e) => { setEditionId(e.target.value); setStack([]); }}>
            {!editions.length && <option value="">No systems yet</option>}
            {systems.map((s) => (
              <optgroup key={s.id} label={s.name}>
                {editions.filter((e) => e.systemId === s.id).map((e) => <option key={e.id} value={e.id}>{s.name} · {e.name}</option>)}
              </optgroup>
            ))}
          </select>
          {counts && <span className="muted small">{counts.rules} rules · {counts.entities} units/gear</span>}
        </div>
        {hasBooks && !showDetail && (tab === 'search' || tab === 'browse') && (
          <select aria-label="Book" value={bookId ?? ''} onChange={(e) => { setBookPick(e.target.value || undefined); setStack([]); }}>
            <option value="">All books</option>
            {index!.books.map((b) => <option key={b.id} value={b.id}>{b.title}{b.version ? ` v${b.version}` : ''} · {b.rules + b.entities}</option>)}
          </select>
        )}
      </header>

      {wide ? (
        <div className="split">
          <div className="pane">{main}</div>
          <div className="pane card-pane">{detail ?? <div className="empty">Pick a rule or unit to read it here.</div>}</div>
        </div>
      ) : showDetail ? detail : main}

      {tray.length > 0 && current !== 'c:tray' && (
        <button className="traybar" onClick={() => { if (tab !== 'search' && tab !== 'browse') setTab('search'); open('c:tray'); }}>
          <span>Rules together</span><span className="count">{tray.length}</span><span>›</span>
        </button>
      )}
      <nav className="tabs">
        {(['search', 'browse', 'import', 'library'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => { setTab(t); if (!wide) setStack([]); }}>
            {{ search: 'Search', browse: 'Browse', import: 'Import', library: 'Library' }[t]}
          </button>
        ))}
      </nav>
      {!edition && tab === 'search' && <div className="empty">Import a rules file to get started.</div>}
    </div>
  );
}

interface NavProps { open: (n: Nav) => void; back?: () => void; inTray: (r: TrayRef) => boolean; toggleTray: (r: TrayRef) => void }

const KIND_FILTERS: { label: string; kinds?: HitKind[] }[] = [
  { label: 'All' }, { label: 'Rules', kinds: ['rule'] }, { label: 'Units', kinds: ['unit'] }, { label: 'Wargear', kinds: ['weapon', 'wargear', 'other'] },
];

function SearchPane({ index, bookId, onOpen, selected }: { index?: EditionIndex; bookId?: string; onOpen: (n: Nav) => void; selected?: string }) {
  const [q, setQ] = useState(() => pref.get('q') ?? '');
  const [filter, setFilter] = useState(0);
  const [tier, setTier] = useState<Tier | undefined>();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { pref.set('q', q); }, [q]);
  const searching = q.trim().length >= 2;
  const listing = !searching && !!bookId; // no query but a book picked: show everything in it, in page order
  const hits = useMemo(() => {
    if (!index) return [];
    if (searching) return index.search(q, 40, KIND_FILTERS[filter].kinds, tier, bookId);
    return bookId ? index.list(bookId, KIND_FILTERS[filter].kinds, tier) : [];
  }, [index, q, filter, tier, bookId]);
  const bookTitle = index?.books.find((b) => b.id === bookId)?.title;
  return (
    <div>
      <div className="searchhead">
      <div className="searchbar">
        <input ref={input} type="search" inputMode="search" autoFocus placeholder="Rules or units, e.g. rend, FNP, breachers"
          value={q} onChange={(e) => setQ(e.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
        {q && <button className="clear" aria-label="Clear" onClick={() => { setQ(''); input.current?.focus(); }}>×</button>}
      </div>
      </div>
      <div className="filters">
        {KIND_FILTERS.map((f, i) => <button key={f.label} className={i === filter ? 'on' : ''} onClick={() => setFilter(i)}>{f.label}</button>)}
        <span className="sep" />
        {([['Any', undefined], ['Core', 'core'], ['Expanded', 'expanded']] as [string, Tier | undefined][]).map(([l, t]) => <button key={l} className={t === tier ? 'on' : ''} onClick={() => setTier(t)}>{l}</button>)}
      </div>
      {searching && !hits.length && <div className="empty">Nothing matches “{q}”{bookTitle ? ' in this book' : ''}.</div>}
      {listing && <p className="muted small">{hits.length} {hits.length === 1 ? 'entry' : 'entries'} in {bookTitle}, in page order. Type to search within it.</p>}
      {listing && !hits.length && <div className="empty">Nothing in this book for these filters.</div>}
      <ul className="results">{hits.map((h) => <HitRow key={h.ref} h={h} showBook={!bookId} onOpen={onOpen} on={h.ref === selected} />)}</ul>
    </div>
  );
}

const KIND_LABEL: Record<HitKind, string> = { rule: '', unit: 'Unit', weapon: 'Weapon', wargear: 'Wargear', other: 'Entry' };

function HitRow({ h, showBook, onOpen, on }: { h: Hit; showBook: boolean; onOpen: (n: Nav) => void; on?: boolean }) {
  return (
    <li>
      <button className={`hit ${on ? 'on' : ''}`} onClick={() => onOpen(h.ref)}>
        <span className="hit-name">{h.name}{h.faction && <span className="badge faction">{h.faction}</span>}</span>
        <span className="hit-meta">{[h.kind === 'rule' ? `${h.category} · ${h.tier === 'expanded' ? 'Expanded' : 'Core'}` : `${KIND_LABEL[h.kind]} · ${h.category}`, showBook && h.book, h.page && `p.${h.page}`].filter(Boolean).join(' · ')}</span>
        {h.snippet && <span className="hit-snip">{h.snippet}</span>}
      </button>
    </li>
  );
}

function ListRow({ name, meta, faction, onClick }: { name: string; meta?: string; faction?: string; onClick: () => void }) {
  return (
    <li><button className="hit" onClick={onClick}>
      <span className="hit-name">{name}{faction && <span className="badge faction">{faction}</span>}</span>
      {meta && <span className="hit-meta">{meta}</span>}
    </button></li>
  );
}

function BrowsePane({ index, bookId, editionId, version, onOpen }: { index?: EditionIndex; bookId?: string; editionId?: string; version: number; onOpen: (n: Nav) => void }) {
  const [cat, setCat] = useState<string>();
  const [entities, setEntities] = useState<Entity[]>([]);
  useEffect(() => { if (editionId) db.entities.where('editionId').equals(editionId).toArray().then(setEntities); }, [editionId, version]);
  useEffect(() => { setCat(undefined); }, [bookId]);
  if (!index) return null;
  const inBook = (id: string) => !bookId || bookId in (index.bookPages.get(id) ?? {});
  const pageIn = (id: string) => (bookId ? index.bookPages.get(id)?.[bookId] : undefined);
  const all = [...index.rules.values()].filter((r) => inBook(r.id));
  const bookEntities = entities.filter((e) => inBook(e.id));
  const groups: { key: string; label: string; count: number }[] = [
    ...index.categories.map((c) => ({ key: 'r:' + c, label: c, count: all.filter((r) => r.category === c).length })),
    ...(['unit', 'weapon', 'wargear'] as const).map((t) => ({ key: 'e:' + t, label: { unit: 'Units', weapon: 'Weapons', wargear: 'Wargear' }[t], count: bookEntities.filter((e) => e.type === t).length })),
  ].filter((g) => g.count);

  if (!cat) return (
    <ul className="results">{groups.map((g) => <ListRow key={g.key} name={g.label} meta={`${g.count}`} onClick={() => setCat(g.key)} />)}</ul>
  );
  const label = groups.find((g) => g.key === cat)?.label ?? '';
  let body: JSX.Element;
  if (cat.startsWith('e:')) {
    const list = bookEntities.filter((e) => e.type === cat.slice(2)).sort((a, b) => (a.faction ?? '').localeCompare(b.faction ?? '') || a.name.localeCompare(b.name));
    body = <ul className="results">{list.map((e) => (
      <ListRow key={e.id} name={e.name} faction={e.faction} meta={[e.unitType && `${e.unitType}${e.subTypes.length ? ` (${e.subTypes.join(', ')})` : ''}`, e.role, pageIn(e.id) && `p.${pageIn(e.id)}`].filter(Boolean).join(' · ')} onClick={() => onOpen('e:' + e.id)} />
    ))}</ul>;
  } else {
    const rules = all.filter((r) => r.category === cat.slice(2));
    const bookOrder = rules.some((r) => r.section);
    if (bookOrder) {
      // Core rules read in book order, grouped by section.
      const pg = (r: Rule) => parseFloat(r.section ? (index.pages.get(r.id) ?? '') : '') || 9999;
      rules.sort((a, b) => (a.section ? 0 : 1) - (b.section ? 0 : 1) || pg(a) - pg(b));
      const sections = new Map<string, Rule[]>();
      rules.forEach((r) => sections.set(r.section ?? 'Other', [...(sections.get(r.section ?? 'Other') ?? []), r]));
      body = <>{[...sections.entries()].map(([sec, rs]) => (
        <div key={sec}><h3 className="pad section-h">{sec}</h3><ul className="results">
          {rs.map((r) => <ListRow key={r.id} name={r.name} meta={[r.phase, index.tiers.get(r.id) === 'expanded' ? 'Expanded' : 'Core', pageIn(r.id) && `p.${pageIn(r.id)}`].filter((x) => x && x !== 'Any').join(' · ')} onClick={() => onOpen('r:' + r.id)} />)}
        </ul></div>
      ))}</>;
    } else {
      body = <ul className="results">{rules.sort((a, b) => a.name.localeCompare(b.name)).map((r) => <ListRow key={r.id} name={r.name} faction={r.faction} meta={[r.phase, index.tiers.get(r.id) === 'expanded' ? 'Expanded' : 'Core', pageIn(r.id) && `p.${pageIn(r.id)}`].filter((x) => x && x !== 'Any').join(' · ')} onClick={() => onOpen('r:' + r.id)} />)}</ul>;
    }
  }
  return <div><button className="back" onClick={() => setCat(undefined)}>‹ All</button><h2 className="pad">{label}</h2>{body}</div>;
}

const STATUS = { verified: '✓ Checked by you', 'ai-checked': 'AI double-checked', unverified: 'Not yet checked' };
const srcLabel = (s: Source, page?: string) => `${s.title}${s.version ? ` v${s.version}` : ''}${page ? `, p.${page}` : ''}`;
const paramName = (r: Rule) => (r.parameters.length ? `${r.name} (${r.parameters.map((p) => p.name).join(', ')})` : r.name);

function TrayButton({ refId, nav }: { refId: TrayRef; nav: NavProps }) {
  const on = nav.inTray(refId);
  return <button className={`small-btn tray-btn ${on ? 'on' : ''}`} onClick={() => nav.toggleTray(refId)}>{on ? '✓ In Rules together' : '+ Rules together'}</button>;
}

function RuleCard({ ruleId, index, nav, onChange }: { ruleId: string; index: EditionIndex; nav: NavProps; onChange: () => void }) {
  const [v, setV] = useState<RuleView>();
  const [showOriginal, setShowOriginal] = useState(false);
  const [pics, setPics] = useState<LibImage[]>([]);
  useEffect(() => { loadRuleView(db, ruleId, index.mentions).then(setV); }, [ruleId, index]);
  useEffect(() => {
    const picIds = v?.current?.printing.imageIds ?? [];
    if (!picIds.length) return setPics([]);
    db.images.bulkGet(picIds).then((xs) => setPics(xs.filter((x): x is LibImage => !!x)));
  }, [v]);
  if (!v) return <div className="empty">{index.rules.has(ruleId) ? 'Loading…' : 'This rule isn’t in your library yet.'}</div>;
  const { rule, current } = v;
  const amended = v.applied.length > 0;
  const Links = ({ title, rules }: { title: string; rules: Rule[] }) => rules.length ? (
    <section><h3>{title}</h3><div className="chips">{rules.map((r) => (
      <button key={r.id} className="chip" onClick={() => nav.open('r:' + r.id)}>{r.name}{r.faction ? ` (${r.faction})` : ''}{r.editionId !== rule.editionId ? ` · ${r.editionId.split('@')[1].replace('-', '.')}` : ''}</button>
    ))}</div></section>
  ) : null;

  return (
    <article className="card">
      {nav.back && <button className="back" onClick={nav.back}>‹ Back</button>}
      <h1>{paramName(rule)}</h1>
      <div className="badges">
        <span className={`badge ${v.tier === 'expanded' ? 'exp' : 'core'}`}>{v.tier === 'expanded' ? 'Expanded' : 'Core'}</span>
        <span className="badge">{rule.category}</span>
        {rule.section && <span className="badge">{rule.section}</span>}
        {rule.phase && <span className="badge">{rule.phase}</span>}
        {rule.faction && <span className="badge faction">{rule.faction}</span>}
      </div>
      <TrayButton refId={`r:${rule.id}`} nav={nav} />

      {v.overrides && <div className="note">Faction version of <button className="link" onClick={() => nav.open('r:' + v.overrides!.id)}>{v.overrides.name}</button>. Use this one for {rule.faction}.</div>}
      {v.factionVersions.length > 0 && <div className="note">Some factions use their own version: {v.factionVersions.map((f) => (
        <button key={f.id} className="link" onClick={() => nav.open('r:' + f.id)}>{f.faction}</button>))}</div>}

      {current && (
        <section>
          {amended && (
            <div className="amended">Amended by {v.applied.map((x) => srcLabel(x.source, x.a.page)).join('; ')}
              <button className="link" onClick={() => setShowOriginal((s) => !s)}>{showOriginal ? 'Show current' : 'Show original'}</button></div>
          )}
          {current.printing.summary && current.printing.fullText && <p className="summary">{current.printing.summary}</p>}
          <p className="ruletext">{showOriginal ? current.printing.fullText : current.text}</p>
          {pics.map((im) => (
            <figure key={im.id} className="rule-image">
              <img src={`data:${im.mimeType};base64,${im.data}`} alt={im.caption} />
              <figcaption>{im.caption}{im.page ? ` · p.${im.page}` : ''}</figcaption>
            </figure>
          ))}
          <div className="source">
            {srcLabel(current.source, current.printing.page)}
            {v.samePrintings.length > 0 && <> · also {v.samePrintings.map((r) => srcLabel(r.source, r.printing.page)).join('; ')}</>}
          </div>
          <div className="status">
            <span className={`st ${current.printing.status}`}>{STATUS[current.printing.status]}</span>
            {current.printing.status !== 'verified' && (
              <button className="small-btn" onClick={async () => { await setStatus(db, current.printing.id, 'verified'); onChange(); }}>Mark checked</button>
            )}
          </div>
        </section>
      )}

      {v.failed.map((x) => (
        <div key={x.a.id} className="warn"><b>Change not applied automatically.</b> Read together with the text above.<br />
          {srcLabel(x.source, x.a.page)}: {x.a.type} {x.a.find && <>“{x.a.find}”</>} {x.a.text && <>→ “{x.a.text}”</>}</div>
      ))}
      {v.earlier.map((x) => (
        <div key={x.a.id} className="note">An older change ({srcLabel(x.source, x.a.page)}) predates this printing and may already be included: {x.a.text}</div>
      ))}

      {v.clarifications.length > 0 && (
        <section><h3>FAQ</h3>{v.clarifications.map((x) => (
          <div key={x.a.id} className="qa"><b>Q: {x.a.question}</b><br />A: {x.a.text}<div className="source">{srcLabel(x.source, x.a.page)}</div></div>
        ))}</section>
      )}

      {v.otherReadings.length > 0 && (
        <section className="warn">
          <b>Printed differently elsewhere.</b> {rule.preferredPrintingId ? 'You chose the reading above.' : current && current.printing.status !== 'unverified' && v.otherReadings.some((r) => r.printing.status === 'unverified') ? 'Showing the checked reading; the ones below haven’t been checked. Compare:' : 'Showing the newest. Compare:'}
          {v.otherReadings.map((r) => (
            <div key={r.printing.id} className="reading">
              <p className="ruletext">{r.text}</p>
              <div className="source">{srcLabel(r.source, r.printing.page)} · {STATUS[r.printing.status]}{r.printing.extractedBy !== 'manual' ? ` · ${r.printing.extractedBy}` : ''}</div>
              <button className="small-btn" onClick={async () => { await preferPrinting(db, rule.id, r.printing.id); onChange(); }}>Use this reading</button>
            </div>
          ))}
          {rule.preferredPrintingId && <button className="small-btn" onClick={async () => { await preferPrinting(db, rule.id, undefined); onChange(); }}>Go back to newest</button>}
        </section>
      )}

      {rule.parameters.length > 0 && (
        <section><h3>Parameters</h3><ul className="plain">{rule.parameters.map((p) => <li key={p.name}><b>{p.name}</b>: {p.kind}{p.note ? ` · ${p.note}` : ''}</li>)}</ul></section>
      )}
      {rule.aliases.length > 0 && <div className="muted small">Also called: {rule.aliases.join(', ')}</div>}

      <Links title="Related" rules={v.related} />
      <Links title="This rule mentions" rules={v.mentions} />
      <Links title="Mentioned by" rules={v.mentionedBy} />
      {v.previous && <Links title="Previous edition" rules={[v.previous]} />}
      {v.next && <Links title="Newer edition" rules={[v.next]} />}

      {v.entities.length > 0 && (
        <section><h3>Units and wargear with this rule</h3><ul className="results flush">{v.entities.map(({ entity, value, via }) => (
          <ListRow key={entity.id + (via ?? '')} name={`${entity.name}${value ? ` (${value})` : ''}`} faction={entity.faction}
            meta={[KIND_LABEL[entity.type as HitKind], via && `via ${via}`].filter(Boolean).join(' · ')} onClick={() => nav.open('e:' + entity.id)} />
        ))}</ul></section>
      )}
    </article>
  );
}

// One rule shown inline (unit page, rules together).
function RuleBlock({ r, nav, showFrom }: { r: InPlay; nav: NavProps; showFrom?: boolean }) {
  const values = [...new Set(r.from.map((f) => f.value).filter(Boolean))];
  const param = r.rule?.parameters[0]?.name;
  const cur = r.resolved?.current;
  return (
    <div className="ruleblock">
      <button className="rb-name" onClick={() => nav.open('r:' + r.ruleId)} disabled={!r.rule}>
        {r.name}{values.length ? ` (${values.join(' / ')})` : r.rule?.parameters.length ? ` (${r.rule.parameters.map((p) => p.name).join(', ')})` : ''}
        {r.rule?.faction && <span className="badge faction">{r.rule.faction}</span>}
        {r.rule && <span className="rb-go">›</span>}
      </button>
      {param && values.length > 0 && <div className="muted small">{param} = {values.join(' / ')}</div>}
      {cur ? <p className="ruletext small-text">{cur.text}</p> : <p className="muted small">Not in your library yet.</p>}
      <div className="source">
        {cur && srcLabel(cur.source, cur.printing.page)}
        {r.resolved?.applied.length ? ' · amended by FAQ' : ''}
        {r.resolved?.otherReadings.length ? ' · printed differently elsewhere' : ''}
        {r.replaced ? ` · replaces universal ${r.replaced.name}` : ''}
      </div>
      {showFrom && <div className="from">From: {r.from.map((f) => f.label + (f.value ? ` ${f.value}` : '')).join('; ')}</div>}
    </div>
  );
}

function EntityCard({ entityId, nav }: { entityId: string; nav: NavProps }) {
  const [v, setV] = useState<EntityView | null>();
  useEffect(() => { loadEntityView(db, entityId).then((x) => setV(x ?? null)); }, [entityId]);
  if (v === undefined) return <div className="empty">Loading…</div>;
  if (v === null) return <div className="empty">This entry isn’t in your library yet.</div>;
  const e = v.entity;
  const ref: TrayRef = `e:${e.id}`;
  const multi = v.profiles.length > 0;
  const single: ProfileView = { names: [], stats: [], rules: v.rules, typeRules: v.typeRules, traits: v.traits, wargear: v.wargear };
  // Swaps tied to a weapon sit under that weapon; the rest (e.g. the model swap) stay in Options and swaps.
  const wargearNames = new Set([...v.wargear.map((w) => w.name), ...v.profiles.flatMap((p) => p.wargear.map((w) => w.name))]);
  const mainSwaps = v.swaps.filter((sw) => !wargearNames.has(sw.replaces));
  return (
    <article className="card unit">
      {nav.back && <button className="back" onClick={nav.back}>‹ Back</button>}
      <h1>{e.name}</h1>
      <div className="badges">
        <span className="badge">{KIND_LABEL[e.type as HitKind]}</span>
        {e.unitType && <span className="badge">{e.unitType}{e.subTypes.length ? ` (${e.subTypes.join(', ')})` : ''}</span>}
        {e.role && <span className="badge">{e.role}</span>}
        {e.faction && <span className="badge faction">{e.faction}</span>}
      </div>
      <div className="row-btns">
        <TrayButton refId={ref} nav={nav} />
        <button className="small-btn" onClick={() => nav.open('c:' + ref)}>See all rules together</button>
      </div>
      {!multi && e.stats.length > 0 && (
        <div className="statline">{e.stats.map((s) => <div key={s.label}><span>{s.label}</span><b>{s.value}</b></div>)}</div>
      )}
      {v.source && <div className="source">{srcLabel(v.source, e.page)}</div>}

      {multi
        ? v.profiles.map((p, i) => <ProfileDrop key={i} index={i} p={p} nav={nav} swaps={v.swaps} />)
        : <ProfileBody p={single} nav={nav} swaps={v.swaps} />}

      {(mainSwaps.length > 0 || v.options.length > 0) && (
        <Dropdown title="Options and swaps">
          {mainSwaps.map((sw, i) => <SwapDrop key={i} sw={sw} nav={nav} />)}
          {v.options.length > 0 && (
            <div className="dgroup">
              <div className="dlabel">Other options</div>
              <ul className="opts">{v.options.map((o, i) => (
                <li key={i}>
                  <ChoiceLink name={o.name} entityId={o.entityId} profileIndex={o.profileIndex} nav={nav} />
                  {o.points && <span className="muted"> {o.points} pts</span>}
                </li>
              ))}</ul>
            </div>
          )}
        </Dropdown>
      )}
      {v.usedBy.length > 0 && (
        <section><h3>Carried by</h3><ul className="results flush">{v.usedBy.map((u) => (
          <ListRow key={u.id} name={u.name} faction={u.faction} meta={v.carriedFor[u.id] ? `${v.carriedFor[u.id]} only` : u.unitType} onClick={() => nav.open('e:' + u.id)} />
        ))}</ul></section>
      )}
      {(e.additionalNotes || e.composition || e.points || e.notes) && (
        <Dropdown title="Additional notes">
          {e.composition && <p className="small-text">Unit composition: {e.composition}</p>}
          {e.points && <p className="small-text">Points: {e.points} pts</p>}
          {e.notes && <p className="small-text">{e.notes}</p>}
          {(e.additionalNotes ?? '').split('\n').filter(Boolean).map((line, i) => <p key={i} className="small-text">{line}</p>)}
        </Dropdown>
      )}
    </article>
  );
}

// One profile line: a dropdown titled with its entry name(s), so shared profiles stay together.
function ProfileDrop({ p, nav, index, swaps }: { p: ProfileView; nav: NavProps; index: number; swaps: SwapView[] }) {
  return (
    <Dropdown title={p.names.join(' / ')} open id={`profile-${index}`}>
      {p.stats.length > 0 && <div className="statline">{p.stats.map((s) => <div key={s.label}><span>{s.label}</span><b>{s.value}</b></div>)}</div>}
      <ProfileBody p={p} nav={nav} swaps={swaps} />
    </Dropdown>
  );
}

function ProfileBody({ p, nav, swaps }: { p: ProfileView; nav: NavProps; swaps: SwapView[] }) {
  // A swap applies to this profile line when it names no line, or names this one.
  const swapsFor = (w: WargearView) => swaps.filter((s) => s.replaces === w.name
    && (s.for.length === 0 || s.for.some((f) => p.names.includes(f.name))));
  return (
    <>
      <RuleGroup label="Special rules" items={p.rules} nav={nav} empty="None listed" />
      <RuleGroup label="Unit type" items={p.typeRules} nav={nav} />
      <RuleGroup label="Traits" items={p.traits} nav={nav} />
      {p.wargear.length > 0 && (
        <div className="dgroup">
          <div className="dlabel">Weapons and wargear</div>
          {p.wargear.map((w) => <WargearDrop key={w.id} w={w} nav={nav} swaps={swapsFor(w)} />)}
        </div>
      )}
    </>
  );
}

function RuleGroup({ label, items, nav, empty }: { label: string; items: InPlay[]; nav: NavProps; empty?: string }) {
  if (items.length === 0 && !empty) return null;
  return (
    <div className="dgroup">
      <div className="dlabel">{label}</div>
      {items.length === 0 ? <p className="muted small">{empty}</p> : items.map((r) => <RuleDrop key={r.ruleId + (r.from[0]?.value ?? '')} r={r} nav={nav} />)}
    </div>
  );
}

function RuleDrop({ r, nav }: { r: InPlay; nav: NavProps }) {
  const values = [...new Set(r.from.map((f) => f.value).filter(Boolean))];
  const cur = r.resolved?.current;
  return (
    <details className="dd rule-dd">
      <summary>
        <span>{r.name}{values.length ? ` (${values.join(' / ')})` : ''}</span>
        {r.rule?.faction && <span className="badge faction">{r.rule.faction}</span>}
      </summary>
      <div className="ddbody">
        {cur ? <p className="ruletext small-text">{cur.text}</p> : <p className="muted small">Not in your library yet.</p>}
        {cur && <div className="source">{srcLabel(cur.source, cur.printing.page)}</div>}
        {r.rule && <button className="link" onClick={() => nav.open('r:' + r.ruleId)}>Open rule ›</button>}
      </div>
    </details>
  );
}

// Wargear: a link to its own entry, with its rules as dropdowns underneath.
function WargearDrop({ w, nav, swaps }: { w: WargearView; nav: NavProps; swaps: SwapView[] }) {
  const choices = swaps.flatMap((sw) => sw.choices);
  return (
    <div className="wg">
      <div className="wg-head">
        {w.entity
          ? <button className="link" onClick={() => nav.open('e:' + w.id)}>{w.name} ›</button>
          : <span className="muted">{w.name}</span>}
        {!w.entity && <span className="muted small">not in your library yet</span>}
      </div>
      {w.rules.length > 0 && (
        <details className="dd">
          <summary>Rules ({w.rules.length})</summary>
          <div className="ddbody">{w.rules.map((r) => <RuleDrop key={r.ruleId + (r.from[0]?.value ?? '')} r={r} nav={nav} />)}</div>
        </details>
      )}
      {choices.length > 0 && (
        <details className="dd">
          <summary>Options ({choices.length})</summary>
          <div className="ddbody">
            <ul className="opts">{choices.map((c, i) => (
              <li key={i}>
                <ChoiceLink name={c.name} entityId={c.entityId} profileIndex={c.profileIndex} nav={nav} />
                {c.points && <span className="muted"> {c.points} pts</span>}
              </li>
            ))}</ul>
          </div>
        </details>
      )}
    </div>
  );
}

// Opens a profile line and scrolls to it (used by swap links).
function openProfile(index: number) {
  const el = document.getElementById(`profile-${index}`) as HTMLDetailsElement | null;
  if (!el) return;
  el.open = true;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// A link to a wargear entry, a profile line, or plain text when neither is in the library.
function ChoiceLink({ name, entityId, profileIndex, nav }: { name: string; entityId?: string; profileIndex: number; nav: NavProps }) {
  if (entityId) return <button className="link inline" onClick={() => nav.open('e:' + entityId)}>{name} ›</button>;
  if (profileIndex >= 0) return <button className="link inline" onClick={() => openProfile(profileIndex)}>{name} ›</button>;
  return <span>{name} <span className="muted small">(not in your library yet)</span></span>;
}

// One swap: "Replace Heavy bolter" with the profile line(s) it applies to and what it can be swapped for.
function SwapDrop({ sw, nav }: { sw: SwapView; nav: NavProps }) {
  return (
    <details className="dd swap-dd">
      <summary>Replace {sw.replaces}</summary>
      <div className="ddbody">
        {sw.for.length > 0 && (
          <p className="small-text swap-for">
            For {sw.for.map((f, i) => (
              <span key={i}>
                {i > 0 && ', '}
                {f.profileIndex >= 0
                  ? <button className="link inline" onClick={() => openProfile(f.profileIndex)}>{f.name} ›</button>
                  : f.name}
              </span>
            ))}
          </p>
        )}
        <ul className="opts">
          {sw.choices.map((c, i) => (
            <li key={i}>
              {c.entityId
                ? <button className="link inline" onClick={() => nav.open('e:' + c.entityId)}>{c.name} ›</button>
                : c.profileIndex >= 0
                  ? <button className="link inline" onClick={() => openProfile(c.profileIndex)}>{c.name} ›</button>
                  : <span>{c.name} <span className="muted small">(not in your library yet)</span></span>}
              {c.points && <span className="muted"> {c.points} pts</span>}
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

function Dropdown({ title, children, open, id }: { title: string; children: ReactNode; open?: boolean; id?: string }) {
  return (
    <details className="dd unit-dd" open={open} id={id}>
      <summary>{title}</summary>
      <div className="ddbody">{children}</div>
    </details>
  );
}

const INTERPLAY_ICON = { mentions: '↔', stacking: '⧉', faction: '⚑', faq: '?', missing: '…' };

function ComboView({ refs, fromTray, index, nav, onClear }: { refs: TrayRef[]; fromTray: boolean; index: EditionIndex; nav: NavProps; onClear: () => void }) {
  const [c, setC] = useState<Combo>();
  const [byPhase, setByPhase] = useState(true);
  useEffect(() => { buildCombo(db, refs, index.mentions).then(setC); }, [refs.join(), index]);
  if (!c) return <div className="empty">Loading…</div>;
  return (
    <article className="card">
      {nav.back && <button className="back" onClick={nav.back}>‹ Back</button>}
      <h1>Rules together</h1>
      <div className="chips">
        {c.items.map((it) => (
          <span key={it.ref} className="chip static">
            <button className="link-plain" onClick={() => nav.open(it.ref)}>{it.label}</button>
            {fromTray && <button className="x" aria-label={`Remove ${it.label}`} onClick={() => nav.toggleTray(it.ref)}>×</button>}
          </span>
        ))}
      </div>
      {fromTray && <p className="muted small">Add more with “+ Rules together” on any rule or unit. <button className="link" onClick={onClear}>Clear all</button></p>}
      {!c.items.length && <div className="empty">Nothing added yet.</div>}

      {c.interplay.length > 0 && (
        <section><h3>How these interact</h3>
          {c.interplay.map((i, n) => (
            <div key={n} className={`interplay ${i.kind}`}><span className="ic">{INTERPLAY_ICON[i.kind]}</span><span>{i.text}</span></div>
          ))}
          <p className="muted small">Found automatically: rules that refer to each other, the same rule from two places, faction versions and FAQ answers.</p>
        </section>
      )}

      {c.rules.length > 0 && (
        <section>
          <h3 className="h-row">{c.rules.length} rules in play
            <button className="link" onClick={() => setByPhase((x) => !x)}>{byPhase ? 'A–Z' : 'By phase'}</button></h3>
          {byPhase
            ? c.byPhase.map(([phase, rs]) => (
              <div key={phase}><div className="phase">{phase}</div>{rs.map((r) => <RuleBlock key={r.ruleId} r={r} nav={nav} showFrom />)}</div>
            ))
            : c.rules.map((r) => <RuleBlock key={r.ruleId} r={r} nav={nav} showFrom />)}
        </section>
      )}
    </article>
  );
}

type Staged = { name: string; plan?: ImportPlan; exists: boolean; error?: string };

function ImportPane({ onDone }: { onDone: (editionId: string) => void }) {
  const [staged, setStaged] = useState<Staged[]>([]);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [result, setResult] = useState<string>();

  const readOne = async (file: File): Promise<Staged> => {
    try {
      const text = (await file.text()).replace(/^﻿/, '');
      const isCsv = file.name.toLowerCase().endsWith('.csv');
      const raw = isCsv ? csvToImport(text) : JSON.parse(text);
      if (!isCsv && (raw as { format?: string } | null)?.format !== FORMAT) {
        return { name: file.name, exists: false, error: `Needs "format": "${FORMAT}" at the top.` };
      }
      const plan = planImport(raw as ImportFile);
      return { name: file.name, plan, exists: !!(await db.sources.get(plan.source.id)) };
    } catch (e) {
      return { name: file.name, exists: false, error: `Couldn't read the file: ${(e as Error).message}` };
    }
  };

  const read = async (files: File[]) => {
    setResult(undefined);
    setReading(true);
    try { setStaged(await Promise.all(files.map(readOne))); } finally { setReading(false); }
  };

  const importable = staged.filter((s) => s.plan && s.plan.errors.length === 0);
  const blocked = staged.length - importable.length;

  const importAll = async () => {
    setBusy(true);
    let editionId: string | undefined;
    let count = 0;
    try {
      // Imports run in the order the files were chosen. Each replaces only its own source.
      for (const s of importable) {
        await applyImport(db, s.plan!);
        editionId = s.plan!.edition.id;
        count++;
      }
    } finally {
      setBusy(false);
    }
    setResult(`Imported ${count} file${count === 1 ? '' : 's'}.`);
    setStaged([]);
    if (editionId) onDone(editionId);
  };

  return (
    <div className="pad">
      <h2>Import rules files</h2>
      <p className="muted">Choose one or more files at once: books, supplements, FAQs or errata. JSON or CSV. Each file replaces only its own source.</p>
      <label className="file-btn">Choose files
        <input type="file" multiple accept=".json,.csv,.txt,application/json,text/csv"
          onChange={(e) => { const f = Array.from(e.target.files ?? []); if (f.length) read(f); e.target.value = ''; }} />
      </label>
      {reading && <div className="muted">Checking files…</div>}
      {result && <div className="note">{result}</div>}

      {staged.length > 0 && (
        <>
          <div className="muted" style={{ marginTop: 12 }}>
            {importable.length} ready{blocked ? ` · ${blocked} need fixing and will be skipped` : ''}
          </div>
          {staged.map((s, i) => (
            <div className="plan" key={i} style={{ marginTop: 10 }}>
              <h3>{s.plan ? (s.plan.source.title || 'Untitled') : s.name}{s.plan?.source.version ? ` v${s.plan.source.version}` : ''}</h3>
              <div className="muted small">{s.name}</div>
              {s.error && <div className="error">{s.error}</div>}
              {s.plan && (
                <>
                  <div className="muted">{s.plan.system.name} · {s.plan.edition.name} · {s.plan.source.kind} · {s.plan.source.published}</div>
                  <div>{s.plan.rules.length} rules · {s.plan.amendments.length} FAQ changes · {s.plan.entities.length} units/wargear</div>
                  {s.exists && <div className="note">You already have this source. It will be replaced.</div>}
                  {s.plan.errors.length > 0 && (
                    <div className="error"><b>{s.plan.errors.length} problem{s.plan.errors.length > 1 ? 's' : ''} to fix:</b>
                      <ul>{s.plan.errors.slice(0, 50).map((e, j) => <li key={j}><code>{e.path || 'file'}</code> {e.message}</li>)}</ul></div>
                  )}
                  {s.plan.warnings.length > 0 && (
                    <details className="warn"><summary>{s.plan.warnings.length} note{s.plan.warnings.length > 1 ? 's' : ''}</summary>
                      <ul>{s.plan.warnings.slice(0, 200).map((e, j) => <li key={j}><code>{e.path}</code> {e.message}</li>)}</ul></details>
                  )}
                </>
              )}
            </div>
          ))}
          <div className="row" style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="primary" disabled={busy || importable.length === 0} onClick={importAll}>
              {busy ? 'Importing…' : `Import ${importable.length} file${importable.length === 1 ? '' : 's'}`}
            </button>
            <button disabled={busy} onClick={() => setStaged([])}>Clear</button>
          </div>
        </>
      )}
    </div>
  );
}

function LibraryPane({ onChange, version, onErased }: { onChange: () => void; version: number; onErased: () => void }) {
  const [data, setData] = useState<{ systems: GameSystem[]; editions: Edition[]; sources: Source[]; counts: Map<string, number> }>();
  const [confirm, setConfirm] = useState<string>();
  useEffect(() => {
    (async () => {
      const [systems, editions, sources, printings, entities] = await Promise.all([db.systems.toArray(), db.editions.toArray(), db.sources.toArray(), db.printings.toArray(), db.entities.toArray()]);
      const counts = new Map<string, number>();
      [...printings, ...entities].forEach((p) => counts.set(p.sourceId, (counts.get(p.sourceId) ?? 0) + 1));
      setData({ systems, editions, sources, counts });
    })();
  }, [version]);
  if (!data) return null;
  const confirmRow = (key: string, label: string, run: () => Promise<void>, ask = 'Delete', keep = 'Keep') => (
    confirm === key
      ? <span className="btns"><button className="small-btn danger" onClick={async () => { await run(); setConfirm(undefined); }}>{ask}</button><button className="small-btn" onClick={() => setConfirm(undefined)}>{keep}</button></span>
      : <button className="small-btn" onClick={() => setConfirm(key)}>{label}</button>
  );
  return (
    <div className="pad">
      <h2>Library</h2>
      {!data.systems.length && <p className="muted">Nothing here yet. Use Import to add a rules file.</p>}
      {data.systems.map((sys) => (
        <section key={sys.id}>
          <div className="src-row"><h3>{sys.name}</h3>
            {confirmRow(`sys:${sys.id}`, 'Remove game', async () => { await removeSystem(db, sys.id); onErased(); }, 'Delete game')}
          </div>
          {confirm === `sys:${sys.id}` && <p className="muted small">Deletes {sys.name} and every book in it from this device.</p>}
          {data.editions.filter((e) => e.systemId === sys.id).map((ed) => (
            <div key={ed.id} className="edition"><div className="muted">Edition {ed.name}</div>
              <TierEditor editionId={ed.id} version={version} onChange={onChange} />
              <ul className="plain">{data.sources.filter((s) => s.editionId === ed.id).sort((a, b) => a.published.localeCompare(b.published)).map((s) => (
                <li key={s.id} className="src-row">
                  <span className="src-text"><span>{srcLabel(s)}</span><span className="muted small">{s.kind}{s.isCore ? ' · core' : ''} · {s.published} · {data.counts.get(s.id) ?? 0} entries</span></span>
                  {confirmRow(`src:${s.id}`, 'Remove', async () => { await removeSource(db, s.id); onChange(); })}
                </li>
              ))}</ul>
            </div>
          ))}
        </section>
      ))}
      {data.systems.length > 0 && (
        <section className="plan">
          <h3>Erase everything</h3>
          <p className="muted small">Removes every game, book, rule and unit stored on this device. Your rules files are not touched, so you can import them again.</p>
          {confirmRow('all', 'Erase everything on this device', async () => { await eraseAll(db); onErased(); }, 'Yes, erase everything', 'Cancel')}
        </section>
      )}
      <p className="muted small">Stored on this device and works offline. Your transcribed rules text is for your own use; it isn't shared.</p>
    </div>
  );
}

// Core vs Expanded, set per section (the import file gives the starting point; your choice sticks).
function TierEditor({ editionId, version, onChange }: { editionId: string; version: number; onChange: () => void }) {
  const [rows, setRows] = useState<{ section: string; n: number; core: number }[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    (async () => {
      const [rules, printings, sources] = await Promise.all([
        db.rules.where('editionId').equals(editionId).toArray(), db.printings.toArray(), db.sources.where('editionId').equals(editionId).toArray(),
      ]);
      const coreSrc = new Set(sources.filter((s) => s.isCore).map((s) => s.id));
      const printed = new Set(printings.filter((p) => coreSrc.has(p.sourceId)).map((p) => p.ruleId));
      const by = new Map<string, { section: string; n: number; core: number }>();
      rules.filter((r) => r.section).forEach((r) => {
        const row = by.get(r.section!) ?? { section: r.section!, n: 0, core: 0 };
        row.n++; if ((r.tier ?? (printed.has(r.id) ? 'core' : 'expanded')) === 'core') row.core++;
        by.set(r.section!, row);
      });
      setRows([...by.values()].sort((a, b) => a.section.localeCompare(b.section)));
    })();
  }, [editionId, version]);
  if (!rows.length) return null;
  const set = async (section: string, tier: Tier) => { await setSectionTier(db, editionId, section, tier); onChange(); };
  return (
    <div className="tiers">
      <button className="small-btn" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Set'} Core / Expanded by section</button>
      {open && <ul className="plain">{rows.map((r) => (
        <li key={r.section} className="src-row">
          <span>{r.section} <span className="muted small">{r.n} · {r.core === r.n ? 'Core' : r.core === 0 ? 'Expanded' : `${r.core} Core / ${r.n - r.core} Expanded`}</span></span>
          <span><button className={`small-btn ${r.core === r.n ? 'on' : ''}`} onClick={() => set(r.section, 'core')}>Core</button>
            <button className={`small-btn ${r.core === 0 ? 'on' : ''}`} onClick={() => set(r.section, 'expanded')}>Expanded</button></span>
        </li>
      ))}</ul>}
    </div>
  );
}
