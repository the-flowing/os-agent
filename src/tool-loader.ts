// Carga dinámica de tools
// Cada archivo en ./tools/ es una tool que se puede cargar/recargar en runtime

import { readdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import type { ToolDefinition, Tool } from './types'

// Tipo de tool compatible con Claude API
interface ClaudeTool {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

const toolsDir = join(dirname(import.meta.path), 'tools')

// Cache de tools - se puede invalidar para recargar
const toolCache = new Map<string, Tool>()

export async function loadTools(): Promise<void> {
  const files = await readdir(toolsDir)

  for (const file of files) {
    if (file.endsWith('.ts')) {
      const toolName = file.replace('.ts', '')
      await loadTool(toolName)
    }
  }
}

export async function loadTool(name: string): Promise<Tool | null> {
  try {
    // Importar dinámicamente con timestamp para forzar recarga
    const modulePath = join(toolsDir, `${name}.ts`)
    const module = await import(`${modulePath}?t=${Date.now()}`)

    const tool: Tool = {
      definition: module.definition,
      execute: module.execute
    }

    toolCache.set(name, tool)
    return tool
  } catch (error) {
    console.error(`Error cargando tool ${name}:`, error)
    return null
  }
}

export async function reloadTool(name: string): Promise<Tool | null> {
  toolCache.delete(name)
  return loadTool(name)
}

export async function reloadAllTools(): Promise<void> {
  toolCache.clear()
  await loadTools()
}

export async function getToolDefinitions(): Promise<ClaudeTool[]> {
  const definitions: ClaudeTool[] = []

  for (const [, tool] of toolCache) {
    definitions.push({
      name: tool.definition.name,
      description: tool.definition.description,
      input_schema: tool.definition.input_schema
    })
  }

  return definitions
}

export async function executeTool(name: string, params: Record<string, unknown>): Promise<string> {
  const tool = toolCache.get(name)

  if (!tool) {
    return `Error: tool "${name}" no encontrada`
  }

  try {
    return await tool.execute(params)
  } catch (error) {
    return `Error ejecutando tool: ${error}`
  }
}

// Exponer función para agregar tools en runtime
export async function addTool(name: string, code: string): Promise<boolean> {
  const toolPath = join(toolsDir, `${name}.ts`)

  try {
    await Bun.write(toolPath, code)
    await loadTool(name)
    console.log(`✅ Tool "${name}" agregada`)
    return true
  } catch (error) {
    console.error(`Error agregando tool:`, error)
    return false
  }
}
