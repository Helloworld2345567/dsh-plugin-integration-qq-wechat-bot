import {idSchema,type ChannelAdapter,type ChannelReplyEnvelope} from './types.js';

export type ChannelLoginMethod='qr'|'credentials';
export interface ChannelCapabilities {
  conversations:readonly ('private'|'group')[];
  login:readonly ChannelLoginMethod[];
  groupSupport:'unsupported'|'observed_only';
}
export interface ChannelDefinition {
  id:string;
  displayName:string;
  capabilities:ChannelCapabilities;
  adapter:ChannelAdapter;
  normalizeCredential?(value:unknown):{accountId:string;credential:unknown};
  normalizeReply?(value:unknown):ChannelReplyEnvelope;
}
export interface ChannelRegistry {
  require(id:string):ChannelDefinition;
  list():readonly ChannelDefinition[];
}

function freezeDefinition(input:ChannelDefinition):ChannelDefinition {
  const id=idSchema.parse(input.id);const displayName=input.displayName.trim();if(!displayName||displayName.length>100)throw Error('CHANNEL_DISPLAY_NAME_INVALID');
  const conversations=Object.freeze([...input.capabilities.conversations]);const login=Object.freeze([...input.capabilities.login]);
  if(!conversations.length||new Set(conversations).size!==conversations.length||new Set(login).size!==login.length)throw Error('CHANNEL_CAPABILITIES_INVALID');
  return Object.freeze({id,displayName,adapter:input.adapter,normalizeCredential:input.normalizeCredential,normalizeReply:input.normalizeReply,capabilities:Object.freeze({conversations,login,groupSupport:input.capabilities.groupSupport})});
}
export function createChannelRegistry(inputs:readonly ChannelDefinition[]):ChannelRegistry {
  const definitions=Object.freeze(inputs.map(freezeDefinition));const map=new Map<string,ChannelDefinition>();
  for(const definition of definitions){if(map.has(definition.id))throw Error(`CHANNEL_ALREADY_REGISTERED: ${definition.id}`);map.set(definition.id,definition);}
  return Object.freeze({require(id:string){const result=map.get(id);if(!result)throw Error(`CHANNEL_NOT_REGISTERED: ${id}`);return result;},list(){return definitions;}});
}
