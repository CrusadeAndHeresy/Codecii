// A mission that opens in place: its maps first, then its rules. Nothing navigates away.
import { useEffect, useState } from 'react';
import { db } from './db';
import type { LibImage } from './model';
import type { EditionIndex } from './search';
import { RuleBody } from './RuleDrops';

export function usePics(ruleId: string, wanted: boolean) {
  const [pics, setPics] = useState<LibImage[]>([]);
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    (async () => {
      const prints = await db.printings.where('ruleId').equals(ruleId).toArray();
      const found = await db.images.bulkGet([...new Set(prints.flatMap((p) => p.imageIds ?? []))]);
      if (live) setPics([...new Map(found.filter((x): x is LibImage => !!x).map((x) => [x.data, x])).values()]);
    })();
    return () => { live = false; };
  }, [ruleId, wanted]);
  return pics;
}

export function Pics({ pics }: { pics: LibImage[] }) {
  return (
    <>
      {pics.map((im) => (
        <figure className="map" key={im.id}>
          <img src={`data:${im.mimeType};base64,${im.data}`} alt={im.caption} />
          <figcaption className="muted small">{im.caption}</figcaption>
        </figure>
      ))}
    </>
  );
}

// `pictures={false}` for a mission: its maps are shown in the Map section instead.
export default function MissionDrop({ ruleId, name, index, open, pictures = true }: { ruleId: string; name: string; index: EditionIndex; open: (nav: string) => void; pictures?: boolean }) {
  const [opened, setOpened] = useState(false);
  const pics = usePics(ruleId, opened && pictures);
  return (
    <details className="dd" onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) setOpened(true); }}>
      <summary><span>{name}</span></summary>
      <div className="ddbody">
        {opened && (
          <>
            {pictures && <Pics pics={pics} />}
            <RuleBody ruleId={ruleId} index={index} open={open} />
          </>
        )}
      </div>
    </details>
  );
}
