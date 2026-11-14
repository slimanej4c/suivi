import {readFile, mkdir, writeFile, copyFile} from 'node:fs/promises';

const assets = {};
for (const [route, name, type] of [
  ['/', 'index.html', 'text/html'],
  ['/app.js', 'app.js', 'text/javascript'],
  ['/style.css', 'style.css', 'text/css'],
]) {
  assets[route] = {body: await readFile(new URL('./src/' + name, import.meta.url), 'utf8'), type};
}
await mkdir('dist/server', {recursive:true});
await mkdir('dist/.openai', {recursive:true});
const worker = await readFile('src/worker.js', 'utf8');
await writeFile('dist/server/index.js', 'const assets = ' + JSON.stringify(assets) + ';\n' + worker);
await copyFile('.openai/hosting.json','dist/.openai/hosting.json');
