import {createChannelRegistry,type ChannelRegistry} from '../src/core/channel-registry.js';
import type {ChannelAdapter} from '../src/core/types.js';

export function fixtureChannels(adapter:ChannelAdapter):ChannelRegistry {
  return createChannelRegistry([
    {id:'qq',displayName:'QQ',adapter,capabilities:{conversations:['private','group'],login:[],groupSupport:'observed_only'}},
    {id:'weixin',displayName:'Weixin',adapter,capabilities:{conversations:['private','group'],login:[],groupSupport:'observed_only'}},
  ]);
}
