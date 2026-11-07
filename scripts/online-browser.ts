import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright-core'
import { build, preview } from 'vite'
import { Delivery, DT } from '../src/cricket.ts'
import { ONLINE_WINDUP_MS, type OnlineServerMessage, type OnlineSnapshot } from '../src/online-contract.ts'
import { startOnlineServer } from './online-server.ts'

let now = 1000
const host = await startOnlineServer({ clock: () => now, toss: () => 0, nextSeed: () => 41 })
const outDir = await mkdtemp(join(tmpdir(), 'ccl-online-browser-'))
let server: Awaited<ReturnType<typeof preview>> | undefined
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined

async function snapshot(messages: OnlineServerMessage[], check: (state: OnlineSnapshot) => boolean) {
  const until = performance.now() + 10_000
  while (performance.now() < until) {
    const next = messages.findLast((message) => message.type === 'snapshot' && check(message.state))
    if (next?.type === 'snapshot') return next.state
    await delay(20)
  }
  throw new Error('The browser did not receive its expected match state')
}

try {
  const bundle = { configLoader: 'native', build: { outDir, emptyOutDir: true }, logLevel: 'error' } as const
  await build({
    ...bundle,
    define: { 'import.meta.env.VITE_CCL_ONLINE_URL': JSON.stringify(host.url) },
  })
  server = await preview({ ...bundle, preview: { host: '127.0.0.1', port: 0, strictPort: true } })
  const address = server.httpServer.address()
  assert.ok(address && typeof address !== 'string')
  const url = `http://127.0.0.1:${address.port}/`
  const serviceUrl = host.url.replace('ws:', 'http:').replace('/online', '/health')
  assert.equal((await (await fetch(serviceUrl)).json()).status, 'ok')
  const args = ['--ignore-gpu-blocklist', '--enable-webgl']
  if (process.platform === 'darwin' && process.env.CCL_CHROME_PATH) args.push('--use-angle=metal')
  const chrome = await chromium.launch({
    executablePath: process.env.CCL_CHROME_PATH,
    args: process.env.CCL_SOFTWARE_GPU === '1'
      ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
      : args,
  })
  browser = chrome
  const errors: string[] = []

  async function client(destination = url) {
    const context = await chrome.newContext({ viewport: { width: 907, height: 510 }, deviceScaleFactor: 1 })
    const page = await context.newPage()
    const messages: OnlineServerMessage[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('websocket', (socket) => {
      if (socket.url() !== host.url) return
      socket.on('framereceived', ({ payload }) => {
        if (typeof payload === 'string') messages.push(JSON.parse(payload))
      })
    })
    await page.goto(destination)
    return { context, page, messages }
  }

  const first = await client()
  await first.page.getByRole('button', { name: 'Online', exact: true }).click()
  await first.page.getByRole('button', { name: 'Quick 1v1' }).click()
  await first.page.getByRole('heading', { name: 'Finding opponent' }).waitFor()
  const waiting = await snapshot(first.messages, (state) => state.phase === 'lobby')
  assert.deepEqual(waiting.connected, [true, false])
  assert.equal(waiting.overs, 5)

  const second = await client()
  await second.page.getByRole('button', { name: 'Online', exact: true }).click()
  await second.page.getByRole('button', { name: 'Quick 1v1' }).click()
  await second.page.getByRole('heading', { name: 'Opponent won the toss' }).waitFor()
  await first.page.getByRole('button', { name: 'Bat first' }).click()
  await second.page.getByRole('button', { name: 'Bowl', exact: true }).click()
  const windup = await snapshot(first.messages, (state) => state.phase === 'windup')
  assert.equal(windup.room, waiting.room)

  now += ONLINE_WINDUP_MS
  const released = await snapshot(first.messages, (state) => state.phase === 'flight')
  assert.ok(released.active)
  await first.page.locator('#timing').waitFor()
  now += new Delivery(released.active.options).contactTick * DT * 1000 + 0.1
  await first.page.keyboard.press('Space')
  await snapshot(first.messages, (state) => Boolean(state.active?.shot))
  now += 12_000
  const result = await snapshot(first.messages, (state) => state.delivery === 2)
  assert.ok(result.last?.replay.shot)
  assert.equal(result.score.legalBalls, 1)
  assert.ok(result.score.runs > 0, 'A timed browser swing should reach the server and score')
  assert.deepEqual(result, await snapshot(second.messages, (state) => state.delivery === 2))
  for (const { page } of [first, second]) {
    await page.locator('#overs').filter({ hasText: /^0\.1$/ }).waitFor()
    assert.equal(await page.locator('#score').textContent(), `${result.score.runs}/${result.score.wickets}`)
  }

  first.messages.length = 0
  await first.page.reload()
  const recovered = await snapshot(first.messages, (state) => state.phase === 'ready' && state.delivery === 2)
  assert.equal(recovered.room, waiting.room)
  assert.deepEqual(recovered.score, result.score)
  await first.context.close()
  await second.context.close()

  const privateHost = await client()
  await privateHost.page.getByRole('button', { name: 'Online', exact: true }).click()
  await privateHost.page.locator('#private-overs').fill('2')
  await privateHost.page.getByRole('button', { name: 'Create private room' }).click()
  const privateRoom = await snapshot(privateHost.messages, (state) => state.phase === 'lobby')
  const invite = await privateHost.page.getByLabel('Invite link').inputValue()
  assert.equal(new URL(invite).searchParams.get('room'), privateRoom.room)
  const guest = await client(invite)
  await guest.page.getByRole('heading', { name: 'Private room' }).waitFor()
  await privateHost.page.getByLabel('Room ground', { exact: true }).selectOption('harbor')
  await privateHost.page.getByRole('button', { name: 'Apply room setup' }).click()
  await snapshot(privateHost.messages, (state) => state.settingsVersion === 2)
  await privateHost.page.getByRole('button', { name: 'Approve XI & ready' }).click()
  await guest.page.getByRole('button', { name: 'Approve XI & ready' }).click()
  await guest.page.getByRole('heading', { name: 'Opponent won the toss' }).waitFor()
  const joined = await snapshot(guest.messages, (state) => state.phase === 'toss')
  assert.equal(joined.room, privateRoom.room)
  assert.equal(joined.mode, 'private')
  assert.equal(joined.overs, 2)
  await privateHost.page.getByRole('button', { name: 'Bat first' }).click()
  await guest.page.locator('#line').fill('0.7')
  await guest.page.locator('#line').dispatchEvent('input')
  for (let attempt = 1; attempt <= 12; attempt++) {
    await guest.page.getByRole('button', { name: 'Bowl', exact: true }).click()
    await snapshot(guest.messages, (state) => state.phase === 'windup' && state.delivery === attempt)
    now += ONLINE_WINDUP_MS + 12_000
    const settled = await snapshot(guest.messages, (state) => state.delivery === attempt + 1)
    assert.equal(settled.last?.delivery, attempt)
  }
  const chase = await snapshot(privateHost.messages, (state) => state.innings === 2)
  assert.equal(chase.firstInnings?.score.legalBalls, 12)
  assert.equal(chase.firstInnings?.score.runs, 0)
  assert.equal(chase.score.target, 1)
  assert.equal(chase.battingSeat, 1)
  await privateHost.page.getByRole('button', { name: 'Bowl', exact: true }).waitFor()
  await privateHost.page.locator('#line').fill('1.4')
  await privateHost.page.locator('#line').dispatchEvent('input')
  await privateHost.page.getByRole('button', { name: 'Bowl', exact: true }).click()
  await snapshot(privateHost.messages, (state) => state.phase === 'windup' && state.delivery === 13)
  now += ONLINE_WINDUP_MS + 12_000
  const finished = await snapshot(privateHost.messages, (state) => state.phase === 'complete')
  assert.equal(finished.result?.winner, 1)
  assert.equal(finished.score.runs, 1)
  assert.equal(finished.score.legalBalls, 0)
  await privateHost.page.getByRole('heading', { name: 'Opponent wins' }).waitFor()
  await guest.page.getByRole('heading', { name: 'You win' }).waitFor()
  for (const { page } of [privateHost, guest]) {
    assert.match(await page.locator('#overlay-scores').textContent() ?? '', /0\/0.*1\/0/)
    assert.equal(await page.locator('#coins').textContent(), page === guest.page ? '30' : '15')
  }
  await privateHost.page.getByRole('button', { name: 'Rematch', exact: true }).click()
  await guest.page.getByRole('button', { name: 'Rematch', exact: true }).click()
  const rematched = await snapshot(privateHost.messages, (state) => state.match === 2)
  assert.equal(rematched.room, privateRoom.room)
  assert.equal(rematched.phase, 'lobby')
  assert.deepEqual(rematched.wallets, finished.wallets)
  await privateHost.page.getByRole('heading', { name: 'Private room' }).waitFor()
  assert.deepEqual(errors, [])
  console.log('Online browser smoke passed: two Chromium clients, toss, server-scored swing, reconnect, private invite, innings change and full match result.')
} finally {
  await browser?.close()
  await server?.close()
  await host.close()
  await rm(outDir, { recursive: true, force: true })
}
