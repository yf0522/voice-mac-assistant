import type { ToolCall } from '@shared/types'
import type { Runner } from '../runner'

export async function handleApp(call: ToolCall, r: Runner) {
  if (call.name === 'open_app') {
    await r.osascript(`tell application "${call.args.app_name}" to activate`)
    return { opened: call.args.app_name }
  }
  await r.osascript(`tell application "${call.args.app_name}" to quit`)
  return { quit: call.args.app_name }
}
