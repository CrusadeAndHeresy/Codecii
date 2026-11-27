// What a game needs to see about the table: where to deploy, and the sectors it is scored on.
import type { EditionIndex } from './search';
import MissionDrop, { usePics, Pics } from './MissionDrop';

export const isSectorMap = (caption: string) => /^sector map/i.test(caption);

export default function MapSection({ missionId, deployment, index, open }: {
  missionId: string; deployment?: { id: string; name: string }; index: EditionIndex; open: (nav: string) => void;
}) {
  const pics = usePics(missionId, true);
  const sectors = pics.filter((p) => isSectorMap(p.caption));
  const own = pics.filter((p) => !isSectorMap(p.caption));
  return (
    <>
      {deployment
        ? <MissionDrop key={deployment.id} ruleId={deployment.id} name={`Deployment: ${deployment.name}`} index={index} open={open} />
        : own.length > 0 && <details className="dd"><summary><span>Deployment map</span></summary><div className="ddbody"><Pics pics={own} /></div></details>}
      {sectors.length > 0 && <details className="dd"><summary><span>Scoring map (sectors)</span></summary><div className="ddbody"><Pics pics={sectors} /></div></details>}
    </>
  );
}
