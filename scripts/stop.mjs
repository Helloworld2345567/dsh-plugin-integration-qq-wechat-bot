import { readFile,access } from 'node:fs/promises';
import path from 'node:path';
import { productHome } from './runtime.mjs';
const stateFile=path.join(productHome,'launcher.json');let state;try{state=JSON.parse(await readFile(stateFile,'utf8'));}catch(error){if(error.code==='ENOENT'){console.log('No owned launcher is running.');process.exit(0);}throw error;}const {port,token}=state;
if(!Number.isInteger(port)||port<1||port>65535||typeof token!=='string')throw new Error('Invalid launcher state');
const response=await fetch(`http://127.0.0.1:${port}/stop`,{method:'POST',headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(3000)});
if(!response.ok)throw new Error('Stop rejected');const deadline=Date.now()+20000;while(Date.now()<deadline){try{await access(stateFile);}catch{console.log('Owned Harness process stopped.');process.exit(0);}await new Promise(r=>setTimeout(r,250));}throw new Error('Shutdown still pending; launcher state retained');
