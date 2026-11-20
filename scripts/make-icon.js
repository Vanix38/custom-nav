// Génère build/icon.ico (multi-tailles) et build/icon.png à partir de build/icon.svg.
// Usage : npx electron scripts/make-icon.js
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const dir = path.join(__dirname, '..', 'build');
const svg = fs.readFileSync(path.join(dir, 'icon.svg'), 'utf8');

// Rendu unique en 512 px, puis réduction pour chaque taille
async function renderMaster() {
  const size = 512;
  const win = new BrowserWindow({
    show: false, width: size, height: size, useContentSize: true, transparent: true, frame: false,
    webPreferences: { offscreen: true },
  });
  win.webContents.setZoomFactor(1);
  const html = `<html><body style="margin:0;background:transparent">
    <img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="${size}" height="${size}" style="display:block"></body></html>`;
  const file = path.join(app.getPath('temp'), 'explora-icon.html');
  fs.writeFileSync(file, html);
  await win.loadFile(file);
  await new Promise((r) => setTimeout(r, 500));
  let img = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
  if (img.getSize().width !== size) img = img.resize({ width: size, height: size, quality: 'best' });
  win.destroy();
  fs.unlinkSync(file);
  return img;
}

// ICO dont chaque image est un PNG (format accepté depuis Windows Vista)
function buildIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const master = await renderMaster();
  const pngs = SIZES.map((size) => ({ size, data: master.resize({ width: size, height: size, quality: 'best' }).toPNG() }));
  fs.writeFileSync(path.join(dir, 'icon.ico'), buildIco(pngs));
  fs.writeFileSync(path.join(dir, 'icon.png'), master.toPNG());
  console.log('icon.ico et icon.png générés');
  app.quit();
});
