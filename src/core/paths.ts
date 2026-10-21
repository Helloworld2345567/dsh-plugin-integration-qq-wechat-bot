import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export function packageRoot():string { let folder=path.dirname(fileURLToPath(import.meta.url));while(true){const file=path.join(folder,'package.json');if(existsSync(file)&&JSON.parse(readFileSync(file,'utf8')).name==='dsh-plugin-integration-qq-wechat-bot')return folder;const parent=path.dirname(folder);if(parent===folder)throw new Error('PACKAGE_ROOT_NOT_FOUND');folder=parent;} }
