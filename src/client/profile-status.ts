import type {AcceptanceView,HealthView,PublicServiceProfile} from '../core/service-management.js';
import type {BotConfig} from '../core/types.js';

type Persona=Pick<BotConfig,'id'|'revision'>;
type Profile=Pick<PublicServiceProfile,'serviceId'|'profileId'|'revision'|'contentHash'>;

function matchesProfile(value:any,profile:Profile|undefined):boolean {
  return !!value&&!!profile&&value.serviceId===profile.serviceId&&value.profileId===profile.profileId&&value.profileRevision===profile.revision&&value.profileContentHash===profile.contentHash;
}

export function currentProfileHealth(value:HealthView|undefined,profile:Profile|undefined,now=Date.now()):HealthView|undefined {
  if(!matchesProfile(value,profile))return;
  return value!.expiresAt<=now?{...value!,state:'unknown'}:value;
}

export function currentProfileAcceptance(value:AcceptanceView|undefined,persona:Persona,profile:Profile|undefined,operation:string,now=Date.now()):AcceptanceView|undefined {
  if(!matchesProfile(value,profile)||value!.personaId!==persona.id||value!.personaRevision!==persona.revision||value!.operation!==operation)return;
  return value!.state!=='NOT_RUN'&&value!.expiresAt!==undefined&&value!.expiresAt<=now?{...value!,state:'EXPIRED'}:value;
}

/** Status endpoints are keyed by persona ID and carry the exact persona/Profile revisions. */
export function currentProfileValidation(status:any,persona:Persona,profile:Profile|undefined,field:'synthesisValidation'|'conversionValidation'|'downloadValidation'):any {
  if(status?.revision!==persona.revision||!matchesProfile({...status,serviceId:status?.profileRef?.serviceId,profileId:status?.profileRef?.profileId},profile))return;
  return status[field];
}
