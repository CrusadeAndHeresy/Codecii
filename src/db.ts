import Dexie, { type Table } from 'dexie';
import type { Army } from './army';
import type { Amendment, EditLogEntry, Edition, Entity, GameSystem, LibImage, Printing, Rule, Source } from './model';

export class LibraryDB extends Dexie {
  systems!: Table<GameSystem, string>;
  editions!: Table<Edition, string>;
  sources!: Table<Source, string>;
  rules!: Table<Rule, string>;
  printings!: Table<Printing, string>;
  amendments!: Table<Amendment, string>;
  entities!: Table<Entity, string>;
  editLog!: Table<EditLogEntry, number>;
  images!: Table<LibImage, string>;
  armies!: Table<Army, string>;
  meta!: Table<{ key: string; value: unknown }, string>;

  constructor(name = 'rules-library') {
    super(name);
    this.version(1).stores({
      systems: 'id, updatedAt',
      editions: 'id, systemId, updatedAt',
      sources: 'id, editionId, updatedAt',
      rules: 'id, editionId, normName, overridesRuleId, supersedes, updatedAt',
      printings: 'id, ruleId, sourceId, status, updatedAt',
      amendments: 'id, ruleId, sourceId, updatedAt',
      entities: 'id, editionId, sourceId, *ruleIds, updatedAt',
      editLog: '++seq, recordId, at',
      meta: 'key',
    });
    this.version(2).stores({
      amendments: 'id, ruleId, sourceId, *alsoRuleIds, updatedAt',
      entities: 'id, editionId, sourceId, *ruleIds, *wargearIds, name, updatedAt',
    }).upgrade(async (tx) => {
      // v1 entities had per-source ids and no profile fields: clear them; re-import the books to restore.
      await tx.table('entities').clear();
    });
    this.version(3).stores({
      images: 'id, sourceId',
    });
    this.version(4).stores({
      armies: 'id, editionId, updatedAt',
    });
  }
}

export const db = new LibraryDB();
