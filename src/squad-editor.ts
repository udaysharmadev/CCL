import { ACTION_LABELS, BATTING_STYLES, BOWLING_CAPABILITIES, BOWLING_TYPES, BOWLING_TYPE_LABELS, PLAYER_ROLES, ROLE_LABELS, SKIN_TONES, bowlingLabel, canKeepWicket, canPlayerBowl, compatibleActions, isSpinBowler, isSpinType, playerRatings, validatePlayerProfile, type PlayerProfile, type BowlingType } from './player-profile.ts'
import { getPlayerProfile, getPlayerStats, profileStoreWarning, savePlayerProfile } from './player-store.ts'

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') {
  const node = document.createElement(tag); node.className = className; node.textContent = text; return node
}
function button(label: string, action: () => void, className = 'choice') {
  const control = el('button', className, label); control.type = 'button'; control.addEventListener('click', action); return control
}
const titleCase = (name: string) => name.replace(/([A-Z])/g, ' $1').replaceAll('-', ' ').replace(/^./, c => c.toUpperCase())
export type SquadFilter = 'all' | 'batters' | 'bowlers' | 'all-rounders' | 'wicketkeepers' | 'left-handed' | 'right-handed' | 'fast' | 'spin'
export type SquadSort = 'order' | 'batting' | 'bowling' | 'pace' | 'spin' | 'fielding' | 'overall'

export function createSquadEditor(parent: HTMLElement, onSaved: () => void) {
  let filter: SquadFilter = 'all', sort: SquadSort = 'order'
  let selected: string[] = []
  let draft: PlayerProfile, tab = 'identity'
  const toolbar = el('div', 'squad-toolbar')
  const filterLabel = el('label', '', 'SHOW')
  const filterSelect = el('select'); filterSelect.id = 'squad-filter'; filterSelect.setAttribute('aria-label', 'Filter squad')
  for (const value of ['all', 'batters', 'bowlers', 'all-rounders', 'wicketkeepers', 'left-handed', 'right-handed', 'fast', 'spin'] as const) filterSelect.add(new Option(value === 'all' ? 'Entire squad' : titleCase(value), value))
  filterSelect.addEventListener('change', () => { filter = filterSelect.value as SquadFilter; onSaved() })
  filterLabel.append(filterSelect)
  const sortLabel = el('label', '', 'SORT')
  const sortSelect = el('select'); sortSelect.id = 'squad-sort'; sortSelect.setAttribute('aria-label', 'Sort squad')
  for (const value of ['order', 'batting', 'bowling', 'pace', 'spin', 'fielding', 'overall'] as const) sortSelect.add(new Option(value === 'order' ? 'Batting order' : `${titleCase(value)} rating`, value))
  sortSelect.addEventListener('change', () => { sort = sortSelect.value as SquadSort; onSaved() })
  sortLabel.append(sortSelect)
  const compare = button('Compare 0/2', showComparison, 'secondary squad-compare'); compare.id = 'squad-compare'; compare.disabled = true
  toolbar.append(filterLabel, sortLabel, compare)
  const warning = el('p', 'squad-store-warning'); warning.setAttribute('role', 'status')
  parent.querySelector('.lineup-lists')!.before(toolbar, warning)

  const editor = el('dialog', 'overlay player-editor'); editor.id = 'player-editor'; editor.setAttribute('aria-labelledby', 'player-editor-title')
  const form = el('form'); form.noValidate = true
  const heading = el('header', 'player-editor-heading')
  const headingCopy = el('div'); headingCopy.append(el('span', 'eyebrow', 'PLAYER WORKSHOP'))
  const headingTitle = el('h2', '', 'Player profile'); headingTitle.id = 'player-editor-title'; headingCopy.append(headingTitle)
  const dismiss = button('×', () => editor.close(), 'menu-close'); dismiss.setAttribute('aria-label', 'Close player profile')
  heading.append(headingCopy, dismiss)
  const hero = el('section', 'player-profile-hero')
  const jersey = el('div', 'profile-jersey'); jersey.setAttribute('aria-label', 'Jersey preview')
  const jerseyName = el('span'), jerseyNumber = el('strong'); jersey.append(jerseyName, jerseyNumber)
  const heroCopy = el('div', 'profile-hero-copy'), heroName = el('h3'), heroRole = el('p'), heroStyle = el('span')
  const ratings = el('div', 'profile-rating-row'); heroCopy.append(heroName, heroRole, heroStyle, ratings); hero.append(jersey, heroCopy)
  const tabs = el('nav', 'profile-tabs'); tabs.setAttribute('aria-label', 'Player profile sections')
  const content = el('section', 'profile-fields'); content.id = 'profile-fields'
  const errors = el('p', 'profile-errors'); errors.id = 'profile-errors'; errors.setAttribute('role', 'status')
  const footer = el('footer', 'profile-footer')
  const footerNote = el('small', '', 'Saved for future Solo matches. Live matches keep their starting profiles.')
  const saveButton = el('button', 'primary', 'Save player'); saveButton.type = 'submit'; saveButton.id = 'player-save'
  footer.append(footerNote, button('Cancel', () => editor.close(), 'secondary'), saveButton)
  form.append(heading, hero, tabs, content, errors, footer); editor.append(form); document.body.append(editor)

  const comparison = el('dialog', 'overlay squad-comparison'); comparison.id = 'squad-comparison'
  comparison.setAttribute('aria-label', 'Compare players'); document.body.append(comparison)

  function renderHero() {
    jerseyName.textContent = draft.identity.jerseyName.toUpperCase(); jerseyNumber.textContent = String(draft.identity.jerseyNumber)
    heroName.textContent = draft.identity.displayName; heroRole.textContent = ROLE_LABELS[draft.role]
    heroStyle.textContent = `${draft.batting.hand === 'left' ? 'Left' : 'Right'}-hand bat · ${bowlingLabel(draft)}`
    ratings.replaceChildren(...Object.entries(playerRatings(draft)).map(([key, value]) => {
      const cell = el('span'); cell.append(el('b', '', String(value)), el('small', '', key.toUpperCase())); return cell
    }))
  }
  function feedback() { errors.textContent = validatePlayerProfile(draft).join(' '); renderHero() }
  function field(label: string, group: 'identity' | 'batting' | 'bowling' | 'fielding' | 'root', key: string, options?: { values?: readonly string[]; labels?: Record<string, string>; min?: number; max?: number; step?: number; length?: number }) {
    const holder = el('label', 'profile-field'); holder.append(el('span', '', label))
    const target = (group === 'root' ? draft : draft[group]) as unknown as Record<string, unknown>
    const value = target[key]
    const control = options?.values ? el('select') : el('input')
    control.id = `profile-${key}`
    if (control instanceof HTMLSelectElement) for (const v of options!.values!) control.add(new Option(options?.labels?.[v] ?? titleCase(v), v))
    else {
      control.type = typeof value === 'number' ? 'number' : 'text'
      if (options?.min !== undefined) control.min = String(options.min)
      if (options?.max !== undefined) control.max = String(options.max)
      if (options?.step !== undefined) control.step = String(options.step)
      if (options?.length) control.maxLength = options.length
    }
    control.value = String(value)
    control.addEventListener(control instanceof HTMLSelectElement ? 'change' : 'input', () => {
      target[key] = typeof value === 'number' ? Number(control.value) : control.value
      if (group === 'bowling' && key === 'type') {
        const type = draft.bowling.type
        if (isSpinType(type)) draft.bowling.arm = type.startsWith('left-arm') ? 'left' : 'right'
        draft.bowling.action = compatibleActions(type)[0]
        draft.bowling.maxPace = isSpinType(type) ? 92 : type === 'medium' ? 122 : type === 'medium-fast' ? 136 : 151
        renderFields()
      }
      feedback()
    })
    holder.append(control); content.append(holder); return control
  }
  function sectionTitle(title: string, description: string) {
    const intro = el('div', 'profile-section-intro'); intro.append(el('h3', '', title), el('p', '', description)); content.append(intro)
  }
  function ratingsFields(group: 'batting' | 'bowling' | 'fielding', keys: string[]) { for (const key of keys) field(titleCase(key), group, key, { min: 0, max: 100, step: 1 }) }
  function renderFields() {
    content.replaceChildren(); content.dataset.tab = tab
    for (const b of tabs.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.tab === tab))
    if (tab === 'identity') {
      sectionTitle('Make the shirt yours', 'Names appear throughout future Solo matches. Your roster identity stays stable when you rename a player.')
      field('Full player name', 'identity', 'fullName', { length: 36 }); field('Match display name', 'identity', 'displayName', { length: 24 })
      field('Dressing-room / jersey name', 'identity', 'jerseyName', { length: 14 }); field('Jersey number', 'identity', 'jerseyNumber', { min: 0, max: 99, step: 1 })
      field('Player role', 'root', 'role', { values: PLAYER_ROLES, labels: ROLE_LABELS })
      const leadership = el('label', 'profile-field'); leadership.append(el('span', '', 'Leadership'))
      const lead = el('select'); lead.id = 'profile-leadership'
      for (const [value, label] of [['player', 'Squad player'], ['captain', 'Captain'], ['viceCaptain', 'Vice-captain']]) lead.add(new Option(label, value))
      lead.value = draft.identity.captain ? 'captain' : draft.identity.viceCaptain ? 'viceCaptain' : 'player'
      lead.addEventListener('change', () => { draft.identity.captain = lead.value === 'captain'; draft.identity.viceCaptain = lead.value === 'viceCaptain'; feedback() })
      leadership.append(lead); content.append(leadership)
      const skin = el('fieldset', 'profile-appearance'); skin.append(el('legend', '', 'Appearance'))
      SKIN_TONES.forEach((color, index) => {
        const swatch = button('', () => { draft.identity.skinTone = color; renderFields() }, 'profile-swatch')
        swatch.style.setProperty('--skin', color); swatch.setAttribute('aria-label', `Appearance ${index + 1}`); swatch.setAttribute('aria-pressed', String(draft.identity.skinTone === color)); skin.append(swatch)
      }); content.append(skin)
      field('Profile notes', 'root', 'details', { length: 240 })
    } else if (tab === 'batting') {
      sectionTitle('Batting identity', 'Handedness changes stance and shot orientation. Ratings range from 0 to 100; running feeds each batter’s individual pace.')
      field('Batting hand', 'batting', 'hand', { values: ['right', 'left'], labels: { right: 'Right-handed', left: 'Left-handed' } })
      field('Batting style', 'batting', 'style', { values: BATTING_STYLES }); field('Preferred batting position', 'batting', 'position', { min: 1, max: 11, step: 1 })
      ratingsFields('batting', ['skill', 'power', 'timing', 'technique', 'shotControl', 'running', 'consistency', 'aggression'])
    } else if (tab === 'bowling') {
      sectionTitle(isSpinBowler(draft) ? 'Spin craft' : 'Pace craft', 'Capabilities determine eligibility. The selected style controls variations, action, pace range and the movement of each delivery.')
      field('Bowling capability', 'bowling', 'capability', { values: BOWLING_CAPABILITIES })
      field('Bowling arm', 'bowling', 'arm', { values: ['right', 'left'], labels: { right: 'Right-arm', left: 'Left-arm' } })
      field('Bowling type', 'bowling', 'type', { values: BOWLING_TYPES, labels: BOWLING_TYPE_LABELS })
      field('Bowling action', 'bowling', 'action', { values: compatibleActions(draft.bowling.type), labels: ACTION_LABELS })
      field('Maximum pace · km/h', 'bowling', 'maxPace', { min: isSpinBowler(draft) ? 60 : 100, max: isSpinBowler(draft) ? 115 : draft.bowling.type === 'medium' ? 135 : draft.bowling.type === 'medium-fast' ? 148 : 165, step: 1 })
      ratingsFields('bowling', ['skill', 'accuracy', 'control', 'paceControl', 'variationMastery', 'stamina', 'consistency'])
      ratingsFields('bowling', isSpinBowler(draft) ? ['spin', 'flight', 'drift', 'turn'] : ['swing', 'reverseSwing', 'seam', 'yorker', 'bouncer', 'slowerBall'])
      const note = el('p', 'profile-style-note', 'Changing spin type aligns its bowling arm and action. Other incompatible role or capability combinations must be resolved before saving.'); content.append(note)
    } else if (tab === 'fielding') {
      sectionTitle('Fielding and keeping', 'Wicketkeeping ability of 50 or more qualifies a player as your keeper. Fielding attributes are saved independently from batting and bowling.')
      ratingsFields('fielding', ['rating', 'catching', 'throwingAccuracy', 'throwingPower', 'agility', 'reflexes', 'groundFielding', 'wicketkeeping'])
    } else {
      sectionTitle('Local career', 'Completed Solo matches recorded since this upgrade. Historic team totals are retained separately.')
      const s = getPlayerStats(draft.id)
      const values = [['Matches', s.matches], ['Runs', s.runs], ['Best innings', s.bestRuns], ['Balls faced', s.ballsFaced], ['Strike rate', s.ballsFaced ? (s.runs / s.ballsFaced * 100).toFixed(1) : '—'], ['Fours / sixes', `${s.fours} / ${s.sixes}`], ['Wickets', s.wickets], ['Overs', `${Math.floor(s.ballsBowled / 6)}.${s.ballsBowled % 6}`], ['Runs conceded', s.conceded], ['Economy', s.ballsBowled ? (s.conceded / s.ballsBowled * 6).toFixed(2) : '—']]
      for (const [label, value] of values) { const cell = el('div', 'profile-stat'); cell.append(el('span', '', String(label)), el('strong', '', String(value))); content.append(cell) }
    }
  }
  for (const section of ['identity', 'batting', 'bowling', 'fielding', 'statistics']) {
    const control = button(titleCase(section), () => { tab = section; renderFields() }, 'profile-tab'); control.dataset.tab = section; tabs.append(control)
  }
  form.addEventListener('submit', event => {
    event.preventDefault()
    for (const key of ['fullName', 'displayName', 'jerseyName'] as const) draft.identity[key] = draft.identity[key].trim()
    const result = savePlayerProfile(draft)
    if (!result.ok) { errors.textContent = result.errors.join(' '); errors.scrollIntoView({ block: 'nearest' }); return }
    editor.close(); onSaved()
  })

  function showComparison() {
    if (selected.length !== 2) return
    const profiles = selected.map(getPlayerProfile), heading = el('header', 'player-editor-heading')
    heading.append(el('h2', '', 'Head to head'), button('×', () => comparison.close(), 'menu-close'))
    const table = el('table', 'profile-compare-table')
    const head = el('thead'), row = el('tr'); row.append(el('th', '', 'Attribute'), ...profiles.map(p => el('th', '', p.identity.displayName))); head.append(row); table.append(head)
    const body = el('tbody')
    const metrics: [string, (p: PlayerProfile) => string | number][] = [
      ['Role', p => ROLE_LABELS[p.role]], ['Batting hand', p => titleCase(p.batting.hand)], ['Bowling', bowlingLabel], ['Batting', p => playerRatings(p).batting], ['Bowling rating', p => playerRatings(p).bowling], ['Accuracy', p => p.bowling.accuracy], ['Control', p => p.bowling.control], ['Maximum pace', p => `${p.bowling.maxPace} km/h`], ['Spin', p => p.bowling.spin], ['Timing', p => p.batting.timing], ['Power', p => p.batting.power], ['Running', p => p.batting.running], ['Fielding', p => p.fielding.rating], ['Stamina', p => p.bowling.stamina], ['Keeper', p => canKeepWicket(p) ? 'Eligible' : 'No'], ['Career runs', p => getPlayerStats(p.id).runs], ['Career wickets', p => getPlayerStats(p.id).wickets],
    ]
    for (const [label, read] of metrics) { const row = el('tr'); row.append(el('th', '', label), ...profiles.map(p => el('td', '', String(read(p))))); body.append(row) }
    table.append(body); comparison.replaceChildren(heading, table, button('Done', () => comparison.close(), 'primary')); comparison.showModal()
  }
  function matches(profile: PlayerProfile) {
    switch (filter) {
      case 'batters': return !profile.role.includes('bowler') || profile.role.includes('all-rounder')
      case 'bowlers': return canPlayerBowl(profile)
      case 'all-rounders': return profile.role.includes('all-rounder')
      case 'wicketkeepers': return canKeepWicket(profile)
      case 'left-handed': return profile.batting.hand === 'left'
      case 'right-handed': return profile.batting.hand === 'right'
      case 'fast': return canPlayerBowl(profile) && !isSpinBowler(profile)
      case 'spin': return canPlayerBowl(profile) && isSpinBowler(profile)
      default: return true
    }
  }
  return {
    open(id: string) { draft = getPlayerProfile(id); tab = 'identity'; errors.textContent = ''; renderHero(); renderFields(); editor.showModal() },
    matches,
    sorted(ids: readonly string[]) {
      const output = ids.filter(id => matches(getPlayerProfile(id)))
      const metric = (p: PlayerProfile) => sort === 'pace' ? p.bowling.maxPace : sort === 'spin' ? p.bowling.spin : sort === 'order' ? 0 : playerRatings(p)[sort]
      return sort === 'order' ? output : output.sort((a, b) => metric(getPlayerProfile(b)) - metric(getPlayerProfile(a)))
    },
    compareButton(id: string) {
      const control = button(selected.includes(id) ? '✓' : '⇄', () => {
        selected = selected.includes(id) ? selected.filter(p => p !== id) : [...selected.slice(-1), id]
        compare.textContent = `Compare ${selected.length}/2`; compare.disabled = selected.length !== 2; onSaved()
      }, 'choice roster-compare')
      control.setAttribute('aria-label', `Compare ${getPlayerProfile(id).identity.displayName}`); control.setAttribute('aria-pressed', String(selected.includes(id))); return control
    },
    refresh() { warning.textContent = profileStoreWarning(); warning.hidden = !warning.textContent },
  }
}
