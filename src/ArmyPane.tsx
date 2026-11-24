// The Army tab: read an army list (PDF, screenshots or pasted text), then show one card per unit,
// grouped by battlefield role, with every rule a tap away.
import { scrollToTop } from './scroll';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { db } from './db';
import type { Entity } from './model';
import type { EditionIndex } from './search';
import { buildUnitCard, type UnitCardModel } from './unitCard';
import { GearDrop, RuleSection, StatLine } from './RuleDrops';
import {
  buildArmy, groupByRole, makeLookup, ROLES, roleOf, SURE, unitModels, unitPoints,
  type Army, type ArmyCopy, type ArmyGear, type ArmyUnit, type GearLookup, type Reading,
} from './army';
import { readArmyFiles, readArmyText } from './armyRead';

const store = {
  get: () => { try { return localStorage.getItem('army') ?? undefined; } catch { return undefined; } },
  set: (v: string) => { try { localStorage.setItem('army', v); } catch { /* storage unavailable */ } },
};
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

const LEGIONS = ['Dark Angels', "Emperor's Children", 'Iron Warriors', 'White Scars', 'Space Wolves', 'Imperial Fists', 'Night Lords', 'Blood Angels', 'Iron Hands', 'World Eaters', 'Ultramarines', 'Death Guard', 'Thousand Sons', 'Sons of Horus', 'Word Bearers', 'Salamanders', 'Raven Guard', 'Alpha Legion', 'Shattered Legions', 'Blackshields'];
export default function ArmyPane({ index, editionId, open }: { index?: EditionIndex; editionId?: string; open: (nav: string) => void }) {
  const [armies, setArmies] = useState<Army[]>([]);
  const [ents, setEnts] = useState<Map<string, Entity>>(new Map());
  const [activeId, setActiveId] = useState<string | undefined>(store.get);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean }>();
  const [busy, setBusy] = useState(false);
  const [paste, setPaste] = useState('');
  const [edit, setEdit] = useState(false);

  const load = useCallback(async () => {
    if (!editionId) return;
    const [a, e] = await Promise.all([
      db.armies.where('editionId').equals(editionId).reverse().sortBy('updatedAt'),
      db.entities.where('editionId').equals(editionId).toArray(),
    ]);
    setArmies(a);
    setEnts(new Map(e.map((x) => [x.id, x])));
  }, [editionId]);
  useEffect(() => { void load(); }, [load]);

  const active = armies.find((a) => a.id === activeId);
  const pick = (id?: string) => { setActiveId(id); store.set(id ?? ''); setEdit(false); scrollToTop(); };
  const save = async (a: Army) => { await db.armies.put({ ...a, updatedAt: Date.now() }); await load(); };

  const finish = async (reading: Reading, sourceName?: string) => {
    if (!editionId || !index) throw new Error('Import a rules file first, so the list can be matched to your units.');
    if (!reading.units.length) throw new Error('No units found. If this is a list, try pasting its text or choosing a clearer screenshot.');
    const all = [...ents.values()];
    const army = buildArmy(reading, { editionId, units: all.filter((e) => e.type === 'unit'), look: makeLookup(all, [...index.rules.values()]) }, sourceName);
    await db.armies.put(army);
    await load();
    pick(army.id);
    setMsg(undefined);
  };
  const run = async (job: () => Promise<void>) => {
    setBusy(true); setMsg(undefined);
    try { await job(); } catch (e) { setMsg({ text: (e as Error).message || 'Could not read that.', bad: true }); } finally { setBusy(false); }
  };

  if (!editionId || !index) return <div className="empty">Import a rules file first, then you can read an army list.</div>;

  if (active) {
    return (
      <ArmyPage army={active} ents={ents} index={index} open={open} edit={edit} setEdit={setEdit}
        onBack={() => pick(undefined)} onSave={save}
        onDelete={async () => { if (confirm(`Delete “${active.name}”?`)) { await db.armies.delete(active.id); await load(); pick(undefined); } }} />
    );
  }

  return (
    <div className="pad">
      <h2>Armies</h2>
      <p className="muted">Read a list from a PDF, a screenshot or pasted text. It is read on this phone and matched to your library. Nothing is sent anywhere.</p>
      <label className={`file-btn${busy ? ' disabled' : ''}`}>{busy ? 'Reading…' : 'Choose a PDF or screenshots'}
        <input type="file" multiple disabled={busy} accept="application/pdf,image/*,.txt,text/plain"
          onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ''; if (f.length) void run(async () => finish(await readArmyFiles(f, (t) => setMsg({ text: t })), f[0].name)); }} />
      </label>
      <h3>Or paste the list</h3>
      <textarea className="paste" rows={6} placeholder="Paste the text of your list here" value={paste} onChange={(e) => setPaste(e.target.value)} />
      <button className="primary" disabled={busy || !paste.trim()} onClick={() => void run(async () => { await finish(readArmyText(paste), 'pasted text'); setPaste(''); })}>Read pasted list</button>
      {msg && <div className={msg.bad ? 'error' : 'note'}>{msg.text}</div>}

      {armies.length > 0 && (
        <>
          <h3>Saved armies</h3>
          <ul className="results flush">
            {armies.map((a) => (
              <li key={a.id} className="army-li">
                <button className="row" onClick={() => pick(a.id)}>
                  <span className="r-name">{a.name}</span>
                  <span className="muted small">{a.units.length} unit{a.units.length === 1 ? '' : 's'} · {a.units.reduce((t, u) => t + unitPoints(u), 0)} pts</span>
                </button>
                <button className="small-btn army-del" aria-label={`Delete ${a.name}`}
                  onClick={async () => { if (confirm(`Delete “${a.name}”? This cannot be undone.`)) { await db.armies.delete(a.id); await load(); } }}>Delete</button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// ---------- One army ----------

function ArmyPage({ army, ents, index, open, edit, setEdit, onBack, onSave, onDelete }: {
  army: Army; ents: Map<string, Entity>; index: EditionIndex; open: (n: string) => void; edit: boolean; setEdit: (b: boolean) => void;
  onBack: () => void; onSave: (a: Army) => Promise<void>; onDelete: () => void;
}) {
  const groups = useMemo(() => groupByRole(army.units, ents), [army, ents]);
  const look = useMemo(() => makeLookup([...ents.values()], [...index.rules.values()]), [ents, index]);
  const [fold, setFold] = useState({ n: 0, folded: false });
  const total = army.units.reduce((t, u) => t + unitPoints(u), 0);
  const setUnit = (u: ArmyUnit | null, id: string) => onSave({ ...army, units: u ? army.units.map((x) => (x.id === id ? u : x)) : army.units.filter((x) => x.id !== id) });
  const unsure = army.units.filter((u) => !u.entityId || (u.matchScore ?? 0) < SURE).length;
  return (
    <div className="pad">
      <button className="back" onClick={onBack}>‹ Armies</button>
      <h2>{army.name}</h2>
      <div className="muted">
        {army.units.length} unit{army.units.length === 1 ? '' : 's'} · {total} pts{army.total != null && army.total !== total ? ` (list says ${army.total})` : ''}
      </div>
      {army.notes.map((n, i) => <div className="note" key={i}>{n}</div>)}
      {unsure > 0 && <div className="note">{unsure} unit{unsure === 1 ? ' needs' : 's need'} a quick check. Each one has a “Check this match” box: confirm it, or pick the right unit.</div>}
      <div className="bgrid">
        <button className={`small-btn${edit ? ' on' : ''}`} onClick={() => setEdit(!edit)}>{edit ? 'Done' : 'Edit'}</button>
        <button className="small-btn" onClick={() => setFold((f) => ({ n: f.n + 1, folded: true }))}>Hide all</button>
        <button className="small-btn" onClick={() => setFold((f) => ({ n: f.n + 1, folded: false }))}>Show all</button>
      </div>
      {edit && <div className="bgrid"><button className="small-btn danger" onClick={onDelete}>Delete army</button></div>}
      {groups.map((g) => (
        <section key={g.role}>
          <h3 className="rolehead">{g.role}<span>{g.units.length} · {g.pts} pts</span></h3>
          {g.units.map((u) => (
            <UnitCard key={u.id} unit={u} entity={u.entityId ? ents.get(u.entityId) : undefined} look={look} index={index} open={open} edit={edit} fold={fold}
              onChange={(next) => setUnit(next, u.id)} />
          ))}
        </section>
      ))}
    </div>
  );
}

// ---------- One unit card (all copies of the unit share it) ----------

function UnitCard({ unit, entity, look, index, open, edit, fold, onChange }: {
  unit: ArmyUnit; entity?: Entity; look: GearLookup; index: EditionIndex; open: (n: string) => void; edit: boolean;
  fold: { n: number; folded: boolean }; onChange: (u: ArmyUnit | null) => void;
}) {
  const [model, setModel] = useState<UnitCardModel>();
  const [folded, setFolded] = useState(true);
  useEffect(() => { if (fold.n) setFolded(fold.folded); }, [fold]);
  // Rebuilt whenever the unit, its match or any wargear changes.
  const key = JSON.stringify([unit.entityId, unit.listName, unit.copies.map((c) => [c.models, c.gear])]);
  useEffect(() => {
    let live = true;
    buildUnitCard(db, unit, entity, look).then((m) => { if (live) setModel(m); });
    return () => { live = false; };
  }, [key, entity, look]); // eslint-disable-line react-hooks/exhaustive-deps

  const name = entity?.name ?? unit.listName;
  const unsure = !entity || (unit.matchScore ?? 0) < SURE;
  const count = unit.copies.length;
  const pts = unitPoints(unit);
  const setCopy = (id: string, fn: (c: ArmyCopy) => ArmyCopy | null) =>
    onChange({ ...unit, copies: unit.copies.flatMap((c) => { if (c.id !== id) return [c]; const n = fn(c); return n ? [n] : []; }) });
  const gearEmpty = model?.taken.every((t) => t.items.length === 0);

  return (
    <article className="card ucard">
      <datalist id="legion-names">{LEGIONS.map((l) => <option key={l} value={l} />)}</datalist>
      <div className="uhead">
        <div className="uline">
          <button className="uname" disabled={!entity} onClick={() => entity && open('e:' + entity.id)}>{name}{entity && <span className="rb-go">›</span>}</button>
          <button className="small-btn fold" aria-expanded={!folded} onClick={() => setFolded(!folded)}>{folded ? 'Show' : 'Hide'}</button>
        </div>
        <div className="badges">
          {count > 1 && <span className="badge">×{count}</span>}
          <span className="badge">{unitModels(unit)} model{unitModels(unit) === 1 ? '' : 's'}</span>
          {pts > 0 && <span className="badge">{pts} pts</span>}
          {entity?.faction && <span className="badge faction">{entity.faction}</span>}
          {[...new Set(unit.copies.map((c) => c.legion).filter(Boolean))].map((l) => <span className="badge faction" key={l} title="The Legion this unit is taken as in your list">{l}</span>)}
          {unsure && <span className="badge warn">{entity ? 'Check match' : 'Not in library'}</span>}
        </div>
        {entity && name.toLowerCase() !== unit.listName.toLowerCase() && <div className="muted small">Listed as “{unit.listName}”</div>}
      </div>

      {unsure && <MatchCheck unit={unit} entity={entity} index={index} onChange={onChange} />}

      {!model ? <div className="muted small">Loading…</div> : (
        <>
          {model.lines.filter((l) => l.stats.length).map((l) => (
            <div key={l.index}>
              {(l.label || l.tag) && <div className="muted small">{l.label}{l.tag ? ` · ${l.tag}` : ''}</div>}
              <StatLine stats={l.stats} />
            </div>
          ))}
          {model.notes.map((n) => <div className="note" key={n}>{n}</div>)}

          {!folded && (
            <>
              <RuleSection label="Type and sub-types" items={model.types} index={index} open={open} />
              <RuleSection label="Special rules" items={model.rules} index={index} open={open} />
              <RuleSection label="Traits" items={model.traits} index={index} open={open} />
              <div className="dgroup">
                <div className="dlabel">Wargear</div>
                {model.wargear.length === 0 && <p className="muted small">None listed for this unit.</p>}
                {model.wargear.map((g) => <GearDrop key={g.key} g={g} index={index} open={open} />)}
              </div>

              <div className="dgroup taken">
                <div className="dlabel">Options taken in this list</div>
                {gearEmpty && <p className="muted small">Nothing extra is listed.</p>}
                {model.taken.map((t) => t.items.length > 0 && (
                  <div className="copy" key={t.copyId}>
                    {count > 1 && <div className="copy-h">{t.label}</div>}
                    {t.items.map((g) => <GearDrop key={g.key} g={g} index={index} open={open} />)}
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {edit && (
        <details className="dd" open>
          <summary>Edit loadout{count > 1 ? ` · ${count} copies` : ''}</summary>
          <div className="ddbody">
            {unit.copies.map((c, i) => (
              <div className="copy" key={c.id}>
                <div className="copy-h">{count > 1 ? `Copy ${i + 1} · ` : ''}{c.models}{c.modelsGuessed ? '?' : ''} model{c.models === 1 ? '' : 's'}{c.pts ? ` · ${c.pts} pts` : ''}</div>
                <label className="small">Legion in this list{' '}
                  <input list="legion-names" value={c.legion ?? ''} placeholder="e.g. Space Wolves"
                    onChange={(e) => setCopy(c.id, (x) => ({ ...x, legion: e.target.value.trim() ? e.target.value : undefined }))} />
                </label>
                <GearChips gear={c.gear} index={index}
                  onRemove={(gi) => setCopy(c.id, (x) => ({ ...x, gear: x.gear.filter((_, k) => k !== gi) }))}
                  onMatch={(gi, h) => setCopy(c.id, (x) => ({ ...x, gear: x.gear.map((g, k) => (k === gi ? { ...g, kind: 'weapon', entityId: h.id, ruleId: undefined } : g)) }))} />
                <div className="row-btns">
                  <button className="small-btn" onClick={() => setCopy(c.id, (x) => ({ ...x, models: Math.max(1, x.models - 1), modelsGuessed: false }))}>− model</button>
                  <button className="small-btn" onClick={() => setCopy(c.id, (x) => ({ ...x, models: x.models + 1, modelsGuessed: false }))}>+ model</button>
                  {count > 1 && <button className="small-btn danger" onClick={() => setCopy(c.id, () => null)}>Remove copy</button>}
                </div>
                <Picker index={index} kinds={['weapon', 'wargear', 'other']} placeholder="Add wargear…"
                  onPick={(h) => setCopy(c.id, (x) => ({ ...x, gear: [...x.gear, { name: h.name, kind: 'weapon', entityId: h.id, added: true }] }))} />
              </div>
            ))}
            <button className="small-btn" onClick={() => onChange({ ...unit, copies: [...unit.copies, { id: uid(), models: unit.copies[0]?.models ?? 1, gear: [], pts: unit.copies[0]?.pts }] })}>+ Add another copy</button>
          </div>
        </details>
      )}

      {edit && (
        <details className="dd">
          <summary>Change this unit</summary>
          <div className="ddbody">
            <div className="muted small">Pick the library unit this is, if the match is wrong.</div>
            <Picker index={index} kinds={['unit']} placeholder="Search units…"
              onPick={(h) => onChange({ ...unit, entityId: h.id, matchScore: 1 })} />
            <label className="small">Role{' '}
              <select value={unit.roleOverride ?? ''} onChange={(e) => onChange({ ...unit, roleOverride: e.target.value || undefined })}>
                <option value="">Automatic ({roleOf({ ...unit, roleOverride: undefined }, entity)})</option>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <button className="small-btn danger" onClick={() => onChange(null)}>Remove this unit from the army</button>
          </div>
        </details>
      )}
    </article>
  );
}

// "Is this the right unit?" in one glance: what the list says, what it was matched to, and a yes or a different pick.
function MatchCheck({ unit, entity, index, onChange }: { unit: ArmyUnit; entity?: Entity; index: EditionIndex; onChange: (u: ArmyUnit | null) => void }) {
  const [picking, setPicking] = useState(false);
  return (
    <div className="matchcheck">
      <div className="dlabel">Check this match</div>
      <div className="mc-line"><span>Your list says</span><b>{unit.listName}</b></div>
      {entity
        ? <div className="mc-line"><span>Matched to</span><b>{entity.name}{entity.faction ? ` · ${entity.faction}` : ''}</b></div>
        : <p className="muted small">No unit in your library has this name.</p>}
      {entity && <p className="muted small">Check the stats and rules below look like the unit you took.</p>}
      <div className="bgrid">
        {entity && <button className="small-btn ok" onClick={() => onChange({ ...unit, matchScore: 1 })}>✓ That’s right</button>}
        <button className="small-btn" onClick={() => setPicking(!picking)}>{picking ? 'Cancel' : entity ? 'Pick another' : 'Pick the unit'}</button>
      </div>
      {picking && <Picker index={index} kinds={['unit']} placeholder="Search units…" onPick={(h) => onChange({ ...unit, entityId: h.id, matchScore: 1 })} />}
    </div>
  );
}

// Edit mode: what the list says was taken. Remove an item, or point it at the right library item.
function GearChips({ gear, index, onRemove, onMatch }: {
  gear: ArmyGear[]; index: EditionIndex; onRemove: (i: number) => void; onMatch: (i: number, h: { id: string; name: string }) => void;
}) {
  const [matching, setMatching] = useState<number>();
  if (!gear.length) return <div className="muted small">Nothing extra listed.</div>;
  return (
    <>
      <div className="chips">
        {gear.map((g, i) => (
          <span key={i} className={`chip static${g.kind === 'text' ? ' extra' : ''}`}>
            <span className="chip-go">{g.label ? g.label + ': ' : ''}{g.forModel ? g.forModel + ': ' : ''}{g.count && g.count > 1 ? g.count + '× ' : ''}{g.name}{g.kind === 'model' ? ' (model)' : ''}</span>
            <button className="chip-x" aria-label={`Match ${g.name} to a different library item`} onClick={() => setMatching(matching === i ? undefined : i)}>⇄</button>
            <button className="chip-x" aria-label={`Remove ${g.name}`} onClick={() => onRemove(i)}>×</button>
          </span>
        ))}
      </div>
      {matching !== undefined && gear[matching] && (
        <div>
          <div className="muted small">Which library item is “{gear[matching].name}”?</div>
          <Picker index={index} kinds={['weapon', 'wargear', 'other']} placeholder="Search wargear…" onPick={(h) => { onMatch(matching, h); setMatching(undefined); }} />
        </div>
      )}
    </>
  );
}

// A small search box over the library; shows a few results to tap.
function Picker({ index, kinds, placeholder, onPick }: {
  index: EditionIndex; kinds: ('unit' | 'weapon' | 'wargear' | 'other')[]; placeholder: string;
  onPick: (h: { id: string; name: string }) => void;
}) {
  const [q, setQ] = useState('');
  const hits = q.trim().length >= 2 ? index.search(q, 6, kinds) : [];
  return (
    <div className="picker">
      <input type="search" value={q} placeholder={placeholder} onChange={(e) => setQ(e.target.value)} />
      {hits.length > 0 && (
        <ul className="results flush">
          {hits.map((h) => (
            <li key={h.ref}><button className="row" onClick={() => { onPick({ id: h.id, name: h.name }); setQ(''); }}>
              <span className="r-name">{h.name}</span><span className="muted small">{[h.faction, h.page ? `p.${h.page}` : ''].filter(Boolean).join(' · ')}</span>
            </button></li>
          ))}
        </ul>
      )}
    </div>
  );
}
