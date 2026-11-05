type Data = Pick<Storage, 'getItem' | 'setItem'>
type Lifecycle = 'loadingStart' | 'loadingStop' | 'gameplayStart' | 'gameplayStop'

interface Sdk {
  init(): Promise<void>
  environment: 'local' | 'crazygames' | 'disabled'
  data: Data
  game: Record<Lifecycle, () => void | Promise<void>> & {
    settings?: { muteAudio: boolean }
    addSettingsChangeListener?(listener: (settings: { muteAudio: boolean }) => void): void
    getInviteParam?(name: string): string | null
    inviteLink?(params: Record<string, string>): string
    updateRoom?(room: { roomId: string; isJoinable: boolean; inviteParams: Record<string, string> }): void
    leftRoom?(): void
  }
}

declare global {
  interface Window { CrazyGames?: { SDK: Sdk } }
}

let sdk: Sdk | undefined
let gameplay = false
let loading = false

function shouldLoadSdk() {
  return window.self !== window.top || /(^|\.)crazygames\.com$/.test(location.hostname) ||
    new URLSearchParams(location.search).get('useLocalSdk') === 'true'
}

async function loadScript() {
  const script = document.createElement('script')
  script.src = 'https://sdk.crazygames.com/crazygames-sdk-v3.js'
  script.async = true
  await new Promise<void>((resolve, reject) => {
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('CrazyGames SDK could not load'))
    document.head.append(script)
  })
}

export async function initializePlatform(onMute: (muted: boolean) => void) {
  if (!window.CrazyGames && !shouldLoadSdk()) return
  let deadline: number | undefined
  try {
    sdk = await Promise.race([
      (async () => {
        if (!window.CrazyGames) await loadScript()
        const instance = window.CrazyGames?.SDK
        if (!instance) return
        await instance.init()
        if (instance.environment === 'crazygames' || instance.environment === 'local') return instance
      })(),
      new Promise<undefined>((resolve) => { deadline = window.setTimeout(resolve, 2800) }),
    ])
    if (sdk?.game.settings) onMute(sdk.game.settings.muteAudio)
    sdk?.game.addSettingsChangeListener?.((settings) => onMute(settings.muteAudio))
  } catch {
    sdk = undefined
  } finally {
    clearTimeout(deadline)
  }
}

function notify(name: Lifecycle) {
  try {
    void Promise.resolve(sdk?.game[name]()).catch(() => {})
  } catch { /* A platform event cannot interrupt play. */ }
}

export function setLoading(value: boolean) {
  if (value === loading) return
  loading = value
  notify(value ? 'loadingStart' : 'loadingStop')
}

export function setGameplay(value: boolean) {
  if (value === gameplay) return
  gameplay = value
  notify(value ? 'gameplayStart' : 'gameplayStop')
}

export function stored(key: string) {
  try { return (sdk ? sdk.data : localStorage).getItem(key) } catch { return null }
}

export function save(key: string, value: string) {
  try {
    (sdk ? sdk.data : localStorage).setItem(key, value)
    return true
  } catch { return false }
}

export function inviteRoom() {
  try { return sdk?.game.getInviteParam?.('room') ?? null } catch { return null }
}

export function inviteLink(room: string) {
  if (sdk?.environment === 'crazygames') {
    try {
      const url = sdk.game.inviteLink?.({ room })
      if (url) return url
    } catch { /* The direct link is still available. */ }
  }
  const url = new URL(location.href)
  url.search = ''
  url.hash = ''
  url.searchParams.set('room', room)
  return url.href
}

export function publishRoom(room: string, joinable: boolean) {
  try {
    if (sdk?.environment === 'crazygames') {
      sdk.game.updateRoom?.({ roomId: room, isJoinable: joinable, inviteParams: { room } })
    }
  } catch { /* The game room is still available directly. */ }
}

export function leavePublishedRoom() {
  try { sdk?.game.leftRoom?.() } catch { /* Closing the socket still leaves the room. */ }
}
