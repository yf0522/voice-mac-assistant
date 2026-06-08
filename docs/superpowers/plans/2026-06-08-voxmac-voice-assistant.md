# VoxMac 实时语音助手 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个 macOS 独立桌面 App（Electron + TypeScript），用唤醒词「贾维斯」唤起，经 Gemini Live API 实时双向语音对话，理解意图后经三级安全网关执行 macOS 动作（开关 App、系统控制、文件目录、信息查询、用 iTerm2 调起 Claude Code / VS Code / Gemini CLI），并把结果用语音说回；支持唤醒后连续对话、静默 5 分钟自动回待机。

**Architecture:** Electron 双进程。**主进程（Node）** 持有 `GEMINI_API_KEY`，拥有 Gemini Live 会话、工具注册表、三级安全网关、动作执行器、会话状态机；**渲染进程（Chromium）** 负责麦克风采集（Web Audio AudioWorklet，下采样到 16kHz PCM）、Porcupine 本地唤醒词、VAD、24kHz 音频回放、UI。两进程通过 `contextBridge` + IPC 通信：渲染进程把音频帧/唤醒/VAD 事件发给主进程，主进程把模型音频、转录、动作日志、确认请求发回渲染进程。纯逻辑单元（安全网关、执行器、状态机、重采样、Gemini 消息解析）走 TDD；集成胶水（Electron 壳、音频、Porcupine、UI）走具体接线任务。

**Tech Stack:** Electron, TypeScript, electron-vite, Vitest（单测）, `@google/genai`（Gemini Live）, `@picovoice/porcupine-web` + `@picovoice/web-voice-processor`（唤醒词）, Node `child_process`/`fs`（macOS 执行）, `osascript`（AppleScript 桥）。

**项目根目录：** `/Users/macbook/workSpace/voice-mac-assistant`

---

## 文件结构（决策锁定）

```
voice-mac-assistant/
├─ package.json
├─ tsconfig.json
├─ tsconfig.node.json
├─ electron.vite.config.ts
├─ vitest.config.ts
├─ .env.example                      # GEMINI_API_KEY / PICOVOICE_ACCESS_KEY
├─ .gitignore
├─ resources/
│  └─ jarvis.ppn                     # 用户从 Picovoice 控制台训练的「贾维斯」中文唤醒词模型（执行阶段放入）
├─ src/
│  ├─ shared/
│  │  ├─ types.ts                    # 跨进程共享类型：ToolCall / ToolResult / RiskLevel / IpcChannels / SessionState
│  │  └─ tools.ts                    # functionDeclarations（工具 schema，单一真相源）
│  ├─ main/
│  │  ├─ index.ts                    # Electron 主进程入口：建窗、装配、IPC
│  │  ├─ ipc.ts                      # IPC 频道注册与转发
│  │  ├─ config.ts                   # 读取 env / 常量（IDLE_TIMEOUT_MS 等）
│  │  ├─ security/
│  │  │  └─ gateway.ts               # 三级安全网关（纯逻辑，TDD）
│  │  ├─ actions/
│  │  │  ├─ executor.ts              # 动作分发器（注入 runner，TDD）
│  │  │  ├─ runner.ts                # 真实命令执行封装（exec/spawn/fs）
│  │  │  └─ handlers/
│  │  │     ├─ apps.ts               # open_app / quit_app
│  │  │     ├─ system.ts             # set_volume / lock_screen / set_brightness / set_dnd
│  │  │     ├─ files.ts              # list_directory / create_folder / move_file / rename_file（沙箱）
│  │  │     ├─ devtools.ts           # launch_dev_tool（iTerm2 → claude/code/gemini）
│  │  │     └─ query.ts              # query_info
│  │  ├─ session/
│  │  │  └─ stateMachine.ts          # 待机↔激活、连续对话、静默5分钟（注入时钟，TDD）
│  │  └─ gemini/
│  │     ├─ liveClient.ts            # 封装 @google/genai Live 会话
│  │     └─ messages.ts              # 解析 server 消息为 {audio,text,toolCalls}（纯逻辑，TDD）
│  ├─ preload/
│  │  └─ index.ts                    # contextBridge 暴露安全 API
│  └─ renderer/
│     ├─ index.html
│     ├─ main.ts                     # 渲染进程入口：装配音频/唤醒/UI
│     ├─ audio/
│     │  ├─ resample.ts              # Float32 48k → Int16 16k PCM（纯逻辑，TDD）
│     │  ├─ capture.ts              # getUserMedia + AudioWorklet 采集
│     │  ├─ worklet-processor.js     # AudioWorklet：抽帧回传
│     │  ├─ vad.ts                   # 能量阈值 VAD（纯逻辑，TDD）
│     │  └─ playback.ts              # 24kHz PCM 播放队列 + barge-in
│     ├─ wakeword.ts                 # Porcupine web 唤醒词
│     └─ ui/
│        ├─ ui.ts                    # 状态/转录/动作日志/确认弹窗渲染（移植原型）
│        └─ ui.css                   # 样式（移植 design-and-prototype.html 视觉）
└─ tests/                            # 见各 Task；与被测文件同名 .test.ts
```

设计原则：纯逻辑与副作用分离——网关/执行分发/状态机/重采样/消息解析不直接碰 `child_process`/`fs`/时钟/网络，而是注入依赖，使其可单测。

---

## 阶段总览（每阶段产出可运行/可测软件）

- **Phase 0** 脚手架：空 Electron 窗口能启动，`npm test` 能跑。
- **Phase 1** 共享类型 + 工具 schema。
- **Phase 2** 三级安全网关（TDD）。
- **Phase 3** 动作执行器 + 分发（TDD，mock runner）。
- **Phase 4** macOS handlers 真实实现（apps/system/files/devtools/query）。
- **Phase 5** 会话状态机（TDD，注入时钟）。
- **Phase 6** Gemini 消息解析（TDD）+ Live 客户端封装。
- **Phase 7** IPC 接线（主↔渲染）。
- **Phase 8** 渲染进程音频：重采样（TDD）、VAD（TDD）、采集、播放。
- **Phase 9** 唤醒词（Porcupine）。
- **Phase 10** UI 移植 + 端到端装配 + 手动测试清单。

---

## Phase 0 — 项目脚手架

### Task 0.1: 初始化仓库与依赖

**Files:**
- Create: `package.json`, `.gitignore`, `.env.example`

- [ ] **Step 1: 初始化 git 与 npm**

```bash
cd /Users/macbook/workSpace/voice-mac-assistant
git init
npm init -y
```

- [ ] **Step 2: 安装依赖**

```bash
npm i electron-vite vite electron typescript @types/node vitest --save-dev
npm i @google/genai @picovoice/porcupine-web @picovoice/web-voice-processor dotenv
```

- [ ] **Step 3: 写 `.gitignore`**

```
node_modules/
out/
dist/
.env
.DS_Store
resources/*.ppn
```

- [ ] **Step 4: 写 `.env.example`**

```
GEMINI_API_KEY=your_gemini_key_here
PICOVOICE_ACCESS_KEY=your_picovoice_access_key_here
```

- [ ] **Step 5: 配置 `package.json` scripts**

把 `scripts` 改为：

```json
{
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "start": "electron-vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 6: 提交**

```bash
git add -A && git commit -m "chore: init electron + vite + vitest scaffold"
```

### Task 0.2: TypeScript 与构建配置

**Files:**
- Create: `tsconfig.json`, `tsconfig.node.json`, `electron.vite.config.ts`, `vitest.config.ts`

- [ ] **Step 1: 写 `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node", "vitest/globals"],
    "baseUrl": ".",
    "paths": { "@shared/*": ["src/shared/*"] }
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 2: 写 `tsconfig.node.json`**（electron-vite 需要）

```json
{ "extends": "./tsconfig.json", "include": ["electron.vite.config.ts"] }
```

- [ ] **Step 3: 写 `electron.vite.config.ts`**

```ts
import { resolve } from 'path'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    build: { rollupOptions: { input: { index: resolve('src/main/index.ts') } } },
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  preload: {
    build: { rollupOptions: { input: { index: resolve('src/preload/index.ts') } } }
  },
  renderer: {
    root: 'src/renderer',
    build: { rollupOptions: { input: { index: resolve('src/renderer/index.html') } } },
    resolve: { alias: { '@shared': resolve('src/shared') } }
  }
})
```

- [ ] **Step 4: 写 `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: { globals: true, environment: 'node', include: ['tests/**/*.test.ts'] },
  resolve: { alias: { '@shared': resolve('src/shared') } }
})
```

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "chore: typescript + electron-vite + vitest config"
```

### Task 0.3: 最小可启动的空窗口

**Files:**
- Create: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/main.ts`

- [ ] **Step 1: 写 `src/main/index.ts`**

```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'path'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 420, height: 680, resizable: false, titleBarStyle: 'hiddenInset',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false }
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
```

- [ ] **Step 2: 写 `src/preload/index.ts`**（占位，后续 Phase 7 扩展）

```ts
import { contextBridge } from 'electron'
contextBridge.exposeInMainWorld('vox', { ping: () => 'pong' })
```

- [ ] **Step 3: 写 `src/renderer/index.html`**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8" /><title>VoxMac</title></head>
<body><div id="app">VoxMac 启动中…</div><script type="module" src="./main.ts"></script></body>
</html>
```

- [ ] **Step 4: 写 `src/renderer/main.ts`**

```ts
const el = document.getElementById('app')!
el.textContent = 'VoxMac · 待命中（脚手架）'
```

- [ ] **Step 5: 启动验证**

Run: `npm run dev`
Expected: 弹出 420×680 窗口，显示「VoxMac · 待命中（脚手架）」。确认后关闭。

- [ ] **Step 6: 提交**

```bash
git add -A && git commit -m "feat: minimal electron window boots"
```

---

## Phase 1 — 共享类型与工具 Schema

### Task 1.1: 共享类型

**Files:**
- Create: `src/shared/types.ts`

- [ ] **Step 1: 写 `src/shared/types.ts`**

```ts
export type RiskLevel = 'green' | 'yellow' | 'red'

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

export interface ToolResult {
  id: string
  name: string
  ok: boolean
  data?: unknown
  error?: string
}

export type SessionState = 'standby' | 'active'

export interface GatewayDecision {
  risk: RiskLevel
  allowed: boolean          // red => false
  needsConfirm: boolean     // yellow => true
  reason?: string           // 拒绝/确认原因（用于语音与 UI）
  confirmPrompt?: string    // 确认弹窗里展示的命令/动作描述
}

export const IPC = {
  // renderer -> main
  AUDIO_CHUNK: 'audio:chunk',
  WAKE_DETECTED: 'wake:detected',
  VAD: 'vad:state',
  CONFIRM_RESULT: 'action:confirm-result',
  // main -> renderer
  STATE: 'session:state',
  IDLE_TICK: 'session:idle-tick',
  MODEL_AUDIO: 'model:audio',
  TRANSCRIPT: 'model:transcript',
  ACTION_LOG: 'action:log',
  CONFIRM_REQUEST: 'action:confirm-request'
} as const
```

- [ ] **Step 2: 提交**

```bash
git add -A && git commit -m "feat: shared cross-process types"
```

### Task 1.2: 工具 Schema（functionDeclarations）

**Files:**
- Create: `src/shared/tools.ts`

- [ ] **Step 1: 写 `src/shared/tools.ts`**

```ts
import { Type } from '@google/genai'

// 单一真相源：Gemini 工具声明。新增动作时只改这里 + 对应 handler。
export const functionDeclarations = [
  { name: 'open_app', description: '打开 macOS 应用',
    parameters: { type: Type.OBJECT, properties: { app_name: { type: Type.STRING } }, required: ['app_name'] } },
  { name: 'quit_app', description: '退出 macOS 应用',
    parameters: { type: Type.OBJECT, properties: { app_name: { type: Type.STRING } }, required: ['app_name'] } },
  { name: 'set_volume', description: '设置或调整系统音量。level 为绝对值 0-100，delta 为相对增减',
    parameters: { type: Type.OBJECT, properties: { level: { type: Type.NUMBER }, delta: { type: Type.NUMBER } } } },
  { name: 'lock_screen', description: '锁定屏幕',
    parameters: { type: Type.OBJECT, properties: {} } },
  { name: 'set_brightness', description: '设置屏幕亮度 0-100',
    parameters: { type: Type.OBJECT, properties: { level: { type: Type.NUMBER } }, required: ['level'] } },
  { name: 'set_dnd', description: '开关勿扰模式',
    parameters: { type: Type.OBJECT, properties: { on: { type: Type.BOOLEAN } }, required: ['on'] } },
  { name: 'list_directory', description: '列出目录内容（仅限用户主目录内）',
    parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING } }, required: ['path'] } },
  { name: 'create_folder', description: '在指定目录新建文件夹（沙箱内）',
    parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING }, name: { type: Type.STRING } }, required: ['path', 'name'] } },
  { name: 'move_file', description: '移动文件（沙箱内）',
    parameters: { type: Type.OBJECT, properties: { src: { type: Type.STRING }, dst: { type: Type.STRING } }, required: ['src', 'dst'] } },
  { name: 'rename_file', description: '重命名文件（沙箱内）',
    parameters: { type: Type.OBJECT, properties: { src: { type: Type.STRING }, name: { type: Type.STRING } }, required: ['src', 'name'] } },
  { name: 'launch_dev_tool', description: '在 iTerm2 打开项目目录并调起开发工具',
    parameters: { type: Type.OBJECT, properties: {
      tool: { type: Type.STRING, enum: ['claude', 'code', 'gemini'] },
      project_path: { type: Type.STRING }
    }, required: ['tool'] } },
  { name: 'query_info', description: '查询时间/日期/系统状态等只读信息',
    parameters: { type: Type.OBJECT, properties: { topic: { type: Type.STRING } }, required: ['topic'] } },
  { name: 'run_shell', description: '执行受限 shell 命令（白名单内，需确认）',
    parameters: { type: Type.OBJECT, properties: { command: { type: Type.STRING } }, required: ['command'] } }
]
```

- [ ] **Step 2: 提交**

```bash
git add -A && git commit -m "feat: gemini tool declarations (single source of truth)"
```

---

## Phase 2 — 三级安全网关（TDD）

### Task 2.1: 网关分级与白名单

**Files:**
- Create: `src/main/security/gateway.ts`
- Test: `tests/gateway.test.ts`

网关职责：给定 `ToolCall`，返回 `GatewayDecision`。规则：
- **绿（直接）**：`open_app, set_volume, lock_screen, set_brightness, set_dnd, list_directory, query_info, launch_dev_tool`
- **黄（需确认）**：`quit_app, create_folder, move_file, rename_file`，以及 `run_shell` 且命令前缀在白名单内
- **红（拒绝）**：`run_shell` 命令命中危险模式（`rm -rf`、`sudo`、`dd`、`mkfs`、`:(){`、`>`/`>>` 重定向到系统路径、反引号/`$()` 命令替换）或不在白名单；任何带文件路径的动作若路径越出用户主目录沙箱

- [ ] **Step 1: 写失败测试 `tests/gateway.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { classify } from '../src/main/security/gateway'

const call = (name: string, args: any = {}) => ({ id: '1', name, args })

describe('gateway classify', () => {
  it('绿色动作直接放行', () => {
    const d = classify(call('open_app', { app_name: 'Safari' }))
    expect(d.risk).toBe('green'); expect(d.allowed).toBe(true); expect(d.needsConfirm).toBe(false)
  })

  it('黄色动作需要确认', () => {
    const d = classify(call('move_file', { src: '~/Downloads/a', dst: '~/Documents/a' }))
    expect(d.risk).toBe('yellow'); expect(d.allowed).toBe(true); expect(d.needsConfirm).toBe(true)
  })

  it('run_shell 白名单内 -> 黄色需确认', () => {
    const d = classify(call('run_shell', { command: 'ls ~/Downloads' }))
    expect(d.risk).toBe('yellow'); expect(d.needsConfirm).toBe(true)
  })

  it('run_shell 危险命令 -> 红色拒绝', () => {
    const d = classify(call('run_shell', { command: 'rm -rf /' }))
    expect(d.risk).toBe('red'); expect(d.allowed).toBe(false)
  })

  it('run_shell sudo -> 红色拒绝', () => {
    expect(classify(call('run_shell', { command: 'sudo reboot' })).allowed).toBe(false)
  })

  it('文件动作路径越界 -> 红色拒绝', () => {
    const d = classify(call('list_directory', { path: '/etc' }))
    expect(d.risk).toBe('red'); expect(d.allowed).toBe(false)
  })

  it('文件动作含 .. 逃逸 -> 红色拒绝', () => {
    const d = classify(call('move_file', { src: '~/Downloads/../../etc/passwd', dst: '~/x' }))
    expect(d.allowed).toBe(false)
  })

  it('未知动作 -> 红色拒绝', () => {
    expect(classify(call('format_disk')).allowed).toBe(false)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/gateway.test.ts`
Expected: FAIL（`classify` 未定义）

- [ ] **Step 3: 写实现 `src/main/security/gateway.ts`**

```ts
import { homedir } from 'os'
import { resolve } from 'path'
import type { ToolCall, GatewayDecision, RiskLevel } from '@shared/types'

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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- tests/gateway.test.ts`
Expected: PASS（8 个用例全绿）

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat: 3-tier security gateway with whitelist + path sandbox (TDD)"
```

---

## Phase 3 — 动作执行器 + 分发（TDD，mock runner）

### Task 3.1: 执行器分发（注入 runner）

执行器把 `ToolCall` 路由到对应 handler。handler 通过注入的 `Runner` 接口执行副作用，便于 mock。

**Files:**
- Create: `src/main/actions/runner.ts`（接口 + 真实实现）
- Create: `src/main/actions/executor.ts`
- Test: `tests/executor.test.ts`

- [ ] **Step 1: 写 `src/main/actions/runner.ts`**（接口先行，真实实现 Phase 4 填充）

```ts
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
}

export const realRunner: Runner = {
  async osascript(script) { return (await execFileP('osascript', ['-e', script])).stdout.trim() },
  async exec(file, args) { return (await execFileP(file, args)).stdout.trim() },
  async readdir(path) { return fs.readdir(path) },
  async mkdir(path) { await fs.mkdir(path, { recursive: false }) },
  async rename(src, dst) { await fs.rename(src, dst) }
}
```

- [ ] **Step 2: 写失败测试 `tests/executor.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest'
import { createExecutor } from '../src/main/actions/executor'
import type { Runner } from '../src/main/actions/runner'

function mockRunner(): Runner {
  return {
    osascript: vi.fn(async () => ''),
    exec: vi.fn(async () => ''),
    readdir: vi.fn(async () => ['a.txt', 'b.png']),
    mkdir: vi.fn(async () => {}),
    rename: vi.fn(async () => {})
  }
}
const call = (name: string, args: any = {}) => ({ id: '1', name, args })

describe('executor', () => {
  it('open_app 调 osascript', async () => {
    const r = mockRunner(); const exec = createExecutor(r)
    const res = await exec(call('open_app', { app_name: 'Safari' }))
    expect(res.ok).toBe(true)
    expect(r.osascript).toHaveBeenCalledOnce()
  })

  it('list_directory 返回文件列表', async () => {
    const r = mockRunner(); const exec = createExecutor(r)
    const res = await exec(call('list_directory', { path: '~/Downloads' }))
    expect(res.ok).toBe(true)
    expect((res.data as any).items).toEqual(['a.txt', 'b.png'])
  })

  it('handler 抛错 -> ok:false 且带 error', async () => {
    const r = mockRunner(); (r.readdir as any).mockRejectedValueOnce(new Error('ENOENT'))
    const exec = createExecutor(r)
    const res = await exec(call('list_directory', { path: '~/none' }))
    expect(res.ok).toBe(false); expect(res.error).toContain('ENOENT')
  })

  it('未知动作 -> ok:false', async () => {
    const exec = createExecutor(mockRunner())
    const res = await exec(call('nope'))
    expect(res.ok).toBe(false)
  })
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npm test -- tests/executor.test.ts`
Expected: FAIL（`createExecutor` 未定义）

- [ ] **Step 4: 写 `src/main/actions/executor.ts`**

```ts
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
  run_shell: async (call, r) => ({ stdout: await r.exec('/bin/sh', ['-c', String(call.args.command)]) })
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
```

- [ ] **Step 5: 写最小 handler 桩**（让测试可编译；真实逻辑 Phase 4 完善）

`src/main/actions/handlers/apps.ts`:

```ts
import type { ToolCall } from '@shared/types'
import type { Runner } from '../runner'
export async function handleApp(call: ToolCall, r: Runner) {
  if (call.name === 'open_app') { await r.osascript(`tell application "${call.args.app_name}" to activate`); return { opened: call.args.app_name } }
  await r.osascript(`tell application "${call.args.app_name}" to quit`); return { quit: call.args.app_name }
}
```

`src/main/actions/handlers/files.ts`:

```ts
import { homedir } from 'os'
import { resolve } from 'path'
import type { ToolCall } from '@shared/types'
import type { Runner } from '../runner'
const abs = (p: string) => resolve(p.startsWith('~') ? p.replace(/^~/, homedir()) : p)
export async function handleFiles(call: ToolCall, r: Runner) {
  switch (call.name) {
    case 'list_directory': return { items: await r.readdir(abs(String(call.args.path))) }
    case 'create_folder': { const p = resolve(abs(String(call.args.path)), String(call.args.name)); await r.mkdir(p); return { created: p } }
    case 'move_file': { await r.rename(abs(String(call.args.src)), abs(String(call.args.dst))); return { moved: true } }
    case 'rename_file': { const src = abs(String(call.args.src)); const dst = resolve(src, '..', String(call.args.name)); await r.rename(src, dst); return { renamed: dst } }
    default: throw new Error(`files: 未知 ${call.name}`)
  }
}
```

`src/main/actions/handlers/system.ts`, `devtools.ts`, `query.ts`：先写桩（Phase 4 完善），保证可编译：

```ts
// system.ts
import type { ToolCall } from '@shared/types'; import type { Runner } from '../runner'
export async function handleSystem(call: ToolCall, _r: Runner) { return { todo: call.name } }
```
```ts
// devtools.ts
import type { ToolCall } from '@shared/types'; import type { Runner } from '../runner'
export async function handleDevtools(call: ToolCall, _r: Runner) { return { todo: call.name } }
```
```ts
// query.ts
import type { ToolCall } from '@shared/types'; import type { Runner } from '../runner'
export async function handleQuery(call: ToolCall, _r: Runner) { return { todo: call.name } }
```

- [ ] **Step 6: 运行测试确认通过**

Run: `npm test -- tests/executor.test.ts`
Expected: PASS（4 用例）

- [ ] **Step 7: 提交**

```bash
git add -A && git commit -m "feat: action executor with injected runner (TDD)"
```

---

## Phase 4 — macOS handlers 真实实现

### Task 4.1: 系统控制 handler

**Files:**
- Modify: `src/main/actions/handlers/system.ts`
- Test: `tests/system-handler.test.ts`

- [ ] **Step 1: 写失败测试 `tests/system-handler.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest'
import { handleSystem } from '../src/main/actions/handlers/system'
const r = () => ({ osascript: vi.fn(async () => ''), exec: vi.fn(async () => ''), readdir: vi.fn(async()=>[]), mkdir: vi.fn(async()=>{}), rename: vi.fn(async()=>{}) })
const call = (name: string, args: any = {}) => ({ id: '1', name, args })

describe('system handler', () => {
  it('set_volume 绝对值生成 set volume 脚本', async () => {
    const rr = r(); await handleSystem(call('set_volume', { level: 50 }), rr as any)
    expect((rr.osascript as any).mock.calls[0][0]).toContain('set volume output volume 50')
  })
  it('lock_screen 调 pmset', async () => {
    const rr = r(); await handleSystem(call('lock_screen'), rr as any)
    expect(rr.exec).toHaveBeenCalledWith('pmset', ['displaysleepnow'])
  })
  it('set_dnd on 调 shortcuts', async () => {
    const rr = r(); await handleSystem(call('set_dnd', { on: true }), rr as any)
    expect(rr.exec).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test -- tests/system-handler.test.ts`
Expected: FAIL（断言不满足，因当前是桩）

- [ ] **Step 3: 实现 `src/main/actions/handlers/system.ts`**

```ts
import type { ToolCall } from '@shared/types'
import type { Runner } from '../runner'

export async function handleSystem(call: ToolCall, r: Runner) {
  switch (call.name) {
    case 'set_volume': {
      if (typeof call.args.level === 'number') {
        await r.osascript(`set volume output volume ${Math.max(0, Math.min(100, call.args.level))}`)
        return { volume: call.args.level }
      }
      const delta = Number(call.args.delta ?? 0)
      const cur = Number(await r.osascript('output volume of (get volume settings)'))
      const next = Math.max(0, Math.min(100, cur + delta))
      await r.osascript(`set volume output volume ${next}`)
      return { volume: next }
    }
    case 'lock_screen':
      await r.exec('pmset', ['displaysleepnow'])
      return { locked: true }
    case 'set_brightness': {
      const lvl = Math.max(0, Math.min(100, Number(call.args.level)))
      // 依赖 brightness CLI（brew install brightness）；0-1 取值
      await r.exec('brightness', [String(lvl / 100)])
      return { brightness: lvl }
    }
    case 'set_dnd': {
      const name = call.args.on ? '打开勿扰模式' : '关闭勿扰模式'
      await r.exec('shortcuts', ['run', name])
      return { dnd: !!call.args.on }
    }
    default: throw new Error(`system: 未知 ${call.name}`)
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm test -- tests/system-handler.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat: system control handler (volume/lock/brightness/dnd)"
```

### Task 4.2: 开发工具 handler（iTerm2）

**Files:**
- Modify: `src/main/actions/handlers/devtools.ts`
- Test: `tests/devtools-handler.test.ts`

- [ ] **Step 1: 写失败测试 `tests/devtools-handler.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest'
import { handleDevtools } from '../src/main/actions/handlers/devtools'
const r = () => ({ osascript: vi.fn(async () => ''), exec: vi.fn(async () => ''), readdir: vi.fn(async()=>[]), mkdir: vi.fn(async()=>{}), rename: vi.fn(async()=>{}) })
const call = (args: any) => ({ id: '1', name: 'launch_dev_tool', args })

describe('devtools handler', () => {
  it('claude: 生成 cd 项目并执行 claude 的 AppleScript', async () => {
    const rr = r(); await handleDevtools(call({ tool: 'claude', project_path: '~/workSpace/glyph' }), rr as any)
    const script = (rr.osascript as any).mock.calls[0][0]
    expect(script).toContain('iTerm')
    expect(script).toContain('cd ')
    expect(script).toContain('claude')
  })
  it('code: 用 code . 打开', async () => {
    const rr = r(); await handleDevtools(call({ tool: 'code', project_path: '~/workSpace/glyph' }), rr as any)
    expect((rr.osascript as any).mock.calls[0][0]).toContain('code .')
  })
  it('未知 tool 抛错', async () => {
    await expect(handleDevtools(call({ tool: 'vim' }) as any, r() as any)).rejects.toThrow()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test -- tests/devtools-handler.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 `src/main/actions/handlers/devtools.ts`**

```ts
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
```

- [ ] **Step 4: 运行确认通过**

Run: `npm test -- tests/devtools-handler.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat: dev tool launcher via iTerm2 (claude/code/gemini)"
```

### Task 4.3: 查询 handler

**Files:**
- Modify: `src/main/actions/handlers/query.ts`
- Test: `tests/query-handler.test.ts`

- [ ] **Step 1: 写失败测试 `tests/query-handler.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { handleQuery } from '../src/main/actions/handlers/query'
const call = (topic: string) => ({ id: '1', name: 'query_info', args: { topic } })

describe('query handler', () => {
  it('time 返回当前时间字符串', async () => {
    const res: any = await handleQuery(call('time') as any, {} as any)
    expect(typeof res.now).toBe('string')
  })
  it('未知 topic 返回 echo', async () => {
    const res: any = await handleQuery(call('天气') as any, {} as any)
    expect(res.topic).toBe('天气')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test -- tests/query-handler.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 `src/main/actions/handlers/query.ts`**

```ts
import type { ToolCall } from '@shared/types'
import type { Runner } from '../runner'

export async function handleQuery(call: ToolCall, _r: Runner) {
  const topic = String(call.args.topic ?? '')
  if (/time|时间|几点/.test(topic)) return { now: new Date().toLocaleTimeString('zh-CN') }
  if (/date|日期|几号/.test(topic)) return { today: new Date().toLocaleDateString('zh-CN') }
  // 其他主题交给模型自身知识回答，这里只回传 topic 让模型继续
  return { topic, note: '无本地数据，请用模型知识回答' }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm test -- tests/query-handler.test.ts`
Expected: PASS

- [ ] **Step 5: 全量回归 + 提交**

Run: `npm test`
Expected: 所有现有测试 PASS

```bash
git add -A && git commit -m "feat: query handler (time/date) + full handler suite"
```

---

## Phase 5 — 会话状态机（TDD，注入时钟）

### Task 5.1: 待机↔激活 + 静默超时

状态机职责：管理 `standby`/`active`，提供 `onWake()`、`onActivity()`、`onDismiss()`，以及静默 `IDLE_TIMEOUT_MS`（默认 300000）到点回 `standby`。用注入的定时器函数（`setTimer`/`clearTimer`）便于用假时钟测试。

**Files:**
- Create: `src/main/session/stateMachine.ts`
- Create: `src/main/config.ts`
- Test: `tests/stateMachine.test.ts`

- [ ] **Step 1: 写 `src/main/config.ts`**

```ts
import 'dotenv/config'
export const CONFIG = {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? '',
  PICOVOICE_ACCESS_KEY: process.env.PICOVOICE_ACCESS_KEY ?? '',
  IDLE_TIMEOUT_MS: 5 * 60 * 1000,
  GEMINI_MODEL: 'gemini-2.0-flash-live-001'
}
```

- [ ] **Step 2: 写失败测试 `tests/stateMachine.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSessionMachine } from '../src/main/session/stateMachine'

describe('session state machine', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('初始为 standby', () => {
    const m = createSessionMachine({ idleMs: 1000 })
    expect(m.state).toBe('standby')
  })
  it('onWake -> active 并触发回调', () => {
    const onChange = vi.fn()
    const m = createSessionMachine({ idleMs: 1000, onChange })
    m.onWake()
    expect(m.state).toBe('active')
    expect(onChange).toHaveBeenCalledWith('active')
  })
  it('active 下静默超时回 standby', () => {
    const onChange = vi.fn()
    const m = createSessionMachine({ idleMs: 1000, onChange })
    m.onWake()
    vi.advanceTimersByTime(1000)
    expect(m.state).toBe('standby')
    expect(onChange).toHaveBeenLastCalledWith('standby')
  })
  it('onActivity 重置静默计时', () => {
    const m = createSessionMachine({ idleMs: 1000 })
    m.onWake()
    vi.advanceTimersByTime(800); m.onActivity()
    vi.advanceTimersByTime(800); expect(m.state).toBe('active') // 未超时
    vi.advanceTimersByTime(200); expect(m.state).toBe('standby')
  })
  it('onDismiss 立刻回 standby', () => {
    const m = createSessionMachine({ idleMs: 1000 })
    m.onWake(); m.onDismiss()
    expect(m.state).toBe('standby')
  })
  it('standby 下 onWake 重复调用幂等', () => {
    const m = createSessionMachine({ idleMs: 1000 })
    m.onWake(); m.onWake()
    expect(m.state).toBe('active')
  })
})
```

- [ ] **Step 3: 运行确认失败**

Run: `npm test -- tests/stateMachine.test.ts`
Expected: FAIL（`createSessionMachine` 未定义）

- [ ] **Step 4: 实现 `src/main/session/stateMachine.ts`**

```ts
import type { SessionState } from '@shared/types'

export interface SessionMachineOpts {
  idleMs: number
  onChange?: (s: SessionState) => void
}

export function createSessionMachine(opts: SessionMachineOpts) {
  let state: SessionState = 'standby'
  let timer: ReturnType<typeof setTimeout> | null = null

  function clear() { if (timer) { clearTimeout(timer); timer = null } }
  function set(next: SessionState) { if (next !== state) { state = next; opts.onChange?.(state) } }
  function arm() { clear(); timer = setTimeout(() => { set('standby'); clear() }, opts.idleMs) }

  return {
    get state() { return state },
    onWake() { set('active'); arm() },
    onActivity() { if (state === 'active') arm() },
    onDismiss() { clear(); set('standby') }
  }
}
```

- [ ] **Step 5: 运行确认通过**

Run: `npm test -- tests/stateMachine.test.ts`
Expected: PASS（6 用例）

- [ ] **Step 6: 提交**

```bash
git add -A && git commit -m "feat: session state machine (standby/active/idle-timeout, TDD)"
```

---

## Phase 6 — Gemini 消息解析（TDD）+ Live 客户端

### Task 6.1: 服务器消息解析（纯逻辑）

把 Gemini Live server 消息归一化为 `{ audioChunks: string[], text: string, toolCalls: ToolCall[] }`，便于主进程消费且可单测。

**Files:**
- Create: `src/main/gemini/messages.ts`
- Test: `tests/gemini-messages.test.ts`

- [ ] **Step 1: 写失败测试 `tests/gemini-messages.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { parseServerMessage } from '../src/main/gemini/messages'

describe('parseServerMessage', () => {
  it('提取音频 inlineData', () => {
    const msg = { serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm', data: 'AAAA' } }] } } }
    const out = parseServerMessage(msg)
    expect(out.audioChunks).toEqual(['AAAA'])
  })
  it('提取文本转录', () => {
    const msg = { serverContent: { modelTurn: { parts: [{ text: '你好' }] } } }
    expect(parseServerMessage(msg).text).toBe('你好')
  })
  it('提取 toolCall functionCalls', () => {
    const msg = { toolCall: { functionCalls: [{ id: 'x1', name: 'open_app', args: { app_name: 'Safari' } }] } }
    const out = parseServerMessage(msg)
    expect(out.toolCalls).toHaveLength(1)
    expect(out.toolCalls[0]).toMatchObject({ id: 'x1', name: 'open_app', args: { app_name: 'Safari' } })
  })
  it('空消息返回空结构', () => {
    const out = parseServerMessage({})
    expect(out.audioChunks).toEqual([]); expect(out.text).toBe(''); expect(out.toolCalls).toEqual([])
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test -- tests/gemini-messages.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 `src/main/gemini/messages.ts`**

```ts
import type { ToolCall } from '@shared/types'

export interface ParsedMessage {
  audioChunks: string[]   // base64 PCM 24k
  text: string
  toolCalls: ToolCall[]
}

export function parseServerMessage(msg: any): ParsedMessage {
  const out: ParsedMessage = { audioChunks: [], text: '', toolCalls: [] }
  const parts = msg?.serverContent?.modelTurn?.parts ?? []
  for (const p of parts) {
    if (p?.inlineData?.data) out.audioChunks.push(p.inlineData.data)
    if (typeof p?.text === 'string') out.text += p.text
  }
  const calls = msg?.toolCall?.functionCalls ?? []
  for (const c of calls) {
    out.toolCalls.push({ id: c.id ?? c.name, name: c.name, args: c.args ?? {} })
  }
  return out
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm test -- tests/gemini-messages.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat: gemini server message parser (TDD)"
```

### Task 6.2: Live 客户端封装

封装 `@google/genai` 的 Live 会话：连接、发送音频、转发解析后的事件、回传 toolResponse、关闭。

**Files:**
- Create: `src/main/gemini/liveClient.ts`

- [ ] **Step 1: 写 `src/main/gemini/liveClient.ts`**

```ts
import { GoogleGenAI, Modality } from '@google/genai'
import { CONFIG } from '../config'
import { functionDeclarations } from '@shared/tools'
import { parseServerMessage } from './messages'
import type { ToolResult } from '@shared/types'

export interface LiveCallbacks {
  onAudio: (base64pcm24k: string) => void
  onText: (text: string) => void
  onToolCalls: (calls: ReturnType<typeof parseServerMessage>['toolCalls']) => void
  onClose: () => void
}

const SYSTEM_INSTRUCTION =
  '你是 macOS 桌面语音助手「贾维斯」。理解用户的中文语音意图，需要操作电脑时调用相应工具函数；' +
  '收到工具结果后用简短自然的中文口语反馈。无法执行或被安全策略拒绝时，礼貌说明原因。'

export async function connectLive(cb: LiveCallbacks) {
  const ai = new GoogleGenAI({ apiKey: CONFIG.GEMINI_API_KEY })
  const session = await ai.live.connect({
    model: CONFIG.GEMINI_MODEL,
    config: {
      responseModalities: [Modality.AUDIO],
      systemInstruction: SYSTEM_INSTRUCTION,
      tools: [{ functionDeclarations }]
    },
    callbacks: {
      onmessage: (msg: any) => {
        const p = parseServerMessage(msg)
        if (p.audioChunks.length) p.audioChunks.forEach(cb.onAudio)
        if (p.text) cb.onText(p.text)
        if (p.toolCalls.length) cb.onToolCalls(p.toolCalls)
      },
      onerror: (e: any) => console.error('[gemini] error', e),
      onclose: () => cb.onClose()
    }
  })

  return {
    // 16kHz PCM base64 实时上传
    sendAudio(base64pcm16k: string) {
      session.sendRealtimeInput({ audio: { data: base64pcm16k, mimeType: 'audio/pcm;rate=16000' } })
    },
    sendToolResponses(results: ToolResult[]) {
      session.sendToolResponse({
        functionResponses: results.map(r => ({
          id: r.id, name: r.name,
          response: r.ok ? { ok: true, ...(r.data as object ?? {}) } : { ok: false, error: r.error }
        }))
      })
    },
    close() { session.close() }
  }
}
```

> 注：`@google/genai` Live API 处于演进中，若 `sendRealtimeInput`/`sendToolResponse` 签名有出入，以安装版本的类型定义为准（`node_modules/@google/genai`）。本任务在 Phase 10 端到端联调时用真实 Key 验证。

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无类型错误（如有 API 签名差异，按当前 SDK 版本修正）

- [ ] **Step 3: 提交**

```bash
git add -A && git commit -m "feat: gemini live client wrapper (@google/genai)"
```

---

## Phase 7 — IPC 接线（主↔渲染）+ 装配编排

### Task 7.1: 编排器（orchestrator）

把状态机、Gemini、网关、执行器串起来；处理 toolCall → 网关 → （必要时请求确认）→ 执行 → 回传。

**Files:**
- Create: `src/main/orchestrator.ts`
- Modify: `src/main/index.ts`, `src/main/ipc.ts`, `src/preload/index.ts`

- [ ] **Step 1: 写 `src/main/ipc.ts`**

```ts
import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '@shared/types'

export function send(win: BrowserWindow, channel: string, payload: unknown) {
  win.webContents.send(channel, payload)
}
export function on(channel: string, handler: (payload: any) => void) {
  ipcMain.on(channel, (_e, payload) => handler(payload))
}
```

- [ ] **Step 2: 写 `src/main/orchestrator.ts`**

```ts
import { BrowserWindow } from 'electron'
import { IPC } from '@shared/types'
import type { ToolCall, ToolResult } from '@shared/types'
import { CONFIG } from './config'
import { classify } from './security/gateway'
import { createExecutor } from './actions/executor'
import { realRunner } from './actions/runner'
import { createSessionMachine } from './session/stateMachine'
import { connectLive } from './gemini/liveClient'
import { send } from './ipc'

export function createOrchestrator(win: BrowserWindow) {
  const execute = createExecutor(realRunner)
  let live: Awaited<ReturnType<typeof connectLive>> | null = null
  const pendingConfirms = new Map<string, (ok: boolean) => void>()

  const machine = createSessionMachine({
    idleMs: CONFIG.IDLE_TIMEOUT_MS,
    onChange: (s) => {
      send(win, IPC.STATE, s)
      if (s === 'standby') { live?.close(); live = null }
    }
  })

  async function handleToolCalls(calls: ToolCall[]) {
    const results: ToolResult[] = []
    for (const call of calls) {
      const decision = classify(call)
      send(win, IPC.ACTION_LOG, { call, decision })
      if (!decision.allowed) {
        results.push({ id: call.id, name: call.name, ok: false, error: decision.reason }); continue
      }
      if (decision.needsConfirm) {
        const ok = await requestConfirm(call.id, decision.confirmPrompt ?? call.name)
        if (!ok) { results.push({ id: call.id, name: call.name, ok: false, error: '用户取消' }); continue }
      }
      results.push(await execute(call))
    }
    live?.sendToolResponses(results)
    machine.onActivity()
  }

  function requestConfirm(id: string, prompt: string): Promise<boolean> {
    send(win, IPC.CONFIRM_REQUEST, { id, prompt })
    return new Promise(res => pendingConfirms.set(id, res))
  }

  return {
    machine,
    async onWake() {
      machine.onWake()
      if (!live) {
        live = await connectLive({
          onAudio: (a) => { send(win, IPC.MODEL_AUDIO, a); machine.onActivity() },
          onText: (t) => send(win, IPC.TRANSCRIPT, { role: 'assistant', text: t }),
          onToolCalls: (calls) => handleToolCalls(calls),
          onClose: () => { live = null }
        })
      }
    },
    onAudioChunk(b64: string) { live?.sendAudio(b64); machine.onActivity() },
    onVad(_speaking: boolean) { machine.onActivity() },
    onConfirmResult(id: string, ok: boolean) { pendingConfirms.get(id)?.(ok); pendingConfirms.delete(id) }
  }
}
```

- [ ] **Step 3: 改 `src/main/index.ts` 装配 IPC**

在 `createWindow` 返回 `win` 后加：

```ts
import { createOrchestrator } from './orchestrator'
import { on } from './ipc'
import { IPC } from '@shared/types'

// 在 app.whenReady().then 内、createWindow 之后：
const win = /* createWindow 改为返回 win */ createWindow()
const orch = createOrchestrator(win)
on(IPC.WAKE_DETECTED, () => orch.onWake())
on(IPC.AUDIO_CHUNK, (b64) => orch.onAudioChunk(b64))
on(IPC.VAD, (speaking) => orch.onVad(speaking))
on(IPC.CONFIRM_RESULT, ({ id, ok }) => orch.onConfirmResult(id, ok))
```

（把 `createWindow` 改成 `function createWindow(): BrowserWindow { … return win }`）

- [ ] **Step 4: 改 `src/preload/index.ts` 暴露安全 API**

```ts
import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/types'

contextBridge.exposeInMainWorld('vox', {
  // renderer -> main
  wake: () => ipcRenderer.send(IPC.WAKE_DETECTED),
  sendAudio: (b64: string) => ipcRenderer.send(IPC.AUDIO_CHUNK, b64),
  vad: (speaking: boolean) => ipcRenderer.send(IPC.VAD, speaking),
  confirm: (id: string, ok: boolean) => ipcRenderer.send(IPC.CONFIRM_RESULT, { id, ok }),
  // main -> renderer 订阅
  onState: (cb: (s: string) => void) => ipcRenderer.on(IPC.STATE, (_e, s) => cb(s)),
  onModelAudio: (cb: (b64: string) => void) => ipcRenderer.on(IPC.MODEL_AUDIO, (_e, a) => cb(a)),
  onTranscript: (cb: (t: any) => void) => ipcRenderer.on(IPC.TRANSCRIPT, (_e, t) => cb(t)),
  onActionLog: (cb: (l: any) => void) => ipcRenderer.on(IPC.ACTION_LOG, (_e, l) => cb(l)),
  onConfirmRequest: (cb: (r: any) => void) => ipcRenderer.on(IPC.CONFIRM_REQUEST, (_e, r) => cb(r))
})
```

- [ ] **Step 5: 类型检查 + 启动冒烟**

Run: `npx tsc --noEmit && npm run dev`
Expected: 窗口启动无报错（功能未接 UI，仅验证装配不崩）。关闭。

- [ ] **Step 6: 提交**

```bash
git add -A && git commit -m "feat: main-process orchestrator + IPC wiring"
```

---

## Phase 8 — 渲染进程音频

### Task 8.1: 重采样（TDD）

**Files:**
- Create: `src/renderer/audio/resample.ts`
- Test: `tests/resample.test.ts`

- [ ] **Step 1: 写失败测试 `tests/resample.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { floatTo16BitPCM, downsample } from '../src/renderer/audio/resample'

describe('audio resample', () => {
  it('downsample 48k->16k 长度约为 1/3', () => {
    const input = new Float32Array(48000).fill(0.5)
    const out = downsample(input, 48000, 16000)
    expect(out.length).toBeGreaterThan(15900)
    expect(out.length).toBeLessThan(16100)
  })
  it('floatTo16BitPCM 把 1.0 映射到约 32767', () => {
    const pcm = floatTo16BitPCM(new Float32Array([1.0, -1.0, 0]))
    const view = new DataView(pcm)
    expect(view.getInt16(0, true)).toBe(32767)
    expect(view.getInt16(2, true)).toBe(-32768)
    expect(view.getInt16(4, true)).toBe(0)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test -- tests/resample.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 `src/renderer/audio/resample.ts`**

```ts
// 线性插值下采样
export function downsample(input: Float32Array, inRate: number, outRate: number): Float32Array {
  if (outRate === inRate) return input
  const ratio = inRate / outRate
  const outLen = Math.round(input.length / ratio)
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const idx = i * ratio
    const lo = Math.floor(idx), hi = Math.min(lo + 1, input.length - 1)
    out[i] = input[lo] + (input[hi] - input[lo]) * (idx - lo)
  }
  return out
}

export function floatTo16BitPCM(input: Float32Array): ArrayBuffer {
  const buf = new ArrayBuffer(input.length * 2)
  const view = new DataView(buf)
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]))
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return buf
}

export function arrayBufferToBase64(buf: ArrayBuffer): string {
  let bin = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm test -- tests/resample.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat: audio resample/PCM utils (TDD)"
```

### Task 8.2: VAD（TDD）

**Files:**
- Create: `src/renderer/audio/vad.ts`
- Test: `tests/vad.test.ts`

- [ ] **Step 1: 写失败测试 `tests/vad.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { createVad } from '../src/renderer/audio/vad'

describe('energy VAD', () => {
  it('静音帧判定为非语音', () => {
    const vad = createVad({ threshold: 0.01 })
    expect(vad.process(new Float32Array(512).fill(0))).toBe(false)
  })
  it('高能量帧判定为语音', () => {
    const vad = createVad({ threshold: 0.01 })
    expect(vad.process(new Float32Array(512).fill(0.3))).toBe(true)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test -- tests/vad.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 `src/renderer/audio/vad.ts`**

```ts
export function createVad(opts: { threshold: number }) {
  return {
    // 返回该帧是否包含语音（RMS 能量阈值）
    process(frame: Float32Array): boolean {
      let sum = 0
      for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i]
      const rms = Math.sqrt(sum / frame.length)
      return rms >= opts.threshold
    }
  }
}
```

- [ ] **Step 4: 运行确认通过 + 提交**

Run: `npm test -- tests/vad.test.ts`
Expected: PASS

```bash
git add -A && git commit -m "feat: energy-based VAD (TDD)"
```

### Task 8.3: 采集与播放（集成，浏览器 API）

**Files:**
- Create: `src/renderer/audio/worklet-processor.js`, `src/renderer/audio/capture.ts`, `src/renderer/audio/playback.ts`

- [ ] **Step 1: 写 `src/renderer/audio/worklet-processor.js`**

```js
class CaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0][0]
    if (ch) this.port.postMessage(ch.slice(0))
    return true
  }
}
registerProcessor('capture-processor', CaptureProcessor)
```

- [ ] **Step 2: 写 `src/renderer/audio/capture.ts`**

```ts
import { downsample, floatTo16BitPCM, arrayBufferToBase64 } from './resample'
import { createVad } from './vad'

export async function startCapture(onPcm16kBase64: (b64: string) => void, onVad: (speaking: boolean) => void) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
  const ctx = new AudioContext()
  await ctx.audioWorklet.addModule(new URL('./worklet-processor.js', import.meta.url))
  const src = ctx.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(ctx, 'capture-processor')
  const vad = createVad({ threshold: 0.012 })
  let lastVad = false
  node.port.onmessage = (e: MessageEvent<Float32Array>) => {
    const frame = e.data
    const speaking = vad.process(frame)
    if (speaking !== lastVad) { lastVad = speaking; onVad(speaking) }
    const pcm = floatTo16BitPCM(downsample(frame, ctx.sampleRate, 16000))
    onPcm16kBase64(arrayBufferToBase64(pcm))
  }
  src.connect(node)
  return { stop() { node.disconnect(); src.disconnect(); stream.getTracks().forEach(t => t.stop()); ctx.close() }, context: ctx }
}
```

- [ ] **Step 3: 写 `src/renderer/audio/playback.ts`**

```ts
// 24kHz PCM 播放队列，支持 barge-in（清空队列）
export function createPlayback() {
  const ctx = new AudioContext({ sampleRate: 24000 })
  let nextStart = 0
  const sources: AudioBufferSourceNode[] = []

  function base64ToPcm(b64: string): Int16Array {
    const bin = atob(b64); const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new Int16Array(bytes.buffer)
  }

  return {
    enqueue(b64: string) {
      const pcm = base64ToPcm(b64)
      const buf = ctx.createBuffer(1, pcm.length, 24000)
      const ch = buf.getChannelData(0)
      for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768
      const node = ctx.createBufferSource()
      node.buffer = buf; node.connect(ctx.destination)
      const t = Math.max(ctx.currentTime, nextStart)
      node.start(t); nextStart = t + buf.duration
      sources.push(node)
      node.onended = () => { const i = sources.indexOf(node); if (i >= 0) sources.splice(i, 1) }
    },
    // 打断：停止所有正在播放/排队的音频
    bargeIn() { sources.forEach(s => { try { s.stop() } catch {} }); sources.length = 0; nextStart = ctx.currentTime }
  }
}
```

- [ ] **Step 4: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat: renderer audio capture + 24k playback with barge-in"
```

---

## Phase 9 — 唤醒词（Porcupine）

### Task 9.1: 接入 Porcupine web

**Files:**
- Create: `src/renderer/wakeword.ts`

> 前置：用户需在 Picovoice 控制台（console.picovoice.ai）训练一个中文「贾维斯」唤醒词，下载 `.ppn`（web 平台）和中文模型参数 `porcupine_params_zh.pv`，放入 `resources/`。AccessKey 写入 `.env` 的 `PICOVOICE_ACCESS_KEY`。

- [ ] **Step 1: 写 `src/renderer/wakeword.ts`**

```ts
import { PorcupineWorker } from '@picovoice/porcupine-web'
import { WebVoiceProcessor } from '@picovoice/web-voice-processor'

// 通过 preload 暴露的环境读取 accessKey（见下方说明）
export async function startWakeWord(accessKey: string, onWake: () => void) {
  const worker = await PorcupineWorker.create(
    accessKey,
    { label: 'jarvis', publicPath: '/jarvis.ppn' },     // 训练好的「贾维斯」模型放到 renderer 可访问路径
    () => onWake(),
    { publicPath: '/porcupine_params_zh.pv' }            // 中文模型参数
  )
  await WebVoiceProcessor.subscribe(worker)
  return {
    async stop() { await WebVoiceProcessor.unsubscribe(worker); worker.release() }
  }
}
```

> 说明：electron-vite 下把 `resources/jarvis.ppn`、`resources/porcupine_params_zh.pv` 复制到 `src/renderer/public/` 使其以 `/jarvis.ppn` 提供。accessKey 经 preload 从主进程 `CONFIG.PICOVOICE_ACCESS_KEY` 注入（在 preload 增加 `getPicovoiceKey: () => ipcRenderer.invoke('cfg:pv-key')`，主进程用 `ipcMain.handle` 返回）。

- [ ] **Step 2: 在 preload + main 增加 key 获取通道**

`src/preload/index.ts` 的 `vox` 对象加：
```ts
getPicovoiceKey: () => ipcRenderer.invoke('cfg:pv-key'),
```
`src/main/index.ts` 加：
```ts
import { ipcMain } from 'electron'
import { CONFIG } from './config'
ipcMain.handle('cfg:pv-key', () => CONFIG.PICOVOICE_ACCESS_KEY)
```

- [ ] **Step 3: 类型检查 + 提交**

Run: `npx tsc --noEmit`
Expected: 无错误（运行需 `.ppn` 资源，留待 Phase 10 真机）

```bash
git add -A && git commit -m "feat: porcupine wake word integration (jarvis)"
```

---

## Phase 10 — UI 移植 + 端到端装配 + 手动测试

### Task 10.1: 移植原型 UI

把 `design-and-prototype.html` 的「App 原型」视觉（状态球、波形、转录、动作日志、确认弹窗、连续对话/倒计时）抽成渲染进程真实 UI，由 IPC 事件驱动。

**Files:**
- Create: `src/renderer/ui/ui.css`（从 prototype 的 `.macwin/.stage/.bigorb/.bars/.convo/.modal/.sessmode` 等样式复制）
- Create: `src/renderer/ui/ui.ts`
- Modify: `src/renderer/index.html`, `src/renderer/main.ts`

- [ ] **Step 1: 复制样式到 `src/renderer/ui/ui.css`**

从 `design-and-prototype.html` 的 `<style>` 中，复制原型相关类（`.macwin .titlebar .appbody .statuspill .stage .halo .orbit .bigorb .ring .bars .spinner .wakehint .sessmode .convo .bub .modal .mcard` 及其 `@keyframes`）。颜色变量沿用 `:root` 中 `--teal/--violet/--blue/--green/--amber/--red/--grad`。

- [ ] **Step 2: 写 `src/renderer/ui/ui.ts`**（提供命令式 API 供 main.ts 调用）

```ts
export interface UI {
  setState(s: 'idle' | 'listening' | 'thinking' | 'speaking'): void
  setSession(active: boolean): void
  setIdle(secLeft: number): void
  addUserText(t: string): void
  addAssistantText(t: string): void
  addAction(label: string, risk: 'green'|'yellow'|'red'): { done(ok: boolean): void }
  confirm(prompt: string): Promise<boolean>
}

export function mountUI(root: HTMLElement): UI {
  root.innerHTML = `
    <div class="macwin">
      <div class="titlebar"><span class="tl r"></span><span class="tl y"></span><span class="tl g"></span><span class="tt">VoxMac</span></div>
      <div class="appbody">
        <div class="statuspill" id="pill"><span class="sd"></span><span id="pillTxt">待命中</span></div>
        <div class="stage" id="stage"><div class="halo"></div><div class="spinner"></div>
          <div class="orbit"><i></i><i></i><i></i></div>
          <div class="ring"></div><div class="ring r2"></div><div class="ring r3"></div>
          <div class="bigorb idle"></div>
          <div class="bars"><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span></div></div>
        <div class="wakehint" id="wakehint">监听唤醒词 <b>「贾维斯」</b></div>
        <div class="sessmode" id="sessmode"><span class="live">●</span> 连续对话中 · <b id="idleTxt">静默 5:00 后待机</b></div>
        <div class="convo" id="convo"></div>
      </div>
      <div class="modal" id="modal"><div class="mcard"><div class="mh"><span class="wico">⚠️</span><h4>需要你确认</h4></div>
        <p id="mDesc"></p><div class="mbtns"><button class="no" id="mNo">取消</button><button class="ok" id="mOk">确认执行</button></div></div></div>
    </div>`
  const $ = (id: string) => root.querySelector('#' + id) as HTMLElement
  const stage = $('stage'), pill = $('pill'), pillTxt = $('pillTxt'),
        convo = $('convo'), wakehint = $('wakehint'), sessmode = $('sessmode'),
        idleTxt = $('idleTxt'), modal = $('modal'), mDesc = $('mDesc')
  const fmt = (s: number) => Math.floor(s/60) + ':' + String(s%60).padStart(2,'0')

  return {
    setState(s) {
      stage.className = 'stage ' + (s === 'idle' ? '' : s)
      pill.className = 'statuspill ' + ({ listening:'listen', thinking:'think', speaking:'speak', idle:'' }[s])
      pillTxt.textContent = { idle:'待命中', listening:'聆听中…', thinking:'思考中…', speaking:'回复中…' }[s]
    },
    setSession(active) {
      wakehint.style.display = active ? 'none' : 'block'
      sessmode.classList.toggle('show', active)
    },
    setIdle(sec) { idleTxt.textContent = '静默 ' + fmt(sec) + ' 后待机' },
    addUserText(t) { const d = document.createElement('div'); d.className='bub u'; d.textContent=t; convo.appendChild(d); convo.scrollTop=convo.scrollHeight },
    addAssistantText(t) { const d = document.createElement('div'); d.className='bub a'; d.textContent=t; convo.appendChild(d); convo.scrollTop=convo.scrollHeight },
    addAction(label, risk) {
      const colors = { green:'#34d399', yellow:'#fbbf24', red:'#fb7185' }
      const d = document.createElement('div'); d.className='bub act'
      d.innerHTML = `⚙️ ${label} <span class="st" style="margin-left:auto">⏳</span>`
      d.style.borderLeft = `3px solid ${colors[risk]}`
      convo.appendChild(d); convo.scrollTop = convo.scrollHeight
      return { done(ok: boolean) { (d.querySelector('.st') as HTMLElement).textContent = ok ? '✓' : '✗' } }
    },
    confirm(prompt) {
      mDesc.textContent = prompt; modal.classList.add('show')
      return new Promise<boolean>(res => {
        const ok = $('mOk'), no = $('mNo')
        const done = (v: boolean) => { modal.classList.remove('show'); res(v) }
        ok.onclick = () => done(true); no.onclick = () => done(false)
      })
    }
  }
}
```

- [ ] **Step 3: 改 `src/renderer/index.html`** 引入样式与挂载点

```html
<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8" />
<title>VoxMac</title><link rel="stylesheet" href="./ui/ui.css" /></head>
<body><div id="app"></div><script type="module" src="./main.ts"></script></body></html>
```

- [ ] **Step 4: 改 `src/renderer/main.ts`** 把 UI、音频、唤醒词、IPC 串起来

```ts
import { mountUI } from './ui/ui'
import { startCapture } from './audio/capture'
import { createPlayback } from './audio/playback'
import { startWakeWord } from './wakeword'

const vox = (window as any).vox
const ui = mountUI(document.getElementById('app')!)
const playback = createPlayback()

let capture: { stop(): void } | null = null
let idleTimer: any = null, idleLeft = 300

function startIdleCountdown() {
  clearInterval(idleTimer); idleLeft = 300; ui.setIdle(idleLeft)
  idleTimer = setInterval(() => { idleLeft--; ui.setIdle(idleLeft); if (idleLeft <= 0) clearInterval(idleTimer) }, 1000)
}

async function onWake() {
  vox.wake()                       // 通知主进程建会话
  ui.setState('listening'); ui.setSession(true); startIdleCountdown()
  if (!capture) capture = await startCapture(
    (b64) => vox.sendAudio(b64),
    (speaking) => { vox.vad(speaking); if (speaking) { idleLeft = 300; ui.setIdle(idleLeft) } }
  )
}

// 主进程事件
vox.onState((s: string) => {
  if (s === 'standby') { ui.setState('idle'); ui.setSession(false); capture?.stop(); capture = null; clearInterval(idleTimer) }
})
vox.onModelAudio((b64: string) => { ui.setState('speaking'); playback.enqueue(b64) })
vox.onTranscript((t: any) => ui.addAssistantText(t.text))
vox.onActionLog(({ call, decision }: any) => {
  const a = ui.addAction(`${call.name}`, decision.risk)
  ;(window as any).__lastAction = a   // 简化：实际可用 id 映射
})
vox.onConfirmRequest(async ({ id, prompt }: any) => {
  const ok = await ui.confirm(prompt); vox.confirm(id, ok)
})

// 唤醒词
;(async () => {
  const key = await vox.getPicovoiceKey()
  await startWakeWord(key, onWake)
})()
```

- [ ] **Step 5: 全量测试 + 类型检查**

Run: `npm test && npx tsc --noEmit`
Expected: 单测全 PASS，类型无误

- [ ] **Step 6: 提交**

```bash
git add -A && git commit -m "feat: port prototype UI + wire renderer end-to-end"
```

### Task 10.2: 真机端到端手动测试

> 前置：`.env` 填好 `GEMINI_API_KEY` 与 `PICOVOICE_ACCESS_KEY`；`resources/` 放好 `jarvis.ppn` + `porcupine_params_zh.pv` 并复制到 `src/renderer/public/`；首次运行 macOS 会弹麦克风 / 自动化 / 辅助功能权限，需在「系统设置 → 隐私与安全性」授权。

- [ ] **Step 1: 启动**

Run: `npm run dev`

- [ ] **Step 2: 唤醒与连续对话**
  - 说「贾维斯」→ 状态球进入聆听、顶部出现「连续对话中 · 静默 5:00」
  - 说「打开 Safari」→ 看到动作日志 `open_app`（绿）→ Safari 打开 → 听到语音「已打开 Safari」
  - 不再说唤醒词，直接说「看下下载文件夹」→ `list_directory` 执行 → 语音播报文件
  - 验证连续两轮无需重复「贾维斯」

- [ ] **Step 3: 危险确认**
  - 说「把下载文件夹清空」或触发 `run_shell` → 弹确认窗 → 取消 → 文件未动；再试确认 → 执行

- [ ] **Step 4: 红线拒绝**
  - 诱导执行危险命令（如让其 `sudo`）→ 验证被网关拒绝并语音说明

- [ ] **Step 5: 开发工具**
  - 说「在 glyph 项目里打开 Claude Code」→ iTerm2 新窗口 `cd ~/workSpace/glyph && claude`

- [ ] **Step 6: 静默回待机**
  - 唤醒后静置（可临时把 `CONFIG.IDLE_TIMEOUT_MS` 调小到 10000 验证）→ 到点回待机、状态球回呼吸态、Gemini 会话关闭

- [ ] **Step 7: 打断（barge-in）**
  - AI 说话时说新指令 → 旧语音停止、响应新指令

- [ ] **Step 8: 记录结果并提交**

```bash
git add -A && git commit -m "test: e2e manual verification notes"
```

---

## 自检与覆盖

- **Spec 覆盖核对：** ① 语音流&架构→Phase 0/7/8；② 意图结构→Phase 1.2；③ macOS 动作列表→Phase 2/3/4；④ 反馈机制→Phase 6/7（toolResponse 回灌）；⑤ 完整流程图→Phase 7 orchestrator；⑥ 测试计划→各 Phase 单测 + Phase 10 手动/红队；⑦ 改善方向→未来工作（不在本期）。唤醒词「贾维斯」→Phase 9；连续对话+静默5分钟→Phase 5 + Phase 10；开发工具(iTerm2)→Phase 4.2；三级安全网关→Phase 2。
- **已知外部依赖（执行阶段需用户提供）：** Gemini API Key、Picovoice AccessKey + 训练好的「贾维斯」`.ppn`、`brightness` CLI（亮度）、`shortcuts` 里的勿扰快捷指令、iTerm2 已安装、`claude`/`code`/`gemini` 在 PATH。
- **风险提醒：** Gemini Live API 处于演进期，`@google/genai` Live 接口签名可能与本计划微调，Phase 6.2/10 以实际 SDK 版本为准。
