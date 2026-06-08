import type { SessionState } from '@shared/types'

export interface SessionMachineOpts {
  idleMs: number
  onChange?: (s: SessionState) => void
}

export function createSessionMachine(opts: SessionMachineOpts) {
  let state: SessionState = 'standby'
  let timer: ReturnType<typeof setTimeout> | null = null

  function clear() { if (timer) { clearTimeout(timer); timer = null } }
  function set(next: SessionState) { if (next !== state) { state = next; opts.onChange?.(state) } }
  function arm() { clear(); timer = setTimeout(() => { set('standby'); clear() }, opts.idleMs) }

  return {
    get state() { return state },
    onWake() { set('active'); arm() },
    onActivity() { if (state === 'active') arm() },
    onDismiss() { clear(); set('standby') }
  }
}
