import type { ToolCall, ToolResult } from '@shared/types'
import type { Runner } from './runner'
import { handleApp } from './handlers/apps'
import { handleSystem } from './handlers/system'
import { handleFiles } from './handlers/files'
import { handleDevtools } from './handlers/devtools'
import { handleQuery } from './handlers/query'

type Handler = (call: ToolCall, r: Runner) => Promise<unknown>

const ROUTES: Record<string, Handler> = {
  open_app: handleApp, quit_app: handleApp,
  set_volume: handleSystem, lock_screen: handleSystem, set_brightness: handleSystem, set_dnd: handleSystem,
  list_directory: handleFiles, create_folder: handleFiles, move_file: handleFiles, rename_file: handleFiles,
  launch_dev_tool: handleDevtools,
  query_info: handleQuery,
  run_shell: async (call, r) => ({ stdout: await r.exec('/bin/sh', ['-c', String(call.args.command)]) }),
  run_applescript: async (call, r) => ({ stdout: await r.osascript(String(call.args.script)) })
}

export function createExecutor(runner: Runner) {
  return async function execute(call: ToolCall): Promise<ToolResult> {
    const handler = ROUTES[call.name]
    if (!handler) return { id: call.id, name: call.name, ok: false, error: `未知动作 ${call.name}` }
    try {
      const data = await handler(call, runner)
      return { id: call.id, name: call.name, ok: true, data }
    } catch (e: any) {
      return { id: call.id, name: call.name, ok: false, error: String(e?.message ?? e) }
    }
  }
}
