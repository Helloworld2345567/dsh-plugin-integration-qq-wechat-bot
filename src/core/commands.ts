/** Channel command parsing never normalizes arguments or dispatches arbitrary tool names. */
export interface ParsedCommand {name:string;args:string}
export function parseCommand(text:string):ParsedCommand|undefined {
  const value=text.trim().replace(/^\[(.*)\]$/s,'$1');
  if(value.startsWith('//'))return undefined;
  const match=/^\/([^\s/]+)(?:\s+([\s\S]*))?$/.exec(value);
  return match?{name:match[1].toLowerCase(),args:match[2]?.trim()??''}:undefined;
}
export function unescapeChat(text:string):string {return text.trimStart().startsWith('//')?text.replace(/^(\s*)\//,'$1'):text;}
export function commandHelp(privileged:boolean,hostTools=privileged):string {
  const basic='/help 帮助\n/new（/reset）开启新会话\n/stop 停止任务\n/compact 压缩上下文\n/status 当前状态\n/sessions [页码] 历史会话\n/resume <会话ID> 恢复会话\n/skills 当前技能';
  return basic+(privileged?'\n/persona [ID] 查看或切换人格\n/model [提供商 模型|reset] 查看或切换模型\n/skill enable|disable <名称> 启停技能\n/stats [时间范围、bot、模型或群筛选] 统计':'')+(privileged&&hostTools?'\n/reload 应用人格与技能文件\n/restart 排空任务并重启\n/evolve <要求> 自修改；status [ID]、history、rollback <ID>':'')+'\n以上操作也可用自然语言表达，例如“开个新会话”“停止当前任务”“查看当前技能”；权限相同。\n以 // 开头可发送普通斜杠文本。';
}
