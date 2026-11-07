import { bowlerEligibility, availableBatters } from './match-selection.ts'
import { bowlingLabel, ROLE_LABELS, type PlayerProfile } from './player-profile.ts'
import { formatOvers, type Innings } from './rules.ts'

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = '') => {
  const n = document.createElement(tag); n.className = cls; n.textContent = text; return n
}

export function createPlayerSelection(leave: () => void) {
  const dialog = el('dialog', 'player-choice-dialog'); dialog.id = 'player-choice-dialog'
  const kicker = el('span', 'player-choice-kicker'), title = el('h2', ''), detail = el('p', '')
  title.id = 'player-choice-title'; dialog.setAttribute('aria-labelledby', title.id)
  const grid = el('div', 'player-choice-grid'), actions = el('div', 'player-choice-actions')
  const exit = el('button', 'secondary', 'Return to stadium'); exit.type = 'button'; exit.addEventListener('click', () => { dialog.close(); leave() })
  actions.append(exit); dialog.append(kicker, title, detail, grid, actions); document.body.append(dialog)
  dialog.addEventListener('cancel', event => event.preventDefault())
  function open(heading: string, text: string) { title.textContent = heading; detail.textContent = text; if (!dialog.open) dialog.showModal() }
  function card(p: PlayerProfile, reason: string, rows: string[], pick: () => void) {
    const button = el('button', 'player-choice-card'); button.type = 'button'; button.dataset.playerId = p.id
    button.disabled = Boolean(reason); button.setAttribute('aria-label', `Select ${p.identity.displayName}${reason ? `: ${reason}` : ''}`)
    button.append(el('strong', '', `${p.identity.jerseyNumber.toString().padStart(2, '0')}  ${p.identity.displayName}${p.identity.captain ? ' · C' : ''}`))
    rows.forEach(row => button.append(el('small', '', row)))
    button.append(el('em', '', reason || 'SELECT PLAYER →')); button.addEventListener('click', pick); return button
  }
  return {
    get open() { return dialog.open },
    close() { dialog.close() },
    bowler(profiles: PlayerProfile[], state: Innings, choose: (id: string) => void) {
      kicker.textContent = `SUNCREST · OVER ${Math.floor(state.legalBalls / 6) + 1}`
      open('Choose your bowler', 'Plan the next over. Figures, stamina and available skills belong to this player. Unavailable players show the rule that prevents selection.')
      grid.replaceChildren(...profiles.map(p => {
        const e = bowlerEligibility(p, state, profiles), b = p.bowling, f = e.figures
        return card(p, e.reason, [bowlingLabel(p), `${b.action.replaceAll('-', ' ')} · ${ROLE_LABELS[p.role]}`,
          `BOWL ${b.skill} · ${['fast', 'medium-fast', 'medium'].includes(b.type) ? `${b.maxPace} km/h` : `SPIN ${b.spin}`}`,
          `Accuracy ${b.accuracy} · Control ${b.control} · Stamina ${e.stamina}%`,
          `${f.wickets}/${f.runs} · ${formatOvers(f.balls)} / ${e.maxOvers} ov · Econ ${f.balls ? (f.runs / f.balls * 6).toFixed(1) : '—'}`,
          `Recent ${e.recent.join(' · ') || 'Yet to bowl'}`], () => { dialog.close(); choose(p.id) })
      }))
    },
    openers(profiles: PlayerProfile[], state: Innings, choose: (a: number, b: number) => void) {
      let first = 0
      const render = () => {
        kicker.textContent = 'SUNCREST · OPENING PARTNERSHIP'
        open(first ? 'Choose the non-striker' : 'Choose your opening batter', first ? `${profiles[first - 1].identity.displayName} takes strike. Pick their opening partner.` : 'Select the player taking first strike, then their partner. Your saved batting order supplies the recommendation.')
        grid.replaceChildren(...profiles.map((p, i) => card(p, first === i + 1 ? 'Already selected to take strike.' : '',
          [`${p.batting.hand === 'left' ? 'Left' : 'Right'}-handed · ${ROLE_LABELS[p.role]}`,
            `BAT ${p.batting.skill} · Timing ${p.batting.timing} · Power ${p.batting.power}`,
            `Technique ${p.batting.technique} · Running ${p.batting.running}`,
            `${p.role === 'opening-batter' ? 'Specialist opener' : i < 2 ? 'Your selected opening order' : `Batting order ${i + 1}`} · ${p.batting.style}`], () => {
            if (!first) { first = i + 1; render() } else { dialog.close(); choose(first, i + 1) }
          })))
      }; render()
    },
    batter(profiles: PlayerProfile[], state: Innings, choose: (index: number) => void) {
      kicker.textContent = 'SUNCREST · NEXT BATTER'
      open('Send in your next batter', `${state.runs}/${state.wickets} · ${formatOvers(state.legalBalls)} overs. Select an available player; the surviving batter keeps their end.`)
      const available = availableBatters(state)
      grid.replaceChildren(...profiles.map((p, i) => card(p, available.includes(i + 1) ? '' : state.batting[i]?.dismissed ? 'Dismissed.' : 'Already at the crease or used.',
        [`${p.batting.hand === 'left' ? 'Left' : 'Right'}-handed · ${ROLE_LABELS[p.role]}`,
          `BAT ${p.batting.skill} · Timing ${p.batting.timing} · Power ${p.batting.power}`,
          `Technique ${p.batting.technique} · Running ${p.batting.running}`,
          available[0] === i + 1 ? 'Next in your batting order' : `Batting order ${i + 1}`], () => { dialog.close(); choose(i + 1) })))
    },
  }
}
