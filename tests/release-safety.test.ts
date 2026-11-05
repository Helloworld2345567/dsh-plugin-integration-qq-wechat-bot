import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isReleaseTextFile,scanReleaseText,validateReleaseEntry} from '../scripts/release-safety.mjs';

test('release scanner rejects absolute paths, loopback, credentials and download locators',()=>{
  assert.deepEqual(scanReleaseText('docs/example.md','模型目录是 E:\\Models\\voice\\actor.pth'),['windows-absolute-path','model-inventory-path']);
  assert.deepEqual(scanReleaseText('docs/example.md','根目录是 \\\\server\\share\\models'),['windows-absolute-path']);
  assert.deepEqual(scanReleaseText('docs/example.md','运行目录 /home/operator/private'),['absolute-path']);
  assert.deepEqual(scanReleaseText('docs/example.md','运行目录 /root/private/config.json'),['absolute-path']);
  assert.deepEqual(scanReleaseText('docs/example.md','服务地址 http://127.0.0.1:9880/v1'),['loopback-endpoint']);
  assert.deepEqual(scanReleaseText('docs/example.md','API_KEY=abcdef0123456789'),['credential']);
  assert.deepEqual(scanReleaseText('docs/example.md','privateDownloadUrl: https://provider.example/file?Signature=secret'),['download-locator']);
  assert.deepEqual(scanReleaseText('docs/example.md','https://provider.example/file?ticket=secret-value'),['download-locator']);
});

test('release scanner permits placeholders, environment names and exact runtime loopback files',()=>{
  assert.deepEqual(scanReleaseText('docs/example.md','使用 <BOT_TTS_HOME>、<LOCAL_MODEL_ROOT> 和 process.env.BOT_IMAGE_KEY_ENV'),[]);
  assert.deepEqual(scanReleaseText('python/rvc_service.py',"host='127.0.0.1'\nurl='http://127.0.0.1:9881'"),[]);
  assert.deepEqual(scanReleaseText('docs/example.md','公开文档 https://example.com/docs 和通用扩展 .pth/.index'),[]);
  assert.deepEqual(scanReleaseText('docs/example.md','回调示例 https://example.com/callback?code=placeholder'),[]);
  assert.equal(isReleaseTextFile('.env.example'),true);
  assert.deepEqual(scanReleaseText('.env.example','# API_KEY=abcdef0123456789'),['credential']);
  assert.deepEqual(scanReleaseText('.env.example','# DOWNLOAD=https://provider.example/file?Signature=secret'),['download-locator']);
});

test('release entries reject traversal, absolute paths and credential-like files',()=>{
  assert.equal(validateReleaseEntry('docs/guide.md'),undefined);
  assert.equal(validateReleaseEntry('.env.example'),undefined);
  assert.match(validateReleaseEntry('.env.local')??'',/Private/);
  assert.match(validateReleaseEntry('../private.txt')??'',/normalized/);
  assert.match(validateReleaseEntry('/absolute.txt')??'',/normalized/);
  assert.match(validateReleaseEntry('config/secrets.json')??'',/Credential/);
  assert.match(validateReleaseEntry('credentials/private.json')??'',/Credential/);
  assert.match(validateReleaseEntry('secrets/private.json')??'',/Credential/);
  assert.match(validateReleaseEntry('data/runtime.json')??'',/Private/);
  assert.match(validateReleaseEntry('__pycache__/worker.pyc')??'',/Private/);
  assert.match(validateReleaseEntry('test-results/run/output.tmp')??'',/Private/);
  assert.match(validateReleaseEntry('models/voice/actor.pth')??'',/Model/);
});

test('release packaging and publishing cannot bypass the complete verification gate',()=>{
  const manifest=JSON.parse(readFileSync('package.json','utf8'));
  assert.ok(!manifest.files.some((file:string)=>/(?:^|\/)(?:tests?|fixtures?)(?:\/|$)/i.test(file)),'test doubles and fixtures must not be declared for npm pack');
  assert.equal(manifest.scripts['check:architecture'],'node scripts/check-architecture.mjs');
  assert.match(manifest.scripts['verify:release'],/^npm run check:architecture && /);
  assert.match(manifest.scripts['verify:release'],/npm run build && npm test/);
  assert.equal(manifest.scripts['prepublishOnly'],'npm run verify:release');
  assert.match(manifest.scripts['release:pack'],/^npm run verify:release && node scripts\/release-pack\.mjs$/);
  assert.doesNotMatch(manifest.scripts['verify:release'],/npm pack(?!.*--ignore-scripts)/);
});
