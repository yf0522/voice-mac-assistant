import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSessionMachine } from '../src/main/session/stateMachine'

describe('session state machine', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('初始为 standby', () => {
    const m = createSessionMachine({ idleMs: 1000 })
    expect(m.state).toBe('standby')
  })
  it('onWake -> active 并触发回调', () => {
    const onChange = vi.fn()
    const m = createSessionMachine({ idleMs: 1000, onChange })
    m.onWake()
    expect(m.state).toBe('active')
    expect(onChange).toHaveBeenCalledWith('active')
  })
  it('active 下静默超时回 standby', () => {
    const onChange = vi.fn()
    const m = createSessionMachine({ idleMs: 1000, onChange })
    m.onWake()
    vi.advanceTimersByTime(1000)
    expect(m.state).toBe('standby')
    expect(onChange).toHaveBeenLastCalledWith('standby')
  })
  it('onActivity 重置静默计时', () => {
    const m = createSessionMachine({ idleMs: 1000 })
    m.onWake()
    vi.advanceTimersByTime(800); m.onActivity()
    vi.advanceTimersByTime(800); expect(m.state).toBe('active') // 未超时
    vi.advanceTimersByTime(200); expect(m.state).toBe('standby')
  })
  it('onDismiss 立刻回 standby', () => {
    const m = createSessionMachine({ idleMs: 1000 })
    m.onWake(); m.onDismiss()
    expect(m.state).toBe('standby')
  })
  it('standby 下 onWake 重复调用幂等', () => {
    const m = createSessionMachine({ idleMs: 1000 })
    m.onWake(); m.onWake()
    expect(m.state).toBe('active')
  })
})
