// Pick a game type first, then either choose one mission or tick a pool and roll from it.
import { useState } from 'react';
import { allMissions, pickOne, type MissionNode, type MissionRef } from './missions';

export default function MissionPicker({ tree, value, onChange, open }: {
  tree: MissionNode[]; value: string; onChange: (ruleId: string) => void; open: (nav: string) => void;
}) {
  const [typeName, setTypeName] = useState('');
  const [random, setRandom] = useState(false);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const type = tree.find((t) => t.name === typeName);
  const all = type ? allMissions(type) : [];
  const pool = all.filter((m) => ticked.has(m.id));
  const chosen = all.find((m) => m.id === value);

  const pickType = (name: string) => { setTypeName(name); setTicked(new Set()); onChange(''); };
  const toggle = (id: string) => setTicked((s) => { const n = new Set(s); if (!n.delete(id)) n.add(id); return n; });

  const box = (m: MissionRef) => (
    <label key={m.id} style={{ display: 'flex', gap: 10, alignItems: 'center', minHeight: 40 }}>
      <input type="checkbox" checked={ticked.has(m.id)} onChange={() => toggle(m.id)} />{m.name}
    </label>
  );
  const group = (n: MissionNode) => {
    const ms = allMissions(n);
    const on = ms.filter((m) => ticked.has(m.id)).length;
    return (
      <details className="dd" key={n.name}>
        <summary>{n.name} · {on ? `${on} of ${ms.length}` : ms.length}</summary>
        <div className="ddbody">{n.missions.map(box)}{n.children.map(group)}</div>
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
      <label className="small">Game type{' '}
        <select value={typeName} onChange={(e) => pickType(e.target.value)}>
          <option value="">Choose…</option>
          {tree.map((t) => <option key={t.name} value={t.name}>{t.name} ({allMissions(t).length})</option>)}
        </select>
      </label>
      <div className="row-btns"><button className="small-btn" onClick={() => pickType(pickOne(tree)!.name)}>Random game type</button></div>
      {type && (
        <>
          <div className="bgrid">
            <button className={`small-btn${random ? '' : ' on'}`} onClick={() => { setRandom(false); onChange(''); }}>Choose mission</button>
            <button className={`small-btn${random ? ' on' : ''}`} onClick={() => { setRandom(true); onChange(''); }}>Random mission</button>
          </div>
          {!random ? (
            <label className="small">Mission{' '}
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
          {chosen && <div className="note">Mission: <button className="small-btn" onClick={() => open('r:' + chosen.id)}>{chosen.name} ›</button></div>}
        </>
      )}
    </>
  );
}
