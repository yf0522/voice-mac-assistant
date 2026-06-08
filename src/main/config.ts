import { config as dotenvConfig } from 'dotenv'
import { existsSync } from 'fs'
import { join } from 'path'

// dotenv 默认从 process.cwd() 找 .env。但用 `open Electron.app --args .../out/main/index.js`
// 启动时 cwd 是 `/`，找不到项目里的 .env → key 为空。
// 故按多个候选绝对路径查找：cwd（dev）、__dirname 上溯（out/main → 项目根）。
const candidates = [
  join(process.cwd(), '.env'),
  join(__dirname, '../../.env'),   // out/main -> 项目根
  join(__dirname, '../../../.env')
]
for (const p of candidates) {
  if (existsSync(p)) {
    dotenvConfig({ path: p })
    console.log('[config] 已加载 .env:', p)
    break
  }
}

export const CONFIG = {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? '',
  IDLE_TIMEOUT_MS: 5 * 60 * 1000,
  GEMINI_MODEL: 'gemini-2.0-flash-live-001'
}
