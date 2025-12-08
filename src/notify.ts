// Sistema de notificaciones simple - solo sonido
// En macOS usa el sonido del sistema

export const sounds = {
  default: '/System/Library/Sounds/Glass.aiff',
  complete: '/System/Library/Sounds/Funk.aiff',
  error: '/System/Library/Sounds/Basso.aiff',
  attention: '/System/Library/Sounds/Ping.aiff',
}

export async function notify(message?: string, sound: string = sounds.default): Promise<void> {
  if (message) {
    console.log(`\n🔔 ${message}\n`)
  }

  try {
    const proc = Bun.spawn(['afplay', sound], { stderr: 'ignore' })
    await proc.exited
  } catch {}
}

export async function notifySuccess(message: string): Promise<void> {
  console.log(`\n✅ ${message}\n`)
  await notify(undefined, sounds.complete)
}

export async function notifyError(message: string): Promise<void> {
  console.log(`\n❌ ${message}\n`)
  await notify(undefined, sounds.error)
}

export async function notifyNeedsInput(message: string): Promise<void> {
  console.log(`\n⏳ ${message}\n`)
  await notify(undefined, sounds.attention)
}
