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
