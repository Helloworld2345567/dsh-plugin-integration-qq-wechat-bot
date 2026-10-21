import type {Context} from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-agent-preset-registry';
export const name='bot-unified-chat';
export const inject=['agentPresets'];
export async function registerMode(ctx:Context):Promise<()=>Promise<void>>{
  const shell=process.platform==='win32'?'pwsh':'bash';
  const dispose=await ctx.agentPresets.register({id:'bot-unified-chat',name:'机器人聊天模式',description:'自然聊天、动态人格；保留 Harness 上下文和工具',order:2,plugins:[
    {id:'time-context',name:'@deepseek-ai/dsh-time-context'},
    {id:'tool-fs',name:'@deepseek-ai/dsh-tool-fs'},
    {id:'tool-fs-search',name:'@deepseek-ai/dsh-tool-fs-search',config:{sampleOverCapGlobResults:false}},
    {id:'compaction',name:'cordis:group',group:true,isolate:{compaction:true,toolResultPruner:true},config:[
      {id:'compaction-basic',name:'@deepseek-ai/dsh-compaction-basic',config:{headroomTokens:2048,maxTokens:1024}},
      {id:'tool-result-pruner',name:'@deepseek-ai/dsh-compaction-tool-result-pruner',config:{thresholdChars:8192,headChars:4096,tailChars:1024}},
    ]},
    {id:'persistent-shell',name:'cordis:group',group:true,isolate:{terminals:true},config:[
      {id:'terminal',name:'@deepseek-ai/dsh-terminal'},
      {id:'terminal-shell',name:'@deepseek-ai/dsh-terminal-bash',config:{shellDialect:shell,timeoutMs:120000}},
      {id:'persistent-shell-tool',name:process.platform==='win32'?'@deepseek-ai/dsh-tool-pwsh-persistent':'@deepseek-ai/dsh-tool-bash-persistent',config:{timeoutMs:120000}},
    ]},
  ]});
  const mode=await ctx.agentPresets.resolve('bot-unified-chat');if(mode.broken)throw new Error(`BOT_MODE_ACTIVATION_FAILED: ${mode.broken}`);return dispose;
}
export async function apply(ctx:Context):Promise<void>{await registerMode(ctx);}
