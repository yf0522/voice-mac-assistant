import type { ToolCall } from '@shared/types'
import type { Runner } from '../runner'

// 桩：Phase 4 实现 iTerm2 调起 claude/code/gemini。
export async function handleDevtools(call: ToolCall, _r: Runner) {
  return { todo: call.name }
}
