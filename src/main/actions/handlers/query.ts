import type { ToolCall } from '@shared/types'
import type { Runner } from '../runner'

// 桩：Phase 4 实现时间/日期等只读查询。
export async function handleQuery(call: ToolCall, _r: Runner) {
  return { todo: call.name }
}
