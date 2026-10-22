import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {mkdir,writeFile,unlink,readFile,rename} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {productHome,launcher,runtimeEnv,run} from './runtime.mjs';
import {recoverFailedUpgrade} from './installation.mjs';
import {Supervisor} from './supervisor.mjs';

await mkdir(productHome,{recursive:true});const stateFile=path.join(productHome,'launcher.json');const token=randomBytes(32).toString('base64url');
try{
  const previous=JSON.parse(await readFile(stateFile,'utf8'));let alive=false;
  if(Number.isSafeInteger(previous.pid)&&previous.pid>0)try{process.kill(previous.pid,0);alive=true;}catch(error){if(error.code!=='ESRCH')alive=true;}
  if(Number.isInteger(previous.port)&&previous.port>0&&previous.port<=65535)try{await fetch(`http://127.0.0.1:${previous.port}/`,{signal:AbortSignal.timeout(1000)});alive=true;}catch{}
  if(alive)throw Error('The saved launcher is still active. Stop that instance before starting another.');
  await rename(stateFile,path.join(productHome,`launcher.stale-${Date.now()}.json`));
}catch(error){if(error.code!=='ENOENT')throw error;}
const server=createServer((req,res)=>{if(req.method==='POST'&&req.url==='/stop'&&req.headers.authorization===`Bearer ${token}`){res.end('stopping');supervisor.stop();}else{res.writeHead(403);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
try{await writeFile(stateFile,JSON.stringify({port,token,pid:process.pid}),{flag:'wx',mode:0o600,flush:true});}catch{server.close();throw Error('A launcher state already exists. Stop the existing instance; if it has exited, archive launcher.json before starting again.');}
const supervisor=new Supervisor({
  token,
  spawn:()=>launcher(['--profile','bots','--no-open',...process.argv.slice(2)],{stdio:['inherit','inherit','inherit','ipc'],env:{...runtimeEnv,BOT_HOME:productHome,BOT_LAUNCH_TOKEN:token}}),
  readTask:async id=>{if(typeof id!=='string'||!/^[a-z0-9-]{1,80}$/i.test(id))throw Error('Invalid restart task ID');return JSON.parse(await readFile(path.join(productHome,'evolution',`${id}.json`),'utf8'));},
  recover:id=>recoverFailedUpgrade(productHome,id,archive=>run(['plugin','--profile','bots','add',archive])),
  forceKill:child=>{if(process.platform==='win32')spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else child.kill('SIGKILL');},
  onError:error=>console.error(error.message),
  onExit:code=>{server.close();void unlink(stateFile).catch(()=>{}).then(()=>process.exit(code));},
});
process.on('SIGINT',()=>supervisor.stop());process.on('SIGTERM',()=>supervisor.stop());supervisor.start();
