import {interpolate,type MessageDescriptor,type SystemLocale} from './common.js';

/** Storage failures retain their established Chinese Error.message for callers. */
export const storageMessages={
  personaRootDirectory:{zh:'人格根目录必须是普通目录',en:'The persona root must be a regular directory.'},
  personaIdReserved:{zh:'人格 ID 不能使用系统保留名称',en:'The persona ID cannot be a reserved system name.'},
  personaIdCaseConflict:{zh:'人格 ID 大小写与已有目录冲突',en:'The persona ID conflicts with the capitalization of an existing directory.'},
  personaDirectory:{zh:'人格目录必须是普通目录',en:'The persona directory must be a regular directory.'},
  personaFile:{zh:'人格文件必须是普通文件',en:'Persona files must be regular files.'},
  personaFileTooLarge:{zh:'人格文件超过 512 KiB',en:'The persona file exceeds 512 KiB.'},
  personaSavePending:{zh:'人格文件有未完成的保存，请重新打开实例后核对',en:'A persona file save is incomplete. Reopen the instance and check its state.'},
  personaFilesMissing:{zh:'人格目录必须同时包含 config.json 和 persona.md',en:'The persona directory must contain both config.json and persona.md.'},
  personaIdMismatch:{zh:'config.json 的 ID 必须与人格目录名一致',en:'The ID in config.json must match the persona directory name.'},
  personaFilesChanged:{zh:'人格文件在保存期间被修改，已保留现场，请核对 .pending.json',en:'Persona files changed during saving. The files were preserved; inspect .pending.json.'},
  personaSaveActive:{zh:'人格文件仍由活动进程保存，暂不恢复，请稍后重试',en:'An active process is still saving persona files. Retry recovery later.'},
  personaJournalInvalid:{zh:'人格保存日志无效，请核对 .pending.json',en:'The persona save journal is invalid. Inspect .pending.json.'},
  botMissing:{zh:'机器人不存在',en:'The bot does not exist.'},
  accountAlreadyBound:{zh:'该平台账号已经绑定其他机器人',en:'This platform account is already bound to another bot.'},
  botIdentityImmutable:{zh:'已有机器人的渠道身份不可修改；请创建新机器人',en:'An existing bot cannot change its channel identity. Create a new bot.'},
  botConfigMissing:{zh:'机器人 {id} 的配置不存在',en:'The configuration for bot {id} does not exist.'},
  personaMissing:{zh:'配置不存在或已归档',en:'The configuration does not exist or has been archived.'},
  personaStillBound:{zh:'请先解除机器人或活动会话配置绑定',en:'Remove bot and active-session bindings before archiving this configuration.'},
  personaValidationChanged:{zh:'人格文件在校验期间被修改，请重新应用',en:'Persona files changed during validation. Apply them again.'},
  memoryLength:{zh:'记忆长度无效',en:'The memory length is invalid.'},
  memorySourceRequired:{zh:'记忆必须来自用户本人表达的稳定偏好，并提供完整原文行',en:'Memory must come from the user’s own stated preference and include the complete original line.'},
  memorySourceForgotten:{zh:'该来源的记忆已被删除或更正',en:'Memory from this source has been deleted or corrected.'},
  sessionNotOwned:{zh:'会话不存在或不属于当前渠道身份',en:'The session does not exist or belongs to another channel identity.'},
  assetNotOwned:{zh:'附件不存在或不属于当前会话',en:'The attachment does not exist or belongs to another session.'},
} as const;

export type StorageMessageKey=keyof typeof storageMessages;
export function storageDescriptor(key:StorageMessageKey,params?:MessageDescriptor['params']):MessageDescriptor{return{key:`storage.${key}`,...params?{params}:{}};}
export function formatStorageMessage(message:MessageDescriptor|undefined,locale:SystemLocale):string|undefined{
  if(!message?.key.startsWith('storage.'))return;
  const key=message.key.slice('storage.'.length);
  if(!Object.hasOwn(storageMessages,key))return;
  return interpolate(storageMessages[key as StorageMessageKey][locale],message.params);
}
