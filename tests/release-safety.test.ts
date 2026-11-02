import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scanReleaseText,validateReleaseEntry} from '../scripts/release-safety.mjs';

test('release scanner rejects drive, UNC, loopback, credentials and download locators',()=>{
  assert.deepEqual(scanReleaseText('docs/example.md','模型目录是 E:\\Models\\voice\\actor.pth'),['windows-absolute-path','model-inventory-path']);
  assert.deepEqual(scanReleaseText('docs/example.md','根目录是 \\\\server\\share\\models'),['windows-absolute-path']);
  assert.deepEqual(scanReleaseText('docs/example.md','服务地址 http://127.0.0.1:9880/v1'),['loopback-endpoint']);
  assert.deepEqual(scanReleaseText('docs/example.md','API_KEY=abcdef0123456789'),['credential']);
  assert.deepEqual(scanReleaseText('docs/example.md','privateDownloadUrl: https://provider.example/file?Signature=secret'),['download-locator']);
});

test('release scanner permits placeholders, environment names and exact runtime loopback files',()=>{
  assert.deepEqual(scanReleaseText('docs/example.md','使用 <BOT_TTS_HOME>、<LOCAL_MODEL_ROOT> 和 process.env.BOT_IMAGE_KEY_ENV'),[]);
  assert.deepEqual(scanReleaseText('python/rvc_service.py',"host='127.0.0.1'\nurl='http://127.0.0.1:9881'"),[]);
  assert.deepEqual(scanReleaseText('docs/example.md','公开文档 https://example.com/docs 和通用扩展 .pth/.index'),[]);
});

test('release entries reject traversal, absolute paths and credential-like files',()=>{
  assert.equal(validateReleaseEntry('docs/guide.md'),undefined);
  assert.match(validateReleaseEntry('../private.txt')??'',/normalized/);
  assert.match(validateReleaseEntry('/absolute.txt')??'',/normalized/);
  assert.match(validateReleaseEntry('config/secrets.json')??'',/Credential/);
  assert.match(validateReleaseEntry('data/runtime.json')??'',/Private/);
});
