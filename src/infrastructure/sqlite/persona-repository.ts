import {storageDescriptor} from '../../i18n/storage.js';
import {configSchema, configForWrite,botSettingsFromConfig,configWithBotSettings, type BotConfig, type SessionBinding} from '../../core/types.js';
import {sameConfig} from '../../core/personas.js';
import {ConflictError,LocalizedError} from '../../core/errors.js';
import type {PersonaConfigRepository, PersonaDraft, PersonaStatus} from '../../core/ports/persona.js';
import type {BotRepository} from '../../core/ports/bot.js';
import type {BindingRepository} from '../../core/ports/session.js';
import type {SqliteDatabase} from './database.js';
import type {PersonaFiles} from '../files/persona-files.js';
import path from 'node:path';

const personaBaselineKey = (id: string) => id;

/**
 * Applied persona configuration revisions.  A saved revision is immutable; its
 * persona files are published through the journaled file adapter first.
 */
export class SqlitePersonaConfigRepository implements PersonaConfigRepository {
  constructor(
    private readonly database: SqliteDatabase,
    private readonly files: PersonaFiles,
    private readonly bots: () => BotRepository,
    private readonly bindings: () => BindingRepository,
  ) {}
  configs(): BotConfig[] {return this.database.records.list<BotConfig>('config').map(config => configSchema.parse(config));}
  config(id: string): BotConfig {
    const value = this.findConfig(id);
    if (!value || value.archived) throw new LocalizedError(storageDescriptor('personaMissing'),'配置不存在或已归档');
    return configSchema.parse(value);
  }
  findConfig(id: string): BotConfig | undefined {return this.database.records.get<BotConfig>('config', id);}
  configVersions(): readonly BotConfig[] {return this.database.records.list<BotConfig>('config-version').map(config => configSchema.parse(config));}
  configVersion(personaId: string, revision: number): BotConfig | undefined {return this.database.records.get<BotConfig>('config-version', `${personaId}:${revision}`);}
  effectiveConfig(binding: SessionBinding): BotConfig {
    const bot=this.bots().bot(binding.scope.botId);
    const persona=this.config(binding.personaId??bot.configId);
    const config=configWithBotSettings(persona,bot.settings??botSettingsFromConfig(this.config(bot.configId)));
    let effective: BotConfig = binding.modelOverride ? {...config, model:{...binding.modelOverride}} : config;
    const voice = effective.media.voice;
    if (voice && binding.ttsOverride) {
      effective = {
        ...effective,
        media: {
          ...effective.media,
          voice: binding.ttsOverride.kind === 'edge'
            ? {...voice, engine:'edge_tts', protocol:'edge_tts', profileRef:undefined, voice:binding.ttsOverride.voice, format:'mp3'}
            : {...voice, engine:binding.ttsOverride.profileRef.serviceId, protocol:undefined, profileRef:{...binding.ttsOverride.profileRef}, voice:undefined, format:'wav'},
        },
      };
    }
    const singing = effective.media.singing;
    if (singing && binding.stsOverride) {
      effective = {...effective, media:{...effective.media, singing:{...singing, profileRef:{...binding.stsOverride.profileRef}}}};
    }
    return effective;
  }
  personaStatus(id: string): PersonaStatus {
    try {
      const directory = this.files.directory(id), file = this.files.read(id), baseline = this.baseline(id);
      return {id, directory, state:baseline?.digest === file.digest && sameConfig(file.config, this.findConfig(id)!) ? 'synced' : 'draft'};
    } catch (error) { return {id, directory:path.join(this.files.root, id), state:'error', error:error instanceof Error ? error.message : 'PERSONA_FILES_INVALID', ...(error instanceof LocalizedError ? {message:error.localizedMessage} : {})}; }
  }
  personaDirectory(id?: string): string {return this.files.directory(id);}
  personaRoot(): string {return this.files.root;}
  readPersonaDraft(id: string): PersonaDraft {return this.files.read(id);}
  countConfigs(): number {return this.database.records.count('config');}
  /** Persona file adapter, exposed to the composition root only. */
  personaFiles(): PersonaFiles {return this.files;}
  baseline(id: string): {digest:string} | undefined {return this.database.records.get<{digest:string}>('persona-files', personaBaselineKey(id));}
  saveBaseline(id: string, digest: string): void {this.database.records.put('persona-files', personaBaselineKey(id), {digest});}
  recoverFiles(id: string): void {this.files.recover(id, this.findConfig(id));}
  saveConfig(input: unknown, expectedRevision?: number, fileDigest?: string): BotConfig {
    const value = configForWrite(input);
    const check = () => {
      const previous = this.findConfig(value.id);
      if (previous && previous.revision !== expectedRevision) throw new ConflictError();
      if (value.archived && (this.bots().bots().some(bot => !bot.archived && bot.configId === value.id) || this.bindings().bindings().some((binding:SessionBinding) => binding.personaId === value.id))) throw new LocalizedError(storageDescriptor('personaStillBound'),'请先解除机器人或活动会话配置绑定');
      return previous;
    };
    this.files.recover(value.id, this.findConfig(value.id));
    const previous = check();
    if (fileDigest !== undefined && this.files.read(value.id).digest !== fileDigest) throw new ConflictError('人格文件在校验期间被修改，请重新应用',storageDescriptor('personaValidationChanged'));
    if (fileDigest !== undefined && previous && sameConfig(previous, value)) {
      this.database.transaction(() => {
        check();
        this.saveBaseline(value.id, fileDigest!);
      });
      return previous;
    }
    const next = {...value, revision:previous ? previous.revision + 1 : 1};
    return this.files.publish(next, fingerprint => this.database.transaction(() => {
      check();
      this.database.records.put('config-version', `${next.id}:${next.revision}`, next);
      this.database.records.put('config', next.id, next);
      this.saveBaseline(next.id, fingerprint);
      return next;
    }));
  }
}
