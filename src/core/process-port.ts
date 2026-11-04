export interface ControlledProcessRequest {
  jobId?:string;
  command:string;
  args:readonly string[];
  cwd:string;
  env?:NodeJS.ProcessEnv;
  signal:AbortSignal;
  deadline:number;
  maxOutputBytes?:number;
  stdin?:Buffer;
}
export interface ControlledProcessResult {code:number|null;stdout:Buffer}
/** Host-owned process execution port. Core adapters only describe bounded work. */
export interface ControlledProcessPort {
  run(request:ControlledProcessRequest):Promise<ControlledProcessResult>;
  cancel(jobId:string):Promise<'cancelled'|'unknown'>;
}
