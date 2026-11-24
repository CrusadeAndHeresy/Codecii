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

const FLAVOUR_TERMS = /\b(Special Rules?|Rules?|Units?|Models?|Weapons?|Tests?|Phase|Sub-Phase|Step|Characteristics?|Status(?:es)?|Reactions?|Hits?|Wounds?|Attacks?|Players?|Points?|Slots?|Targets?|Traits?)\b/g;
const looksLikeBackground = (p: string) => p.length >= 60 && !/\d/.test(p) && !RULEY.test(p) && !/:/.test(p.slice(0, 40));
// the paragraph after the background that opens the rule itself
const OPENS_RULE = /\b(this|these) (Special Rule|Rule|Trait|Reaction|Gambit|Psychic Power|Weapon|Wargear)\b|^(A|An|The|Any)\s+(Model|Unit|Weapon|Player|Army)s?\b|^(Models?|Units?|Weapons?)\b/;

export function splitIntro(summary: string | undefined, fullText: string | undefined): { intro: string[]; body: string[] } {
  const ps = (fullText ?? '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const none = { intro: [] as string[], body: ps };
  if (ps.length < 2) return none;
  const sc = summary ? ps.map((p) => overlap(summary, p)) : ps.map(() => 0);
  let best = 0;
  sc.forEach((v, i) => { if (v > sc[best]) best = i; });
  const matched = best > 0 && sc[best] >= 0.3 && sc[best] >= sc[0] + 0.15;
  let cut = 0;
  if (matched) {
    // strip leading background paragraphs, one at a time, up to the paragraph the summary matches
    while (cut < best && looksLikeBackground(ps[cut]) && sc[cut] < 0.2) cut++;
  } else if (looksLikeBackground(ps[0]) && (ps[0].match(FLAVOUR_TERMS) ?? []).length <= 1 && ps[0].length >= 80 && OPENS_RULE.test(ps[1])) {
    cut = 1;   // no summary to check against: only when the next paragraph plainly opens the rule
  }
  return cut ? { intro: ps.slice(0, cut), body: ps.slice(cut) } : none;
}
