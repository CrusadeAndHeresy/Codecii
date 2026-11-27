// The Game tab: two players share lists and a mission by QR code. Nothing is sent to a server.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { db } from './db';
import type { Entity, Source } from './model';
import type { EditionIndex } from './search';
import { groupByRole, makeLookup, unitPoints, type Army } from './army';
import { UnitCard } from './ArmyPane';
import { QrCode, Scanner } from './Qr';
import { booksFor, checkBooks, decodePack, encodePack, expired, mergeBooks, trimArmy, type GamePack, type ListPack } from './pack';
import { scrollToTop } from './scroll';
import MissionPicker from './MissionPicker';
import { missionTree } from './missions';

type View = 'home' | 'share' | 'host' | 'join';
const KEY = 'game';
const points = (a: Army) => a.units.reduce((t, u) => t + unitPoints(u), 0);
const summary = (a: Army) => `${a.name} · ${a.units.length} unit${a.units.length === 1 ? '' : 's'} · ${points(a)} pts`;

export default function GamePane({ index, editionId, open }: { index?: EditionIndex; editionId?: string; open: (nav: string) => void }) {
  const [view, setView] = useState<View>('home');
  const [armies, setArmies] = useState<Army[]>([]);
  const [ents, setEnts] = useState<Map<string, Entity>>(new Map());
  const [sources, setSources] = useState<Source[]>([]);
  const [game, setGame] = useState<GamePack>();
  const [mine, setMine] = useState('');
  const [theirs, setTheirs] = useState<ListPack>();
  const [mission, setMission] = useState('');
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    if (!editionId) return;
    const [a, e, s, saved] = await Promise.all([
      db.armies.where('editionId').equals(editionId).reverse().sortBy('updatedAt'),
      db.entities.where('editionId').equals(editionId).toArray(),
      db.sources.where('editionId').equals(editionId).toArray(),
      db.meta.get(KEY),
    ]);
    setArmies(a); setEnts(new Map(e.map((x) => [x.id, x]))); setSources(s);
    const g = saved?.value as GamePack | undefined;
    if (g && expired(g)) await db.meta.delete(KEY);
    setGame(g && !expired(g) && g.editionId === editionId ? g : undefined);
  }, [editionId]);
  useEffect(() => { void load(); }, [load]);

  const tree = useMemo(() => missionTree(index?.rules.values() ?? []), [index]);
  const go = (v: View) => { setView(v); setMsg(''); setCode(''); setTheirs(undefined); scrollToTop(); };

  if (!editionId || !index) return <div className="empty">Import a rules file first.</div>;

  // The books an army (and mission) draws on, so the other phone can check it has them.
  const needed = (a: Army, missionId?: string) => {
    const ids = new Set<string>();
    const addEntity = (id?: string) => { const e = id ? ents.get(id) : undefined; if (e) ids.add(e.sourceId); };
    a.units.forEach((u) => { addEntity(u.entityId); u.copies.forEach((c) => c.gear.forEach((g) => addEntity(g.entityId))); });
    if (missionId) Object.keys(index.bookPages.get(missionId) ?? {}).forEach((id) => ids.add(id));
    return booksFor(ids, sources);
  };
  const guard = async (job: () => Promise<void>) => { setMsg(''); try { await job(); } catch (e) { setMsg((e as Error).message || 'Something went wrong.'); } };
  const keep = async (g: GamePack) => { await db.meta.put({ key: KEY, value: g }); setGame(g); go('home'); };

  const share = (id: string) => guard(async () => {
    setMine(id); setCode('');
    const a = armies.find((x) => x.id === id);
    if (a) setCode(await encodePack({ v: 1, type: 'list', editionId, books: needed(a), army: trimArmy(a) }));
  });
  const scanned = (want: 'list' | 'game') => (text: string) => guard(async () => {
    const p = await decodePack(text);
    if (p.type !== want) throw new Error(want === 'list' ? 'That is a game code. Scan your opponent’s list code.' : 'That is a list code. Scan the host’s game code.');
    if (p.editionId !== editionId) throw new Error('That code is for a different game or edition. Switch edition at the top, or import it first.');
    if (p.type === 'list') setTheirs(p);
    else {
      if (expired(p)) throw new Error('That game code is more than a day old. Ask the host to make a new one.');
      await keep(p);
    }
  });
  const make = () => guard(async () => {
    const a = armies.find((x) => x.id === mine);
    if (!a || !theirs) return;
    const m = index.rules.get(mission);
    await keep({
      v: 1, type: 'game', editionId, createdAt: Date.now(), books: mergeBooks(needed(a, m?.id), theirs.books),
      mission: m && { ruleId: m.id, name: m.name }, host: trimArmy(a), guest: theirs.army,
    });
  });

  const pickArmy = (value: string, onChange: (id: string) => void) => (
    <label className="small">Your army{' '}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose…</option>
        {armies.map((a) => <option key={a.id} value={a.id}>{summary(a)}</option>)}
      </select>
    </label>
  );
  const back = <button className="back" onClick={() => go('home')}>‹ Game</button>;
  const note = msg && <div className="note" role="alert">{msg}</div>;

  if (view === 'share') return (
    <div className="pad">{back}<h2>Share my list</h2>
      {armies.length ? pickArmy(mine, share) : <p className="muted">Read a list on the Army tab first.</p>}
      {note}
      {code && <><p>Show this to the host.</p><QrCode code={code} /></>}
    </div>
  );

  if (view === 'host') return (
    <div className="pad">{back}<h2>Host a game</h2>
      <h3>1. Mission</h3>
      <MissionPicker tree={tree} value={mission} onChange={setMission} open={open} />
      <h3>2. Your army</h3>
      {armies.length ? pickArmy(mine, setMine) : <p className="muted">Read a list on the Army tab first.</p>}
      <h3>3. Opponent’s list</h3>
      {theirs ? <div className="note">{summary(theirs.army)}</div> : <Scanner label="Scan opponent’s list" onCode={scanned('list')} />}
      {theirs && checkBooks(theirs.books, sources).map((w) => <div className="note" key={w}>{w}</div>)}
      {note}
      <button className="primary" disabled={!mine || !theirs} onClick={make}>Lock lists and make game</button>
    </div>
  );

  if (view === 'join') return (
    <div className="pad">{back}<h2>Join a game</h2>
      <p className="muted">Scan the host’s game code.</p>
      <Scanner label="Scan game code" onCode={scanned('game')} />
      {note}
    </div>
  );

  return (
    <div className="pad">
      <h2>Game</h2>
      <div className="bgrid">
        <button className="small-btn" onClick={() => go('share')}>Share my list</button>
        <button className="small-btn" onClick={() => go('host')}>Host</button>
        <button className="small-btn" onClick={() => go('join')}>Join</button>
      </div>
      {game
        ? <GameView game={game} ents={ents} sources={sources} index={index} open={open}
            onEnd={async () => { if (confirm('Clear this game from this phone?')) { await db.meta.delete(KEY); setGame(undefined); } }} />
        : <p className="muted">One player shares their list, the other hosts. The host then shows a game code for the first player to scan.</p>}
    </div>
  );
}

function GameView({ game, ents, sources, index, open, onEnd }: {
  game: GamePack; ents: Map<string, Entity>; sources: Source[]; index: EditionIndex; open: (n: string) => void; onEnd: () => void;
}) {
  const [side, setSide] = useState<'host' | 'guest'>('host');
  const [code, setCode] = useState('');
  const look = useMemo(() => makeLookup([...ents.values()], [...index.rules.values()]), [ents, index]);
  const army = game[side];
  const warnings = checkBooks(game.books, sources);
  return (
    <>
      {warnings.map((w) => <div className="note" key={w}>{w}</div>)}
      <h3>Mission</h3>
      {game.mission
        ? index.rules.has(game.mission.ruleId)
          ? <button className="small-btn" onClick={() => open('r:' + game.mission!.ruleId)}>{game.mission.name} ›</button>
          : <div className="note">{game.mission.name} isn’t in your library.</div>
        : <p className="muted small">No mission chosen.</p>}
      <div className="row-btns">
        <button className="small-btn" onClick={async () => setCode(code ? '' : await encodePack(game))}>{code ? 'Hide game code' : 'Show game code'}</button>
        <button className="small-btn danger" onClick={onEnd}>End game</button>
      </div>
      {code && <QrCode code={code} />}
      <h3>Armies</h3>
      <div className="bgrid">
        {(['host', 'guest'] as const).map((s) => (
          <button key={s} className={`small-btn${side === s ? ' on' : ''}`} onClick={() => setSide(s)}>{game[s].name} · {points(game[s])} pts</button>
        ))}
      </div>
      {groupByRole(army.units, ents).map((g) => (
        <section key={side + g.role}>
          <h3 className="rolehead">{g.role}<span>{g.units.length} · {g.pts} pts</span></h3>
          {g.units.map((u) => (
            <UnitCard key={side + u.id} readOnly unit={u} entity={u.entityId ? ents.get(u.entityId) : undefined} look={look} index={index} open={open}
              edit={false} fold={{ n: 0, folded: true }} onChange={() => {}} />
          ))}
        </section>
      ))}
    </>
  );
}
