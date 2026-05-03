/**
 * Заглушка для вех M2–M10 до появления реальных тестов.
 * Запуск: tsx tests/console/stub-milestone.ts M7
 */
import { exitCode, printResult } from './runner';

const milestone = process.argv[2];
if (!milestone || !/^M\d{1,2}$/.test(milestone)) {
  console.error('Укажите веху: tsx tests/console/stub-milestone.ts M2');
  process.exit(1);
}

printResult(
  milestone,
  1,
  'Заглушка — тесты будут добавлены параллельно с разработкой вехи',
  true
);
exitCode(0);
