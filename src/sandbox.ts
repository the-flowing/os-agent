// Sandbox para ejecutar tareas aisladas
// Crea un entorno temporal, ejecuta código, corre tests, limpia

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface SandboxResult {
  success: boolean
  output: string
  testsPassed?: boolean
  error?: string
}

export class Sandbox {
  public dir: string | null = null

  async create(): Promise<string> {
    this.dir = await mkdtemp(join(tmpdir(), 'osa-sandbox-'))
    return this.dir
  }

  async writeFile(relativePath: string, content: string): Promise<void> {
    if (!this.dir) throw new Error('Sandbox no inicializado')
    const fullPath = join(this.dir, relativePath)

    // Crear directorios si no existen
    const dir = fullPath.substring(0, fullPath.lastIndexOf('/'))
    if (dir !== this.dir) {
      await Bun.spawn(['mkdir', '-p', dir]).exited
    }

    await Bun.write(fullPath, content)
  }

  async readFile(relativePath: string): Promise<string> {
    if (!this.dir) throw new Error('Sandbox no inicializado')
    const file = Bun.file(join(this.dir, relativePath))
    return await file.text()
  }

  async exec(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    if (!this.dir) throw new Error('Sandbox no inicializado')

    const proc = Bun.spawn(['bash', '-c', command], {
      cwd: this.dir,
      stdout: 'pipe',
      stderr: 'pipe'
    })

    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited

    return { stdout, stderr, exitCode }
  }

  async runTests(testCommand: string = 'bun test'): Promise<SandboxResult> {
    if (!this.dir) throw new Error('Sandbox no inicializado')

    const { stdout, stderr, exitCode } = await this.exec(testCommand)

    return {
      success: exitCode === 0,
      output: stdout + stderr,
      testsPassed: exitCode === 0,
      error: exitCode !== 0 ? stderr : undefined
    }
  }

  async destroy(): Promise<void> {
    if (this.dir) {
      await rm(this.dir, { recursive: true, force: true })
      this.dir = null
    }
  }
}

// Función helper para ejecutar una tarea completa en sandbox
export async function runInSandbox(
  setup: (sandbox: Sandbox) => Promise<void>,
  testCommand?: string
): Promise<SandboxResult> {
  const sandbox = new Sandbox()

  try {
    await sandbox.create()
    await setup(sandbox)
    return await sandbox.runTests(testCommand)
  } catch (error) {
    return {
      success: false,
      output: '',
      error: String(error)
    }
  } finally {
    await sandbox.destroy()
  }
}
