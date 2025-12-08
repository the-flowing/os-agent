// Tests para tools: create, patch, glob, grep (rg)

import { describe, test, expect, beforeAll } from 'bun:test'
import { loadTools, executeTool } from '../tool-loader'
import { mkdir, rm, unlink } from 'node:fs/promises'

beforeAll(async () => {
  await loadTools()
})

describe('Tool: create', () => {
  test('crea archivo nuevo', async () => {
    const file = `/tmp/create-test-${Date.now()}.txt`

    const result = await executeTool('create', {
      path: file,
      content: 'Hello World'
    })

    expect(result).toContain('creado')
    const content = await Bun.file(file).text()
    expect(content).toBe('Hello World')

    await unlink(file)
  })

  test('error si archivo ya existe', async () => {
    const file = `/tmp/create-exists-${Date.now()}.txt`
    await Bun.write(file, 'existing')

    const result = await executeTool('create', {
      path: file,
      content: 'new content'
    })

    expect(result).toContain('ya existe')
    expect(result).toContain('patch')

    // Contenido no cambió
    const content = await Bun.file(file).text()
    expect(content).toBe('existing')

    await unlink(file)
  })

  test('crea directorios si no existen', async () => {
    const file = `/tmp/create-dir-${Date.now()}/sub/file.txt`

    const result = await executeTool('create', {
      path: file,
      content: 'nested'
    })

    expect(result).toContain('creado')
    const content = await Bun.file(file).text()
    expect(content).toBe('nested')

    await rm(`/tmp/create-dir-${file.split('/')[2]}`, { recursive: true, force: true })
  })
})

describe('Tool: patch', () => {
  test('aplica patch a archivo existente', async () => {
    const file = `/tmp/patch-test-${Date.now()}.txt`
    await Bun.write(file, 'line one\nline two\nline three\n')

    const result = await executeTool('patch', {
      path: file,
      old_string: 'line two',
      new_string: 'line TWO modified'
    })

    expect(result).toContain('modificado')

    const content = await Bun.file(file).text()
    expect(content).toContain('line TWO modified')

    await unlink(file)
  })

  test('error si archivo no existe', async () => {
    const file = `/tmp/patch-noexist-${Date.now()}.txt`

    const result = await executeTool('patch', {
      path: file,
      old_string: 'whatever',
      new_string: 'new'
    })

    expect(result).toContain('no existe')
    expect(result).toContain('create')
  })

  test('error si old_string no es único', async () => {
    const file = `/tmp/patch-dup-${Date.now()}.txt`
    await Bun.write(file, 'foo bar\nfoo baz\n')

    const result = await executeTool('patch', {
      path: file,
      old_string: 'foo',
      new_string: 'qux'
    })

    expect(result).toContain('2 veces')
    expect(result).toContain('replace_all')

    await unlink(file)
  })

  test('replace_all reemplaza todas las ocurrencias', async () => {
    const file = `/tmp/patch-all-${Date.now()}.txt`
    await Bun.write(file, 'foo bar\nfoo baz\n')

    const result = await executeTool('patch', {
      path: file,
      old_string: 'foo',
      new_string: 'qux',
      replace_all: true
    })

    expect(result).toContain('2 reemplazos')

    const content = await Bun.file(file).text()
    expect(content).toBe('qux bar\nqux baz\n')

    await unlink(file)
  })
})

describe('Tool: glob', () => {
  test('encuentra archivos por patrón', async () => {
    const dir = `/tmp/glob-test-${Date.now()}`
    await mkdir(dir, { recursive: true })
    await Bun.write(`${dir}/a.ts`, 'a')
    await Bun.write(`${dir}/b.ts`, 'b')
    await Bun.write(`${dir}/c.js`, 'c')

    const result = await executeTool('glob', {
      pattern: '*.ts',
      cwd: dir
    })

    expect(result).toContain('a.ts')
    expect(result).toContain('b.ts')
    expect(result).not.toContain('c.js')

    await rm(dir, { recursive: true, force: true })
  })

  test('busca recursivamente', async () => {
    const dir = `/tmp/glob-recursive-${Date.now()}`
    await mkdir(`${dir}/sub`, { recursive: true })
    await Bun.write(`${dir}/a.ts`, 'a')
    await Bun.write(`${dir}/sub/d.ts`, 'd')

    const result = await executeTool('glob', {
      pattern: '**/*.ts',
      cwd: dir
    })

    expect(result).toContain('a.ts')
    expect(result).toContain('d.ts')

    await rm(dir, { recursive: true, force: true })
  })
})

describe('Tool: grep (ripgrep)', () => {
  test('encuentra texto en archivo', async () => {
    const file = `/tmp/grep-test-${Date.now()}.txt`
    await Bun.write(file, 'line one\nline two\nline three')

    const result = await executeTool('grep', {
      pattern: 'two',
      path: file
    })

    expect(result).toContain('line two')
    expect(result).toContain('2:')

    await unlink(file)
  })

  test('busca en directorio', async () => {
    const dir = `/tmp/grep-dir-${Date.now()}`
    await mkdir(dir, { recursive: true })
    await Bun.write(`${dir}/file1.txt`, 'hello world')
    await Bun.write(`${dir}/file2.txt`, 'goodbye world')

    const result = await executeTool('grep', {
      pattern: 'world',
      path: dir
    })

    expect(result).toContain('world')
    expect(result).toContain('2 coincidencias')

    await rm(dir, { recursive: true, force: true })
  })

  test('busca case insensitive', async () => {
    const file = `/tmp/grep-case-${Date.now()}.txt`
    await Bun.write(file, 'Hello\nHELLO\nhello')

    const result = await executeTool('grep', {
      pattern: 'hello',
      path: file,
      ignore_case: true
    })

    expect(result).toContain('3 coincidencias')

    await unlink(file)
  })
})
