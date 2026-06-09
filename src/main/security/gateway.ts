import type { ToolCall, GatewayDecision } from '@shared/types'

// 已放权策略（用户要求）：除「破坏性命令」需二次确认外，其余动作一律直接执行、不打扰。
// 安全仍保留两道：① 未知动作拒绝；② run_shell 命中破坏性模式 → 需确认（不直接拒）。
const KNOWN = new Set([
  'open_app', 'quit_app', 'set_volume', 'lock_screen', 'set_brightness', 'set_dnd',
  'list_directory', 'create_folder', 'move_file', 'rename_file',
  'launch_dev_tool', 'query_info', 'run_shell', 'run_applescript'
])

// 破坏性命令：递归/强制删除、磁盘抹除、写裸设备、fork 炸弹、关机重启等 → 需确认
const DESTRUCTIVE = /\brm\b[^|;&]*\s-(?:[a-z]*r[a-z]*f|[a-z]*f[a-z]*r|rf|fr|r|f)\b|\bmkfs\b|\bdd\b\s+if=|\bdiskutil\b\s+(erase|reformat)|>\s*\/dev\/|:\(\)\s*\{|\bshutdown\b|\breboot\b|\bhalt\b/i

function deny(reason: string): GatewayDecision {
  return { risk: 'red', allowed: false, needsConfirm: false, reason }
}
const green: GatewayDecision = { risk: 'green', allowed: true, needsConfirm: false }

export function classify(call: ToolCall): GatewayDecision {
  if (!KNOWN.has(call.name)) return deny(`未知动作 ${call.name}，已拒绝`)

  if (call.name === 'run_shell') {
    const cmd = String(call.args.command ?? '')
    if (DESTRUCTIVE.test(cmd)) {
      return { risk: 'yellow', allowed: true, needsConfirm: true, confirmPrompt: cmd }
    }
    return green
  }

  // 其余所有动作：直接执行，无需确认
  return green
}
