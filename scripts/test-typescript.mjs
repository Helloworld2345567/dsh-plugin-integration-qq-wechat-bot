import { globSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const runtimeOwnedEnvironment = [
  'BOT_DATA_HOME',
  'BOT_HOME',
  'BOT_PERSONAS_ROOT',
  'BOT_WORKSPACE_ROOT',
  'DSH_AGENTS_HOME',
  'DSH_HOME',
  'DSH_PROFILE',
  'DSH_PROFILE_DIR',
  'DSH_SESSION_ID',
  'DSH_WEB_URL',
];

const env = { ...process.env };
for (const name of runtimeOwnedEnvironment) delete env[name];

const files = globSync('tests/*.test.ts').sort();
if (!files.length) throw new Error('No TypeScript tests found');

const cli = fileURLToPath(import.meta.resolve('tsx/cli'));
const child = spawn(process.execPath, [cli, '--test', ...files], {
  cwd: process.cwd(),
  env,
  stdio: 'inherit',
  windowsHide: true,
});

child.once('error', error => {
  console.error(error);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  if (signal) {
    console.error(`TypeScript tests terminated by ${signal}`);
    process.exitCode = 1;
  } else {
    process.exitCode = code ?? 1;
  }
});
