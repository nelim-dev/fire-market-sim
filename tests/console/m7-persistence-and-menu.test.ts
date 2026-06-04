/**
 * M7: persistence + menu pause contract. Запуск: npm run test:m7
 */
import { LogicManager } from '../../src/logic/managers/LogicManager';
import { MemoryPersistenceStorage } from '../../src/logic/modules/persistence/storage';
import {
  CURRENT_SNAPSHOT_SCHEMA,
  createSlotId,
} from '../../src/logic/modules/persistence/snapshot';
import { exitCode, printResult } from './runner';

const M = 'M7';
let failures = 0;
let testNum = 0;

async function run(description: string, fn: () => void | Promise<void>): Promise<void> {
  testNum++;
  try {
    await fn();
    printResult(M, testNum, description, true);
  } catch (e) {
    failures++;
    printResult(
      M,
      testNum,
      description,
      false,
      e instanceof Error ? e.message : String(e)
    );
  }
}

function assertEq<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

async function main(): Promise<void> {
  await run('LogicManager: exportSnapshot / restoreSnapshot round-trip', () => {
    const lm = new LogicManager();
    lm.pause();
    lm.update(1);
    const before = lm.getState();
    const epochBefore = before.simulationEpochMs;
    const cashBefore = before.portfolio.cashRub;
    const pausedBefore = before.isPaused;
    const selectedBefore = before.uiState.selectedSymbol;

    const snapshot = lm.exportSnapshot('Test Save', createSlotId('Test Save', 1_700_000_000_000));
    assertEq(snapshot.schemaVersion, CURRENT_SNAPSHOT_SCHEMA, 'schemaVersion');
    assertEq(snapshot.displayName, 'Test Save', 'displayName');
    assertEq(snapshot.gameState.simulationEpochMs, epochBefore, 'epoch in snapshot');
    assertEq(
      (snapshot.gameState as { persistence?: unknown }).persistence,
      undefined,
      'persistence not in saved gameState'
    );

    lm.restoreSnapshot(snapshot);
    const after = lm.getState();
    assertEq(after.simulationEpochMs, epochBefore, 'epoch after restore');
    assertEq(after.portfolio.cashRub, cashBefore, 'cash after restore');
    assertEq(after.isPaused, pausedBefore, 'isPaused after restore');
    assertEq(after.uiState.selectedSymbol, selectedBefore, 'selectedSymbol after restore');
    assertEq(after.persistence.ready, true, 'persistence UI re-init');
  });

  await run('LogicManager: portfolio lotSequence survives restore', () => {
    const lm = new LogicManager();
    const snapshotBefore = lm.exportSnapshot('Baseline', createSlotId('Baseline'));
    const lotSeqBefore =
      (snapshotBefore.moduleRuntime.portfolio as { lotSequence?: number })
        .lotSequence ?? 0;
    lm.restoreSnapshot(snapshotBefore);
    const afterRuntime = lm.exportSnapshot('After', createSlotId('After'));
    const lotSeqAfter =
      (afterRuntime.moduleRuntime.portfolio as { lotSequence?: number }).lotSequence ??
      0;
    assertEq(lotSeqAfter, lotSeqBefore, 'lotSequence preserved');
  });

  await run('PersistenceModule: save / list / load via MemoryAdapter', async () => {
    const storage = new MemoryPersistenceStorage();
    const lm = new LogicManager();
    lm.setPersistenceStorageForTests(storage);
    lm.pause();

    const epochBefore = lm.getState().simulationEpochMs;
    lm.dispatchCommand({ type: 'persistence/save', displayName: 'Slot A' });
    await new Promise((r) => setTimeout(r, 50));
    if (lm.getState().persistence.lastError) {
      throw new Error(lm.getState().persistence.lastError ?? 'save_failed');
    }
    if (lm.getState().persistence.saveSlots.length !== 1) {
      throw new Error('expected one save slot');
    }

    lm.update(2);
    lm.dispatchCommand({ type: 'persistence/list-saves' });
    await new Promise((r) => setTimeout(r, 50));

    const slotId = lm.getState().persistence.saveSlots[0]?.slotId;
    if (!slotId) {
      throw new Error('missing slotId');
    }
    lm.dispatchCommand({ type: 'persistence/load', slotId });
    await new Promise((r) => setTimeout(r, 50));
    if (lm.getState().persistence.lastError) {
      throw new Error(lm.getState().persistence.lastError ?? 'save_failed');
    }
    assertEq(lm.getState().simulationEpochMs, epochBefore, 'epoch after load');
  });

  await run('PersistenceModule: invalid load does not corrupt state', async () => {
    const storage = new MemoryPersistenceStorage();
    const lm = new LogicManager();
    lm.setPersistenceStorageForTests(storage);
    const epochBefore = lm.getState().simulationEpochMs;
    const cashBefore = lm.getState().portfolio.cashRub;

    lm.dispatchCommand({ type: 'persistence/load', slotId: 'missing-slot' });
    await new Promise((r) => setTimeout(r, 50));

    if (!lm.getState().persistence.lastError) {
      throw new Error('expected persistence lastError');
    }
    assertEq(lm.getState().simulationEpochMs, epochBefore, 'epoch unchanged');
    assertEq(lm.getState().portfolio.cashRub, cashBefore, 'cash unchanged');
  });

  await run('Menu pause contract: pause/resume via runtime commands', () => {
    const lm = new LogicManager();
    assertEq(lm.getState().isPaused, false, 'initial not paused');
    lm.pause();
    assertEq(lm.getState().isPaused, true, 'paused after pause');
    const epoch = lm.getState().simulationEpochMs;
    lm.update(1);
    assertEq(lm.getState().simulationEpochMs, epoch, 'epoch frozen on pause');
    lm.resume();
    assertEq(lm.getState().isPaused, false, 'resumed');
  });
}

main()
  .then(() => {
    process.exit(exitCode(failures));
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
