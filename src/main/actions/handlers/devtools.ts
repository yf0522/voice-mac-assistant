import { homedir } from 'os'
import { resolve } from 'path'
import type { ToolCall } from '@shared/types'
import type { Runner } from '../runner'

const TOOL_CMD: Record<string, string> = { claude: 'claude', code: 'code .', gemini: 'gemini' }

export async function handleDevtools(call: ToolCall, r: Runner) {
  const tool = String(call.args.tool)
  const cmd = TOOL_CMD[tool]
  if (!cmd) throw new Error(`未知开发工具 ${tool}`)
  const dir = call.args.project_path
    ? resolve(String(call.args.project_path).replace(/^~/, homedir()))
    : homedir()
  // 用 AppleScript 驱动 iTerm2：新建窗口 → cd 项目 → 运行工具
  const script = `
    tell application "iTerm"
      activate
      set newWindow to (create window with default profile)
      tell current session of newWindow
        write text "cd ${dir.replace(/"/g, '\\"')} && ${cmd}"
      end tell
    end tell`
  await r.osascript(script)
  return { launched: tool, dir }
}
