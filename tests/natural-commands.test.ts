import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseNaturalControl} from '../src/core/natural-commands.js';

const accepted:Record<string,string[]>={
  stop:['停止','停止一下','停下','停下来','停一下','停止当前任务','停止当前操作','取消任务','取消当前任务','停止生成','停止回复','中断当前任务','stop','STOP NOW','stop current task','stop the current task','cancel this task','abort the task'],
  new:['新会话','新对话','新建会话','开启新会话','开启全新会话','开始一个新对话','创建一个新的会话','new chat','start a new session','open new conversation','create a new chat'],
  reset:['清空会话','清空当前会话','清空上下文','清空当前会话上下文','重置当前对话','重置会话','reset','reset current session','clear the current context','clear this chat'],
  compact:['压缩上下文','压缩当前上下文','压缩当前会话上下文','压缩对话上下文','compact','compact current context','compress the context'],
  status:['状态','当前状态','查看会话状态','显示当前会话状态','status','show status','show the current session status'],
  help:['帮助','命令帮助','显示帮助','查看命令帮助','列出命令','帮助菜单','help','show help','command help','list commands'],
  skills:['技能列表','查看技能','显示当前技能','列出当前人格技能','查看技能列表','skills','list skills','show available skills'],
  sessions:['历史会话列表','查看历史会话','显示历史对话','列出会话','查看会话列表','sessions','list sessions','show previous conversations','list session history'],
};

for(const [name,phrases] of Object.entries(accepted))test(`natural ${name} requires a complete basic control`,()=>{
  for(const text of phrases)assert.deepEqual(parseNaturalControl(text),{name,args:''},text);
});

test('an explicit control permits a single salutation and polite prefix in either order',()=>{
  for(const text of ['请停止当前任务。','小樱，停止当前任务！','小樱请停止当前任务','小樱：请帮我停止当前任务。','请小樱，停止当前任务','麻烦你停止当前任务','帮我停止当前任务','Sakura, please STOP CURRENT TASK!','Please Sakura: stop current task.','  stop\tcurrent\ttask!  ']){
    assert.deepEqual(parseNaturalControl(text),{name:'stop',args:''},text);
  }
  assert.deepEqual(parseNaturalControl('小樱，清空当前会话。'),{name:'reset',args:''});
});

test('short conversational imperatives still require the complete unqualified request',()=>{
  for(const [text,name] of [['开个新会话','new'],['开一个新会话','new'],['重新开始一个会话','new'],['压缩一下上下文','compact'],['别继续了','stop']]){
    assert.deepEqual(parseNaturalControl(text),{name,args:''},text);
    for(const ordinary of [`不要${text}`,`怎么${text}`,`如果失败就${text}`,`解释${text}`,`“${text}”`,`${text}，然后回答问题`])assert.equal(parseNaturalControl(ordinary),undefined,ordinary);
  }
});

test('negation, conditions, questions and discussion never interrupt the active task',()=>{
  for(const text of [
    '不要停止','不要停止当前任务','请不要清空当前会话','先别分析','先别分析这个视频','先不要压缩上下文','别帮我重置会话','停止不是我的要求',
    '怎么开启新会话','如何停止当前任务','小樱，怎么开启新会话？','可以停止吗','停止？','清空上下文?','显示状态好吗','如果卡住就停止当前任务','如果失败，清空会话','等完成后开启新会话',
    '解释停止当前任务','翻译停止当前任务','翻译：stop','请解释“清空会话”是什么意思','帮我写一段关于新会话的说明','我刚才说了停止','我想知道新会话会发生什么',
    'do not stop','please do not stop','don\'t stop','how do I start a new chat','can you stop?','what is compact context','if stuck stop','explain stop','translate stop','say stop','stop is a command',
  ])assert.equal(parseNaturalControl(text),undefined,text);
});

test('quoted, compound and embedded commands remain ordinary chat',()=>{
  for(const text of [
    '"stop"','“停止”','「清空会话」','`stop`','```\nstop\n```','[停止]','我说：停止','停止，然后继续生成','停止当前任务并开启新会话','停止。新建会话。','stop and start a new chat',
    'stop\nnew chat','停止\n请','stop；new chat','截图中的按钮写着停止','<text>stop</text>','prefix stop suffix','\u200b停止','停止\u200b','小樱小樱停止','请请停止','Sakurastop',
  ])assert.equal(parseNaturalControl(text),undefined,text);
});

test('arguments, privileged operations and slash escaping are left to existing routes',()=>{
  for(const text of [
    '','   ','/stop','//stop','/new','//开启新会话','/model reset','切换人格 sakura','更换模型','启用技能 weather','重启','重载','查看统计','查看自进化记录','回退版本','删除所有历史记录',
    'persona sakura','model reset','restart','reload','stats','evolve add a skill','resume abc','sessions 2','show sessions 2','查看历史会话第二页','清空会话 abc','stop task 2','new chat please and use model x',
  ])assert.equal(parseNaturalControl(text),undefined,text);
});
