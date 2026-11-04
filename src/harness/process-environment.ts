/** Minimal environment for one host-assigned worker or subprocess directory. */
export function jobEnvironment(output:string):NodeJS.ProcessEnv{return{
  PATH:process.env.PATH,
  SystemRoot:process.env.SystemRoot,
  SYSTEMROOT:process.env.SYSTEMROOT,
  HOME:output,
  USERPROFILE:output,
  APPDATA:output,
  LOCALAPPDATA:output,
  TEMP:output,
  TMP:output,
  PYTHONDONTWRITEBYTECODE:'1',
  PYTHONIOENCODING:'utf-8',
  PYTHONUTF8:'1',
};}
