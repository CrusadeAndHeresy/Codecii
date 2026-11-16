import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { LibraryDB } from './db';
import { planImport } from './importer';
import { applyImport } from './store';
import { buildEditionIndex } from './search';

describe('filter groups', () => {
  it('splits rules into Rules, Missions and Detachments', async () => {
    const db = new LibraryDB('scope-test');
    const f = { format: 'rules-library/v1', system: { name: 'Scope' }, edition: { name: '1' },
      source: { title: 'S', kind: 'rulebook', isCore: true, published: '2026-01-01' },
      rules: [
        { name: 'Rending', category: 'Special Rule', fullText: 'Rend.' },
        { name: 'Search and Destroy', category: 'Deployment Map', fullText: 'Map.' },
        { name: 'Pride of the Legion', category: 'Primary Detachment', fullText: 'Det.' },
      ] };
    await applyImport(db, planImport(f));
    const ix = await buildEditionIndex(db, 'scope@1');
    const ids = (s?: { cats?: string[]; notCats?: string[] }) => ix.list(ix.books[0].id, ['rule'], undefined, s).map((h) => h.name).sort();
    expect(ids({ notCats: ['Deployment Map', 'Primary Detachment'] })).toEqual(['Rending']);
    expect(ids({ cats: ['Deployment Map'] })).toEqual(['Search and Destroy']);
    expect(ids({ cats: ['Primary Detachment'] })).toEqual(['Pride of the Legion']);
  });
});
