import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,symlink,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {OutputValidatorRegistry} from '../src/core/output-validator.js';
import {ServiceContractError} from '../src/core/service-errors.js';

async function fixture(t:any){const root=await mkdtemp(path.resolve('.codex/output-validator-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
const png=(width=1,height=1)=>{const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');bytes.writeUInt32BE(width,16);bytes.writeUInt32BE(height,20);return bytes;};

test('validator owns paths and ignores adapter-declared MIME',async t=>{
  const root=await fixture(t),file=path.join(root,'image.bin');await writeFile(file,png());const result=await new OutputValidatorRegistry().validate({kind:'image',jobDirectory:root,file:'image.bin',declaredMime:'text/html'});assert.equal(result.mime,'image/png');assert.deepEqual(result.metadata,{width:1,height:1});
  const outside=path.join(path.dirname(root),'outside.bin');await writeFile(outside,png());await assert.rejects(()=>new OutputValidatorRegistry().validate({kind:'image',jobDirectory:root,file:outside}),error=>error instanceof ServiceContractError&&error.serviceError.category==='OUTPUT_INVALID');const linked=path.join(root,'linked.png');await symlink(file,linked,'file');await assert.rejects(()=>new OutputValidatorRegistry().validate({kind:'image',jobDirectory:root,file:linked}),error=>error instanceof ServiceContractError&&error.serviceError.category==='OUTPUT_INVALID');await rm(outside,{force:true});
});

test('image validator rejects oversized dimensions and truncated payloads',async t=>{
  const root=await fixture(t),huge=path.join(root,'huge.png'),truncated=path.join(root,'truncated.jpg');await writeFile(huge,png(32768,32768));await writeFile(truncated,Buffer.from([0xff,0xd8,0xff,0xe0,0,2]));const validator=new OutputValidatorRegistry({maxImagePixels:100});
  await assert.rejects(()=>validator.validate({kind:'image',jobDirectory:root,file:huge}),/服务输出未通过宿主校验/);await assert.rejects(()=>validator.validate({kind:'image',jobDirectory:root,file:truncated}),/服务输出未通过宿主校验/);
});

test('image validator accepts static SVG output and rejects unsafe external content',async t=>{
  const root=await fixture(t),safe=path.join(root,'safe.svg'),unsafe=path.join(root,'unsafe.svg');
  await writeFile(safe,'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 16"><rect width="24" height="16"/></svg>');
  await writeFile(unsafe,'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="16"><script>alert(1)</script></svg>');
  const result=await new OutputValidatorRegistry().validate({kind:'image',jobDirectory:root,file:'safe.svg'});
  assert.equal(result.mime,'image/svg+xml');assert.deepEqual(result.metadata,{width:24,height:16});
  await assert.rejects(()=>new OutputValidatorRegistry().validate({kind:'image',jobDirectory:root,file:'unsafe.svg'}),/服务输出未通过宿主校验/);
});

test('file validator rejects ZIP traversal and expansion bombs',async t=>{
  const root=await fixture(t),file=path.join(root,'bad.zip'),entry=Buffer.from('../outside.txt');const header=Buffer.alloc(46);header.writeUInt32LE(0x02014b50,0);header.writeUInt32LE(1_000_000,24);header.writeUInt16LE(entry.length,28);await writeFile(file,Buffer.concat([Buffer.from([0x50,0x4b,0x03,0x04]),Buffer.alloc(8),header,entry]));
  await assert.rejects(()=>new OutputValidatorRegistry({maxArchiveExpandedBytes:1000}).validate({kind:'file',jobDirectory:root,file}),/服务输出未通过宿主校验/);
});
