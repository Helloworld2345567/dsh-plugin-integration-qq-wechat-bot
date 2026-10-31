import type {Context} from '@deepseek-ai/cordis';
import {credentialKey,isCredentialKeySegment} from '@deepseek-ai/dsh-credentials';
import type {Credentials} from '../core/runtime-ports.js';
import type {Credential} from '../core/types.js';

/** Keep existing valid keys; encode other bot IDs in a separate scope to avoid collisions. */
function botCredentialKey(id:string){
  return isCredentialKeySegment(id)?credentialKey('bot-integration',id):credentialKey('bot-integration-encoded',`id-${Buffer.from(id,'utf8').toString('hex')}`);
}

/** Adapt Harness grant records to the bot credential port for all schema-valid bot IDs. */
export function createBotCredentials(provider:Pick<Context['credentials'],'readRecord'|'modifyRecord'|'deleteRecord'>):Credentials {
  return {
    read:async id=>{const value=await provider.readRecord(botCredentialKey(id));return value?.kind==='grant'?value.payload as unknown as Credential:undefined;},
    write:async(id,value)=>{await provider.modifyRecord(botCredentialKey(id),async()=>({kind:'grant',payload:value as unknown as Record<string,unknown>}));},
    remove:async id=>{await provider.deleteRecord(botCredentialKey(id));},
  };
}
