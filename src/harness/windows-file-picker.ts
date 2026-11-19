import type {SystemLocale} from '../i18n/common.js';
import {pickWindowsPath} from './windows-path-picker.js';

export const pickWindowsFile=(initial:string|undefined,locale:SystemLocale,signal:AbortSignal,run?:Parameters<typeof pickWindowsPath>[4]):Promise<unknown>=>
  pickWindowsPath('file',initial,locale,signal,run);
