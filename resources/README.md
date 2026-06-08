# 唤醒词资源（vosk-browser · 本地离线）

VoxMac 使用 [`vosk-browser`](https://github.com/ccoreilly/vosk-browser)（WASM 版 Kaldi）
在渲染进程内做**完全本地离线**的中文 STT，再对转写文本模糊匹配唤醒词「贾维斯」。
**无需任何账号、AccessKey 或云服务**。

## 1. 下载并打包模型

运行项目根目录的脚本（约 40MB，需联网一次）：

```bash
bash scripts/fetch-model.sh
```

脚本做的事：

1. 从 `https://alphacephei.com/vosk/models/vosk-model-small-cn-0.22.zip`
   下载中文小模型；
2. 解压，把模型目录里的内容（`am/` `conf/` `graph/` `ivector/` …）
   打包成 **gzipped tar**；
3. 输出到 `src/renderer/public/vosk-model-cn.tar.gz`，
   在渲染进程以根路径 `/vosk-model-cn.tar.gz` 提供。

> vosk-browser 的 `createModel(url)` 接收的就是一个 **`.tar.gz`**：
> 解压后顶层即模型目录（含 `am/conf/graph/ivector`）。脚本已按此结构打包。

## 2. 代码加载方式

`src/renderer/wakeword.ts`：

- `createModel('/vosk-model-cn.tar.gz')` 加载模型（后台 Web Worker）；
- `new model.KaldiRecognizer(16000)` 建 16kHz 识别器；
- 麦克风音频经 AudioWorklet 推送 `Float32Array` 帧，调
  `recognizer.acceptWaveformFloat(frame, ctx.sampleRate)`（vosk 内部重采样）；
- 监听 `result` / `partialresult` 事件，取 `result.text` / `result.partial`，
  调 `matchesWakePhrase`（见 `src/renderer/wake-match.ts`）判定是否命中。

## 3. 唤醒词模糊匹配

中文小模型对短词易同音误识，`matchesWakePhrase` 用近音候选集合容错：
归一化去标点后，检测连续三字「首-中-尾」分别落在
贾/家/加/嘉 · 维/伟/为/唯/惟 · 斯/司/师/思/丝。

> 模型文件较大（~40MB），**不纳入版本库**（见 `.gitignore` 的
> `src/renderer/public/*.tar.gz`）；`src/renderer/public/` 仅以 `.gitkeep` 占位。
