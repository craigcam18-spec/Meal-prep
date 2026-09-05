/**
 * A D1-shaped wrapper around node:sqlite, so the tests can run the real
 * queries.
 *
 * D1 is SQLite with a promise API bolted on, which means src/recipes-store.js
 * can run unchanged against an in-memory database here — the SQL in it is
 * exercised by `npm test` rather than only ever in production. The surface
 * copied is the part that module uses: prepare, bind, all, and batch.
 */

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const isSelect = (sql) => /^\s*select/i.test(sql);

class Statement {
  constructor(db, sql, params) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  /** D1 returns a new bound statement rather than mutating this one. */
  bind(...params) {
    return new Statement(this.db, this.sql, params);
  }

  async all() {
    const statement = this.db.prepare(this.sql);
    if (isSelect(this.sql)) {
      return { results: statement.all(...this.params), meta: { changes: 0 } };
    }
    const info = statement.run(...this.params);
    return { results: [], meta: { changes: Number(info.changes) } };
  }
}

class Database {
  constructor() {
    this.db = new DatabaseSync(':memory:');
    // D1 enforces foreign keys; node:sqlite does not unless told to. Matching
    // it means a test would catch an insert that orphans its parent.
    this.db.exec('PRAGMA foreign_keys = ON');
  }

  prepare(sql) {
    return new Statement(this.db, sql, []);
  }

  /** One transaction, all or nothing, like D1's own batch. */
  async batch(statements) {
    this.db.exec('BEGIN');
    try {
      const out = [];
      for (const statement of statements) out.push(await statement.all());
      this.db.exec('COMMIT');
      return out;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  exec(sql) {
    this.db.exec(sql);
  }
}

/** A fresh database with db/schema.sql applied, plus any extra SQL files. */
export function freshDatabase(...sqlFiles) {
  const db = new Database();
  for (const name of ['schema.sql', ...sqlFiles]) {
    db.exec(readFileSync(new URL(`../db/${name}`, import.meta.url), 'utf8'));
  }
  return db;
}
