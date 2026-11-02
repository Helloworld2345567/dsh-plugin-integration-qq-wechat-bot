import {parseServicePluginManifest,type ServiceCapabilityDescriptor,type ServicePluginManifest} from './service-contract.js';

export interface ServiceCatalogEntry {
  readonly manifest:ServicePluginManifest;
  readonly capabilities:readonly ServiceCapabilityDescriptor[];
}

const copyDescriptor=(descriptor:ServiceCapabilityDescriptor):ServiceCapabilityDescriptor=>Object.freeze({
  ...descriptor,
  inputKinds:Object.freeze([...descriptor.inputKinds]),
  outputKinds:Object.freeze([...descriptor.outputKinds]),
  parameterSchema:Object.freeze({...descriptor.parameterSchema,schema:Object.freeze(structuredClone(descriptor.parameterSchema.schema))}),
});
const copyManifest=(input:ServicePluginManifest):ServicePluginManifest=>{
  const parsed=parseServicePluginManifest(structuredClone(input));
  return Object.freeze({
    ...parsed,
    protocols:Object.freeze([...parsed.protocols]),
    capabilities:Object.freeze(parsed.capabilities.map(copyDescriptor)),
    profileSchema:Object.freeze({...parsed.profileSchema,schema:Object.freeze(structuredClone(parsed.profileSchema.schema))}),
    dependencies:Object.freeze(parsed.dependencies.map(item=>Object.freeze({...item}))),
    credentialRefs:Object.freeze(parsed.credentialRefs.map(item=>Object.freeze({...item}))),
  });
};

export interface ServiceCatalogReservations {operations?:ReadonlySet<string>;tools?:ReadonlySet<string>;permissions?:ReadonlySet<string>}
export class ServiceCatalog {
  private readonly services:ReadonlyMap<string,ServiceCatalogEntry>;
  private readonly operations:ReadonlyMap<string,{readonly serviceId:string;readonly descriptor:ServiceCapabilityDescriptor}>;
  constructor(manifests:readonly ServicePluginManifest[],reservations:ServiceCatalogReservations={}){
    const services=new Map<string,ServiceCatalogEntry>(),operations=new Map<string,{serviceId:string;descriptor:ServiceCapabilityDescriptor}>(),packages=new Map<string,string>(),permissions=new Map<string,string>(),tools=new Map<string,string>();
    for(const input of manifests){
      const manifest=copyManifest(input);
      if(services.has(manifest.serviceId))throw new Error(`SERVICE_ID_DUPLICATE: ${manifest.serviceId}`);
      const previousPackage=packages.get(manifest.packageId);if(previousPackage)throw new Error(`SERVICE_PACKAGE_DUPLICATE: ${manifest.packageId} (${previousPackage}, ${manifest.serviceId})`);packages.set(manifest.packageId,manifest.serviceId);
      for(const descriptor of manifest.capabilities){
        if(reservations.operations?.has(descriptor.operation))throw new Error(`SERVICE_OPERATION_RESERVED: ${descriptor.operation}`);
        if(reservations.permissions?.has(descriptor.permission))throw new Error(`SERVICE_PERMISSION_RESERVED: ${descriptor.permission}`);
        if(descriptor.tool&&reservations.tools?.has(descriptor.tool))throw new Error(`SERVICE_TOOL_RESERVED: ${descriptor.tool}`);
        if(operations.has(descriptor.operation))throw new Error(`SERVICE_OPERATION_DUPLICATE: ${descriptor.operation}`);
        const permissionOwner=permissions.get(descriptor.permission);if(permissionOwner&&permissionOwner!==manifest.serviceId)throw new Error(`SERVICE_PERMISSION_DUPLICATE: ${descriptor.permission} (${permissionOwner}, ${manifest.serviceId})`);permissions.set(descriptor.permission,manifest.serviceId);
        if(descriptor.tool){const toolOwner=tools.get(descriptor.tool);if(toolOwner&&toolOwner!==manifest.serviceId)throw new Error(`SERVICE_TOOL_DUPLICATE: ${descriptor.tool} (${toolOwner}, ${manifest.serviceId})`);tools.set(descriptor.tool,manifest.serviceId);}
        operations.set(descriptor.operation,Object.freeze({serviceId:manifest.serviceId,descriptor}));
      }
      services.set(manifest.serviceId,Object.freeze({manifest,capabilities:manifest.capabilities}));
    }
    this.services=services;this.operations=operations;Object.freeze(this);
  }
  list():readonly ServiceCatalogEntry[]{return Object.freeze([...this.services.values()]);}
  service(serviceId:string):ServiceCatalogEntry|undefined{return this.services.get(serviceId);}
  require(serviceId:string):ServiceCatalogEntry{const value=this.service(serviceId);if(!value)throw new Error(`SERVICE_NOT_REGISTERED: ${serviceId}`);return value;}
  operation(operation:string):{readonly serviceId:string;readonly descriptor:ServiceCapabilityDescriptor}|undefined{return this.operations.get(operation);}
  requireOperation(operation:string):{readonly serviceId:string;readonly descriptor:ServiceCapabilityDescriptor}{const value=this.operation(operation);if(!value)throw new Error(`SERVICE_OPERATION_NOT_REGISTERED: ${operation}`);return value;}
}
