import {defineTool,type ToolRunContext} from '@deepseek-ai/dsh-tools';
import {botSessionArgumentsSchema,botPersonaArgumentsSchema,botSkillsArgumentsSchema,type BotSessionArguments,type BotPersonaArguments,type BotSkillsArguments} from '../core/management.js';
import {botVoiceArgumentsSchema,type BotVoiceArguments,type BotVoiceResult} from '../core/features.js';

export function defineBotSessionTool(execute:(args:BotSessionArguments,exec:ToolRunContext)=>Promise<unknown>){
  return defineTool({
    name:'bot_session',
    description:"Manage only the caller-owned channel session. help/status/list query help, current state and owned history. new/stop/compact/resume register actions to execute after the current turn; queued does not mean completed. resume requires a sessionId from the current user list result. Do not modify another user session or a parent task.",
    parameters:{action:{type:'string',required:true,enum:['help','status','list','new','stop','compact','resume']},page:{type:'number'},sessionId:{type:'string'}},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},
    isConcurrencySafe:args=>['help','status','list'].includes(args.action),
    execute:async(args,exec)=>JSON.stringify(await execute(botSessionArgumentsSchema.parse(args),exec)),
  });
}

export function defineBotPersonaTool(execute:(args:BotPersonaArguments,exec:ToolRunContext)=>Promise<unknown>){
  return defineTool({
    name:'bot_persona',
    description:"List or switch the current trusted private-chat persona without local-tool permissions. First list exact persona IDs, then set. The switch queues until the current turn ends, preserves history and clears temporary model overrides. queued does not mean switched. This turn and already-started subtasks keep their frozen configuration. Do not modify shared persona content.",
    parameters:{action:{type:'string',required:true,enum:['list','set']},personaId:{type:'string'}},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},
    isConcurrencySafe:args=>args.action==='list',
    execute:async(args,exec)=>JSON.stringify(await execute(botPersonaArgumentsSchema.parse(args),exec)),
  });
}

export function defineBotSkillsTool(execute:(args:BotSkillsArguments,exec:ToolRunContext)=>Promise<unknown>){
  return defineTool({
    name:'bot_skills',
    description:"Inspect skills for the current persona. Ordinary users may only list enabled skills. Trusted private-chat users may also see published disabled skills and enable/disable them. Changes queue until the current turn ends and affect sessions sharing the persona; queued does not mean completed. Use bot_evolve to add or edit a skill.",
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
    description:"Manage TTS/STS voices for the current trusted private-chat session. First list exact voice IDs, then set. TTS uses edge/<voice> or service/profile; STS uses rvc/<profile>. reset restores the persona default. Changes affect only this session from the next turn; this turn and already-started subtasks keep their frozen voices. Do not modify the shared persona.",
    parameters:{role:{type:'string',required:true,enum:['tts','sts']},action:{type:'string',required:true,enum:['list','set','reset']},id:{type:'string'}},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},
    isConcurrencySafe:args=>args.action==='list',
    execute:async(args,exec)=>{const {sessionId,...result}=await execute(botVoiceArgumentsSchema.parse(args),exec) as BotVoiceResult;return JSON.stringify(result);},
  });
}
