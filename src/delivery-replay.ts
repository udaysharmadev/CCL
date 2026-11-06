import { Delivery, type DeliveryOptions } from './cricket.ts'
import type { OnlineDeliveryCommand, OnlineInputHistory } from './online-contract.ts'

/** Normalize persisted inputs without changing the original (possibly sealed) record. */
export function deliveryCommands(history: OnlineInputHistory): OnlineDeliveryCommand[] {
  if (history.version !== undefined && history.version !== 1 && history.version !== 2) {
    throw new Error('Unsupported delivery replay version')
  }
  const commands: OnlineDeliveryCommand[] = history.version === 2
    ? [...history.commands]
    : [
      // Old records have no cross-type sequence. Preserve their shot-first replay order.
      ...(history.shot ? [{ type: 'swing' as const, ...history.shot }] : []),
      ...(history.runs ?? []).map(control => ({ type: 'running' as const, ...control })),
    ].map((command, index) => ({ ...command, seq: index + 1 }))
  const sequences = new Set<number>()
  let hasSwing = false
  for (const command of commands) {
    if (!Number.isSafeInteger(command.tick) || command.tick < 0 ||
        !Number.isSafeInteger(command.seq) || command.seq <= 0) {
      throw new Error('Invalid delivery command tick or sequence')
    }
    if (sequences.has(command.seq)) throw new Error('Duplicate delivery command sequence')
    sequences.add(command.seq)
    if (command.type === 'swing') {
      if (hasSwing) throw new Error('Duplicate delivery swing')
      hasSwing = true
    } else if (command.type !== 'running' || typeof command.running !== 'boolean') {
      throw new Error('Invalid delivery command')
    }
  }
  return commands.sort((a, b) => a.tick - b.tick || a.seq - b.seq)
}

/** A cursor consumes accepted commands once, before the step following their tick. */
export class DeliveryReplay {
  readonly sim: Delivery
  readonly commands: readonly OnlineDeliveryCommand[]
  private cursor = 0
  private failed = false

  constructor(source: Readonly<{ options: DeliveryOptions }> & OnlineInputHistory) {
    this.commands = deliveryCommands(source)
    this.sim = new Delivery(source.options)
  }

  advanceTo(tick: number, afterStep?: (sim: Delivery) => void): boolean {
    if (!Number.isSafeInteger(tick) || tick < 0) throw new Error('Invalid delivery replay target tick')
    if (this.failed) return false
    while (this.sim.tick <= tick) {
      while (this.commands[this.cursor]?.tick === this.sim.tick) {
        const command = this.commands[this.cursor]
        const accepted = command.type === 'swing'
          ? this.sim.swing(command.input) : this.sim.setRunning(command.running)
        if (!accepted) {
          this.failed = true
          return false
        }
        this.cursor++
      }
      if (this.sim.tick === tick || this.sim.outcome) break
      this.sim.step()
      afterStep?.(this.sim)
    }
    // A revised shot can end the delivery before an earlier accepted run command.
    // The caller must reject that candidate rather than silently lose the command.
    if (this.commands[this.cursor] && this.commands[this.cursor].tick <= tick) this.failed = true
    return !this.failed
  }
}
