import { homedir } from 'os'
import { resolve } from 'path'
import type { ToolCall } from '@shared/types'
import type { Runner } from '../runner'

const HOME = homedir()
const TOOL_CMD: Record<string, string> = { claude: 'claude', code: 'code .', gemini: 'gemini' }

// 断言 realpath 解析后的真实路径落在 HOME 沙箱内（跟随 symlink，与 files.ts 一致）。
function assertReal(real: string): void {
  if (real !== HOME && !real.startsWith(HOME + '/')) {
    throw new Error(`路径越出沙箱：${real}`)
  }
}

// POSIX shell 安全引用：单引号包裹，内部单引号转义为 '\''。
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

// AppleScript 字符串转义：反斜杠与双引号。
function appleEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export async function handleDevtools(call: ToolCall, r: Runner) {
  const tool = String(call.args.tool)
  const cmd = TOOL_CMD[tool]
  if (!cmd) throw new Error(`未知开发工具 ${tool}`)

  const hasPath = call.args.project_path != null && String(call.args.project_path).length > 0
  const dir = hasPath
    ? resolve(String(call.args.project_path).replace(/^~/, HOME))
    : HOME
  // realpath symlink 沙箱二次校验（缺省 homedir 时跳过；project_path 指向的目录应已存在）
  if (hasPath) {
    const real = await r.realpath(dir)
    assertReal(real)
  }

  // 把 dir 用单引号安全包裹再嵌入 shell 命令，再对整条 AppleScript 字符串做 AppleScript 转义。
  const shellLine = `cd ${shellQuote(dir)} && ${cmd}`
  const script = `
    tell application "iTerm"
      activate
      set newWindow to (create window with default profile)
      tell current session of newWindow
        write text "${appleEscape(shellLine)}"
      end tell
    end tell`
  await r.osascript(script)
  return { launched: tool, dir }
}
