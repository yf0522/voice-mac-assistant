import type { ToolCall } from '@shared/types'
import type { Runner } from '../runner'

export async function handleSystem(call: ToolCall, r: Runner) {
  switch (call.name) {
    case 'set_volume': {
      if (typeof call.args.level === 'number') {
        const lvl = Math.max(0, Math.min(100, call.args.level))
        await r.osascript(`set volume output volume ${lvl}`)
        return { volume: lvl }
      }
      const delta = Number(call.args.delta ?? 0)
      const cur = Number(await r.osascript('output volume of (get volume settings)'))
      const next = Math.max(0, Math.min(100, cur + delta))
      await r.osascript(`set volume output volume ${next}`)
      return { volume: next }
    }
    case 'lock_screen':
      await r.exec('pmset', ['displaysleepnow'])
      return { locked: true }
    case 'set_brightness': {
      const lvl = Math.max(0, Math.min(100, Number(call.args.level)))
      // 依赖 brightness CLI（brew install brightness）；0-1 取值
      await r.exec('brightness', [String(lvl / 100)])
      return { brightness: lvl }
    }
    case 'set_dnd': {
      const name = call.args.on ? '打开勿扰模式' : '关闭勿扰模式'
      await r.exec('shortcuts', ['run', name])
      return { dnd: !!call.args.on }
    }
    default: throw new Error(`system: 未知 ${call.name}`)
  }
}
