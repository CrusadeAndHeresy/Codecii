// The deployment map for the chosen mission. A map tied to the mission is filled in; otherwise choose or roll one.
import { useEffect } from 'react';
import type { EditionIndex } from './search';
import { findMap, pickOne, type MissionRef } from './missions';
import MapSection from './MapSection';
import { useKept } from './useKept';

export default function MapStep({ mission, random, value, onChange, index, open }: {
  mission: MissionRef; random: boolean; value: string; onChange: (name: string) => void; index: EditionIndex; open: (nav: string) => void;
}) {
  const faces = mission.maps ?? [];
  const names = [...new Set(faces)];
  const tied = names.length === 1 && !mission.mapDefault;
  const [other, setOther] = useKept('pick.otherMap', false);
  // What the book gives you without choosing: the tied map, the default, or (random game) a roll on the table.
  const auto = () => (tied ? names[0] : mission.mapDefault ?? (random ? pickOne(faces) ?? '' : ''));
  const [forMission, setFor] = useKept('pick.mapFor', '');
  useEffect(() => {
    if (forMission === mission.id) return;
    setFor(mission.id); setOther(false); onChange(auto());
  });
  const entry = value ? findMap(index.rules.values(), value) : undefined;
  const roll = () => onChange(pickOne(faces)!);
  const picking = names.length > 1 && (!mission.mapDefault || other);

  const section = <MapSection key={mission.id} missionId={mission.id} deployment={entry} index={index} open={open} />;
  if (!names.length) return <><p className="muted small">No separate deployment map to pick for this mission.</p>{section}</>;
  return (
    <>
      {tied && <p className="muted small">This map is set by the mission.</p>}
      {mission.mapDefault && names.length > 1 && (
        <label style={{ display: 'flex', gap: 10, alignItems: 'center', minHeight: 44 }}>
          <input type="checkbox" checked={other} onChange={(e) => { setOther(e.target.checked); onChange(e.target.checked && random ? pickOne(faces)! : mission.mapDefault!); }} />
          Use a different map (optional in the book)
        </label>
      )}
      {picking && (random
        ? <button className="small-btn wide" onClick={roll}>{value ? 'Roll map again' : 'Roll for map'}</button>
        : <label className="field">Map
            <select value={value} onChange={(e) => onChange(e.target.value)}>
              <option value="">Choose…</option>
              {names.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>)}
      {!entry && value && <div className="note">{value} isn’t in your library. Import the book that has it.</div>}
      {section}
    </>
  );
}
