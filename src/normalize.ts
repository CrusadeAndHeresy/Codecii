export function normName(s: string): string {
  return s
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/\s*\([^)]*\)\s*$/, '') // drop trailing parameter: "Rending (X)" → "rending"
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function slug(s: string): string {
  return normName(s).replace(/ /g, '-') || 'x';
}

// "Rending (4+)" → { name: "Rending", value: "4+" }
export function parseRuleRef(s: string): { name: string; value?: string } {
  const m = s.trim().match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  if (m && m[1]) return { name: m[1].trim(), value: m[2].trim() };
  return { name: s.trim() };
}

export function hashText(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim().toLowerCase();
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

export const ids = {
  system: (name: string) => slug(name),
  edition: (systemId: string, name: string) => `${systemId}@${slug(name)}`,
  source: (editionId: string, title: string, version?: string) =>
    `${editionId}/${slug(title)}${version ? '-v' + slug(version) : ''}`,
  rule: (editionId: string, name: string, faction?: string) =>
    `${editionId}:${slug(name)}${faction ? '~' + slug(faction) : ''}`,
  printing: (ruleId: string, sourceId: string) => `${ruleId}|${sourceId}`,
  entity: (editionId: string, name: string, faction?: string) => `${editionId}#${slug(name)}${faction ? '~' + slug(faction) : ''}`,
};
