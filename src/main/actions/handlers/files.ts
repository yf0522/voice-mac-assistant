import { homedir } from 'os'
import { resolve, dirname } from 'path'
import type { ToolCall } from '@shared/types'
import type { Runner } from '../runner'

const HOME = homedir()

// 展开 ~ 并解析为绝对路径（仅做字符串层面归一，不跟随 symlink）。
const abs = (p: string) => resolve(p.startsWith('~') ? p.replace(/^~/, HOME) : p)

// 给定一个已被 realpath 解析过的真实绝对路径，断言其落在 HOME 沙箱内。
function assertReal(real: string): void {
  if (real !== HOME && !real.startsWith(HOME + '/')) {
    throw new Error(`路径越出沙箱：${real}`)
  }
}

// 校验「已存在」的路径：对其自身做 realpath（跟随 symlink）后断言在沙箱内，
// 返回归一后的绝对路径供后续 fs 操作使用。
async function guardExisting(r: Runner, p: string): Promise<string> {
  const a = abs(p)
  const real = await r.realpath(a)
  assertReal(real)
  return a
}

// 校验「尚不存在」的目标路径：目标本身 realpath 会 ENOENT，
// 故对其父目录做 realpath 校验（父目录必须已存在且在沙箱内），
// 返回归一后的绝对目标路径。
async function guardTarget(r: Runner, target: string): Promise<string> {
  const a = abs(target)
  const parentReal = await r.realpath(dirname(a))
  assertReal(parentReal)
  return a
}

export async function handleFiles(call: ToolCall, r: Runner) {
  switch (call.name) {
    case 'list_directory': {
      const p = await guardExisting(r, String(call.args.path))
      return { items: await r.readdir(p) }
    }
    case 'create_folder': {
      const target = resolve(abs(String(call.args.path)), String(call.args.name))
      const dst = await guardTarget(r, target)
      await r.mkdir(dst)
      return { created: dst }
    }
    case 'move_file': {
      const src = await guardExisting(r, String(call.args.src))
      const dst = await guardTarget(r, String(call.args.dst))
      await r.rename(src, dst)
      return { moved: true }
    }
    case 'rename_file': {
      const src = await guardExisting(r, String(call.args.src))
      const target = resolve(src, '..', String(call.args.name))
      const dst = await guardTarget(r, target)
      await r.rename(src, dst)
      return { renamed: dst }
    }
    default:
      throw new Error(`files: 未知 ${call.name}`)
  }
}
