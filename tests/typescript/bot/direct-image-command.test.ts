import {test} from 'node:test';
import assert from 'node:assert/strict';
import {commandHelp} from '../../../src/core/commands.js';
import {parseDirectImageCommand as parse} from '../../../src/core/direct-image-command.js';
import {systemMessage} from '../../../src/i18n/system.js';

test('only explicit draw and edit commands select the direct image path',()=>{
  for(const text of ['/image google','/drawn hills','//draw cats','//生图：猫','please /draw this','请画一只猫','能不能生图：一只猫','生图怎么操作','要我回复“修图：”吗？']){
    assert.equal(parse(text),undefined,text);
  }
  assert.deepEqual(parse('/DRAW /image google'),{kind:'request',operation:'image_generate',parameters:{prompt:'/image google'}});
  assert.deepEqual(parse('/edit 把红色换成蓝色'),{kind:'request',operation:'image_edit',parameters:{prompt:'把红色换成蓝色'}});
});

test('Chinese image directives require an exact initial verb and colon',()=>{
  for(const prefix of ['生图：','生成图片: ']){
    assert.deepEqual(parse(prefix+'--n 2 一只猫'),{kind:'request',operation:'image_generate',parameters:{prompt:'一只猫',n:2}});
  }
  for(const prefix of ['修图:','编辑图片：']){
    assert.deepEqual(parse(prefix+'把前景变亮'),{kind:'request',operation:'image_edit',parameters:{prompt:'把前景变亮'}});
  }
  assert.deepEqual(parse('生图：'),{kind:'invalid'});
});

test('leading options leave subsequent prompt text, signs and whitespace intact',()=>{
  const prompt='Create   a poster\nprint "--n 2" and /stop on it';
  for(const args of ['--size 1024x768 --n 3','--n 3 --size 1024×768']){
    assert.deepEqual(parse(`/draw ${args} ${prompt}`),{
      kind:'request',operation:'image_generate',parameters:{prompt,width:1024,height:768,n:3},
    });
  }
  assert.deepEqual(parse('/edit -- --size 5x5'),{kind:'request',operation:'image_edit',parameters:{prompt:'--size 5x5'}});
});

test('recognized but incomplete or malformed image commands return a usage result',()=>{
  for(const text of ['/draw','/edit --','/draw --size 512x512','/edit --n two cats','/draw --size 1280 cats','/draw --n=2 cats','/draw --n 2 --n 3 cats','/edit --size 512x512 --size 256x256 cats','/draw --typo cats']){
    assert.deepEqual(parse(text),{kind:'invalid'},text);
  }
  for(const locale of ['zh','en'] as const){
    for(const text of [systemMessage(locale,'directImageUsage'),commandHelp(false,false,locale)]){
      assert.match(text,/\/draw\b/);assert.match(text,/\/edit\b/);
    }
  }
});
