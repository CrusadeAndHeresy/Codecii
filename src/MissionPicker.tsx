// Pick a game type first, then either choose one mission or tick a pool and roll from it.
import { useEffect } from 'react';
import type { EditionIndex } from './search';
import MissionDrop from './MissionDrop';
import { useKept } from './useKept';
import MapStep from './MapStep';
import { allMissions, pickOne, type MissionNode, type MissionRef } from './missions';

export default function MissionPicker({ tree, value, onChange, map, onMap, variant, onVariant, index, open }: {
  tree: MissionNode[]; value: string; onChange: (ruleId: string) => void; map: string; onMap: (name: string) => void; variant: string; onVariant: (v: string) => void; index: EditionIndex; open: (nav: string) => void;
}) {
  const [typeName, setTypeName] = useKept('pick.type', '');
  const [random, setRandom] = useKept('pick.random', false);
  const [ticked, setTicked] = useKept<Set<string>>('pick.ticked', new Set());
  const type = tree.find((t) => t.name === typeName);
  const all = type ? allMissions(type) : [];
  const pool = all.filter((m) => ticked.has(m.id));
  const chosen = all.find((m) => m.id === value);
  const [forMission, setFor] = useKept('pick.variantFor', '');
  useEffect(() => {
    const id = chosen?.id ?? '';
    if (forMission === id) return;
    setFor(id); onVariant(chosen?.variants?.[0] ?? '');
  });
  const [archetype, setArchetype] = useKept('pick.archetype', '');

  const pickType = (name: string) => { setTypeName(name); setArchetype(''); setTicked(new Set()); onChange(''); };
  const toggle = (id: string) => setTicked((s) => { const n = new Set(s); if (!n.delete(id)) n.add(id); return n; });

  const box = (m: MissionRef) => (
    <label key={m.id} style={{ display: 'flex', gap: 10, alignItems: 'center', minHeight: 40 }}>
      <input type="checkbox" checked={ticked.has(m.id)} onChange={() => toggle(m.id)} />{m.name}
    </label>
  );
  // Roll the archetype, then either roll the mission too or let the players agree it.
  const archetypeRolls = (n: MissionNode) => {
    const rolled = n.children.find((c) => c.name === archetype);
    return (
      <div className="roll">
        <button className="small-btn wide" onClick={() => { const a = pickOne(n.children)!; setArchetype(''); onChange(pickOne(allMissions(a))!.id); }}>Roll archetype and mission</button>
        <button className="small-btn wide" onClick={() => { setArchetype(pickOne(n.children)!.name); onChange(''); }}>Roll archetype only, we pick the mission</button>
        {rolled && (
          <>
            <p className="muted small">Rolled {rolled.name}. Agree a mission:</p>
            {allMissions(rolled).map((m) => <button key={m.id} className={`small-btn wide${value === m.id ? ' on' : ''}`} onClick={() => onChange(m.id)}>{m.name}</button>)}
          </>
        )}
      </div>
    );
  };
  const group = (n: MissionNode) => {
    const ms = allMissions(n);
    const on = ms.filter((m) => ticked.has(m.id)).length;
    return (
      <details className="dd" key={n.name}>
        <summary>{n.name} · {on ? `${on} of ${ms.length}` : ms.length}</summary>
        <div className="ddbody">
          {!n.missions.length && n.children.length > 1 && archetypeRolls(n)}
          {n.missions.map(box)}{n.children.map(group)}
        </div>
      </details>
    );
  };
  const options = (n: MissionNode, trail: string[]): JSX.Element[] => [
    ...(n.missions.length ? [<optgroup key={trail.join('/')} label={trail.join(' › ')}>{n.missions.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</optgroup>] : []),
    ...n.children.flatMap((c) => options(c, [...trail, c.name])),
  ];

  if (!tree.length) return <p className="muted">No tagged missions in your library yet. Re-import your mission books.</p>;
  return (
    <>
      <label className="field">Game type
        <select value={typeName} onChange={(e) => pickType(e.target.value)}>
          <option value="">Choose…</option>
          {tree.map((t) => <option key={t.name} value={t.name}>{t.name} ({allMissions(t).length})</option>)}
        </select>
      </label>
      <div className="row-btns"><button className="small-btn wide" onClick={() => pickType(pickOne(tree)!.name)}>Random game type</button></div>
      {type && (
        <>
          <div className="bgrid">
            <button className={`small-btn${random ? '' : ' on'}`} onClick={() => { setRandom(false); onChange(''); }}>Choose mission</button>
            <button className={`small-btn${random ? ' on' : ''}`} onClick={() => { setRandom(true); onChange(''); }}>Random mission</button>
          </div>
          {!random ? (
            <label className="field">Mission
              <select value={value} onChange={(e) => onChange(e.target.value)}>
                <option value="">No mission</option>
                {options(type, [])}
              </select>
            </label>
          ) : (
            <>
              <label style={{ display: 'flex', gap: 10, alignItems: 'center', minHeight: 44, fontWeight: 650 }}>
                <input type="checkbox" checked={pool.length === all.length}
                  onChange={() => setTicked(new Set(pool.length === all.length ? [] : all.map((m) => m.id)))} />
                Select all {type.name}
              </label>
              {type.missions.map(box)}
              {type.children.map(group)}
              <button className="primary" disabled={!pool.length} onClick={() => onChange(pickOne(pool)!.id)}>Roll from {pool.length} mission{pool.length === 1 ? '' : 's'}</button>
            </>
          )}
          {chosen && (
            <>
              <MissionDrop key={chosen.id} ruleId={chosen.id} name={chosen.name} index={index} open={open} pictures={false} />
              {chosen.variants && (
                <>
                  <label className="field">Played as
                    <select value={variant} onChange={(e) => onVariant(e.target.value)}>
                      {chosen.variants.map((v, i) => <option key={v} value={v}>{v}{i === 0 ? ' (default)' : ''}</option>)}
                    </select>
                  </label>
                  {random && <div className="row-btns"><button className="small-btn wide" onClick={() => onVariant(pickOne(chosen.variants!)!)}>Roll Escalation or Hammerblow</button></div>}
                </>
              )}
              <h3>Maps</h3>
              <MapStep mission={chosen} random={random} value={map} onChange={onMap} index={index} open={open} />
            </>
          )}
        </>
      )}
    </>
  );
}
