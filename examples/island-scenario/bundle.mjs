// Package reviewed source into the same inert bundle returned by a designer.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const files={};
for(const name of ['manifest.json','report.md','implementation/common.mjs','implementation/install.mjs','implementation/verify.mjs'])files[name]=readFileSync(fileURLToPath(new URL(name,import.meta.url)),'utf8');
process.stdout.write(JSON.stringify({files},null,2)+'\n');
