import type {ParsedCommand} from './commands.js';

type BasicControl='stop'|'new'|'reset'|'compact'|'status'|'help'|'skills'|'sessions';

// These are whole-message imperatives, not intent/keyword extraction. Keep actions
// with arguments, configuration changes and maintenance in their existing tools.
const controls:ReadonlyArray<readonly [BasicControl,RegExp]>=[
  ['stop',/^(?:停止|停止一下|停下|停下来|停一下|别继续了|(?:停止|取消|中止|终止|中断|结束)(?:当前)?(?:任务|操作)|停止(?:执行|生成|回复|思考)|stop(?: now| (?:the (?:current )?|this |current )?task| (?:generating|responding|thinking))?|cancel(?: (?:the (?:current )?|this |current )?task)?|abort (?:the (?:current )?|this |current )?task)$/u],
  ['new',/^(?:新会话|新对话|新建(?:会话|对话)|(?:开启|开始|创建)(?:一个)?全?新(?:的)?(?:会话|对话)|开(?:一)?个新(?:会话|对话)|重新开始一个(?:会话|对话)|new (?:chat|session|conversation)|(?:start|open|create) (?:a )?new (?:chat|session|conversation))$/u],
  ['reset',/^(?:(?:清空|重置)(?:当前)?(?:会话|对话|(?:(?:会话|对话))?上下文)|reset(?: (?:the (?:current )?|this |current )?(?:chat|session|conversation|context))?|clear (?:the (?:current )?|this |current )?(?:chat|session|conversation|context))$/u],
  ['compact',/^(?:压缩(?:一下)?(?:当前)?(?:会话|对话)?上下文|compact(?: (?:the (?:current )?|this |current )?context)?|compress (?:the (?:current )?|this |current )?context)$/u],
  ['status',/^(?:(?:查看|显示)?(?:当前)?(?:会话)?状态|status|show (?:the (?:current )?|current )?(?:session )?status)$/u],
  ['help',/^(?:(?:查看|显示)?(?:命令)?帮助|(?:查看|显示|列出)命令|(?:显示)?帮助菜单|help|(?:show |command |show command )help|(?:show|list) commands)$/u],
  ['skills',/^(?:技能列表|(?:查看|显示|列出)(?:当前(?:人格)?)?技能(?:列表)?|skills|(?:show|list) (?:(?:available|current) )?skills)$/u],
  ['sessions',/^(?:历史(?:会话|对话)列表|(?:查看|显示|列出)(?:历史(?:会话|对话)|会话列表)|列出会话|sessions|(?:show|list) (?:(?:past|previous|historical) )?(?:sessions|conversations)|(?:show|list) session history)$/u],
];

/** Only explicit, single-message controls may interrupt work before model dispatch. */
export function parseNaturalControl(text:string):ParsedCommand|undefined {
  let value=text.trim();
  if(!value||/[\r\n]/u.test(value))return undefined;
  // Questions, quotes, conditional/negative language and extra clauses remain
  // ordinary chat because they cannot match one of the full expressions above.
  value=value.replace(/[。.!！]+$/u,'').trimEnd();
  let addressed=false,polite=false;
  for(let i=0;i<2;i++){
    const address=/^(?:小樱[，,：:]?[ \t]*|sakura(?:[,:][ \t]*|[ \t]+))/iu.exec(value);
    if(!addressed&&address){value=value.slice(address[0].length);addressed=true;continue;}
    const courtesy=/^(?:(?:请(?:你|帮我)?|麻烦(?:你)?|帮我)[ \t]*|please[ \t]+)/iu.exec(value);
    if(!polite&&courtesy){value=value.slice(courtesy[0].length);polite=true;continue;}
    break;
  }
  value=value.toLowerCase().replace(/[ \t]+/gu,' ');
  const match=controls.find(([,pattern])=>pattern.test(value));
  return match?{name:match[0],args:''}:undefined;
}
