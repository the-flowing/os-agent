import { describe, test, expect, beforeAll } from 'bun:test'

// NOTA: Estos tests requieren TTY interactivo que no está disponible en bun test.
// El CLI basado en Ink necesita raw mode para funcionar.
// Para testear Ctrl+C manualmente: bun run src/cli.tsx
import { spawn } from 'child_process'

function runCLI(): Promise<{ spawn: ReturnType<typeof spawn>, output: string[] }> {
  return new Promise((resolve) => {
    const output: string[] = []
    const proc = spawn('bun', ['src/cli.tsx'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0' }
    })

    proc.stdout?.on('data', (data) => {
      output.push(data.toString())
      console.log('STDOUT:', data.toString())
    })

    proc.stderr?.on('data', (data) => {
      output.push(data.toString())
      console.log('STDERR:', data.toString())
    })

    // Esperar a que arranque
    setTimeout(() => resolve({ spawn: proc, output }), 1000)
  })
}

// Skip: Ink requiere TTY que no está disponible en bun test
describe.skip('Ctrl+C behavior', () => {
  test('Ctrl+C con texto escrito debe limpiar línea, no salir', async () => {
    const { spawn: proc, output } = await runCLI()

    // Escribir algo
    proc.stdin?.write('hola mundo')
    await new Promise(r => setTimeout(r, 100))

    // Enviar Ctrl+C
    proc.stdin?.write('\x03') // Ctrl+C
    await new Promise(r => setTimeout(r, 200))

    // El proceso debería seguir vivo
    const isAlive = proc.exitCode === null
    console.log('Process alive after Ctrl+C with text:', isAlive)
    console.log('Exit code:', proc.exitCode)
    console.log('Output:', output.join(''))

    // Limpiar
    proc.kill()

    expect(isAlive).toBe(true)
  }, 10000)

  test('Ctrl+C sin texto debe salir', async () => {
    const { spawn: proc, output } = await runCLI()

    // Enviar Ctrl+C directo (sin escribir nada)
    proc.stdin?.write('\x03') // Ctrl+C

    // Esperar a que termine
    await new Promise(r => setTimeout(r, 500))

    console.log('Exit code after Ctrl+C empty:', proc.exitCode)
    console.log('Output:', output.join(''))

    const exited = proc.exitCode !== null

    // Limpiar por si acaso
    if (proc.exitCode === null) proc.kill()

    expect(exited).toBe(true)
  }, 10000)

  test('Ctrl+C x2 rápido debe salir siempre', async () => {
    const { spawn: proc, output } = await runCLI()

    // Escribir algo
    proc.stdin?.write('texto')
    await new Promise(r => setTimeout(r, 100))

    // Ctrl+C dos veces rápido
    proc.stdin?.write('\x03')
    await new Promise(r => setTimeout(r, 50))
    proc.stdin?.write('\x03')

    await new Promise(r => setTimeout(r, 500))

    console.log('Exit code after 2x Ctrl+C:', proc.exitCode)
    console.log('Output:', output.join(''))

    const exited = proc.exitCode !== null
    if (proc.exitCode === null) proc.kill()

    expect(exited).toBe(true)
  }, 10000)
})
