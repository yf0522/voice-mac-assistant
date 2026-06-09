# VoxMac · 语音管家

> A hands‑free, real‑time **speech‑to‑speech** voice assistant for macOS. Say the wake word **"Jarvis" (贾维斯)** → talk naturally over **Gemini Live API** → it understands your intent and **controls your Mac** (open/quit apps, system settings, files, run any AppleScript/shell, web search) → and replies back in voice. Fully local wake word (Vosk, offline, no cloud), continuous conversation, and a 3‑tier safety gateway. Built with Electron + TypeScript.

![status](https://img.shields.io/badge/platform-macOS-black) ![stack](https://img.shields.io/badge/Electron%20%2B%20TypeScript-blue) ![model](https://img.shields.io/badge/Gemini%20Live-native%20audio-9b8cff) ![license](https://img.shields.io/badge/license-MIT-34e0c4)

**English TL;DR:** wake word runs offline on‑device (Vosk); only after "Jarvis" does audio stream to Gemini Live. The model can call local tools to drive macOS. Everything runs from your own machine with your own Gemini API key. See **Setup** below. The rest of this README is in Chinese.

---

macOS 实时语音助手（Speech‑to‑Speech）。唤醒词「**贾维斯**」唤起 → 经 **Gemini Live API** 实时双向语音对话 → 理解意图后经**三级安全网关**执行 macOS 动作 → 把结果用语音说回。支持**连续对话**（唤醒后无需重复唤醒词）与**静默 5 分钟自动回待机**。

> 设计稿与可交互原型见 `design-and-prototype.html`；完整实现计划见 `docs/superpowers/plans/`。

## 能力

| 类别 | 动作 | 示例 |
|---|---|---|
| App | open_app / quit_app | "打开 Safari"、"关掉微信" |
| 系统 | set_volume / lock_screen / set_brightness / set_dnd | "调大音量"、"锁屏"、"开勿扰" |
| 文件 | list_directory / create_folder / move_file / rename_file | "看下下载文件夹" |
| 开发 | launch_dev_tool（iTerm2 → claude / code / gemini） | "在 glyph 项目里开 Claude Code" |
| 查询 | query_info | "现在几点" |
| 受限 | run_shell（白名单 + 确认） | "跑下 ls" |

## 安全模型（三级网关）

- 🟢 **绿色 · 直接执行**：只读 / 低风险（open_app、query、list_dir、音量、锁屏、launch_dev_tool）
- 🟡 **黄色 · 需确认**：改动文件 / 退出 App / 白名单内 run_shell（弹窗 + 语音二次确认）
- 🔴 **红色 · 拒绝**：白名单外破坏性命令、shell 元字符 / 命令链、路径越出用户目录沙箱、含注入字符的路径 —— 直接拒绝，永不执行

纵深防御：命令前缀白名单 + shell 元字符拦截 + 路径字符白名单（网关层）+ `fs.realpath` symlink 沙箱二次校验（执行层）。

## 技术栈

Electron + TypeScript + electron-vite · Gemini Live（`@google/genai`）· 本地离线唤醒词（`vosk-browser`，WASM Kaldi，零账号零 key）· Vitest。
主进程持有 API Key、运行 Gemini 会话 / 安全网关 / 执行器 / 状态机；渲染进程负责音频采集（16kHz PCM）/ 唤醒词 / 24kHz 播放 / UI；两进程经 contextBridge + IPC 通信。

## 前置条件

1. **Node.js** 18+ 与 npm。
2. **Gemini API Key** —— 写入 `.env` 的 `GEMINI_API_KEY`（这是唯一需要的 key）。
3. **中文唤醒模型** —— 运行 `bash scripts/fetch-model.sh` 下载并打包 vosk 中文小模型（约 40MB）到 `src/renderer/public/vosk-model-cn.tar.gz`，无需任何账号 / key。详见 `resources/README.md`。
4.（可选）`brightness` CLI（`brew install brightness`）—— 用于 set_brightness。
6.（可选）「快捷指令」App 里创建名为「打开勿扰模式」「关闭勿扰模式」的快捷指令 —— 用于 set_dnd。
7.（可选）已安装 **iTerm2**，且 `claude` / `code` / `gemini` 在 PATH —— 用于 launch_dev_tool。

## 安装与运行

```bash
cp .env.example .env        # 填入 GEMINI_API_KEY（唯一需要的 key）
npm install
bash scripts/fetch-model.sh # 下载中文唤醒模型到 src/renderer/public/
npm run dev                 # 开发模式启动
```

首次运行 macOS 会弹**麦克风**、**自动化（控制 iTerm/系统事件）**、**辅助功能**权限请求，需在「系统设置 → 隐私与安全性」授权。

## 开发

```bash
npm test          # 跑单元测试（Vitest）
npx tsc --noEmit  # 类型检查
npm run build     # 生产构建（electron-vite）
```

测试覆盖纯逻辑核心：安全网关（分级/白名单/路径沙箱/注入防护）、动作执行器、各 handler、会话状态机、Gemini 消息解析、音频重采样、VAD。

## 真机端到端验收清单（Task 10.2）

需 `.env` 与唤醒模型（`bash scripts/fetch-model.sh`）就位后手动验证：

- [ ] **唤醒 + 连续对话**：说「贾维斯」→ 进入聆听、顶部显示「连续对话中 · 静默 5:00」；说「打开 Safari」→ 动作日志 `open_app`（绿）→ Safari 打开 → 语音「已打开 Safari」；**不再喊唤醒词**直接说「看下下载文件夹」→ `list_directory` 执行 → 语音播报
- [ ] **危险确认**：「把下载文件夹清空」类 / run_shell → 弹确认窗 → 取消则文件不动；确认则执行
- [ ] **红线拒绝**：诱导执行危险命令（如 sudo）→ 被网关拒绝并语音说明
- [ ] **开发工具**：「在 glyph 项目里打开 Claude Code」→ iTerm2 新窗口 `cd ~/workSpace/glyph && claude`
- [ ] **静默回待机**：唤醒后静置（可临时把 `src/main/config.ts` 的 `IDLE_TIMEOUT_MS` 调小到 10000 验证）→ 到点回待机、Gemini 会话关闭
- [ ] **打断（barge-in）**：AI 说话时说新指令 → 旧语音停止、响应新指令

## 已知限制

- Gemini Live API 处于 Preview / experimental，接口与模型可能演进（当前模型 `gemini-2.0-flash-live-001`，见 `src/main/config.ts`）。
- 唤醒走 vosk 本地全量中文 STT + 模糊匹配「贾维斯」（见 `src/renderer/wake-match.ts`）：完全离线、零账号，但中文小模型对短词存在同音误识，故用近音候选集合容错；常驻识别有一定 CPU 开销，可能偶发误触。
- 重采样为线性插值（无抗混叠低通），如识别质量受影响可后续优化。
