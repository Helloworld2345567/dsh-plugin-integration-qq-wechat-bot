import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { productHome,launcher,runtimeEnv } from './runtime.mjs';
await mkdir(productHome,{recursive:true});
const stateFile=path.join(productHome,'launcher.json');
const token=randomBytes(32).toString('base64url');let child;let stopping=false;
const stop=()=>{if(stopping)return;stopping=true;if(child?.pid){if(child.connected)child.send({type:'bot-stop',nonce:token});else child.kill('SIGTERM');setTimeout(()=>{if(child.exitCode!==null||child.signalCode!==null)return;if(process.platform==='win32')spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else child.kill('SIGKILL');},15000).unref();}else process.exit(0);};
const server=createServer((req,res)=>{if(req.method==='POST'&&req.url==='/stop'&&req.headers.authorization===`Bearer ${token}`){res.end('stopping');stop();}else{res.writeHead(403);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port;
try{await writeFile(stateFile,JSON.stringify({port,token}),{flag:'wx',mode:0o600});}catch{server.close();throw new Error('A launcher state already exists. Stop the existing instance; if it has exited, archive launcher.json before starting again.');}
child=launcher(['--profile','bots','--no-open',...process.argv.slice(2)],{stdio:['inherit','inherit','inherit','ipc'],env:{...runtimeEnv,BOT_LAUNCH_TOKEN:token}});
process.on('SIGINT',stop);process.on('SIGTERM',stop);
child.on('error',error=>{console.error(error.message);stop();});
child.on('exit',async code=>{server.close();await unlink(stateFile).catch(()=>{});process.exit(code??0);});
