// Tipos base

export interface ToolDefinition {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

export interface Tool {
  definition: ToolDefinition
  execute: (params: Record<string, unknown>) => Promise<string>
}
