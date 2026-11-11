import type {ToolSchema} from '@deepseek-ai/dsh-llm';
import type {AssembledSection,PromptAssembly} from '@deepseek-ai/dsh-system-prompt';

export const TOOL_LOADER='bot_tools';
const alwaysVisible=new Set([TOOL_LOADER,'structured_output']);
const summaries:Readonly<Record<string,string>>={
  read:'Read local files',write:'Write local files',edit:'Edit local files',read_image:'View a local image',
  glob:'Find files by path',grep:'Search file contents',pwsh:'Run PowerShell commands',bash:'Run shell commands',
  web_search:'Search the web',web_fetch:'Read a web page',skill:'Read skill instructions',
  bot_session:'Manage this chat and its history',bot_persona:'List or switch personas',bot_skills:'List or change enabled skills',
  bot_model:'List or switch chat models',bot_voice_control:'List or switch TTS/STS voices',bot_stats:'Query bot usage statistics',
  bot_evolve:'Update persona, skills or plugin code',bot_schedule:'Manage scheduled tasks',bot_proactive:'Manage proactive messages',
  bot_media:'Read attachments or process media',bot_send_file:'Register a file for delivery',
  bot_remember:'Save a stated user preference',bot_forget_memory:'Forget a saved preference',bot_read_social:'Read a public social post',
  image_generation:'Generate or edit an image',image_download:'Download an original image',
  media_analysis:'Transcribe audio or understand video',media_transform:'Convert or edit media',
  bot_voice:'Generate requested speech',bot_sing:'Convert singing or speech voices',bot_music:'Search or download music',
};
const sectionTools:Readonly<Record<string,readonly string[]>>={
  'tool:read':['read'],'tool:write':['write'],'tool:edit':['edit'],'tool:glob':['glob'],'tool:grep':['grep'],
  'tool:pwsh':['pwsh'],'tool:bash':['bash'],'tool:web_search':['web_search'],'tool:web_fetch':['web_fetch'],
  'tool:session-query':['session_search','session_event_search','session_event_read'],'tool:subagent':['subagent'],
};

export function toolCatalogDescription(available:readonly ToolSchema[]):string {
  const entries=available.filter(tool=>!alwaysVisible.has(tool.name)).map(tool=>{
    const summary=summaries[tool.name]??tool.description.replace(/\s+/g,' ').trim().split(/(?<=[.!?。！？])\s|(?<=[。！？])/u)[0]!.slice(0,100);
    return `${tool.name}: ${summary}`;
  });
  return `Load tools needed for the current task by exact name, then call them. Loaded tools remain available for this turn.\n${entries.join('\n')||'No additional tools are available.'}`;
}

export function loadTools(names:string[],available:readonly ToolSchema[],loaded:Set<string>):string[] {
  const selected=[...new Set(names)],known=new Set(available.map(tool=>tool.name));
  for(const name of selected)if(!known.has(name)||alwaysVisible.has(name))throw new Error(`TOOL_NOT_AVAILABLE: ${name}`);
  for(const name of selected)loaded.add(name);
  return selected;
}

function sectionNames(name:string):readonly string[] {return sectionTools[name]??(name.startsWith('tool:')?[name.slice(5)]:[]);}

export function toolInstructions(sections:readonly AssembledSection[],names:ReadonlySet<string>):string[] {
  return sections.filter(section=>sectionNames(section.name).some(name=>names.has(name))&&section.text.trim()).map(section=>section.text);
}

/** Disclosure changes model input only; the registry continues to own execution and permissions. */
export function projectTools(assembly:PromptAssembly,loaded:ReadonlySet<string>):PromptAssembly {
  const tools=assembly.tools.filter(tool=>alwaysVisible.has(tool.name)||loaded.has(tool.name)).map(tool=>tool.name===TOOL_LOADER?{...tool,description:toolCatalogDescription(assembly.tools)}:tool);
  const deferred=new Set(assembly.tools.filter(tool=>!alwaysVisible.has(tool.name)).map(tool=>tool.name));
  return {...assembly,tools,sections:assembly.sections.filter(section=>!sectionTools[section.name]&&!sectionNames(section.name).some(name=>deferred.has(name)))};
}
