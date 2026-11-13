import {defineTool,type ToolRunContext} from '@deepseek-ai/dsh-tools';
import {botSessionArgumentsSchema,botPersonaArgumentsSchema,botSkillsArgumentsSchema,type BotSessionArguments,type BotPersonaArguments,type BotSkillsArguments} from '../core/management.js';
import {botVoiceArgumentsSchema,type BotVoiceArguments,type BotVoiceResult} from '../core/features.js';

export function defineBotSessionTool(execute:(args:BotSessionArguments,exec:ToolRunContext)=>Promise<unknown>){
  return defineTool({
    name:'bot_session',
    description:"Query or change the caller-owned session. action is help, status, list, new, compact or resume; resume requires a sessionId.",
    parameters:{action:{type:'string',required:true,enum:['help','status','list','new','compact','resume']},page:{type:'number'},sessionId:{type:'string'}},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},
    isConcurrencySafe:args=>['help','status','list'].includes(args.action),
    execute:async(args,exec)=>JSON.stringify(await execute(botSessionArgumentsSchema.parse(args),exec)),
  });
}

export function defineBotPersonaTool(execute:(args:BotPersonaArguments,exec:ToolRunContext)=>Promise<unknown>){
  return defineTool({
    name:'bot_persona',
    description:"List or switch the current trusted private-chat persona. set requires a personaId.",
    parameters:{action:{type:'string',required:true,enum:['list','set']},personaId:{type:'string'}},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},
    isConcurrencySafe:args=>args.action==='list',
    execute:async(args,exec)=>JSON.stringify(await execute(botPersonaArgumentsSchema.parse(args),exec)),
  });
}

export function defineBotSkillsTool(execute:(args:BotSkillsArguments,exec:ToolRunContext)=>Promise<unknown>){
  return defineTool({
    name:'bot_skills',
    description:"List or enable/disable published skills in trusted private chat. enable/disable requires a skill name and changes the shared persona.",
    parameters:{action:{type:'string',required:true,enum:['list','enable','disable']},name:{type:'string'}},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},
    isConcurrencySafe:args=>args.action==='list',
    execute:async(args,exec)=>JSON.stringify(await execute(botSkillsArgumentsSchema.parse(args),exec)),
  });
}

/** The closure supplies the current session; IDs are resolved by the host. */
export function defineBotVoiceControlTool(execute:(args:BotVoiceArguments,exec:ToolRunContext)=>Promise<unknown>){
  return defineTool({
    name:'bot_voice_control',
    description:"List or change TTS/STS voices for the current trusted private session. set requires a voice id; reset restores the persona default.",
    parameters:{role:{type:'string',required:true,enum:['tts','sts']},action:{type:'string',required:true,enum:['list','set','reset']},id:{type:'string'}},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},
    isConcurrencySafe:args=>args.action==='list',
    execute:async(args,exec)=>{const {sessionId,...result}=await execute(botVoiceArgumentsSchema.parse(args),exec) as BotVoiceResult;return JSON.stringify(result);},
  });
}
