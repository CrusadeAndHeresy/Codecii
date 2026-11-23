// Dropdowns that keep you on the unit: a rule opens in place, and the rules it refers to open inside it.
import { createContext, useContext, useEffect, useState } from 'react';
import { db } from './db';
import type { Source, Stat } from './model';
import type { EditionIndex } from './search';
import { loadRuleView, type RuleView } from './store';
import { statText } from './importer';
import { sameName, type GearItem, type RuleItem } from './unitCard';

const srcLabel = (s: Source, page?: string) => `${s.title}${s.version ? ` v${s.version}` : ''}${page ? `, p.${page}` : ''}`;
const MAX_DEPTH = 5;

// The rules we are already inside, so A → B → A can never loop.
const Trail = createContext<string[]>([]);

interface Ctx { index: EditionIndex; open: (nav: string) => void }

export function StatLine({ stats }: { stats: Stat[] }) {
  if (!stats.length) return null;
  return <div className="statline">{stats.map((s) => <div key={s.label}><span>{s.label}</span><b>{statText(s.value)}</b></div>)}</div>;
}

const ruleLabel = (r: RuleItem) => (r.value ? `${r.name} (${r.value})` : r.name);

// A rule as a dropdown row. Its text and its sub-rules are only loaded once it is opened.
export function RuleDrop({ item, index, open }: { item: RuleItem } & Ctx) {
  const [opened, setOpened] = useState(false);
  return (
    <details className="dd rule-dd" onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) setOpened(true); }}>
      <summary>
        <span>{ruleLabel(item)}</span>
        {item.tag && <span className="tag">{item.tag}</span>}
        {item.faction && <span className="badge faction">{item.faction}</span>}
      </summary>
      <div className="ddbody">
        {item.missing ? <p className="muted small">Not in your library yet.</p> : opened && <RuleBody ruleId={item.ruleId} index={index} open={open} />}
      </div>
    </details>
  );
}

// The rule's text, where it is printed, and the rules it refers to as links that open right here.
export function RuleBody({ ruleId, index, open }: { ruleId: string } & Ctx) {
  const trail = useContext(Trail);
  const [v, setV] = useState<RuleView | null>();
  const [shown, setShown] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    setV(undefined);
    loadRuleView(db, ruleId, index.mentions).then((x) => { if (live) setV(x ?? null); });
    return () => { live = false; };
  }, [ruleId, index]);
  if (v === undefined) return <p className="muted small">Loading…</p>;
  if (v === null) return <p className="muted small">Not in your library yet.</p>;

  const cur = v.current;
  const seen = new Set<string>([ruleId, ...trail]);
  const subs = trail.length >= MAX_DEPTH ? [] : [...v.related, ...v.mentions].filter((r) => !seen.has(r.id) && seen.add(r.id));
  const toggle = (id: string) => setShown((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <Trail.Provider value={[...trail, ruleId]}>
      {(v.rule.phase || v.rule.category) && (
        <div className="badges">
          {v.rule.phase && <span className="badge">{v.rule.phase}</span>}
          {v.rule.category && <span className="badge">{v.rule.category}</span>}
        </div>
      )}
      {cur ? <p className="ruletext small-text">{cur.text}</p> : <p className="muted small">No text for this rule in your library yet.</p>}
      {cur && <div className="source">{srcLabel(cur.source, cur.printing.page)}</div>}
      {v.applied.length > 0 && <div className="note">Amended by {v.applied.map((x) => srcLabel(x.source, x.a.page)).join('; ')}.</div>}
      {v.clarifications.slice(0, 3).map((x, i) => (
        <div className="note" key={i}>FAQ ({srcLabel(x.source, x.a.page)}): {x.a.question ? `Q: ${x.a.question} ` : ''}A: {x.a.text}</div>
      ))}
      {v.otherReadings.length > 0 && <div className="note">Printed differently in another book. Open the rule page to compare.</div>}
      {subs.length > 0 && (
        <div className="subrules">
          <div className="dlabel">Related rules</div>
          <div className="chips">
            {subs.map((r) => (
              <button key={r.id} className={`chip${shown.includes(r.id) ? ' on' : ''}`} aria-expanded={shown.includes(r.id)} onClick={() => toggle(r.id)}>{r.name}{r.faction ? ` (${r.faction})` : ''}</button>
            ))}
          </div>
          {subs.filter((r) => shown.includes(r.id)).map((r) => (
            <div className="nested" key={r.id}>
              <div className="nested-h"><span>{r.name}</span><button className="x" aria-label={`Close ${r.name}`} onClick={() => toggle(r.id)}>×</button></div>
              <RuleBody ruleId={r.id} index={index} open={open} />
            </div>
          ))}
        </div>
      )}
      <button className="link inline" onClick={() => open('r:' + ruleId)}>Open the rule page ›</button>
    </Trail.Provider>
  );
}

export function RuleSection({ label, items, index, open }: { label: string; items: RuleItem[] } & Ctx) {
  if (!items.length) return null;
  return (
    <div className="dgroup">
      <div className="dlabel">{label}</div>
      {items.map((r) => <RuleDrop key={`${r.ruleId}|${r.value ?? ''}`} item={r} index={index} open={open} />)}
    </div>
  );
}

// A weapon or piece of wargear: its profile and its rules inside one dropdown.
export function GearDrop({ g, index, open }: { g: GearItem } & Ctx) {
  const [opened, setOpened] = useState(false);
  const body = g.lines.some((l) => l.stats.length || l.rules.length) || g.children.length > 0;
  return (
    <details className="dd gear-dd" onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) setOpened(true); }}>
      <summary>
        <span>{g.count && g.count > 1 ? `${g.count}× ` : ''}{g.name}</span>
        {g.by && <span className="tag">{g.by}</span>}
        {g.tag && <span className="tag">{g.tag}</span>}
        {g.missing && <span className="tag warn">not in library</span>}
      </summary>
      <div className="ddbody">
        {g.matched && <p className="muted small">Matched to “{g.matched}” in your library.</p>}
        {g.note && <p className="muted small">{g.note}</p>}
        {g.rule && opened && <RuleBody ruleId={g.rule.ruleId} index={index} open={open} />}
        {!g.rule && g.lines.map((l, i) => (
          <div className="gline" key={i}>
            {l.label && (g.lines.length > 1 || !sameName(l.label, g.name)) && <div className="muted small">{l.label}</div>}
            <StatLine stats={l.stats} />
            {l.rules.map((r) => <RuleDrop key={`${r.ruleId}|${r.value ?? ''}`} item={r} index={index} open={open} />)}
          </div>
        ))}
        {g.children.length > 0 && (
          <div className="dgroup">
            <div className="dlabel">Also carries</div>
            {g.children.map((c) => <GearDrop key={c.key} g={c} index={index} open={open} />)}
          </div>
        )}
        {!g.rule && !g.missing && !g.note && !body && <p className="muted small">The library has no profile or rules for this item.</p>}
        {g.entityId && <button className="link inline" onClick={() => open('e:' + g.entityId)}>Open {g.name} ›</button>}
      </div>
    </details>
  );
}
