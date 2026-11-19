import type {SystemLocale} from '../i18n/common.js';
import {pickWindowsPath} from './windows-path-picker.js';

export const pickWindowsDirectory=(initial:string|undefined,locale:SystemLocale,signal:AbortSignal,run?:Parameters<typeof pickWindowsPath>[4]):Promise<unknown>=>
  pickWindowsPath('directory',initial,locale,signal,run);
