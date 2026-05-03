/**
 * Общий формат вывода консольных тестов вех M1–M10.
 */
export function printResult(
  milestone: string,
  testNum: number,
  description: string,
  passed: boolean,
  errorMessage?: string
): void {
  if (passed) {
    console.log(
      `[${milestone}] Тест ${testNum}: ${description} — ✅ ПРОЙДЕН`
    );
  } else {
    console.log(
      `[${milestone}] Тест ${testNum}: ${description} — ❌ НЕ ПРОЙДЕН (ошибка: ${errorMessage ?? 'неизвестно'})`
    );
  }
}

export function exitCode(failureCount: number): never {
  process.exit(failureCount > 0 ? 1 : 0);
}
