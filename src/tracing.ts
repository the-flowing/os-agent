import * as fs from "node:fs/promises"
import * as path from "node:path"

const TRACE_DIR = path.resolve(process.cwd(), "traces")

type TraceContext = {
  provider?: string
  model?: string
  protocol?: string
  url?: string
  stream?: boolean
}

type TraceEntry = {
  type: "meta" | "request" | "response" | "stream_chunk" | "error" | "info"
  [key: string]: any
}

export interface TraceLogger {
  id: string
  path: string
  write(entry: TraceEntry): Promise<void>
}

async function ensureTraceDir() {
  try {
    await fs.mkdir(TRACE_DIR, { recursive: true })
  } catch {}
}

function safeFilenamePart(input?: string) {
  const safe = (input || "unknown").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 60)
  return safe || "unknown"
}

export async function createTraceLogger(context: TraceContext): Promise<TraceLogger> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const name = `${timestamp}-${safeFilenamePart(context.provider)}-${safeFilenamePart(context.model)}`
  const filePath = path.join(TRACE_DIR, `${name}.jsonl`)

  await ensureTraceDir()

  const initialEntry: TraceEntry = { type: "meta", timestamp: new Date().toISOString(), context }
  try {
    await fs.appendFile(filePath, JSON.stringify(initialEntry) + "\n")
  } catch {}

  const write = async (entry: TraceEntry) => {
    try {
      await fs.appendFile(filePath, JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + "\n")
    } catch {}
  }

  return { id: name, path: filePath, write }
}

const SECRET_KEYS = [
  "authorization",
  "api-key",
  "apikey",
  "token",
  "secret",
  "set-cookie",
  "cookie",
  "password",
  "session",
  "access_token",
  "refresh_token"
]

function isSecretKey(key: string) {
  const lower = key.toLowerCase()
  return SECRET_KEYS.some(k => lower.includes(k))
}

export function redactHeadersForTrace(headers: Record<string, string>): Record<string, string> {
  const output: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    output[key] = isSecretKey(key) ? "[redacted]" : value
  }
  return output
}

export function redactForTrace(value: any): any {
  if (value === null || value === undefined) return value
  if (typeof value === "string") {
    if (value.length > 20000) return value.slice(0, 20000) + "...<truncated>"
    return value
  }
  if (Array.isArray(value)) {
    return value.map(v => redactForTrace(v))
  }
  if (typeof value === "object") {
    const output: Record<string, any> = {}
    for (const [key, val] of Object.entries(value)) {
      output[key] = isSecretKey(key) ? "[redacted]" : redactForTrace(val)
    }
    return output
  }
  return value
}

export function logStreamToTrace(stream: ReadableStream<Uint8Array>, trace: TraceLogger) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()

  ;(async () => {
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        if (chunk) await trace.write({ type: "stream_chunk", chunk })
      }
      const finalChunk = decoder.decode()
      if (finalChunk) await trace.write({ type: "stream_chunk", chunk: finalChunk })
    } catch (err) {
      await trace.write({ type: "error", message: err instanceof Error ? err.message : String(err) })
    } finally {
      try {
        reader.releaseLock()
      } catch {}
      await trace.write({ type: "info", message: "stream_end" })
    }
  })()
}
