// Validates an import file and turns it into library records.
// One file = one source (a book, a PDF download, an FAQ). Re-importing the same source replaces
// only that source's printings/amendments/entities; other books and other editions are never touched.
import type {
  Tier, Amendment, AmendmentType, Edition, Entity, GameSystem, ImageKind, LibImage, Printing, Rule, RuleParam, Source, SourceKind, VerifyStatus,
} from './model';
import { hashText, ids, normName, parseRuleRef } from './normalize';

export const FORMAT = 'rules-library/v1';

export interface ImportFile {
  format: string;
  system: { name: string; publisher?: string };
  edition: { name: string; released?: string };
  source: { title: string; kind: SourceKind; isCore?: boolean; version?: string; published: string };
  rules?: ImportRule[];
  amendments?: ImportAmendment[];
  entities?: ImportEntity[];
  images?: ImportImage[];
}
export interface ImportImage {
  id: string;                 // local id, referenced from a rule's images list
  kind: ImageKind;
  caption: string;
  page?: string | number;
  source?: string;
  mimeType: 'image/png' | 'image/jpeg';
  width?: number;
  height?: number;
  data: string;               // base64, no data-URL prefix
}
export interface ImportRule {
  name: string; aliases?: string[]; category: string; parameters?: RuleParam[]; phase?: string; section?: string; tier?: Tier;
  summary?: string; fullText?: string; page?: string | number; tags?: string[]; related?: string[]; images?: string[];
  faction?: string; overrides?: string;
  supersedes?: { edition: string; name: string };
  status?: VerifyStatus; extractedBy?: Printing['extractedBy']; confidence?: number;
}
export interface ImportAmendment {
  rule: string; faction?: string; type: AmendmentType; find?: string; text?: string; question?: string; page?: string | number;
  alsoRules?: string[]; // other rules a Q&A covers
}
export interface ImportEntity {
  name: string; aliases?: string[]; type: Entity['type']; faction?: string; page?: string | number; rules: string[];
  unitType?: string; subTypes?: string[]; role?: string; keywords?: string[]; notes?: string;
  stats?: Record<string, string | number> | { label: string; value: string | number }[];
  wargear?: string[];   // names of weapons/wargear entries
  traits?: string[];    // [Allegiance]-style traits (brackets optional)
  options?: (string | { name: string; points?: string; wargear?: string; profile?: string })[]; // plain options; text or object with a link
  additionalNotes?: string; // non-game: where found, how identified, how to build
  composition?: string;
  points?: string;
  profiles?: ImportProfile[]; // when a unit has several profile lines
  swaps?: ImportSwap[];       // what can be swapped out, and for what
}
export interface ImportSwap {
  replaces: string;           // wargear name, or "Model"
  for?: string[];             // profile name(s) it applies to
  choices: { name: string; points?: string; wargear?: string; profile?: string }[];
}
export interface ImportProfile {
  names: string[];      // entry name(s) this profile line covers; several names = shared profile
  stats: Record<string, string | number> | { label: string; value: string | number }[];
  rules: string[];
  traits?: string[];
  unitType?: string;
  subTypes?: string[];
  wargear?: string[];
}

export interface Issue { path: string; message: string }

export interface ImportPlan {
  system: GameSystem; edition: Edition; source: Source;
  rules: Rule[]; printings: Printing[]; amendments: Amendment[]; entities: Entity[]; images: LibImage[];
  errors: Issue[]; warnings: Issue[];
}

const KINDS: SourceKind[] = ['rulebook', 'supplement', 'download', 'faq', 'errata', 'user'];
const AMEND: AmendmentType[] = ['replace', 'insert', 'delete', 'clarification'];
const PARAM_KINDS = ['number', 'roll', 'distance', 'text'];
const ENTITY_TYPES = ['unit', 'wargear', 'weapon', 'other'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const IMAGE_KINDS: ImageKind[] = ['board-layout', 'list-design'];
const IMAGE_TYPES = ['image/png', 'image/jpeg'];
const MAX_IMAGE_BYTES = 1_500_000; // decoded size per picture; keeps one book file phone-sized

// A stat the book leaves blank (no invulnerable save) is a dash, never the word "null".
export const statText = (v: unknown) => (v === null || v === undefined || v === '' || v === 'null' ? '–' : String(v));
const str = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
const pageStr = (p: unknown) => (p === undefined || p === null || p === '' ? undefined : String(p));

export function planImport(raw: unknown, now = Date.now()): ImportPlan {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const err = (path: string, message: string) => errors.push({ path, message });
  const warn = (path: string, message: string) => warnings.push({ path, message });

  const f = (raw ?? {}) as ImportFile;
  if (typeof raw !== 'object' || raw === null) err('', 'File is not a JSON object.');
  if (f.format !== FORMAT) err('format', `Must be "${FORMAT}".`);
  if (!str(f.system?.name)) err('system.name', 'Required, e.g. "Horus Heresy".');
  if (!str(f.edition?.name)) err('edition.name', 'Required, e.g. "3.0".');
  if (!str(f.source?.title)) err('source.title', 'Required, e.g. "Liber Astartes".');
  if (!KINDS.includes(f.source?.kind)) err('source.kind', `Must be one of: ${KINDS.join(', ')}.`);
  if (!DATE.test(f.source?.published ?? '')) err('source.published', 'Required date YYYY-MM-DD (used to work out the latest version).');

  const systemId = ids.system(f.system?.name ?? '');
  const editionId = ids.edition(systemId, f.edition?.name ?? '');
  const sourceId = ids.source(editionId, f.source?.title ?? '', f.source?.version);

  const system: GameSystem = { id: systemId, name: f.system?.name ?? '', publisher: f.system?.publisher, updatedAt: now };
  const edition: Edition = { id: editionId, systemId, name: f.edition?.name ?? '', released: f.edition?.released, updatedAt: now };
  const source: Source = {
    id: sourceId, editionId, title: f.source?.title ?? '', kind: f.source?.kind, isCore: !!f.source?.isCore,
    version: f.source?.version, published: f.source?.published, updatedAt: now,
  };

  // Pictures: validated first, so rules can point at them.
  const images: LibImage[] = [];
  const imageIds = new Map<string, string>(); // local id -> library id
  (f.images ?? []).forEach((im, i) => {
    const p = `images[${i}]`;
    if (!str(im?.id)) return err(`${p}.id`, 'Required: a short id, e.g. "map-dawn-of-war".');
    const at = `${p} (${im.id})`;
    if (imageIds.has(im.id)) return err(at, 'Duplicate image id in this file.');
    if (!IMAGE_KINDS.includes(im.kind)) err(`${at}.kind`, `Must be one of: ${IMAGE_KINDS.join(', ')}.`);
    if (!str(im.caption)) err(`${at}.caption`, 'Required, e.g. "Deployment Map: Dawn of War".');
    if (!IMAGE_TYPES.includes(im.mimeType)) err(`${at}.mimeType`, `Must be one of: ${IMAGE_TYPES.join(', ')}.`);
    if (!str(im.data) || !/^[A-Za-z0-9+/=\s]+$/.test(im.data)) return err(`${at}.data`, 'Needs base64 image data (no "data:" prefix).');
    const bytes = Math.floor((im.data.replace(/\s/g, '').length * 3) / 4);
    if (bytes > MAX_IMAGE_BYTES) return err(`${at}.data`, `Picture is ${Math.round(bytes / 1000)} KB; the limit is ${MAX_IMAGE_BYTES / 1000} KB. Shrink it.`);
    const libId = `${sourceId}#${im.id}`;
    imageIds.set(im.id, libId);
    images.push({ id: libId, sourceId, kind: im.kind, caption: im.caption, page: pageStr(im.page), source: im.source,
      mimeType: im.mimeType, width: im.width, height: im.height, data: im.data.replace(/\s/g, '') });
  });

  const rules: Rule[] = [];
  const printings: Printing[] = [];
  const seen = new Map<string, number>();
  const ruleIdFor = (name: string, faction?: string) => ids.rule(editionId, name, faction);

  (f.rules ?? []).forEach((r, i) => {
    const p = `rules[${i}]`;
    if (!str(r?.name)) return err(`${p}.name`, 'Required.');
    const at = `${p} (${r.name})`;
    if (!str(r.category)) err(`${at}.category`, 'Required, e.g. "Special Rule" or "Weapon Trait".');
    if (!str(r.summary) && !str(r.fullText)) err(at, 'Needs a summary or fullText.');
    (r.parameters ?? []).forEach((pm, j) => {
      if (!str(pm?.name)) err(`${at}.parameters[${j}].name`, 'Required, e.g. "X".');
      if (!PARAM_KINDS.includes(pm?.kind)) err(`${at}.parameters[${j}].kind`, `Must be one of: ${PARAM_KINDS.join(', ')}.`);
    });
    if (/\([^)]*\)\s*$/.test(r.name) && !(r.parameters?.length))
      warn(`${at}.name`, 'Looks parameterised but has no parameters listed.');
    if (r.tier !== undefined && r.tier !== 'core' && r.tier !== 'expanded') err(`${at}.tier`, 'Must be "core" or "expanded".');
    if (r.overrides && !r.faction) err(`${at}.overrides`, 'A faction override needs "faction".');
    if (r.confidence !== undefined && (r.confidence < 0 || r.confidence > 1)) err(`${at}.confidence`, 'Must be 0–1.');
    if (!str(pageStr(r.page))) warn(`${at}.page`, 'No page reference.');
    const picIds = (r.images ?? []).map((x) => {
      const libId = imageIds.get(x);
      if (!libId) err(`${at}.images`, `"${x}" isn't in this file's images list.`);
      return libId;
    }).filter((x): x is string => !!x);

    const id = ruleIdFor(r.name, r.faction);
    if (seen.has(id)) return err(at, `Duplicate of rules[${seen.get(id)}] in this file.`);
    seen.set(id, i);

    const prev = r.supersedes;
    rules.push({
      id, editionId, name: r.name.replace(/\s*\([^)]*\)\s*$/, '').trim(), normName: normName(r.name),
      aliases: r.aliases ?? [], category: r.category, parameters: r.parameters ?? [], phase: r.phase, section: r.section,
      tier: r.tier, tierBy: r.tier ? 'import' : undefined,
      tags: r.tags ?? [], relatedRuleIds: (r.related ?? []).map((n) => ruleIdFor(parseRuleRef(n).name)),
      faction: r.faction, overridesRuleId: r.overrides ? ruleIdFor(r.overrides) : undefined,
      supersedes: prev ? ids.rule(ids.edition(systemId, prev.edition), prev.name) : undefined,
      updatedAt: now,
    });
    printings.push({
      id: ids.printing(id, sourceId), ruleId: id, sourceId, page: pageStr(r.page),
      summary: r.summary, fullText: r.fullText, textHash: r.fullText ? hashText(r.fullText) : undefined,
      status: r.status ?? (r.extractedBy && r.extractedBy !== 'manual' ? 'unverified' : 'verified'),
      extractedBy: r.extractedBy ?? 'manual', confidence: r.confidence, updatedAt: now,
      ...(picIds.length ? { imageIds: picIds } : {}),
    });
  });

  // Related names that aren't in this file may come from another book: keep them, flag them.
  const inFile = new Set(rules.map((r) => r.id));
  rules.forEach((r) => r.relatedRuleIds.forEach((rid) => {
    if (!inFile.has(rid)) warn(`rules (${r.name}).related`, `"${rid.split(':')[1]}" isn't in this file; it will link once that book is imported.`);
  }));

  const amendments: Amendment[] = [];
  (f.amendments ?? []).forEach((a, i) => {
    const p = `amendments[${i}]`;
    if (!str(a?.rule)) return err(`${p}.rule`, 'Required: the rule name this changes.');
    if (!AMEND.includes(a.type)) return err(`${p}.type`, `Must be one of: ${AMEND.join(', ')}.`);
    if (a.type === 'delete' && !str(a.find)) err(`${p}.find`, 'Delete needs the text to remove.');
    if ((a.type === 'replace' || a.type === 'insert') && !str(a.text)) err(`${p}.text`, 'Needs the new text.');
    if (a.type === 'clarification' && !str(a.text)) err(`${p}.text`, 'Needs the answer.');
    amendments.push({
      id: `${sourceId}#${i}`, ruleId: ruleIdFor(a.rule, a.faction), sourceId, page: pageStr(a.page),
      type: a.type, find: a.find, text: a.text, question: a.question,
      alsoRuleIds: a.alsoRules?.map((n) => ruleIdFor(parseRuleRef(n).name)), updatedAt: now,
    });
    if (a.alsoRules && a.type !== 'clarification') warn(`${p}.alsoRules`, 'Only used for clarifications (Q&As).');
  });
  if (amendments.length && !['faq', 'errata', 'download'].includes(f.source?.kind))
    warn('amendments', 'Amendments usually come from an FAQ, errata or download source.');

  const entities: Entity[] = [];
  const seenEntity = new Set<string>();
  (f.entities ?? []).forEach((e, i) => {
    const p = `entities[${i}]`;
    if (!str(e?.name)) return err(`${p}.name`, 'Required.');
    const at = `${p} (${e.name})`;
    if (!ENTITY_TYPES.includes(e.type)) err(`${at}.type`, `Must be one of: ${ENTITY_TYPES.join(', ')}.`);
    if (!e.profiles && !Array.isArray(e.rules)) return err(`${at}.rules`, 'Needs a list, e.g. ["Rending (4+)", "Deep Strike"]; use [] for none.');
    if (e.wargear !== undefined && !Array.isArray(e.wargear)) return err(`${at}.wargear`, 'Needs a list of weapon/wargear names.');
    if (e.profiles !== undefined && (!Array.isArray(e.profiles) || e.profiles.length === 0)) return err(`${at}.profiles`, 'Needs at least one profile line.');
    if (e.swaps !== undefined && !Array.isArray(e.swaps)) return err(`${at}.swaps`, 'Needs a list of swaps.');
    (e.options ?? []).forEach((o, j) => {
      if (typeof o !== 'string' && !str(o?.name)) err(`${at}.options[${j}].name`, 'Needs the option text.');
    });
    (e.swaps ?? []).forEach((sw, j) => {
      if (!str(sw?.replaces)) err(`${at}.swaps[${j}].replaces`, 'Needs the item being swapped, e.g. "Heavy bolter".');
      if (!Array.isArray(sw?.choices) || sw.choices.length === 0) err(`${at}.swaps[${j}].choices`, 'Needs at least one choice.');
    });
    const id = ids.entity(editionId, e.name, e.faction);
    if (seenEntity.has(id)) return err(at, 'Duplicate entry in this file.');
    seenEntity.add(id);

    const toRefs = (list: string[] = []) => list.map((s) => {
      const { name, value } = parseRuleRef(s);
      return { ruleId: ruleIdFor(name), value };
    });
    const uniq = (xs: { ruleId: string; value?: string }[]) => [...new Map(xs.map((r) => [r.ruleId + '|' + (r.value ?? ''), r])).values()];
    const toStats = (st: ImportEntity['stats']) => Array.isArray(st)
      ? st.map((x) => ({ label: String(x.label), value: statText(x.value) }))
      : Object.entries(st ?? {}).map(([label, value]) => ({ label, value: statText(value) }));
    // Type links to the rule of the same name; sub-types to "<name> Sub-Type" (so Heavy Sub-Type never collides with Heavy (X)).
    const typeIdsOf = (unitType?: string, subTypes: string[] = []) => [
      ...(unitType ? [ruleIdFor(unitType)] : []),
      ...subTypes.map((n) => ruleIdFor(/sub-type$/i.test(n) ? n : `${n} Sub-Type`)),
    ];

    const profiles = e.profiles?.map((pr, j) => {
      const pat = `${at}.profiles[${j}]`;
      if (!Array.isArray(pr?.names) || pr.names.length === 0) err(`${pat}.names`, 'Needs the entry name(s) this profile line belongs to.');
      if (!Array.isArray(pr?.rules)) err(`${pat}.rules`, 'Needs a list of special rules; use [] for none.');
      const pRules = toRefs(pr?.rules ?? []);
      const pTraits = toRefs(pr?.traits ?? []);
      const pTypes = typeIdsOf(pr?.unitType, pr?.subTypes ?? []);
      return {
        names: pr?.names ?? [], stats: toStats(pr?.stats), rules: pRules, traits: pTraits,
        ruleIds: [...new Set([...pRules.map((r) => r.ruleId), ...pTraits.map((r) => r.ruleId), ...pTypes])],
        unitType: pr?.unitType, subTypes: pr?.subTypes ?? [],
        wargearIds: (pr?.wargear ?? []).map((n) => ids.entity(editionId, n)),
      };
    });

    const topRules = toRefs(e.rules ?? []);
    const topTraits = toRefs(e.traits ?? []);
    const topTypes = typeIdsOf(e.unitType, e.subTypes ?? []);
    const refs = uniq([...topRules, ...(profiles ? profiles.flatMap((p) => p.rules) : [])]);
    entities.push({
      id, editionId, sourceId, name: e.name, aliases: e.aliases?.length ? e.aliases : undefined, type: e.type, faction: e.faction, page: pageStr(e.page),
      unitType: e.unitType, subTypes: e.subTypes ?? [], role: e.role,
      stats: profiles ? [] : toStats(e.stats), keywords: e.keywords ?? [], notes: e.notes,
      rules: refs,
      ruleIds: [...new Set([
        ...refs.map((r) => r.ruleId), ...topTypes, ...topTraits.map((r) => r.ruleId),
        ...(profiles ? profiles.flatMap((p) => p.ruleIds) : []),
      ])],
      wargearIds: [...new Set([
        ...(e.wargear ?? []).map((n) => ids.entity(editionId, n)),
        ...(profiles ? profiles.flatMap((p) => p.wargearIds) : []),
      ])],
      traits: topTraits, profiles, additionalNotes: e.additionalNotes,
      options: (e.options ?? []).map((o) => typeof o === 'string'
        ? { name: o }
        : { name: o.name, points: o.points, wargearId: o.wargear ? ids.entity(editionId, o.wargear) : undefined, profile: o.profile }),
      swaps: (e.swaps ?? []).map((sw) => ({
        replaces: sw.replaces, for: sw.for ?? [],
        choices: (sw.choices ?? []).map((c) => ({
          name: c.name, points: c.points,
          wargearId: c.wargear ? ids.entity(editionId, c.wargear) : undefined,
          profile: c.profile,
        })),
      })),
      composition: e.composition, points: e.points, updatedAt: now,
    });
  });

  if (!rules.length && !amendments.length && !entities.length) err('', 'Nothing to import: no rules, amendments or entities.');

  images.forEach((im) => { if (!rules.some((r) => printings.some((p) => p.imageIds?.includes(im.id)))) warn(`images (${im.id})`, 'No rule points at this picture, so it won\'t show.'); });
  return { system, edition, source, rules, printings, amendments, entities, images, errors, warnings };
}

// CSV: one rule per row. Columns: name,category,aliases,parameters,phase,summary,fullText,page,tags,related,faction,overrides
// Lists use "|" (e.g. aliases "FNP|Feel No Pain"); parameters as "X:number|Y:distance".
// Source details come from the import screen (or a header row "#source,title,kind,published,version,isCore,system,edition").
export function csvToImport(csv: string, meta?: Partial<ImportFile>): unknown {
  const rows = parseCsv(csv);
  let header = rows.shift() ?? [];
  const out: ImportFile = { ...(meta as ImportFile), format: FORMAT, rules: [] };
  if (header[0] === '#source') {
    const [, title, kind, published, version, isCore, system, edition] = header;
    out.source = { title, kind: kind as SourceKind, published, version: version || undefined, isCore: isCore === 'true' };
    out.system = { name: system };
    out.edition = { name: edition };
    header = rows.shift() ?? [];
  }
  const col = (name: string) => header.indexOf(name);
  const list = (v?: string) => (v ? v.split('|').map((s) => s.trim()).filter(Boolean) : undefined);
  for (const r of rows) {
    if (!r.some((c) => c.trim())) continue;
    const g = (n: string) => (col(n) >= 0 ? r[col(n)]?.trim() || undefined : undefined);
    out.rules!.push({
      name: g('name') ?? '', category: g('category') ?? '', aliases: list(g('aliases')),
      parameters: list(g('parameters'))?.map((s) => {
        const [name, kind] = s.split(':');
        return { name, kind: (kind ?? 'number') as RuleParam['kind'] };
      }),
      phase: g('phase'), summary: g('summary'), fullText: g('fullText'), page: g('page'),
      tags: list(g('tags')), related: list(g('related')), faction: g('faction'), overrides: g('overrides'),
    });
  }
  return out;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
