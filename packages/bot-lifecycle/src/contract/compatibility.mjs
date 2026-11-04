export const LIFECYCLE_CONTRACT_SCHEMA=1;
export const LIFECYCLE_PROTOCOL='dsh.lifecycle';
export const COMPATIBILITY_CODES=Object.freeze({
  METADATA_MISSING:'LIFECYCLE_METADATA_MISSING',
  METADATA_INVALID:'LIFECYCLE_METADATA_INVALID',
  PROTOCOL_INCOMPATIBLE:'LIFECYCLE_PROTOCOL_INCOMPATIBLE',
  COORDINATOR_TOO_OLD:'LIFECYCLE_COORDINATOR_TOO_OLD',
  COORDINATOR_API_INCOMPATIBLE:'LIFECYCLE_COORDINATOR_API_INCOMPATIBLE',
  MAIN_TOO_OLD:'LIFECYCLE_MAIN_TOO_OLD',
  MAIN_VERSION_INCOMPATIBLE:'LIFECYCLE_MAIN_VERSION_INCOMPATIBLE',
  CAPABILITY_MISSING:'LIFECYCLE_CAPABILITY_MISSING',
  IDENTITY_MISMATCH:'LIFECYCLE_IDENTITY_MISMATCH',
  ARTIFACT_MISMATCH:'LIFECYCLE_ARTIFACT_MISMATCH',
  OFFLINE_PAIR_REQUIRED:'LIFECYCLE_OFFLINE_PAIR_REQUIRED',
});

const VERSION=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
function fail(code,diagnostic){const error=new Error(`${code}: ${diagnostic}`);error.code=code;error.safeDiagnostic=diagnostic;throw error;}
export function parseLifecycleVersion(value,label='version'){
  const match=typeof value==='string'&&VERSION.exec(value);
  if(!match)fail(COMPATIBILITY_CODES.METADATA_INVALID,`${label} must be a numeric major.minor.patch version`);
  return Object.freeze({major:Number(match[1]),minor:Number(match[2]),patch:Number(match[3]),text:value});
}
export function compareLifecycleVersions(left,right){
  const a=typeof left==='string'?parseLifecycleVersion(left):left,b=typeof right==='string'?parseLifecycleVersion(right):right;
  return a.major-b.major||a.minor-b.minor||a.patch-b.patch;
}
function rangeTerms(range,label){
  if(typeof range!=='string'||!range.trim())fail(COMPATIBILITY_CODES.METADATA_INVALID,`${label} is missing`);
  return range.trim().split(/\s+/).map(term=>{const match=/^(>=|<=|>|<|=)?(\d+\.\d+\.\d+)$/.exec(term);if(!match)fail(COMPATIBILITY_CODES.METADATA_INVALID,`${label} contains an unsupported range term`);return{operator:match[1]??'=',version:parseLifecycleVersion(match[2],label)};});
}
export function lifecycleVersionSatisfies(version,range){
  const actual=parseLifecycleVersion(version);
  return rangeTerms(range,'compatibility range').every(({operator,version:expected})=>{const compared=compareLifecycleVersions(actual,expected);return operator==='>='?compared>=0:operator==='<='?compared<=0:operator==='>'?compared>0:operator==='<'?compared<0:compared===0;});
}
function strings(value,label){
  if(!Array.isArray(value)||value.some(item=>typeof item!=='string'||!item||item.length>120)||new Set(value).size!==value.length)fail(COMPATIBILITY_CODES.METADATA_INVALID,`${label} must be a unique string array`);
  return Object.freeze([...value].sort());
}
function packageFields(manifest){
  if(!manifest||typeof manifest!=='object'||typeof manifest.name!=='string'||typeof manifest.version!=='string')fail(COMPATIBILITY_CODES.METADATA_INVALID,'package name or version is invalid');
  parseLifecycleVersion(manifest.version,'package version');return{name:manifest.name,version:manifest.version};
}
export function lifecycleDeclaration(manifest,expectedRole){
  const pkg=packageFields(manifest),value=manifest.dshLifecycle;
  if(!value||typeof value!=='object')fail(COMPATIBILITY_CODES.METADATA_MISSING,`${pkg.name} has no dshLifecycle declaration`);
  if(value.schemaVersion!==LIFECYCLE_CONTRACT_SCHEMA||!['main','coordinator'].includes(value.role)||expectedRole&&value.role!==expectedRole)fail(COMPATIBILITY_CODES.METADATA_INVALID,`${pkg.name} lifecycle role or schema is invalid`);
  if(value.role==='main'&&pkg.name!=='dsh-plugin-integration-qq-wechat-bot'||value.role==='coordinator'&&pkg.name!=='dsh-bot-lifecycle')fail(COMPATIBILITY_CODES.METADATA_INVALID,'Lifecycle package name does not match its role');
  if(value.role==='main'){
    parseLifecycleVersion(value.runtimeProtocol,'runtime protocol');rangeTerms(value.coordinatorApiRange,'coordinator API range');
    return Object.freeze({schemaVersion:1,role:'main',packageName:pkg.name,packageVersion:pkg.version,runtimeProtocol:value.runtimeProtocol,coordinatorApiRange:value.coordinatorApiRange,capabilities:strings(value.capabilities,'main capabilities'),requiredCoordinatorCapabilities:strings(value.requiredCoordinatorCapabilities,'required coordinator capabilities')});
  }
  parseLifecycleVersion(value.coordinatorApi,'coordinator API');rangeTerms(value.runtimeProtocolRange,'runtime protocol range');rangeTerms(value.mainPackageRange,'main package range');
  return Object.freeze({schemaVersion:1,role:'coordinator',packageName:pkg.name,packageVersion:pkg.version,coordinatorApi:value.coordinatorApi,runtimeProtocolRange:value.runtimeProtocolRange,mainPackageRange:value.mainPackageRange,capabilities:strings(value.capabilities,'coordinator capabilities'),requiredMainCapabilities:strings(value.requiredMainCapabilities,'required main capabilities')});
}
function lowerBound(range){const term=rangeTerms(range,'compatibility range').find(item=>item.operator==='>='||item.operator==='>');return term?.version;}
function incompatible(code,diagnostic,details={}){return Object.freeze({compatible:false,code,diagnostic,negotiatedCapabilities:Object.freeze([]),...details});}
export function evaluateLifecycleCompatibility(main,coordinator){
  try{
    main=lifecycleDeclaration({name:main?.packageName,version:main?.packageVersion,dshLifecycle:{schemaVersion:main?.schemaVersion,role:main?.role,runtimeProtocol:main?.runtimeProtocol,coordinatorApiRange:main?.coordinatorApiRange,capabilities:main?.capabilities,requiredCoordinatorCapabilities:main?.requiredCoordinatorCapabilities}},'main');
    coordinator=lifecycleDeclaration({name:coordinator?.packageName,version:coordinator?.packageVersion,dshLifecycle:{schemaVersion:coordinator?.schemaVersion,role:coordinator?.role,coordinatorApi:coordinator?.coordinatorApi,runtimeProtocolRange:coordinator?.runtimeProtocolRange,mainPackageRange:coordinator?.mainPackageRange,capabilities:coordinator?.capabilities,requiredMainCapabilities:coordinator?.requiredMainCapabilities}},'coordinator');
  }catch{return incompatible(COMPATIBILITY_CODES.METADATA_INVALID,'Lifecycle declarations are invalid');}
  if(!lifecycleVersionSatisfies(main.runtimeProtocol,coordinator.runtimeProtocolRange))return incompatible(COMPATIBILITY_CODES.PROTOCOL_INCOMPATIBLE,'Runtime protocol is outside the coordinator range',{main,coordinator});
  if(!lifecycleVersionSatisfies(coordinator.coordinatorApi,main.coordinatorApiRange)){
    const minimum=lowerBound(main.coordinatorApiRange),old=minimum&&compareLifecycleVersions(coordinator.coordinatorApi,minimum)<0;
    return incompatible(old?COMPATIBILITY_CODES.COORDINATOR_TOO_OLD:COMPATIBILITY_CODES.COORDINATOR_API_INCOMPATIBLE,old?'Coordinator API is too old for the main bundle':'Coordinator API is outside the main bundle range',{main,coordinator});
  }
  if(!lifecycleVersionSatisfies(main.packageVersion,coordinator.mainPackageRange)){
    const minimum=lowerBound(coordinator.mainPackageRange),old=minimum&&compareLifecycleVersions(main.packageVersion,minimum)<0;
    return incompatible(old?COMPATIBILITY_CODES.MAIN_TOO_OLD:COMPATIBILITY_CODES.MAIN_VERSION_INCOMPATIBLE,old?'Main bundle is too old for the coordinator':'Main bundle version is outside the coordinator range',{main,coordinator});
  }
  const baselineMain=['runtime.health','runtime.quiesce','runtime.resume','upgrade.main-hot'],baselineCoordinator=['coordinator.tick','upgrade.main-hot','upgrade.offline-pair'];
  const missingCoordinator=[...new Set([...main.requiredCoordinatorCapabilities,...baselineCoordinator])].find(item=>!coordinator.capabilities.includes(item));
  const missingMain=[...new Set([...coordinator.requiredMainCapabilities,...baselineMain])].find(item=>!main.capabilities.includes(item));
  if(missingCoordinator||missingMain)return incompatible(COMPATIBILITY_CODES.CAPABILITY_MISSING,`Required lifecycle capability is missing: ${missingCoordinator??missingMain}`,{main,coordinator});
  return Object.freeze({compatible:true,code:'LIFECYCLE_COMPATIBLE',diagnostic:'Lifecycle bundle declarations are compatible',main,coordinator,negotiatedCapabilities:Object.freeze(main.capabilities.filter(item=>coordinator.capabilities.includes(item)).sort())});
}
export function planMainReplacement(candidateMain,currentCoordinator){
  const result=evaluateLifecycleCompatibility(candidateMain,currentCoordinator),requiredMain=['runtime.health','runtime.quiesce','runtime.resume','upgrade.main-hot'],requiredCoordinator=['coordinator.tick','upgrade.main-hot','upgrade.offline-pair'],missing=result.compatible&&(requiredMain.find(item=>!result.main.capabilities.includes(item))??requiredCoordinator.find(item=>!result.coordinator.capabilities.includes(item)));
  return result.compatible&&!missing?Object.freeze({mode:'main-hot',...result}):Object.freeze({mode:'offline-pair',compatible:false,code:COMPATIBILITY_CODES.OFFLINE_PAIR_REQUIRED,diagnostic:'Candidate main bundle requires a supervised offline two-bundle upgrade',cause:missing?COMPATIBILITY_CODES.CAPABILITY_MISSING:result.code,main:result.main??candidateMain,coordinator:result.coordinator??currentCoordinator,negotiatedCapabilities:Object.freeze([])});
}
export function assertLifecycleCompatibility(main,coordinator){const result=evaluateLifecycleCompatibility(main,coordinator);if(!result.compatible)fail(result.code,result.diagnostic);return result;}
