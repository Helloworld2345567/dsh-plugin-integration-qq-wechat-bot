export interface ModuleFixture {path:string;source:string}
export interface ArchitectureViolation {rule:string;file:string;target?:string;detail:string}
export interface ModuleAnalysis {
  files:string[];
  edges:Array<{from:string;to?:string;specifier:string;runtime:boolean;dynamic:boolean}>;
  cycles:string[][];
  violations:ArchitectureViolation[];
  skippedDynamicImports:Array<{file:string;line:number}>;
}
export interface ArchitectureResult {
  status:'PASS'|'FAIL';
  modules:number;
  typescriptModules:number;
  runtimeEdges:number;
  pythonModules:number;
  pythonImports:number;
  pythonImportSideEffects:Array<{file:string;line:number}>;
  cycles:string[][];
  skippedDynamicImports:Array<{file:string;line:number}>;
  violations:ArchitectureViolation[];
}
export function normalizeRepoPath(value:string):string;
export function parseModuleImports(file:string,source:string):{imports:Array<{specifier:string;runtime:boolean;dynamic:boolean}>;skippedDynamicImports:Array<{file:string;line:number}>};
export function analyzeModules(entries:ModuleFixture[]):ModuleAnalysis;
export function analyzePythonModules(entries:ModuleFixture[]):{imports:Array<{file:string;module:string;line:number}>;importSideEffects:Array<{file:string;line:number}>};
export function checkRepository(root?:string,options?:{inventory?:boolean}):Promise<ArchitectureResult&{dependencyInventory?:{modules:string[];imports:ModuleAnalysis['edges'];pythonImports:Array<{file:string;module:string;line:number}>}}>;
export function formatArchitectureResult(result:ArchitectureResult|ModuleAnalysis|unknown):string;
