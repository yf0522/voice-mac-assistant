import 'dotenv/config'

export const CONFIG = {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? '',
  IDLE_TIMEOUT_MS: 5 * 60 * 1000,
  GEMINI_MODEL: 'gemini-2.0-flash-live-001'
}
