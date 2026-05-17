export type EducationSyncUnlockedFromCatalogCommand = {
  type: 'education/sync-unlocked-from-catalog';
};

export type EducationLockSymbolCommand = {
  type: 'education/lock-symbol';
  symbol: string;
};

export type EducationUnlockSymbolCommand = {
  type: 'education/unlock-symbol';
  symbol: string;
};

export type EducationCommand =
  | EducationSyncUnlockedFromCatalogCommand
  | EducationLockSymbolCommand
  | EducationUnlockSymbolCommand;
