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
  const bundle = { build: { outDir, emptyOutDir: true }, logLevel: 'error' } as const
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
  await first.page.getByLabel('Private overs').fill('2')
  await first.page.getByRole('button', { name: 'Duo Batting · bat together vs AI', exact: true }).click()
  await first.page.getByRole('heading', { name: 'Duo room', exact: true }).waitFor()
  const invite = await first.page.getByLabel('Invite link').inputValue()
  const second = await client(invite)
  await second.page.setViewportSize({ width: 800, height: 450 })
  await second.page.getByRole('heading', { name: 'Duo room', exact: true }).waitFor()
  for (const entry of [first, second]) await entry.page.getByRole('button', { name: 'Approve XI & ready' }).click()
  const clients = [first, second]
  let state: OnlineSnapshot = await snapshot(first.messages, (state) => state.phase === 'ready')
  assert.equal(state.mode, 'duo')
  assert.equal(state.tossWinner, null)

  const initialVersion = state.duoSwap?.version ?? 0
  const initialScore = state.score
  await first.page.getByRole('button', { name: 'Swap control', exact: true }).click()
  await second.page.getByRole('button', { name: 'Accept control swap', exact: true }).waitFor()
  const requested = await snapshot(first.messages, (state) => Boolean(state.duoSwap?.votes[0]))
  assert.equal(requested.battingSeat, 0)
  await first.page.getByRole('button', { name: 'Cancel swap request', exact: true }).click()
  await second.page.getByRole('button', { name: 'Swap control', exact: true }).waitFor()
  await first.page.getByRole('button', { name: 'Swap control', exact: true }).click()
  await second.page.getByRole('button', { name: 'Accept control swap', exact: true }).click()
  const swapped = await snapshot(first.messages, (state) => state.duoSwap?.version === initialVersion + 1)
  assert.equal(swapped.battingSeat, 1)
  assert.deepEqual(swapped.score, initialScore)
  await first.page.locator('#bat-controls').waitFor({ state: 'hidden' })
  await second.page.locator('#bat-controls').waitFor({ state: 'visible' })
  await second.page.getByRole('button', { name: 'Swap control', exact: true }).click()
  await first.page.getByRole('button', { name: 'Accept control swap', exact: true }).click()
  state = await snapshot(first.messages, (state) => state.duoSwap?.version === initialVersion + 2)
  assert.equal(state.battingSeat, 0)
  assert.deepEqual(state.score, initialScore)
  await first.page.screenshot({ path: '/tmp/ccl-duo-swap.png' })

  for (let delivery = 1; delivery <= 12; delivery++) {
    const seat: 0 | 1 = state.battingSeat === 1 ? 1 : 0
    const striker: typeof first = clients[seat]
    const partner: typeof first = clients[seat === 0 ? 1 : 0]
    await striker.page.getByRole('button', { name: 'Next ball', exact: true }).click()
    await snapshot(striker.messages, (state) => state.phase === 'windup' && state.delivery === delivery)
    now += ONLINE_WINDUP_MS
    const release = await snapshot(striker.messages, (state) => state.phase === 'flight' && state.delivery === delivery)
    assert.ok(release.active)
    assert.equal(await striker.page.getByRole('button', { name: 'Swap control', exact: true }).isVisible(), false)
    await striker.page.locator('#timing').waitFor()
    assert.equal(await partner.page.locator('#bat-controls').isVisible(), false)
    assert.equal(await partner.page.locator('#bowl-controls').isVisible(), false)
    if (delivery <= 3) {
      const modeButton = striker.page.locator(delivery === 2 ? '#loft-toggle' : '#defense-toggle')
      if (await modeButton.getAttribute('aria-pressed') !== 'true') await modeButton.click()
      const viewport = striker.page.viewportSize()
      await striker.page.mouse.move((viewport?.width ?? 907) / 2, 240)
      now += new Delivery(release.active.options).contactTick * DT * 1000 + .1
      await striker.page.keyboard.press('Space')
      const accepted = await snapshot(striker.messages, (state) => Boolean(state.active?.shot) && state.delivery === delivery)
      now += 6 * DT * 1000
      await snapshot(striker.messages, (state) => state.active?.phase === 'field' && state.delivery === delivery)
      if (delivery === 1) {
        await striker.page.getByRole('button', { name: 'Run / +1', exact: true }).click()
        await snapshot(striker.messages, (state) => state.active?.runs?.length === 1 && state.delivery === delivery)
      }
      if (delivery === 2) {
        await partner.page.getByRole('button', { name: 'Wait!', exact: true }).click()
        await snapshot(striker.messages, (state) => state.partnerCall?.call === 'wait')
        await striker.page.locator('#target-label').filter({ hasText: /WAIT/ }).waitFor()
        await striker.page.getByRole('button', { name: 'Run / +1', exact: true }).click()
        await snapshot(striker.messages, (state) => state.active?.runs?.length === 1)
        await striker.page.getByRole('button', { name: 'Run / +1', exact: true }).click()
        await snapshot(striker.messages, (state) => state.active?.runs?.length === 2)
        await striker.page.locator('#duo-role').filter({ hasText: 'RUNNING · 2 called' }).waitFor()
        await delay(300)
        assert.equal(await striker.page.locator('#duo-role').textContent(), 'RUNNING · 2 called', 'draw frames must not repeat queued commands')
        now += 100
        await striker.page.getByRole('button', { name: 'Turn back', exact: true }).click()
        await snapshot(striker.messages, (state) => state.active?.runs?.length === 3)
        await striker.page.screenshot({ path: '/tmp/ccl-duo-batting.png' })
        await partner.page.screenshot({ path: '/tmp/ccl-duo-partner.png' })
      }
      if (delivery === 3) {
        const forecast = new Delivery(release.active.options)
        while (!forecast.outcome && forecast.tick < 900) {
          if (forecast.tick === accepted.active?.shot?.tick) forecast.swing(accepted.active.shot.input)
          forecast.step()
        }
        assert.equal(forecast.outcome?.reason, 'fielded')
        const runTick = forecast.tick - 110
        now += (runTick - new Delivery(release.active.options).contactTick - 6) * DT * 1000
        await snapshot(striker.messages, (state) => state.active !== null && state.active.tick >= runTick && state.delivery === delivery)
        await striker.page.keyboard.press('r')
        await snapshot(striker.messages, (state) => state.active?.runs?.length === 1 && state.delivery === delivery)
        striker.messages.length = 0
        await striker.page.reload()
        await snapshot(striker.messages, (state) => Boolean(state.active?.runs?.length) && state.delivery === delivery)
        await striker.page.locator('#duo-role').filter({ hasText: 'RUNNING · 1 called' }).waitFor()
      }
    }
    now += 12000
    state = await snapshot(first.messages, (state) => state.last?.delivery === delivery)
    for (const entry of clients) {
      await entry.page.locator('#overs').filter({ hasText: new RegExp('^' + Math.floor(delivery / 6) + '\\.' + delivery % 6 + '$') }).waitFor()
      assert.equal(await entry.page.locator('#score').textContent(), state.score.runs + '/' + state.score.wickets)
    }
    if (delivery === 1) assert.equal(state.battingSeat, 1)
    if (delivery === 3) {
      assert.equal(state.last?.outcome.wicket, 'run-out')
      assert.equal(state.last?.outcome.dismissedBatter, 'nonStriker')
      assert.equal(state.score.striker, 3)
      assert.equal(state.battingSeat, 0)
      await striker.page.screenshot({ path: '/tmp/ccl-duo-run-out.png' })
    }
    if (delivery === 4) {
      first.messages.length = 0
      await first.page.reload()
      const restored = await snapshot(first.messages, (state) => state.delivery === 5)
      assert.equal(restored.mode, 'duo')
      assert.equal(restored.room, state.room)
    }
    if (delivery === 6) assert.equal(state.battingSeat, 1)
  }
  assert.equal(state.phase, 'complete')
  assert.equal(state.innings, 1)
  assert.equal(state.result?.reason, 'duo')
  assert.equal(state.score.runs, 7)
  assert.equal(state.score.wickets, 1)
  for (const entry of clients) {
    await entry.page.getByRole('heading', { name: 'Partnership complete', exact: true }).waitFor()
    assert.equal(await entry.page.locator('#coins').textContent(), '15')
  }
  await first.page.screenshot({ path: '/tmp/ccl-duo-result.png' })
  for (const entry of clients) await entry.page.getByRole('button', { name: 'Rematch', exact: true }).click()
  const rematch = await snapshot(first.messages, (state) => state.match === 2)
  assert.equal(rematch.room, state.room)
  await first.page.getByRole('heading', { name: 'Duo room', exact: true }).waitFor()
  assert.deepEqual(errors, [])
  console.log('Duo browser passed: mutual swap/cancel, shared 12-ball innings at 7/1, manual single, queued runs applied once, turn back, partner calls, run-out replacement, live-ball reconnect, team rewards and rematch.')

} finally {
  await browser?.close()
  await server?.close()
  await host.close()
  await rm(outDir, { recursive: true, force: true })
}
