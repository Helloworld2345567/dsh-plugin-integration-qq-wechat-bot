import type {HistoryLocation, HistoryLocationRepository} from '../../core/ports/workspace.js';
import type {MusicAcquisition, MusicCandidates, MusicStateRepository, SingingAttempt, SingingCandidates, SingingStateRepository, VoiceLibrarySettingsRepository} from '../../core/ports/media.js';
import type {SqliteDatabase} from './database.js';

/** Exported chat history file location per session. */
export class SqliteHistoryLocationRepository implements HistoryLocationRepository {
  constructor(private readonly database: SqliteDatabase) {}
  find(sessionId: string): HistoryLocation | undefined {return this.database.records.get<HistoryLocation>('history-location', sessionId);}
  save(location: HistoryLocation): void {this.database.records.put('history-location', location.sessionId, location);}
  list(): readonly HistoryLocation[] {return this.database.records.list<HistoryLocation>('history-location');}
}

/** Session-bound music candidates and acquisition state. */
export class SqliteMusicStateRepository implements MusicStateRepository {
  constructor(private readonly database: SqliteDatabase) {}
  candidates(scope: string): MusicCandidates | null | undefined {return this.database.records.get<MusicCandidates>('music-candidates', scope);}
  saveCandidates(scope: string, value: MusicCandidates): void {this.database.records.put('music-candidates', scope, value);}
  acquisition(scope: string): MusicAcquisition | null | undefined {return this.database.records.get<MusicAcquisition>('music-acquisition', scope);}
  saveAcquisition(scope: string, value: MusicAcquisition): void {this.database.records.put('music-acquisition', scope, value);}
  clear(scope: string): void {
    this.database.records.put('music-candidates', scope, null);
    this.database.records.put('music-acquisition', scope, null);
  }
}

/** Session-bound singing candidates and attempt state. */
export class SqliteSingingStateRepository implements SingingStateRepository {
  constructor(private readonly database: SqliteDatabase) {}
  candidates(scope: string): SingingCandidates | null | undefined {return this.database.records.get<SingingCandidates>('singing-candidates', scope);}
  saveCandidates(scope: string, value: SingingCandidates | null): void {this.database.records.put('singing-candidates', scope, value);}
  attempt(scope: string): SingingAttempt | null | undefined {return this.database.records.get<SingingAttempt>('singing-attempt', scope);}
  saveAttempt(scope: string, value: SingingAttempt): void {this.database.records.put('singing-attempt', scope, value);}
}

/** Operator-editable voice model library settings. */
export class SqliteVoiceLibrarySettingsRepository implements VoiceLibrarySettingsRepository {
  constructor(private readonly database: SqliteDatabase) {}
  read(): unknown {return this.database.records.get<unknown>('voice-model-library', 'settings');}
  write(settings: unknown): void {this.database.records.put('voice-model-library', 'settings', settings);}
}
