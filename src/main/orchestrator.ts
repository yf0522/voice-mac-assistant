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

  return {
    machine,
    async onWake() {
      machine.onWake()
      if (!live) {
        try {
          live = await connectLive({
            onAudio: (a) => { send(win, IPC.MODEL_AUDIO, a); machine.onActivity() },
            onText: (t) => send(win, IPC.TRANSCRIPT, { role: 'assistant', text: t }),
            onUserText: (t) => send(win, IPC.TRANSCRIPT, { role: 'user', text: t }),
            onInterrupted: () => send(win, IPC.INTERRUPT, undefined),
            onToolCalls: (calls) => {
              // 串行化：前一批 handleToolCalls 完成后再处理下一批，避免并发乱序。
              toolQueue = toolQueue.then(() => handleToolCalls(calls)).catch(() => {})
            },
            onClose: () => { live = null }
          })
        } catch (e: any) {
          // 连接失败（无 key / 网络）不应让主进程 unhandled rejection；
          // 通过 IPC 把错误以动作日志形式告知渲染层并回到待机。
          live = null
          send(win, IPC.ACTION_LOG, { error: `Gemini Live 连接失败：${String(e?.message ?? e)}` })
          machine.onDismiss()
        }
      }
    },
    onAudioChunk(b64: string) { live?.sendAudio(b64); machine.onActivity() },
    onVad(_speaking: boolean) { machine.onActivity() },
    onConfirmResult(id: string, ok: boolean) { pendingConfirms.get(id)?.(ok); pendingConfirms.delete(id) }
  }
}
