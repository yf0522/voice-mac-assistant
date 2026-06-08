# 唤醒词资源（Porcupine）

VoxMac 使用 Picovoice Porcupine 监听中文唤醒词「贾维斯」。运行唤醒词功能前，
需要你自行从 Picovoice 控制台训练并下载两个文件，**SDK 版本：porcupine-web 4.0.0 /
web-voice-processor 4.0.10**。

## 1. 获取 AccessKey

1. 注册并登录 [console.picovoice.ai](https://console.picovoice.ai)。
2. 复制你的 **AccessKey**。
3. 写入项目根目录 `.env`：

   ```
   PICOVOICE_ACCESS_KEY=你的_access_key
   ```

   主进程通过 `CONFIG.PICOVOICE_ACCESS_KEY` 读取，并经 IPC 通道 `cfg:pv-key`
   提供给渲染进程（preload `vox.getPicovoiceKey()`）。

## 2. 训练中文「贾维斯」唤醒词

1. 在控制台进入 **Porcupine → Train Wake Word**。
2. 语言选择 **Chinese (Mandarin)**，唤醒短语填「贾维斯」。
3. 平台（Platform）选择 **Web (WASM)**。
4. 训练完成后下载，得到唤醒词文件 `*.ppn`。

## 3. 下载中文模型参数

在控制台的模型参数下载页，下载 **Chinese** 的 Porcupine 参数模型，得到
`porcupine_params_zh.pv`。

## 4. 放置文件

把两个文件重命名 / 放到 **`src/renderer/public/`**，使其在渲染进程以根路径提供：

```
src/renderer/public/jarvis.ppn                 ->  /jarvis.ppn
src/renderer/public/porcupine_params_zh.pv     ->  /porcupine_params_zh.pv
```

代码（`src/renderer/wakeword.ts`）正是以 `/jarvis.ppn` 和
`/porcupine_params_zh.pv` 这两个 `publicPath` 加载模型的。

> 这两个 `.ppn` / `.pv` 是用户私有资源（与 AccessKey 绑定），不纳入版本库；
> `src/renderer/public/` 目录仅以 `.gitkeep` 占位。
