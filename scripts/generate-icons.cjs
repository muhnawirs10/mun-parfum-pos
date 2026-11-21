/**
 * Membuat ikon PWA & splash screen dari scripts/icon.svg memakai Chromium
 * (Playwright). Jalankan: node scripts/generate-icons.cjs
 */
const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')

const svg = fs.readFileSync(path.join(__dirname, 'icon.svg'), 'utf8')
const out = path.join(__dirname, '..', 'public', 'icons')
const dataUrl = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64')

const icons = [
  { name: 'icon-192.png', size: 192, pad: 0, radius: 0 },
  { name: 'icon-512.png', size: 512, pad: 0, radius: 0 },
  // maskable: logo di zona aman 80% tengah
  { name: 'maskable-512.png', size: 512, pad: 0.12, radius: 0 },
  { name: 'apple-touch-icon.png', size: 180, pad: 0, radius: 0 },
  { name: 'favicon-32.png', size: 32, pad: 0, radius: 0.2 },
]
// splash iOS (lebar x tinggi piksel fisik)
const splashes = [
  { name: 'splash-2048x1536.png', w: 2048, h: 1536 }, // iPad 9.7"/mini landscape
  { name: 'splash-2160x1620.png', w: 2160, h: 1620 }, // iPad 10.2" landscape
  { name: 'splash-2388x1668.png', w: 2388, h: 1668 }, // iPad Pro 11" landscape
  { name: 'splash-1170x2532.png', w: 1170, h: 2532 }, // iPhone portrait
]

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  for (const i of icons) {
    await page.setViewportSize({ width: i.size, height: i.size })
    const inner = Math.round(i.size * (1 - 2 * i.pad))
    await page.setContent(`<body style="margin:0;background:#171717;display:flex;align-items:center;justify-content:center;width:${i.size}px;height:${i.size}px">
      <img src="${dataUrl}" width="${inner}" height="${inner}" style="border-radius:${i.radius * 100}%"></body>`)
    await page.screenshot({ path: path.join(out, i.name), omitBackground: i.radius > 0 })
  }
  for (const s of splashes) {
    await page.setViewportSize({ width: s.w, height: s.h })
    const logo = Math.round(Math.min(s.w, s.h) * 0.22)
    await page.setContent(`<body style="margin:0;background:#F5F5F3;display:flex;flex-direction:column;gap:${logo * 0.15}px;align-items:center;justify-content:center;width:${s.w}px;height:${s.h}px;font-family:Arial,Helvetica,sans-serif">
      <img src="${dataUrl}" width="${logo}" height="${logo}" style="border-radius:${logo * 0.22}px">
      <div style="font-size:${logo * 0.22}px;font-weight:800;color:#171717;letter-spacing:0.02em">MUN PARFUM POS</div></body>`)
    await page.screenshot({ path: path.join(out, s.name) })
  }
  await browser.close()
  console.log('ikon dibuat di', out)
})()
