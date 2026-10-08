export const MIST_PER_SUI = 1_000_000_000n

export function suiToMist(sui: string | number): bigint {
  const [whole, frac = ''] = String(sui).split('.')
  return BigInt(whole || '0') * MIST_PER_SUI + BigInt((frac + '000000000').slice(0, 9))
}

export function formatSui(mist: bigint | string | number): string {
  const value = BigInt(mist)
  const whole = value / MIST_PER_SUI
  const frac = (value % MIST_PER_SUI).toString().padStart(9, '0').replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : whole.toString()
}

export const shortAddress = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`
