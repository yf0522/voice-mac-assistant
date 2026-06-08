import { promisify } from 'util'
import { execFile as _execFile } from 'child_process'
import { promises as fs } from 'fs'
const execFileP = promisify(_execFile)

// 副作用边界：所有 handler 只通过这个接口触达系统，方便测试注入 mock。
export interface Runner {
  osascript(script: string): Promise<string>
  exec(file: string, args: string[]): Promise<string>
  readdir(path: string): Promise<string[]>
  mkdir(path: string): Promise<void>
  rename(src: string, dst: string): Promise<void>
  // 解析真实路径（跟随 symlink），用于沙箱越界校验。
  realpath(path: string): Promise<string>
}

export const realRunner: Runner = {
  async osascript(script) { return (await execFileP('osascript', ['-e', script])).stdout.trim() },
  async exec(file, args) { return (await execFileP(file, args)).stdout.trim() },
  async readdir(path) { return fs.readdir(path) },
  async mkdir(path) { await fs.mkdir(path, { recursive: false }) },
  async rename(src, dst) { await fs.rename(src, dst) },
  async realpath(path) { return fs.realpath(path) }
}
