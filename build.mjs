// Genera dist/index.html (file unico, tutto inline) e la versione PWA installabile in dist/pwa/.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
const r = f => readFileSync(new URL('./src/' + f, import.meta.url), 'utf8');
const esc = s => s.replace(/<\/script/g, '<\\/script');
const page = extra => r('index.html')
  .replace('/*CSS*/', () => r('style.css'))
  .replace('/*CORE*/', () => esc(r('core.js')))
  .replace('/*APP*/', () => esc(r('app.js')))
  .replace('<!--PWA-->', () => extra.head).replace('<!--SW-->', () => extra.tail);
for (const d of ['./dist', './docs']) mkdirSync(new URL(d, import.meta.url), { recursive: true });
writeFileSync(new URL('./dist/index.html', import.meta.url), page({ head: '', tail: '' }));
writeFileSync(new URL('./docs/index.html', import.meta.url), page({
  head: '<link rel="manifest" href="manifest.webmanifest"><link rel="apple-touch-icon" href="icon.png">',
  tail: `<script>if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(e=>console.warn('[sw] registrazione fallita',e));</script>`,
}));
for (const f of ['manifest.webmanifest', 'sw.js', 'icon.png']) copyFileSync(new URL('./public/' + f, import.meta.url), new URL('./docs/' + f, import.meta.url));
console.log('build ok');
