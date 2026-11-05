import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createMatchStore } from '../scripts/match-store.ts'

test('room and rewards persist atomically and repeating a completed match never duplicates coins', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ccl-ledger-'))
  const path = join(directory, 'match.sqlite')
  try {
    const store = createMatchStore(path)
    const reward = { match: 'room/1', token: 'server-issued-account-secret', coins: 30, xp: 40 }
    store.commit('room', '{"match":1,"phase":"complete"}', [reward])
    store.commit('room', '{"match":1,"phase":"complete"}', [], { id: 'room/1/1', value: '{"runs":4}' })
    assert.throws(() => store.commit('room', 'tampered', [], { id: 'room/1/1', value: '{"runs":6}' }), /Sealed delivery changed/)
    store.commit('room', '{"match":1,"phase":"complete"}', [reward])
    assert.deepEqual(store.wallet(reward.token), { coins: 30, xp: 40 })
    assert.throws(() => store.commit('room', 'broken', [{ ...reward, match: 'room/2', coins: -1 }]))
    assert.equal(store.load()[0].state, '{"match":1,"phase":"complete"}')
    store.close()
    const reopened = createMatchStore(path)
    assert.deepEqual(reopened.wallet(reward.token), { coins: 30, xp: 40 })
    reopened.commit('room', '{"match":2}', [{ ...reward, match: 'room/2' }])
    assert.deepEqual(reopened.wallet(reward.token), { coins: 60, xp: 80 })
    reopened.close()
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
