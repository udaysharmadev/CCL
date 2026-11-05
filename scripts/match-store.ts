import { createHash } from 'node:crypto'
import { closeSync, existsSync, openSync, chmodSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

export type Award = { match: string; token: string; coins: number; xp: number }

export function createMatchStore(path: string) {
  if (path !== ':memory:') {
    if (!existsSync(path)) closeSync(openSync(path, 'wx', 0o600))
    chmodSync(path, 0o600)
  }
  const db = new DatabaseSync(path)
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS delivery_events (
      id TEXT PRIMARY KEY,
      event TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rewards (
      match_id TEXT NOT NULL,
      account TEXT NOT NULL,
      coins INTEGER NOT NULL CHECK(coins >= 0),
      xp INTEGER NOT NULL CHECK(xp >= 0),
      PRIMARY KEY(match_id, account)
    );
    CREATE INDEX IF NOT EXISTS rewards_account ON rewards(account);
  `)
  const account = (token: string) => createHash('sha256').update(token).digest('hex')
  const roomStatement = db.prepare('INSERT INTO rooms(id,state) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state')
  const rewardStatement = db.prepare('INSERT OR IGNORE INTO rewards(match_id,account,coins,xp) VALUES (?,?,?,?)')
  const walletStatement = db.prepare('SELECT COALESCE(SUM(coins),0) coins, COALESCE(SUM(xp),0) xp FROM rewards WHERE account=?')
  return {
    register(token: string) { db.prepare('INSERT OR IGNORE INTO accounts(id) VALUES (?)').run(account(token)) },
    knows(token: string) { return Boolean(db.prepare('SELECT id FROM accounts WHERE id=?').get(account(token))) },
    load() {
      return db.prepare('SELECT id,state FROM rooms').all().map((row) => ({ id: String(row.id), state: String(row.state) }))
    },
    commit(id: string, state: string, awards: Award[] = [], event?: { id: string; value: string }) {
      db.exec('BEGIN IMMEDIATE')
      try {
        roomStatement.run(id, state)
        if (event) {
          const recorded = db.prepare('SELECT event FROM delivery_events WHERE id=?').get(event.id)
          if (recorded && recorded.event !== event.value) throw new Error('Sealed delivery changed')
          db.prepare('INSERT OR IGNORE INTO delivery_events(id,event) VALUES (?,?)').run(event.id, event.value)
        }
        for (const award of awards) {
          if (!Number.isSafeInteger(award.coins) || !Number.isSafeInteger(award.xp) || award.coins < 0 || award.xp < 0) {
            throw new Error('Invalid match reward')
          }
          rewardStatement.run(award.match, account(award.token), award.coins, award.xp)
        }
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
    remove(id: string) { db.prepare('DELETE FROM rooms WHERE id=?').run(id) },
    wallet(token: string) {
      const row = walletStatement.get(account(token))
      return { coins: Number(row?.coins ?? 0), xp: Number(row?.xp ?? 0) }
    },
    close() { db.close() },
  }
}
