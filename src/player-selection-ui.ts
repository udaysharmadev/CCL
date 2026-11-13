import './player-selection.css'
import { bowlerEligibility, availableBatters } from './match-selection.ts'
import { bowlingLabel, ROLE_LABELS, type PlayerProfile } from './player-profile.ts'
import { formatOvers, type Innings } from './rules.ts'

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
  const n = document.createElement(tag); n.className = cls; n.textContent = text; return n
}

export type PlayerSelectionContext = {
  teamName?: string
  opponentName?: string
  opponentProfiles?: readonly PlayerProfile[]
  venue?: string
}
type Row = { profile: PlayerProfile; index: number; reason: string; status: string; recommended?: boolean; selected?: boolean; subtitle: string; stats: string[]; stamina?: number; choose: () => void }

/** A live team sheet: eligibility and figures remain owned by the innings. */
export function createPlayerSelection(leave: () => void) {
  const dialog = el('dialog', 'player-choice-dialog'); dialog.id = 'player-choice-dialog'
  const heading = el('header', 'player-choice-heading'), kicker = el('span', 'player-choice-kicker'), title = el('h2'), detail = el('p', 'player-choice-detail')
  title.id = 'player-choice-title'; detail.id = 'player-choice-detail'
  dialog.setAttribute('aria-labelledby', title.id); dialog.setAttribute('aria-describedby', detail.id)
  const copy = el('div'); copy.append(kicker, title, detail)
  const league = el('span', 'choice-league-mark', 'CCL'); league.setAttribute('aria-hidden', 'true'); heading.append(copy, league)
  const matchbar = el('div', 'choice-matchbar'), matchup = el('div', 'choice-matchup'), score = el('div', 'choice-match-score')
  const yourTeam = el('strong'), opponentTeam = el('strong'), scoreValue = el('strong'), scoreDetail = el('small')
  matchup.append(yourTeam, el('span', '', 'v'), opponentTeam); score.append(scoreValue, scoreDetail); matchbar.append(matchup, score)
  const progress = el('div', 'choice-partnership'); progress.hidden = true; progress.setAttribute('role', 'status')
  const boards = el('div', 'choice-boards'), board = el('section', 'choice-main-board'), boardHeader = el('div', 'choice-board-header')
  const boardTitle = el('strong'), boardCount = el('span'); boardHeader.append(boardTitle, boardCount)
  const grid = el('div', 'player-choice-grid'), table = el('table', 'choice-score-table'), tableHead = el('thead'), tableBody = el('tbody')
  table.append(tableHead, tableBody); grid.append(table); board.append(boardHeader, grid)
  const opponent = el('aside', 'choice-opponent-board'), opponentHeader = el('div', 'choice-board-header'), opponentTitle = el('strong'), opponentList = el('ol', 'choice-opponent-list')
  opponentHeader.append(opponentTitle, el('span', '', 'PLAYING XI')); opponent.append(opponentHeader, opponentList); opponent.hidden = true
  boards.append(board, opponent)
  const actions = el('footer', 'player-choice-actions'), footnote = el('small', 'choice-footnote', 'Choose a player from your team sheet. Use Tab and Enter to select.')
  const exit = el('button', 'secondary', 'Return to stadium'); exit.type = 'button'; exit.addEventListener('click', () => { dialog.close(); leave() })
  actions.append(footnote, exit); dialog.append(heading, matchbar, progress, boards, actions); document.body.append(dialog)
  dialog.addEventListener('cancel', event => event.preventDefault())

  function badges(p: PlayerProfile) {
    const wrap = el('span', 'choice-badges')
    if (p.identity.captain) wrap.append(el('span', '', 'C'))
    else if (p.identity.viceCaptain) wrap.append(el('span', '', 'VC'))
    if (p.role === 'wicketkeeper-batter') wrap.append(el('span', '', 'WK'))
    return wrap
  }

  function setup(mode: 'batting' | 'bowling', state: Innings, profiles: PlayerProfile[], context: PlayerSelectionContext, headingText: string, text: string) {
    const team = context.teamName ?? 'Suncrest', rival = context.opponentName ?? 'Ridgebacks'
    title.textContent = headingText; detail.textContent = text; dialog.dataset.selection = mode
    yourTeam.textContent = team; opponentTeam.textContent = rival
    scoreValue.textContent = `${state.runs}/${state.wickets}`
    scoreDetail.textContent = `${mode === 'bowling' ? rival : team} · ${formatOvers(state.legalBalls)} / ${state.overs} OV`
    boardTitle.textContent = `${team.toUpperCase()} · ${mode === 'bowling' ? 'BOWLING' : 'BATTING'}`
    table.setAttribute('aria-label', `${team} ${mode} team sheet`)
    kicker.textContent = `${context.venue ?? 'CRAZY CRICKET LEAGUE'} · ${mode === 'bowling' ? `OVER ${Math.floor(state.legalBalls / 6) + 1}` : 'LIVE TEAM SHEET'}`
    opponent.hidden = !context.opponentProfiles?.length
    boards.classList.toggle('has-opponent', !opponent.hidden)
    opponentTitle.textContent = rival.toUpperCase()
    opponentList.replaceChildren(...(context.opponentProfiles ?? []).map((p, i) => {
      const row = el('li'), identity = el('span', 'choice-opponent-identity')
      identity.append(el('strong', '', p.identity.displayName), el('small', '', ROLE_LABELS[p.role]))
      row.append(el('span', 'choice-order', String(i + 1).padStart(2, '0')), identity, badges(p)); return row
    }))
    const labels = mode === 'bowling' ? ['#', 'PLAYER / BOWLING STYLE', 'O', 'M', 'R', 'W', 'ECON', 'ENERGY', 'STATUS'] : ['#', 'PLAYER / BATTING STYLE', 'R', 'B', '4s', '6s', 'SR', 'STATUS']
    const header = el('tr')
    labels.forEach((label, i) => { const cell = el('th', i === 1 ? 'choice-player-column' : i === labels.length - 1 ? 'choice-status-column' : 'choice-stat-column', label); cell.scope = 'col'; if (mode === 'bowling' && i === 3 || mode === 'batting' && i >= 4 && i <= 6) cell.classList.add('choice-secondary-stat'); header.append(cell) })
    tableHead.replaceChildren(header)
    boardCount.textContent = `${profiles.length} PLAYERS`
  }

  function renderRows(rows: Row[]) {
    const bowling = dialog.dataset.selection === 'bowling'
    boardCount.textContent = `${rows.length} PLAYERS · ${rows.filter(row => !row.reason).length} AVAILABLE`
    tableBody.replaceChildren(...rows.map(row => {
      const p = row.profile, tr = el('tr', 'choice-player-row')
      tr.dataset.available = String(!row.reason); tr.dataset.recommended = String(Boolean(row.recommended)); tr.dataset.selected = String(Boolean(row.selected))
      const number = el('td', 'choice-order', String(row.index + 1).padStart(2, '0')), player = el('td', 'choice-player-column')
      const button = el('button', 'player-choice-card'); button.type = 'button'; button.dataset.playerId = p.id; button.disabled = Boolean(row.reason)
      const name = el('span', 'choice-player-name'); name.append(el('strong', '', p.identity.displayName), badges(p))
      button.append(name, el('small', 'choice-player-style', row.subtitle))
      button.setAttribute('aria-label', `Select ${p.identity.displayName}${row.reason ? `: ${row.reason}` : row.recommended ? ', recommended' : ''}. ${bowling ? 'Bowling' : 'Batting'} figures ${row.stats.join(', ')}`)
      button.addEventListener('click', row.choose); player.append(button); tr.append(number, player)
      row.stats.forEach((stat, i) => { const cell = el('td', 'choice-stat-column', stat); if (bowling && i === 1 || !bowling && i >= 2) cell.classList.add('choice-secondary-stat'); if (bowling && i === 3 || !bowling && i === 0) cell.classList.add('choice-primary-stat'); tr.append(cell) })
      if (row.stamina !== undefined) {
        const cell = el('td', 'choice-energy'), bar = el('span', 'choice-energy-bar'), fill = el('i')
        fill.style.width = `${row.stamina}%`; bar.append(fill); cell.append(el('small', '', `${row.stamina}%`), bar); tr.append(cell)
      }
      const statusCell = el('td', 'choice-status-column'), status = el('span', 'choice-status', row.status)
      status.title = row.reason || (row.recommended ? 'Recommended from your saved batting order' : 'Available for selection')
      statusCell.append(status); if (!row.reason) statusCell.append(el('span', 'choice-select-arrow', '→')); tr.append(statusCell)
      tr.addEventListener('click', event => { if (!row.reason && !button.contains(event.target as Node)) button.click() })
      return tr
    }))
    if (!dialog.open) dialog.showModal()
    const recommended = tableBody.querySelector<HTMLButtonElement>('tr[data-recommended="true"] button:enabled')
    const next = recommended ?? tableBody.querySelector<HTMLButtonElement>('button:enabled')
    next?.focus({ preventScroll: true })
  }

  function bowlingStatus(reason: string) {
    if (!reason) return 'AVAILABLE'
    if (reason.includes('capability')) return 'DOES NOT BOWL'
    if (reason.includes('consecutive')) return 'PREVIOUS OVER'
    if (reason.includes('Maximum') || reason.includes('allowances')) return 'QUOTA USED'
    if (reason.includes('finish')) return 'OVER IN PROGRESS'
    if (reason.includes('Reserve')) return 'ROTATION RESERVED'
    return 'UNAVAILABLE'
  }

  function batterRows(profiles: PlayerProfile[], state: Innings, selected: number | undefined, opening: boolean, pick: (index: number) => void): Row[] {
    const available = opening ? profiles.map((_, i) => i + 1).filter(i => i !== selected) : availableBatters(state)
    return profiles.map((p, i) => {
      const f = state.batting[i], allowed = available.includes(i + 1), atCrease = !f?.dismissed && (state.striker === i + 1 || state.nonStriker === i + 1)
      const reason = allowed ? '' : selected === i + 1 ? 'Already selected to take strike.' : f?.dismissed ? f.dismissalText || 'Dismissed.' : 'Already at the crease or used.'
      return { profile: p, index: i, reason, status: selected === i + 1 ? 'ON STRIKE' : allowed ? available[0] === i + 1 ? 'RECOMMENDED' : 'AVAILABLE' : f?.dismissed ? 'OUT' : atCrease ? 'AT THE CREASE' : 'ALREADY USED',
        selected: selected === i + 1, recommended: available[0] === i + 1,
        subtitle: `${p.batting.hand === 'left' ? 'LHB' : 'RHB'} · ${ROLE_LABELS[p.role]} · BAT ${p.batting.skill}`,
        stats: [String(f?.runs ?? 0), String(f?.balls ?? 0), String(f?.fours ?? 0), String(f?.sixes ?? 0), f?.balls ? (f.runs / f.balls * 100).toFixed(1) : '—'],
        choose: () => pick(i + 1) }
    })
  }

  return {
    get open() { return dialog.open },
    close() { dialog.close() },
    bowler(profiles: PlayerProfile[], state: Innings, choose: (id: string) => void, context: PlayerSelectionContext = {}) {
      progress.hidden = true
      setup('bowling', state, profiles, context, 'Choose your bowler', 'Your full XI, live figures and available bowlers. Select a name to lead the next over.')
      renderRows(profiles.map((p, i) => {
        const e = bowlerEligibility(p, state, profiles), f = e.figures
        return { profile: p, index: i, reason: e.reason, status: bowlingStatus(e.reason), subtitle: `${bowlingLabel(p)}${p.bowling.capability !== 'none' ? ` · BOWL ${p.bowling.skill}` : ''}`,
          stats: [formatOvers(f.balls), String(f.maidens), String(f.runs), String(f.wickets), f.balls ? (f.runs / f.balls * 6).toFixed(1) : '—'], stamina: e.stamina,
          choose: () => { dialog.close(); choose(p.id) } }
      }))
    },
    openers(profiles: PlayerProfile[], state: Innings, choose: (a: number, b: number) => void, context: PlayerSelectionContext = {}) {
      let first = 0
      const render = () => {
        setup('batting', state, profiles, context, first ? 'Choose the non-striker' : 'Choose your opening batter', first ? `${profiles[first - 1].identity.displayName} takes strike. Choose their opening partner below.` : 'Build your opening partnership. Select the striker first, then the non-striker.')
        progress.hidden = false; progress.replaceChildren()
        for (const [step, label] of [[1, first ? `${profiles[first - 1].identity.displayName} · STRIKER` : 'CHOOSE STRIKER'], [2, 'CHOOSE NON-STRIKER']] as const) {
          const item = el('span', `choice-partnership-step${step === (first ? 2 : 1) ? ' active' : ''}${step === 1 && first ? ' complete' : ''}`)
          item.append(el('b', '', step === 1 && first ? '✓' : String(step)), el('span', '', label))
          if (step === 1 && first) {
            const change = el('button', 'choice-change-striker', 'Change'); change.type = 'button'; change.setAttribute('aria-label', 'Change opening striker')
            change.addEventListener('click', () => { first = 0; render() }); item.append(change)
          }
          progress.append(item)
        }
        renderRows(batterRows(profiles, state, first || undefined, true, index => { if (!first) { first = index; render() } else { dialog.close(); choose(first, index) } }))
      }; render()
    },
    batter(profiles: PlayerProfile[], state: Innings, choose: (index: number) => void, context: PlayerSelectionContext = {}) {
      progress.hidden = true
      setup('batting', state, profiles, context, 'Send in your next batter', 'The scorecard shows who is out, at the crease and ready to bat. Select an available player.')
      renderRows(batterRows(profiles, state, undefined, false, index => { dialog.close(); choose(index) }))
    },
  }
}
