// The Army tab: read an army list (PDF, screenshots or pasted text), then show one card per unit,
// grouped by battlefield role, with every rule a tap away.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { db } from './db';
import type { Entity } from './model';
import type { EditionIndex } from './search';
import { buildCombo, type InPlay, type TrayRef } from './views';
import {
  buildArmy, groupByRole, makeLookup, ROLES, roleOf, SURE, unitModels, unitPoints,
  type Army, type ArmyCopy, type ArmyGear, type ArmyUnit, type Reading,
} from './army';
import { statText } from './importer';
import { readArmyFiles, readArmyText } from './armyRead';

const store = {
  get: () => { try { return localStorage.getItem('army') ?? undefined; } catch { return undefined; } },
  set: (v: string) => { try { localStorage.setItem('army', v); } catch { /* storage unavailable */ } },
};
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

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
  const pick = (id?: string) => { setActiveId(id); store.set(id ?? ''); setEdit(false); window.scrollTo(0, 0); };
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
              <li key={a.id}>
                <button className="row" onClick={() => pick(a.id)}>
                  <span className="r-name">{a.name}</span>
                  <span className="muted small">{a.units.length} unit{a.units.length === 1 ? '' : 's'} · {a.units.reduce((t, u) => t + unitPoints(u), 0)} pts</span>
                </button>
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
      {unsure > 0 && <div className="note">{unsure} unit{unsure === 1 ? ' needs' : 's need'} a quick check: tap Edit to confirm which library unit it is.</div>}
      <div className="row-btns">
        <button className={`small-btn${edit ? ' on' : ''}`} onClick={() => setEdit(!edit)}>{edit ? 'Done' : 'Edit'}</button>
        {edit && <button className="small-btn danger" onClick={onDelete}>Delete army</button>}
      </div>
      {groups.map((g) => (
        <section key={g.role}>
          <h3 className="rolehead">{g.role}<span>{g.units.length} · {g.pts} pts</span></h3>
          {g.units.map((u) => (
            <UnitCard key={u.id} unit={u} entity={u.entityId ? ents.get(u.entityId) : undefined} ents={ents} index={index} open={open} edit={edit}
              onChange={(next) => setUnit(next, u.id)} />
          ))}
        </section>
      ))}
    </div>
  );
}

// ---------- One unit card (all copies of the unit share it) ----------

function ruleLabel(r: InPlay) {
  const values = [...new Set(r.from.map((f) => f.value).filter(Boolean))];
  return values.length ? `${r.name} (${values.join(' / ')})` : r.name;
}

function UnitCard({ unit, entity, ents, index, open, edit, onChange }: {
  unit: ArmyUnit; entity?: Entity; ents: Map<string, Entity>; index: EditionIndex; open: (n: string) => void; edit: boolean;
  onChange: (u: ArmyUnit | null) => void;
}) {
  const [rules, setRules] = useState<InPlay[]>();
  const gear = unit.copies.flatMap((c) => c.gear);
  const refs = useMemo(() => {
    const r = new Set<TrayRef>();
    if (unit.entityId) r.add(`e:${unit.entityId}`);
    gear.forEach((g) => { if (g.kind === 'weapon' && g.entityId) r.add(`e:${g.entityId}`); if (g.kind === 'rule' && g.ruleId) r.add(`r:${g.ruleId}`); });
    return [...r];
  }, [unit]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true;
    if (!refs.length) { setRules([]); return; }
    buildCombo(db, refs, index.mentions).then((c) => { if (live) setRules(c.rules); });
    return () => { live = false; };
  }, [refs.join(), index]); // eslint-disable-line react-hooks/exhaustive-deps

  const name = entity?.name ?? unit.listName;
  const profiles = entity ? (entity.profiles?.length ? entity.profiles.map((p) => ({ label: p.names.join(' / '), stats: p.stats })) : [{ label: '', stats: entity.stats }]) : [];
  const standard = (entity?.wargearIds ?? []).map((id) => ({ id, name: ents.get(id)?.name ?? id.split('#').pop()!.replace(/-/g, ' ') }));
  const unsure = !entity || (unit.matchScore ?? 0) < SURE;
  const count = unit.copies.length;
  const pts = unitPoints(unit);
  const setCopy = (id: string, fn: (c: ArmyCopy) => ArmyCopy | null) =>
    onChange({ ...unit, copies: unit.copies.flatMap((c) => { if (c.id !== id) return [c]; const n = fn(c); return n ? [n] : []; }) });

  return (
    <article className="card ucard">
      <div className="uhead">
        <button className="uname" disabled={!entity} onClick={() => entity && open('e:' + entity.id)}>{name}{entity && <span className="rb-go">›</span>}</button>
        <div className="badges">
          {count > 1 && <span className="badge">×{count}</span>}
          <span className="badge">{unitModels(unit)} model{unitModels(unit) === 1 ? '' : 's'}</span>
          {pts > 0 && <span className="badge">{pts} pts</span>}
          {entity?.faction && <span className="badge faction">{entity.faction}</span>}
          {unsure && <span className="badge warn">{entity ? 'Check match' : 'Not in library'}</span>}
        </div>
        {entity && name.toLowerCase() !== unit.listName.toLowerCase() && <div className="muted small">Listed as “{unit.listName}”</div>}
      </div>

      {profiles.filter((p) => p.stats.length).slice(0, 3).map((p, i) => (
        <div key={i}>
          {p.label && profiles.length > 1 && <div className="muted small">{p.label}</div>}
          <div className="statline">{p.stats.map((s) => <div key={s.label}><span>{s.label}</span><b>{statText(s.value)}</b></div>)}</div>
        </div>
      ))}

      {rules === undefined ? <div className="muted small">Loading rules…</div> : rules.length > 0 && (
        <div className="chips">
          {rules.map((r) => (
            <button key={r.ruleId} className="chip" disabled={!r.rule} onClick={() => open('r:' + r.ruleId)}>{ruleLabel(r)}</button>
          ))}
        </div>
      )}

      {(gear.length > 0 || standard.length > 0 || count > 1) && (
        <details className="dd" open={edit || undefined}>
          <summary>Loadout{count > 1 ? ` · ${count} copies` : ''}</summary>
          <div className="ddbody">
            {unit.copies.map((c, i) => (
              <div className="copy" key={c.id}>
                <div className="copy-h">{count > 1 ? `Copy ${i + 1} · ` : ''}{c.models}{c.modelsGuessed ? '?' : ''} model{c.models === 1 ? '' : 's'}{c.pts ? ` · ${c.pts} pts` : ''}</div>
                <GearChips gear={c.gear} open={open} edit={edit} standardIds={entity?.wargearIds ?? []}
                  onRemove={(gi) => setCopy(c.id, (x) => ({ ...x, gear: x.gear.filter((_, k) => k !== gi) }))} />
                {edit && (
                  <>
                    <div className="row-btns">
                      <button className="small-btn" onClick={() => setCopy(c.id, (x) => ({ ...x, models: Math.max(1, x.models - 1), modelsGuessed: false }))}>− model</button>
                      <button className="small-btn" onClick={() => setCopy(c.id, (x) => ({ ...x, models: x.models + 1, modelsGuessed: false }))}>+ model</button>
                      {count > 1 && <button className="small-btn danger" onClick={() => setCopy(c.id, () => null)}>Remove copy</button>}
                    </div>
                    <Picker index={index} kinds={['weapon', 'wargear', 'other']} placeholder="Add wargear…"
                      onPick={(h) => setCopy(c.id, (x) => ({ ...x, gear: [...x.gear, { name: h.name, kind: 'weapon', entityId: h.id, added: true }] }))} />
                  </>
                )}
              </div>
            ))}
            {standard.length > 0 && (
              <div className="muted small">Standard wargear: {standard.map((w, i) => (
                <span key={w.id}>{i > 0 && ', '}<button className="link inline" onClick={() => open('e:' + w.id)}>{w.name}</button></span>
              ))}</div>
            )}
            {edit && <button className="small-btn" onClick={() => onChange({ ...unit, copies: [...unit.copies, { id: uid(), models: unit.copies[0]?.models ?? 1, gear: [], pts: unit.copies[0]?.pts }] })}>+ Add another copy</button>}
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

function GearChips({ gear, open, edit, standardIds, onRemove }: {
  gear: ArmyGear[]; open: (n: string) => void; edit: boolean; standardIds: string[]; onRemove: (i: number) => void;
}) {
  if (!gear.length) return <div className="muted small">Nothing extra listed.</div>;
  return (
    <div className="chips">
      {gear.map((g, i) => {
        const extra = g.kind === 'weapon' && g.entityId && !standardIds.includes(g.entityId);
        const text = `${g.label ? g.label + ': ' : ''}${g.forModel ? g.forModel + ': ' : ''}${g.count && g.count > 1 ? g.count + '× ' : ''}${g.name}`;
        const go = g.kind === 'weapon' && g.entityId ? () => open('e:' + g.entityId) : g.kind === 'rule' && g.ruleId ? () => open('r:' + g.ruleId) : undefined;
        return (
          <span key={i} className={`chip static${extra ? ' extra' : ''}`}>
            <button className="chip-go" disabled={!go} onClick={go}>{text}{extra ? ' ★' : ''}</button>
            {edit && <button className="chip-x" aria-label={`Remove ${g.name}`} onClick={() => onRemove(i)}>×</button>}
          </span>
        );
      })}
    </div>
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
