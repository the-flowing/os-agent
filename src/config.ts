// Configuración de OS-Agent
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

export interface Config {
  baseURL: string
  apiKey: string
  model: string
}

// Leer archivo osa.conf si existe
function loadOsaConfig(): Partial<Config> {
  const configPath = join(process.cwd(), 'osa.conf')
  
  if (!existsSync(configPath)) {
    return {}
  }

  try {
    const content = readFileSync(configPath, 'utf-8')
    const config: Partial<Config> = {}

    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=')
        const value = valueParts.join('=').trim()
        if (key === 'API_URL') config.baseURL = value
        if (key === 'API_KEY') config.apiKey = value
        if (key === 'MODEL') config.model = value
      }
    }
    return config
  } catch {
    return {}
  }
}

// Config por defecto - usa el proxy local con formato OpenAI
export const defaultConfig: Config = {
  baseURL: 'http://localhost:8317/v1',
  apiKey: 'yeee-bro-it-works-lit-67',
  model: 'claude-sonnet-4-5-20250929'
}

// Modelos disponibles en el proxy:
// - claude-sonnet-4-20250514
// - claude-sonnet-4-5-20250929
// - claude-opus-4-20250514
// - claude-opus-4-1-20250805

export function getConfig(): Config {
  const osaConfig = loadOsaConfig()

  return {
    // Prioridad: env vars > osa.conf > defaults
    baseURL: process.env.OSA_BASE_URL || osaConfig.baseURL || defaultConfig.baseURL,
    apiKey: process.env.OSA_API_KEY || osaConfig.apiKey || defaultConfig.apiKey,
    model: process.env.OSA_MODEL || osaConfig.model || defaultConfig.model
  }
}

// Exponer para debug
export { loadOsaConfig }
