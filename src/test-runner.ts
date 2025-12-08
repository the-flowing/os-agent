// Test runner con paralelismo configurable

export interface TestCase {
  name: string
  fn: () => Promise<void>
}

export interface TestResult {
  name: string
  passed: boolean
  error?: string
  durationMs: number
}

export interface RunnerConfig {
  concurrency: number  // k = cuántos tests corren en paralelo
}

const defaultConfig: RunnerConfig = {
  concurrency: 3
}

export async function runTests(
  tests: TestCase[],
  config: RunnerConfig = defaultConfig
): Promise<TestResult[]> {
  const results: TestResult[] = []
  const queue = [...tests]
  const running: Promise<void>[] = []

  async function runOne(test: TestCase): Promise<void> {
    const start = Date.now()
    try {
      await test.fn()
      results.push({
        name: test.name,
        passed: true,
        durationMs: Date.now() - start
      })
      console.log(`  ✓ ${test.name} (${Date.now() - start}ms)`)
    } catch (error) {
      results.push({
        name: test.name,
        passed: false,
        error: String(error),
        durationMs: Date.now() - start
      })
      console.log(`  ✗ ${test.name} (${Date.now() - start}ms)`)
    }
  }

  // Procesar en batches de k
  while (queue.length > 0 || running.length > 0) {
    // Llenar hasta k concurrent
    while (running.length < config.concurrency && queue.length > 0) {
      const test = queue.shift()!
      const promise = runOne(test).then(() => {
        running.splice(running.indexOf(promise), 1)
      })
      running.push(promise)
    }

    // Esperar a que al menos uno termine
    if (running.length > 0) {
      await Promise.race(running)
    }
  }

  return results
}

export function summarize(results: TestResult[]): { passed: number; failed: number; totalMs: number } {
  const passed = results.filter(r => r.passed).length
  const failed = results.filter(r => !r.passed).length
  const totalMs = results.reduce((sum, r) => sum + r.durationMs, 0)

  console.log(`\n${passed} passed, ${failed} failed (${totalMs}ms total)`)

  if (failed > 0) {
    console.log('\nFailed tests:')
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  ✗ ${r.name}: ${r.error}`)
    })
  }

  return { passed, failed, totalMs }
}
