import type { ToolCall } from '@shared/types'
import type { Runner } from '../runner'

// 桩：Phase 4 实现真实系统控制（音量/锁屏/亮度/勿扰）。
export async function handleSystem(call: ToolCall, _r: Runner) {
  return { todo: call.name }
}
