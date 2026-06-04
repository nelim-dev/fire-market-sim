export type PersistenceListSavesCommand = {
  type: 'persistence/list-saves';
};

export type PersistenceSaveCommand = {
  type: 'persistence/save';
  displayName: string;
};

export type PersistenceLoadCommand = {
  type: 'persistence/load';
  slotId: string;
};

export type PersistenceCommand =
  | PersistenceListSavesCommand
  | PersistenceSaveCommand
  | PersistenceLoadCommand;
