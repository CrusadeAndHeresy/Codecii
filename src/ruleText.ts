// A printed rule often opens with a paragraph of background before the rule itself ("Some weapons are wreathed in flame…").
// On a unit card we show the rule first. The background is only split off when the book's summary clearly matches a later
// paragraph and everything before it reads as background; anything unsure stays in the text. The rule page shows it all.
const words = (s: string) => new Set((s.toLowerCase().match(/[a-z']+/g) ?? []).filter((w) => w.length > 2));
const firstSentence = (s: string) => s.trim().split(/(?<=[.!?])\s/)[0] ?? '';
const overlap = (summary: string, p: string) => {
  const a = words(firstSentence(summary)), b = words(firstSentence(p));
  let i = 0; a.forEach((x) => { if (b.has(x)) i++; });
  return i / Math.max(1, new Set([...a, ...b]).size);
};
const RULEY = /(^|\s)(Trigger|Cost|Target|Set-up|Sectors)\s*:|•|\bSpecial Rules?\b|\bTraits?\b|\bDetachments?\b|\bFaction\b|\bPrimary\b|\bBattlefield Role\b|\b(An|Any) Army\b|^(If|When|While|Whenever|At the|As soon|Any|You)\b|^(This|These|A|An|The|Each|All|Models?|Units?)\s+(Model|Unit|Weapon|Models|Units|Reaction|Gambit|Psychic|Special|Stratagem|upgrade|Mission)\b/;

export function splitIntro(summary: string | undefined, fullText: string | undefined): { intro: string[]; body: string[] } {
  const ps = (fullText ?? '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (ps.length < 2 || !summary) return { intro: [], body: ps };
  const sc = ps.map((p) => overlap(summary, p));
  let best = 0;
  sc.forEach((v, i) => { if (v > sc[best]) best = i; });
  if (best === 0 || sc[best] < 0.3 || sc[best] < sc[0] + 0.15) return { intro: [], body: ps };
  const intro = ps.slice(0, best);
  const background = intro.every((p) => p.length >= 60 && !/\d/.test(p) && !RULEY.test(p) && !/:/.test(p.slice(0, 40)));
  return background ? { intro, body: ps.slice(best) } : { intro: [], body: ps };
}
