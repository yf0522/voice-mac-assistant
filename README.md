# VoxMac · 语音管家

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

Electron + TypeScript + electron-vite · Gemini Live（`@google/genai`）· Porcupine 唤醒词（`@picovoice/porcupine-web`）· Vitest。
主进程持有 API Key、运行 Gemini 会话 / 安全网关 / 执行器 / 状态机；渲染进程负责音频采集（16kHz PCM）/ 唤醒词 / 24kHz 播放 / UI；两进程经 contextBridge + IPC 通信。

## 前置条件

1. **Node.js** 18+ 与 npm。
2. **Gemini API Key** —— 写入 `.env` 的 `GEMINI_API_KEY`。
3. **Picovoice AccessKey** —— 在 [console.picovoice.ai](https://console.picovoice.ai) 注册（免费档），写入 `.env` 的 `PICOVOICE_ACCESS_KEY`。
4. **「贾维斯」唤醒词模型** —— 在 Picovoice 控制台训练一个中文唤醒词「贾维斯」，选 **Web (WASM)** 平台导出 `jarvis.ppn`；并下载中文模型参数 `porcupine_params_zh.pv`。把两个文件放到 `src/renderer/public/`（使其分别以 `/jarvis.ppn`、`/porcupine_params_zh.pv` 提供）。详见 `resources/README.md`。
5.（可选）`brightness` CLI（`brew install brightness`）—— 用于 set_brightness。
6.（可选）「快捷指令」App 里创建名为「打开勿扰模式」「关闭勿扰模式」的快捷指令 —— 用于 set_dnd。
7.（可选）已安装 **iTerm2**，且 `claude` / `code` / `gemini` 在 PATH —— 用于 launch_dev_tool。

## 安装与运行

```bash
cp .env.example .env        # 填入 GEMINI_API_KEY 与 PICOVOICE_ACCESS_KEY
# 把 jarvis.ppn 和 porcupine_params_zh.pv 放进 src/renderer/public/
npm install
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

需 `.env` 与唤醒词模型就位后手动验证：

- [ ] **唤醒 + 连续对话**：说「贾维斯」→ 进入聆听、顶部显示「连续对话中 · 静默 5:00」；说「打开 Safari」→ 动作日志 `open_app`（绿）→ Safari 打开 → 语音「已打开 Safari」；**不再喊唤醒词**直接说「看下下载文件夹」→ `list_directory` 执行 → 语音播报
- [ ] **危险确认**：「把下载文件夹清空」类 / run_shell → 弹确认窗 → 取消则文件不动；确认则执行
- [ ] **红线拒绝**：诱导执行危险命令（如 sudo）→ 被网关拒绝并语音说明
- [ ] **开发工具**：「在 glyph 项目里打开 Claude Code」→ iTerm2 新窗口 `cd ~/workSpace/glyph && claude`
- [ ] **静默回待机**：唤醒后静置（可临时把 `src/main/config.ts` 的 `IDLE_TIMEOUT_MS` 调小到 10000 验证）→ 到点回待机、Gemini 会话关闭
- [ ] **打断（barge-in）**：AI 说话时说新指令 → 旧语音停止、响应新指令

## 已知限制

- Gemini Live API 处于 Preview / experimental，接口与模型可能演进（当前模型 `gemini-2.0-flash-live-001`，见 `src/main/config.ts`）。
- 唤醒词需自行训练中文「贾维斯」模型（Porcupine 内置无中文「贾维斯」）。
- 重采样为线性插值（无抗混叠低通），如识别质量受影响可后续优化。
