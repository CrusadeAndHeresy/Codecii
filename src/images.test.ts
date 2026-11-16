import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { LibraryDB } from './db';
import { planImport } from './importer';
import { applyImport, removeSource, resolveById } from './store';

const PNG = 'iVBORw0KGgo='; // tiny placeholder bytes, valid base64
const file = (over: Record<string, unknown> = {}) => ({
  format: 'rules-library/v1', system: { name: 'Pic Test' }, edition: { name: '1' },
  source: { title: 'Pack', kind: 'supplement', isCore: false, published: '2026-11-04' },
  images: [{ id: 'map-a', kind: 'board-layout', caption: 'Deployment Map: A', page: '4', mimeType: 'image/png', data: PNG }],
  rules: [{ name: 'Search and Destroy', category: 'Deployment Map', page: '4', fullText: 'Text.', images: ['map-a'] }],
  ...over,
});

describe('images', () => {
  it('stores a picture and links the rule printing to it', async () => {
    const plan = planImport(file());
    expect(plan.errors).toEqual([]);
    expect(plan.images[0].id).toBe(plan.source.id + '#map-a');
    expect(plan.printings[0].imageIds).toEqual([plan.source.id + '#map-a']);
  });

  it('reports a rule that points at a missing picture', () => {
    const plan = planImport(file({ rules: [{ name: 'X', category: 'Rule', fullText: 't', images: ['nope'] }] }));
    expect(plan.errors.length).toBe(1);
    expect(plan.errors[0].message).toMatch(/isn't in this file/);
  });

  it('rejects a bad kind, bad base64 and oversize data', () => {
    expect(planImport(file({ images: [{ id: 'a', kind: 'photo', caption: 'c', mimeType: 'image/png', data: PNG }] })).errors[0].message).toMatch(/board-layout/);
    expect(planImport(file({ images: [{ id: 'a', kind: 'board-layout', caption: 'c', mimeType: 'image/png', data: 'data:image/png;base64,AAAA' }] })).errors[0].message).toMatch(/base64/);
    const big = 'A'.repeat(2_100_000);
    expect(planImport(file({ images: [{ id: 'a', kind: 'board-layout', caption: 'c', mimeType: 'image/png', data: big }] })).errors[0].message).toMatch(/limit/);
  });

  it('re-importing replaces the pictures of that source only; removing a book removes its pictures', async () => {
    const db = new LibraryDB('images-test');
    await applyImport(db, planImport(file()));
    expect(await db.images.count()).toBe(1);
    await applyImport(db, planImport(file({ images: [] , rules: [{ name: 'Search and Destroy', category: 'Deployment Map', fullText: 'Text.' }] })));
    expect(await db.images.count()).toBe(0);
    await applyImport(db, planImport(file()));
    const sid = planImport(file()).source.id;
    const r = await resolveById(db, planImport(file()).rules[0].id);
    expect(r?.current?.printing.imageIds).toEqual([sid + '#map-a']);
    await removeSource(db, sid);
    expect(await db.images.count()).toBe(0);
  });
});
