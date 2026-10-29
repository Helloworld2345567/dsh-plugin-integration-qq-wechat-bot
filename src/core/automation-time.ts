const formatters=new Map<string,Intl.DateTimeFormat>();
export const validClock=(value:string)=>/^([01]\d|2[0-3]):[0-5]\d$/.test(value);
export const validTimezone=(value:string)=>{try{new Intl.DateTimeFormat('en',{timeZone:value});return true;}catch{return false;}};
export function localTime(at:number,timezone:string):{date:string;minutes:number}{
  let formatter=formatters.get(timezone);
  if(!formatter){formatter=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});formatters.set(timezone,formatter);}
  const p=Object.fromEntries(formatter.formatToParts(at).map(part=>[part.type,part.value]));
  return{date:`${p.year}-${p.month}-${p.day}`,minutes:Number(p.hour)*60+Number(p.minute)};
}
const clockMinutes=(value:string)=>Number(value.slice(0,2))*60+Number(value.slice(3));
export function isQuiet(at:number,config:{timezone:string;quietFrom:string;quietTo:string}):boolean{
  const from=clockMinutes(config.quietFrom),to=clockMinutes(config.quietTo),now=localTime(at,config.timezone).minutes;
  return from<to?now>=from&&now<to:from>to&&(now>=from||now<to);
}
/** Scan actual instants so DST gaps/overlaps and non-hour offsets stay in the selected zone. */
export function nextDailyTime(clock:string,timezone:string,after=Date.now()):number{
  const target=clockMinutes(clock),today=localTime(after,timezone);
  for(let at=Math.floor(after/60000)*60000+60000;at<=after+3*86400000;at+=60000){
    const local=localTime(at,timezone);
    if(local.minutes===target&&(local.date!==today.date||today.minutes<target))return at;
  }
  throw Error('SCHEDULE_TIME_UNAVAILABLE');
}
