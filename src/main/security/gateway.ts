import { homedir } from 'os'
import { resolve } from 'path'
import type { ToolCall, GatewayDecision } from '@shared/types'

const HOME = homedir()

const GREEN = new Set(['open_app', 'set_volume', 'lock_screen', 'set_brightness', 'set_dnd', 'list_directory', 'query_info', 'launch_dev_tool'])
const YELLOW = new Set(['quit_app', 'create_folder', 'move_file', 'rename_file'])

// run_shell 白名单：命令首 token 必须在此集合
const SHELL_WHITELIST = new Set(['ls', 'cat', 'echo', 'pwd', 'open', 'mkdir', 'touch', 'cp', 'mv', 'df', 'du', 'date', 'whoami'])
const SHELL_DANGER = /(\brm\b|\bsudo\b|\bdd\b|\bmkfs\b|:\(\)\{|`|\$\(|>>?\s*\/|\bshutdown\b|\breboot\b|\bkillall\b|\bchmod\b\s+-R)/

// 把 ~ 展开并解析为绝对路径，要求落在 HOME 沙箱内
function pathInSandbox(p: unknown): boolean {
  if (typeof p !== 'string' || p.length === 0) return false
  const expanded = p.startsWith('~') ? p.replace(/^~/, HOME) : p
  const abs = resolve(expanded)
  return abs === HOME || abs.startsWith(HOME + '/')
}

// 从动作参数里抽出所有“路径型”字段
function pathArgs(call: ToolCall): string[] {
  const keys = ['path', 'src', 'dst', 'project_path']
  return keys.filter(k => k in call.args).map(k => String(call.args[k]))
}

function deny(reason: string): GatewayDecision {
  return { risk: 'red', allowed: false, needsConfirm: false, reason }
}

export function classify(call: ToolCall): GatewayDecision {
  const known = GREEN.has(call.name) || YELLOW.has(call.name) || call.name === 'run_shell'
  if (!known) return deny(`未知动作 ${call.name}，已拒绝`)

  // 路径沙箱校验（对所有带路径的动作）
  for (const p of pathArgs(call)) {
    if (!pathInSandbox(p)) return deny(`路径越出用户目录沙箱：${p}`)
  }

  if (call.name === 'run_shell') {
    const cmd = String(call.args.command ?? '')
    if (SHELL_DANGER.test(cmd)) return deny(`命令命中危险模式，已拒绝：${cmd}`)
    // 拒绝命令链/管道/后台等 shell 元字符，防止首-token 白名单绕过（如 `ls; curl ... | sh`）
    if (/[;&|\n]/.test(cmd)) return deny(`命令含 shell 元字符，禁止链式/管道命令：${cmd}`)
    const first = cmd.trim().split(/\s+/)[0]
    if (!SHELL_WHITELIST.has(first)) return deny(`命令不在白名单：${first}`)
    return { risk: 'yellow', allowed: true, needsConfirm: true, confirmPrompt: cmd }
  }

  if (YELLOW.has(call.name)) {
    return { risk: 'yellow', allowed: true, needsConfirm: true, confirmPrompt: describeYellow(call) }
  }
  return { risk: 'green', allowed: true, needsConfirm: false }
}

function describeYellow(call: ToolCall): string {
  switch (call.name) {
    case 'quit_app': return `退出应用 ${call.args.app_name}`
    case 'create_folder': return `在 ${call.args.path} 新建文件夹 ${call.args.name}`
    case 'move_file': return `移动 ${call.args.src} → ${call.args.dst}`
    case 'rename_file': return `重命名 ${call.args.src} → ${call.args.name}`
    default: return call.name
  }
}
