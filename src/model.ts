// Library data model. Every game is data: nothing system-specific is hard-coded.
// GameSystem → Edition → Source (book/PDF/FAQ) → Rule ← Printing (text as printed in one source)
//                                              Rule ← Amendment (FAQ/errata change)
//                                              Entity (unit/wargear/weapon) → Rule refs

export type ISODate = string; // YYYY-MM-DD

export interface GameSystem {
  id: string;            // "horus-heresy"
  name: string;
  publisher?: string;
  updatedAt: number;
}

export interface Edition {
  id: string;            // "horus-heresy@3-0"
  systemId: string;
  name: string;          // "3.0"
  released?: ISODate;
  updatedAt: number;
}

export type SourceKind = 'rulebook' | 'supplement' | 'download' | 'faq' | 'errata' | 'user';

export interface Source {
  id: string;            // "horus-heresy@3-0/liber-astartes"
  editionId: string;
  title: string;
  kind: SourceKind;
  isCore: boolean;       // this source is the core rulebook (the default tier for its rules)
  version?: string;      // "1.1" for versioned downloads/FAQs
  published: ISODate;    // drives "latest version" ordering
  updatedAt: number;
}

export interface RuleParam {
  name: string;          // "X"
  kind: 'number' | 'roll' | 'distance' | 'text';
  note?: string;
}

export type Tier = 'core' | 'expanded';

export interface Rule {
  id: string;            // "<editionId>:<slug>" or "<editionId>:<slug>~<faction>"
  editionId: string;
  name: string;
  normName: string;
  aliases: string[];     // "FNP", old names, common typos
  category: string;      // system-defined: "Special Rule", "Weapon Trait", "Wargear"...
  parameters: RuleParam[];
  phase?: string;
  section?: string;      // for core rules read in book order, e.g. "Assault Phase > Charging"
  tier?: Tier;           // Core (base game) or Expanded (extra rules, in this book or others). Unset = from the source's isCore flag
  tierBy?: 'import' | 'user'; // a tier you set yourself is kept when a book is re-imported
  tags: string[];
  relatedRuleIds: string[];
  faction?: string;      // set for faction-specific versions
  overridesRuleId?: string; // faction version of a universal rule
  supersedes?: string;   // rule id in an older edition (renames carry across)
  preferredPrintingId?: string; // set when you resolve a printing conflict
  updatedAt: number;
}

export type VerifyStatus = 'unverified' | 'ai-checked' | 'verified';

// The rule as printed in one source. Text is the user's own transcription; it never leaves their account.
export interface Printing {
  id: string;            // "<ruleId>|<sourceId>"
  ruleId: string;
  sourceId: string;
  page?: string;
  summary?: string;      // user's own words
  fullText?: string;     // verbatim transcription (personal use only)
  textHash?: string;
  status: VerifyStatus;
  extractedBy: 'manual' | 'gemini' | 'claude' | 'other';
  confidence?: number;   // 0..1 from the reader
  imageIds?: string[];   // pictures printed with this rule in this source (board layouts, list designs)
  updatedAt: number;
}

// A picture from a source (e.g. a deployment map). Stored as base64 PNG/JPEG so it works offline.
export type ImageKind = 'board-layout' | 'list-design';
export interface LibImage {
  id: string;            // "<sourceId>#<local id>"
  sourceId: string;
  kind: ImageKind;
  caption: string;
  page?: string;         // printed page
  source?: string;       // book title as printed
  mimeType: 'image/png' | 'image/jpeg';
  width?: number;
  height?: number;
  data: string;          // base64, no data-URL prefix
}

export type AmendmentType = 'replace' | 'insert' | 'delete' | 'clarification';

export interface Amendment {
  id: string;            // "<sourceId>#<n>"
  ruleId: string;
  sourceId: string;
  page?: string;
  type: AmendmentType;
  find?: string;         // text to replace/delete; omitted on replace = replace whole text
  text?: string;         // new text, insertion, or Q&A answer
  question?: string;     // for clarifications
  alsoRuleIds?: string[]; // a Q&A that covers several rules shows on each, and in the together view
  updatedAt: number;
}

export interface RuleRef { ruleId: string; value?: string } // Rending (4+) → value "4+"

export interface Stat { label: string; value: string }

// A unit, weapon or piece of wargear. Type and sub-types link to rules of the same name when you have them.
// A plain option, e.g. melta bombs or a jetbike upgrade.
export interface OptionItem {
  name: string;
  points?: string;
  wargearId?: string;    // links to a weapon/wargear entry
  profile?: string;      // links to a profile line of this unit
}

// A swap: one item the unit can swap out, the profile line(s) it applies to, and what it can be swapped for.
export interface SwapChoice {
  name: string;
  points?: string;       // e.g. "+15"
  wargearId?: string;    // links to a weapon/wargear entry
  profile?: string;      // links to a profile line of this unit (e.g. swapping the whole model for a jetbike)
}
export interface SwapGroup {
  replaces: string;      // the wargear name, or "Model"
  for: string[];         // profile line name(s) this swap applies to
  choices: SwapChoice[];
}

// One profile line of a unit. Entries that share a profile (e.g. two names, same stats) sit in one line with several names.
export interface EntityProfile {
  names: string[];       // the entry name(s) this profile line covers
  stats: Stat[];
  rules: RuleRef[];      // special rules of this line
  traits: RuleRef[];     // [Allegiance]-style traits of this line
  ruleIds: string[];     // index helper: rules, traits and this line's type/sub-type rules
  unitType?: string;
  subTypes: string[];
  wargearIds: string[];  // links to weapon/wargear entities
}

export interface Entity {
  id: string;            // "<editionId>#<slug>[~faction]": stable, so other entries can link to it
  editionId: string;
  sourceId: string;
  name: string;
  aliases?: string[];    // other names this entry goes by, e.g. "lightning claws" for the pair
  type: 'unit' | 'wargear' | 'weapon' | 'other';
  faction?: string;
  unitType?: string;     // HH3 e.g. "Infantry"
  subTypes: string[];    // e.g. ["Line", "Heavy"]
  role?: string;         // battlefield role / slot
  stats: Stat[];         // free-form so any game's profile fits
  keywords: string[];
  page?: string;
  rules: RuleRef[];
  ruleIds: string[];     // index helper: rules + type/sub-type rules
  wargearIds: string[];  // links to weapon/wargear entities
  profiles?: EntityProfile[]; // present when the entry has more than one profile line
  traits: RuleRef[];          // traits of a single-profile entry
  options?: OptionItem[];     // plain options (no swap), each may link to a wargear entry or a profile line
  swaps?: SwapGroup[];        // swaps, grouped under one 'Options and swaps' dropdown
  additionalNotes?: string;   // where it is found, how the entry was identified, how to build it (not game rules)
  composition?: string;       // e.g. "1 Outrider Legion Champion"
  points?: string;            // e.g. "145"
  notes?: string;        // your own words
  updatedAt: number;
}

export interface EditLogEntry {
  seq?: number;
  at: number;
  recordType: string;
  recordId: string;
  action: string;
  before?: unknown;
  after?: unknown;
}
