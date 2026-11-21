/**
 * Karyawan dapat login dengan username. Username dipetakan ke email sintetis
 * (username@<domain staf>) yang dibuat saat akun dibuat oleh owner, sehingga
 * tidak perlu endpoint publik untuk mencari email dari username.
 */
export function identifierToEmail(identifier: string, staffDomain: string): string {
  const v = identifier.trim().toLowerCase()
  return v.includes('@') ? v : `${v}@${staffDomain}`
}
