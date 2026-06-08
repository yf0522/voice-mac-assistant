// 24kHz PCM 播放队列，支持 barge-in（清空队列）
export function createPlayback() {
  const ctx = new AudioContext({ sampleRate: 24000 })
  let nextStart = 0
  const sources: AudioBufferSourceNode[] = []
  // 抖动缓冲：首块/下溢时多排 150ms 再起播，吸收网络抖动，避免“一卡一卡”的空隙。
  const JITTER = 0.15

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
      // 下溢（nextStart 落后于当前时间，说明上一块播完了还没来下一块）时，
      // 加 150ms 缓冲再起播，让后续块攒上来，连续无缝；否则紧接上一块尾部。
      if (nextStart < ctx.currentTime) nextStart = ctx.currentTime + JITTER
      node.start(nextStart); nextStart += buf.duration
      sources.push(node)
      node.onended = () => { const i = sources.indexOf(node); if (i >= 0) sources.splice(i, 1) }
    },
    // 打断：停止所有正在播放/排队的音频
    bargeIn() { sources.forEach(s => { try { s.stop() } catch {} }); sources.length = 0; nextStart = ctx.currentTime }
  }
}
