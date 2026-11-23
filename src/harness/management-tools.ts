import {defineTool,type ToolRunContext} from '@deepseek-ai/dsh-tools';
import {botSessionArgumentsSchema,botPersonaArgumentsSchema,botSkillsArgumentsSchema,type BotSessionArguments,type BotPersonaArguments,type BotSkillsArguments} from '../core/management.js';
import {botVoiceArgumentsSchema,botImageArgumentsSchema,type BotVoiceArguments,type BotVoiceResult,type BotImageArguments,type BotImageResult} from '../core/features.js';
import {imageProtocolSchema} from '../core/image-service-config.js';

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
    description:"List personas for this trusted private chat. set a listed personaId to use it for the next model request and save it for this session.",
    parameters:{action:{type:'string',required:true,enum:['list','set']},personaId:{type:'string'}},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},
    isConcurrencySafe:args=>args.action==='list',
    execute:async(args,exec)=>JSON.stringify(await execute(botPersonaArgumentsSchema.parse(args),exec)),
  });
}

export function defineBotSkillsTool(execute:(args:BotSkillsArguments,exec:ToolRunContext)=>Promise<unknown>){
  return defineTool({
    name:'bot_skills',
    description:"List or enable/disable published skills in trusted private chat. enable/disable requires a skill name and changes this bot’s enabled skills.",
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
    description:"List TTS/STS voices for this trusted private chat. set a listed voice id or reset to the bot default. The selection applies to the next matching voice operation and persists for this session.",
    parameters:{role:{type:'string',required:true,enum:['tts','sts']},action:{type:'string',required:true,enum:['list','set','reset']},id:{type:'string'}},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},
    isConcurrencySafe:args=>args.action==='list',
    execute:async(args,exec)=>{const {sessionId,...result}=await execute(botVoiceArgumentsSchema.parse(args),exec) as BotVoiceResult;return JSON.stringify(result);},
  });
}

/** The host supplies the session and connection settings; the caller selects only a protocol. */
export function defineBotImageControlTool(execute:(args:BotImageArguments,exec:ToolRunContext)=>Promise<unknown>){
  return defineTool({
    name:'bot_image_control',
    description:'List image services for this trusted private chat. set a listed protocol or reset to the bot/global default. The selection applies to the next image operation and persists for this session.',
    parameters:{action:{type:'string',required:true,enum:['list','set','reset']},protocol:{type:'string',description:`Image protocol (case-insensitive): ${imageProtocolSchema.options.join(', ')}`}},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},
    isConcurrencySafe:args=>args.action==='list',
    execute:async(args,exec)=>{const {sessionId,...result}=await execute(botImageArgumentsSchema.parse(args),exec) as BotImageResult;return JSON.stringify(result);},
  });
}
