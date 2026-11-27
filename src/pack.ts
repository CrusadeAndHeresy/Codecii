// Game packs for two players: a list or a whole game as a short text code (shown as a QR).
// Only references and names travel. Rules text is never included: each device reads it from its own library.
import type { Army, ArmyCopy, ArmyUnit } from './army';
import type { Source } from './model';

export type Book = { id: string; title: string; version?: string; published: string };
export interface ListPack { v: 1; type: 'list'; editionId: string; books: Book[]; army: Army }
export interface GamePack {
  v: 1; type: 'game'; editionId: string; books: Book[]; createdAt: number;
  mission?: { ruleId: string; name: string };
  host: Army; guest: Army;
}
export type Pack = ListPack | GamePack;

const PREFIX = 'CDC1.';
const MAX_CODE = 40_000;
const MAX_JSON = 300_000;
export const GAME_LIFE_MS = 24 * 60 * 60 * 1000;
export const expired = (g: GamePack, now = Date.now()) => now - g.createdAt > GAME_LIFE_MS;

// Reading notes and file names stay on the phone that made the list.
export function trimArmy(a: Army): Army {
  return { id: a.id, editionId: a.editionId, name: a.name, createdAt: 0, updatedAt: 0, total: a.total, notes: [], units: a.units };
}

export function booksFor(ids: Iterable<string>, sources: Source[]): Book[] {
  const want = new Set(ids);
  return sources.filter((s) => want.has(s.id)).map((s) => ({ id: s.id, title: s.title, version: s.version, published: s.published }));
}

export function mergeBooks(...lists: Book[][]): Book[] {
  return [...new Map(lists.flat().map((b) => [b.id, b])).values()];
}

// What to warn about: books the pack needs that are absent here, or dated differently.
export function checkBooks(books: Book[], local: Source[]): string[] {
  const by = new Map(local.map((s) => [s.id, s]));
  return books.flatMap((b) => {
    const s = by.get(b.id);
    const label = `${b.title}${b.version ? ' v' + b.version : ''}`;
    if (!s) return [`You don’t have ${label}.`];
    if ((s.version ?? '') !== (b.version ?? '') || s.published !== b.published) return [`Your copy of ${b.title} is a different version (theirs is dated ${b.published}, yours ${s.published}).`];
    return [];
  });
}

async function pipe(bytes: Uint8Array, stream: ReadableWritablePair<Uint8Array, BufferSource>, limit: number): Promise<Uint8Array> {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(stream).getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); throw new Error('That code is too large.'); }
    chunks.push(value);
  }
  const out = new Uint8Array(size); let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

export async function encodePack(p: Pack): Promise<string> {
  const bytes = await pipe(new TextEncoder().encode(JSON.stringify(p)), new CompressionStream('deflate-raw'), MAX_JSON);
  let bin = ''; bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return PREFIX + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// A scanned code is someone else's data: check its shape before the app uses it.
const str = (x: unknown) => typeof x === 'string';
const optStr = (x: unknown) => x === undefined || str(x);
const obj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const okCopy = (c: unknown) => obj(c) && str(c.id) && typeof c.models === 'number' && optStr(c.legion)
  && Array.isArray(c.gear) && (c.gear as unknown[]).every((g) => obj(g) && str(g.name) && str(g.kind) && optStr(g.label) && optStr(g.forModel));
const okUnit = (u: unknown) => obj(u) && str(u.id) && str(u.listName) && optStr(u.entityId) && optStr(u.slot) && optStr(u.roleOverride)
  && Array.isArray(u.copies) && (u.copies as ArmyCopy[]).every(okCopy);
const okArmy = (a: unknown) => obj(a) && str(a.name) && Array.isArray(a.notes) && Array.isArray(a.units) && (a.units as ArmyUnit[]).every(okUnit);
const okBook = (b: unknown) => obj(b) && str(b.id) && str(b.title) && str(b.published) && optStr(b.version);

export async function decodePack(code: string): Promise<Pack> {
  const text = code.trim();
  const bad = new Error('That isn’t a Codecii list or game code.');
  if (!text.startsWith(PREFIX) || text.length > MAX_CODE) throw bad;
  let p: unknown;
  try {
    const bin = atob(text.slice(PREFIX.length).replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    p = JSON.parse(new TextDecoder().decode(await pipe(bytes, new DecompressionStream('deflate-raw'), MAX_JSON)));
  } catch { throw bad; }
  if (!obj(p) || p.v !== 1 || !str(p.editionId) || !Array.isArray(p.books) || !p.books.every(okBook)) throw bad;
  if (p.type === 'list' && okArmy(p.army)) return p as unknown as ListPack;
  if (p.type === 'game' && typeof p.createdAt === 'number' && okArmy(p.host) && okArmy(p.guest)
    && (p.mission === undefined || (obj(p.mission) && str(p.mission.ruleId) && str(p.mission.name)))) return p as unknown as GamePack;
  throw bad;
}
