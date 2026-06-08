import { Type } from '@google/genai'
import type { FunctionDeclaration } from '@google/genai'

// 单一真相源：Gemini 工具声明。新增动作时只改这里 + 对应 handler。
export const functionDeclarations: FunctionDeclaration[] = [
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
