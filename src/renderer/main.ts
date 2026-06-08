import { mountUI, type ActionHandle, type Risk } from './ui/ui'
import { startCapture } from './audio/capture'
import { createPlayback } from './audio/playback'
import { startWakeWord } from './wakeword'

// 与主进程 CONFIG.IDLE_TIMEOUT_MS 保持一致（5 分钟）；倒计时是纯展示，真相源在主进程状态机。
const IDLE_TIMEOUT_MS = 5 * 60 * 1000

const vox = (window as any).vox
const ui = mountUI(document.getElementById('app')!)
const playback = createPlayback()

let capture: { stop(): void } | null = null
let idleTimer: ReturnType<typeof setInterval> | null = null
const IDLE_SEC = Math.round(IDLE_TIMEOUT_MS / 1000)
let idleLeft = IDLE_SEC

// 待完成的动作日志条目（按 toolCall.id 映射），用于在结果可知时打 ✓/✗
const pendingActions = new Map<string, ActionHandle>()

function resetIdle() {
  idleLeft = IDLE_SEC
  ui.setIdle(idleLeft)
}

function startIdleCountdown() {
  if (idleTimer) clearInterval(idleTimer)
  resetIdle()
  idleTimer = setInterval(() => {
    idleLeft--
    ui.setIdle(idleLeft)
    if (idleLeft <= 0 && idleTimer) clearInterval(idleTimer)
  }, 1000)
}

function stopSession() {
  ui.setState('idle')
  ui.setSession(false)
  capture?.stop()
  capture = null
  if (idleTimer) { clearInterval(idleTimer); idleTimer = null }
  // 仍处于 ⏳ 的动作随会话结束置为失败
  pendingActions.forEach(a => a.done(false))
  pendingActions.clear()
}

async function onWake() {
  vox.wake() // 通知主进程建立 Gemini 会话
  ui.setState('listening')
  ui.setSession(true)
  startIdleCountdown()
  playback.bargeIn() // 唤醒时打断任何残余播放
  if (!capture) {
    capture = await startCapture(
      (b64) => vox.sendAudio(b64),
      (speaking) => {
        vox.vad(speaking)
        if (speaking) {
          resetIdle()
          playback.bargeIn() // 用户开口 → 打断 AI 当前播报
          ui.setState('listening')
        }
      }
    )
  }
}

// ---- 主进程事件订阅 ----
vox.onState((s: string) => {
  if (s === 'standby') stopSession()
})

vox.onModelAudio((b64: string) => {
  ui.setState('speaking')
  playback.enqueue(b64)
})

vox.onTranscript((t: { role?: string; text: string }) => {
  if (!t?.text) return
  if (t.role === 'user') ui.addUserText(t.text)
  else ui.addAssistantText(t.text)
  // 模型在工具结果回灌后才会说话——此时把仍待定的动作视为已完成
  pendingActions.forEach(a => a.done(true))
  pendingActions.clear()
})

vox.onActionLog((log: { call?: { id: string; name: string }; decision?: { risk: Risk; allowed: boolean }; error?: string }) => {
  if (log.error) {
    ui.addAssistantText('⚠️ ' + log.error)
    return
  }
  if (!log.call || !log.decision) return
  const handle = ui.addAction(log.call.name, log.decision.risk)
  if (!log.decision.allowed) {
    // 红线动作被拒绝：立刻标记失败
    handle.done(false)
  } else {
    pendingActions.set(log.call.id, handle)
  }
})

vox.onConfirmRequest(async ({ id, prompt }: { id: string; prompt: string }) => {
  const ok = await ui.confirm(prompt)
  vox.confirm(id, ok)
  if (!ok) {
    // 用户取消：把对应动作标记失败
    pendingActions.get(id)?.done(false)
    pendingActions.delete(id)
  }
})

// ---- 唤醒词监听 ----
;(async () => {
  try {
    const key = await vox.getPicovoiceKey()
    await startWakeWord(key, onWake)
  } catch (e) {
    console.error('[wakeword] 启动失败', e)
    ui.addAssistantText('⚠️ 唤醒词初始化失败，请检查 PICOVOICE_ACCESS_KEY 与 resources/jarvis.ppn')
  }
})()
