import { describe, expect, it } from 'vitest';
import { checkBooks, decodePack, encodePack, expired, type GamePack } from './pack';
import { buildArmy, makeLookup } from './army';

const army = (name: string, n: number) => buildArmy({
  name, units: Array.from({ length: n }, (_, i) => ({ name: `Test Squad ${i}`, models: 5 + (i % 6), pts: 100 + i * 7, details: ['bolter', `Sergeant: power sword ${i}`, '2× melta bombs'] })),
}, { editionId: 'hh@3', units: [], look: makeLookup([], []) });
const game: GamePack = { v: 1, type: 'game', editionId: 'hh@3', createdAt: 1000, books: [{ id: 'b', title: 'Book', published: '2026-01-01' }], host: army('A', 15), guest: army('B', 15) };

describe('game packs', () => {
  it('round-trips and fits in one QR code', async () => {
    const code = await encodePack(game);
    console.log('two 15-unit lists, code length:', code.length);
    expect(await decodePack(code)).toEqual(JSON.parse(JSON.stringify(game)));
    expect(code.length).toBeLessThan(2900);
  });
  it('rejects other codes and malformed packs', async () => {
    await expect(decodePack('https://example.com')).rejects.toThrow();
    await expect(decodePack('CDC1.garbage')).rejects.toThrow();
    await expect(decodePack(await encodePack({ ...game, host: { name: 'x' } } as never))).rejects.toThrow();
    await expect(decodePack(await encodePack({ ...game, pad: 'a'.repeat(299_000), host: { ...game.host, name: 'b'.repeat(900) } } as never))).rejects.toThrow();
  });
  it('flags missing or different books and expiry', () => {
    expect(checkBooks(game.books, [])).toHaveLength(1);
    expect(checkBooks(game.books, [{ id: 'b', editionId: 'hh@3', title: 'Book', kind: 'rulebook', isCore: true, published: '2026-02-01', updatedAt: 0 }])[0]).toMatch(/different version/);
    expect(expired(game, 1000 + 25 * 3600_000)).toBe(true);
  });
});
