import { deliveryToken, formatOvers, runRates, type Innings, type DeliveryOutcome } from './rules.ts'

export const totalRuns = (ball: DeliveryOutcome) => ball.batRuns + ball.wide + ball.noBall + ball.byes + ball.legByes + (ball.penalty ?? 0) + (ball.overthrowRuns ?? 0)
export function batterStatus(innings: Innings, index: number) {
  const batter = innings.batting[index]
  if (batter.dismissed) return batter.dismissalText
  const appeared = batter.balls > 0 || batter.runs > 0 || index + 1 === innings.striker || index + 1 === innings.nonStriker ||
    innings.partnerships.some(pair => pair.batter === index + 1 || pair.partner === index + 1)
  return appeared ? 'not out' : 'yet to bat'
}

/** Snapshots may contain only recent deliveries; never invent missing over totals. */
export function overSummary(innings: Innings) {
  const offset = Math.max(0, innings.legalBalls - innings.history.filter(ball => !ball.wide && !ball.noBall).length)
  let legal = offset
  const overs: { number: number; balls: DeliveryOutcome[]; runs: number; wickets: number; legal: number; partial: boolean }[] = []
  for (const ball of innings.history) {
    const number = Math.floor(legal / 6) + 1
    let over = overs.at(-1)
    if (!over || over.number !== number) {
      over = { number, balls: [], runs: 0, wickets: 0, legal: 0, partial: legal % 6 !== 0 }
      overs.push(over)
    }
    over.balls.push(ball); over.runs += totalRuns(ball); over.wickets += Number(Boolean(ball.wicket))
    if (!ball.wide && !ball.noBall) { legal++; over.legal++ }
  }
  return overs
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = '') {
  const element = document.createElement(tag)
  element.className = className; element.textContent = text
  return element
}
function table(title: string, headers: string[], rows: string[][], active: number[] = []) {
  const section = node('section', 'score-section')
  section.append(node('h3', '', title))
  const scroll = node('div', 'score-table-scroll')
  scroll.tabIndex = 0; scroll.setAttribute('aria-label', title)
  const table = node('table', 'card-table')
  const head = document.createElement('thead'), heading = document.createElement('tr')
  headers.forEach(label => { const th = node('th', '', label); th.scope = 'col'; heading.append(th) })
  head.append(heading); table.append(head)
  const body = document.createElement('tbody')
  rows.forEach((cells,index) => {
    const row = node('tr', active.includes(index) ? 'active-batter' : '')
    cells.forEach((value,i) => { const cell = node(i === 0 ? 'th' : 'td', '', value); if(cell instanceof HTMLTableCellElement && i === 0) cell.scope = 'row'; row.append(cell) })
    body.append(row)
  })
  table.append(body); scroll.append(table); section.append(scroll)
  if (!rows.length) section.append(node('p', 'score-empty', 'No deliveries yet.'))
  return section
}

export function renderMatchScorecard(container: HTMLElement, entries: { label: string; innings: Innings }[], selected = entries.length - 1) {
  const tabs = node('nav', 'innings-tabs'); tabs.setAttribute('aria-label', 'Choose innings')
  entries.forEach((entry,index) => {
    const button = node('button', '', `${index + 1}${index === 0 ? 'st' : 'nd'} innings · ${entry.label}`)
    button.type = 'button'; button.setAttribute('aria-pressed', String(index === selected))
    button.addEventListener('click', () => renderMatchScorecard(container, entries, index))
    tabs.append(button)
  })
  const { innings, label } = entries[selected]
  const rates = runRates(innings)
  const hero = node('section', 'scorecard-hero')
  const title = node('div', 'scorecard-team')
  title.append(node('span', 'score-kicker', `${label} · ${innings.complete ? 'INNINGS COMPLETE' : 'BATTING'}`), node('strong', 'scorecard-total', `${innings.runs}/${innings.wickets}`), node('span', '', `${formatOvers(innings.legalBalls)} / ${innings.overs} overs`))
  const figures = node('div','scorecard-figures')
  const extras = Object.values(innings.extras).reduce((a,b)=>a+b,0)
  for(const [caption,value] of [['RUN RATE',rates.current.toFixed(2)],['EXTRAS',String(extras)],['BOUNDARIES',`${innings.batting.reduce((n,b)=>n+b.fours,0)} × 4  ·  ${innings.batting.reduce((n,b)=>n+b.sixes,0)} × 6`]]) {
    const stat=node('div','');stat.append(node('span','',caption),node('b','',value));figures.append(stat)
  }
  hero.append(title,figures)
  const context=node('p','scorecard-context',innings.target === undefined
    ? `${Math.max(0,innings.overs*6-innings.legalBalls)} balls remaining · ${10-innings.wickets} wickets in hand`
    : innings.runs >= innings.target ? `Target ${innings.target} reached with ${Math.max(0,innings.overs*6-innings.legalBalls)} balls remaining`
    : `Target ${innings.target} · Need ${innings.target-innings.runs} from ${Math.max(0,innings.overs*6-innings.legalBalls)} balls${rates.required === null ? '' : ` · Required rate ${rates.required.toFixed(2)}`}`)
  const active = innings.batting.flatMap((b,i)=>!b.dismissed && [innings.striker,innings.nonStriker].includes(i+1) ? [i] : [])
  const batting = table('Batting',['Batter','Status','R','B','4s','6s','SR'],innings.batting.map((b,i)=>[
    `${b.name || `Batter ${i+1}`}${!innings.complete && i+1===innings.striker ? ' *' : ''}`,batterStatus(innings,i),String(b.runs),String(b.balls),String(b.fours),String(b.sixes),b.balls ? (b.runs/b.balls*100).toFixed(1) : '—',
  ]),active)
  const bowling=table('Bowling',['Bowler','O','M','R','W','Econ','Wd','Nb'],innings.bowling.map(b=>[b.name,formatOvers(b.balls),String(b.maidens),String(b.runs),String(b.wickets),b.balls?(b.runs/b.balls*6).toFixed(2):'—',String(b.wides),String(b.noBalls)]))
  const extrasLine=node('p','extras-line',`Extras ${extras}  ·  b ${innings.extras.byes}  ·  lb ${innings.extras.legByes}  ·  wd ${innings.extras.wide}  ·  nb ${innings.extras.noBall}  ·  penalty ${innings.extras.penalty}`)
  const overs=overSummary(innings)
  const overSection=node('section','score-section'); overSection.append(node('h3','', 'Over by over'))
  const chart=node('div','over-chart');chart.setAttribute('aria-label','Runs scored each over')
  const max=Math.max(8,...overs.map(o=>o.runs))
  overs.forEach(over=>{
    const bar=node('div','over-bar');bar.style.setProperty('--bar',`${Math.max(3,over.runs/max*100)}%`)
    bar.title=`Over ${over.number}: ${over.runs} runs, ${over.wickets} wickets${over.partial?' (partial snapshot)':''}`
    bar.append(node('b','',`${over.runs}${over.partial?'+':''}`),node('i',over.wickets?'with-wicket':''),node('span','',String(over.number)))
    chart.append(bar)
  })
  overSection.append(chart)
  const log=node('div','over-log')
  for(const over of [...overs].reverse()) {
    const row=node('div','over-row');row.append(node('b','',`OVER ${over.number}`))
    const balls=node('div','over-balls')
    over.balls.forEach(ball=>balls.append(node('span',ball.wicket?'wicket':ball.reason==='boundary'?'major':'',deliveryToken(ball))))
    row.append(balls,node('strong','',`${over.runs}${over.partial?'+':''} runs${over.wickets?` · ${over.wickets}W`:''}`));log.append(row)
  }
  overSection.append(log)
  if(!overs.length) overSection.append(node('p','score-empty','The first over is about to begin.'))
  const name=(number:number)=>innings.batting[number-1]?.name || `Batter ${number}`
  const partnerships=table('Partnerships',['Batters','R','B'],innings.partnerships.map(p=>[`${name(p.batter)} / ${name(p.partner)}`,String(p.runs),String(p.balls)]))
  const wickets=table('Fall of wickets',['Wicket','Batter','Score','Overs'],innings.fallOfWickets.map((f,i)=>[String(i+1),name(f.batter),`${f.runs}/${i+1}`,formatOvers(f.overs)]))
  container.replaceChildren(tabs,hero,context,batting,extrasLine,bowling,overSection,partnerships,wickets)
}
