// Configuración de OS-Agent
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

export interface Config {
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
        if (key === 'MODEL') config.model = value
      }
    }
    return config
  } catch {
    return {}
  }
}

// Config por defecto
export const defaultConfig: Config = {
  model: 'opus'
}

export function getConfig(): Config {
  const osaConfig = loadOsaConfig()

  return {
    // Prioridad: env vars > osa.conf > defaults
    model: process.env.OSA_MODEL || osaConfig.model || defaultConfig.model
  }
}

// Exponer para debug
export { loadOsaConfig }
