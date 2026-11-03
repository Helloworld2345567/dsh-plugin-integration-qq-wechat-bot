import {ProfileStore} from '../src/core/profile-store.js';
export function testServiceProfiles(){
  const profiles=new ProfileStore();
  for(const [serviceId,capabilities] of [['rvc',['rvc.convert']],['music',['music.search','music.acquire']],['gpt-sovits',['gpt-sovits.speak']]] as const)profiles.create({serviceId,profileId:'default',state:'ready',capabilities,displayName:serviceId,managedConfig:{}});
  return profiles;
}
