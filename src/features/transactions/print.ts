/**
 * Cetak struk lewat dialog cetak browser. CSS @media print (index.css) hanya
 * menampilkan elemen .receipt-print dengan lebar kertas 58 mm.
 */
export function printReceipt() {
  window.print()
}
