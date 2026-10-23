export type JsonValue=null|boolean|number|string|JsonValue[]|{[key:string]:JsonValue};
export interface CursorStore {
  read(channelId:string,botId:string):JsonValue|undefined;
  write(channelId:string,botId:string,value:JsonValue):void;
}
export type ChannelEvent={type:'group.observed'|'group.joined'|'group.left';channelId:string;botId:string;groupId:string;name?:string;at:number;eventId?:string};
export interface ChannelEventSink {emit(event:ChannelEvent):void}
