// Optional PNG comparison sheet. Pass the path to an installed sharp module.
const fs = require('node:fs');
const sharp = require(process.argv[2] || 'sharp');
const root = 'docs/brand-concepts';
const concepts = JSON.parse(fs.readFileSync(`${root}/manifest.json`, 'utf8'));
const colors = {
  light: { accent: '#4f46e5', soft: '#e9e8ff', text: '#1c2029', surface: '#ffffff', on: '#ffffff', muted: '#5d6878' },
  dark: { accent: '#8b85ff', soft: '#2c2a52', text: '#e6e8ee', surface: '#1b1e26', on: '#12141a', muted: '#9aa3b2' },
};
(async () => {
  const layers = [];
  for (let i = 0; i < concepts.length; i++) {
    const { id } = concepts[i];
    const x = 30 + (i % 2) * 570, y = 130 + Math.floor(i / 2) * 180;
    for (const [j, mode] of ['light', 'dark'].entries()) {
      let source = fs.readFileSync(`${root}/${id}-lockup-${mode}.svg`, 'utf8');
      source = source.replace(/<style>[\s\S]*?<\/style>/, '').replace(/var\(--([\w-]+)\)/g, (_, key) => colors[mode][key]);
      layers.push({ input: await sharp(Buffer.from(source)).resize(345, 60).png().toBuffer(), left: x + 45, top: y + 30 + j * 74 });
      let icon = fs.readFileSync(`${root}/${id}-icon-${mode}.svg`, 'utf8');
      icon = icon.replace(/<style>[\s\S]*?<\/style>/, '').replace(/var\(--([\w-]+)\)/g, (_, key) => colors[mode][key]);
      layers.push({ input: await sharp(Buffer.from(icon)).resize(32, 32).png().toBuffer(), left: x + 474, top: y + 44 + j * 74 });
    }
  }
  const panels = concepts.map(({id}, i) => {
    const x = 30 + (i % 2) * 570, y = 130 + Math.floor(i / 2) * 180;
    return `<text x="${x + 4}" y="${y + 17}" font-size="14" font-weight="600" fill="#5d6878">${id}</text><rect x="${x}" y="${y + 24}" width="540" height="68" rx="9" fill="#ffffff"/><rect x="${x}" y="${y + 98}" width="540" height="68" rx="9" fill="#1b1e26"/>`;
  }).join('');
  const background = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1170" height="1060"><rect width="1170" height="1060" fill="#f4f5f8"/><g font-family="Segoe UI,Arial,sans-serif"><text x="34" y="47" font-size="12" letter-spacing="3" fill="#4f46e5">NAI-TAGDECK / BRAND CONCEPTS</text><text x="32" y="91" font-size="30" font-weight="700" fill="#1c2029">10 header logo concepts</text>${panels}</g></svg>`);
  await sharp(background).composite(layers).png().toFile(`${root}/overview.png`);
  console.log(`${root}/overview.png`);
})().catch(error => { console.error(error); process.exitCode = 1; });
