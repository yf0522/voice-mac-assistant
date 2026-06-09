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

  // toolCall 串行队列：保证多批 handleToolCalls 顺序执行，sendToolResponses 不乱序。
  let toolQueue: Promise<void> = Promise.resolve()

  // 把所有挂留的确认 resolver 以 false 兑现并清空，避免 Promise 永久挂留 /
  // Gemini toolCall 永不收到响应（会话回 standby 时调用）。
  function clearPendingConfirms() {
    for (const resolve of pendingConfirms.values()) resolve(false)
    pendingConfirms.clear()
  }

  const machine = createSessionMachine({
    idleMs: CONFIG.IDLE_TIMEOUT_MS,
    onChange: (s) => {
      send(win, IPC.STATE, s)
      if (s === 'standby') { clearPendingConfirms(); live?.close(); live = null }
    }
  })

  async function handleToolCalls(calls: ToolCall[]) {
    const results: ToolResult[] = []
    // 把一个动作结果同时收集并以 ACTION_RESULT 发给渲染层（按 id 精确标记 ✓/✗）
    const record = (r: ToolResult) => { results.push(r); send(win, IPC.ACTION_RESULT, r) }
    for (const call of calls) {
      const decision = classify(call)
      send(win, IPC.ACTION_LOG, { call, decision })
      if (!decision.allowed) {
        record({ id: call.id, name: call.name, ok: false, error: decision.reason }); continue
      }
      if (decision.needsConfirm) {
        const ok = await requestConfirm(call.id, decision.confirmPrompt ?? call.name)
        if (!ok) { record({ id: call.id, name: call.name, ok: false, error: '用户取消' }); continue }
      }
      record(await execute(call))
    }
    live?.sendToolResponses(results)
    machine.onActivity()
  }

  function requestConfirm(id: string, prompt: string): Promise<boolean> {
    send(win, IPC.CONFIRM_REQUEST, { id, prompt })
    return new Promise(res => pendingConfirms.set(id, res))
  }

  let audioOut = 0
  let audioIn = 0
  let userActive = false // 手动活动检测：当前是否已发过 activityStart 未配对 activityEnd
  return {
    machine,
    async onWake() {
      console.log('[orch] onWake 触发, live已连接?=', !!live)
      machine.onWake()
      if (!live) {
        userActive = false
        try {
          console.log('[orch] 正在连接 Gemini Live...')
          live = await connectLive({
            onAudio: (a) => { if (audioIn++ === 0) console.log('[orch] 收到模型音频(首帧)'); send(win, IPC.MODEL_AUDIO, a); machine.onActivity() },
            onText: (t) => { console.log('[orch] 模型文本:', t); send(win, IPC.TRANSCRIPT, { role: 'assistant', text: t }) },
            onUserText: (t) => { console.log('[orch] 用户转录:', t); send(win, IPC.TRANSCRIPT, { role: 'user', text: t }) },
            onInterrupted: () => send(win, IPC.INTERRUPT, undefined),
            onToolCalls: (calls) => {
              console.log('[orch] 收到 toolCalls:', calls.map(c => c.name).join(','))
              // 串行化：前一批 handleToolCalls 完成后再处理下一批，避免并发乱序。
              toolQueue = toolQueue.then(() => handleToolCalls(calls)).catch(() => {})
            },
            onClose: () => { console.log('[orch] Gemini 会话关闭'); live = null }
          })
          console.log('[orch] Gemini Live 已连接 ✓')
        } catch (e: any) {
          // 连接失败（无 key / 网络）不应让主进程 unhandled rejection；
          // 通过 IPC 把错误以动作日志形式告知渲染层并回到待机。
          console.error('[orch] Gemini Live 连接失败:', e)
          live = null
          send(win, IPC.ACTION_LOG, { error: `Gemini Live 连接失败：${String(e?.message ?? e)}` })
          machine.onDismiss()
        }
      }
    },
    onAudioChunk(b64: string) {
      if (audioOut++ === 0) console.log('[orch] 开始向 Gemini 上传音频(首包), live?=', !!live)
      if (audioOut % 30 === 0) console.log('[orch] 已上传音频包:', audioOut)
      live?.sendAudio(b64); machine.onActivity()
    },
    onVad(speaking: boolean) {
      machine.onActivity()
      if (!live) return
      // 本地 VAD 的「开始/结束说话」转成 Gemini 的手动活动信号（去重，避免重复发）
      if (speaking && !userActive) { userActive = true; live.startActivity(); console.log('[orch] activityStart') }
      else if (!speaking && userActive) { userActive = false; live.endActivity(); console.log('[orch] activityEnd') }
    },
    onConfirmResult(id: string, ok: boolean) { pendingConfirms.get(id)?.(ok); pendingConfirms.delete(id) }
  }
}
