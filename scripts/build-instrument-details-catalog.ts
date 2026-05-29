/**
 * Сборщик каталога не-ценовой информации об инструментах:
 *  - lotSize (с fallback=1)
 *  - метаданные (isBond / faceValue / faceUnit / maturity / ISIN)
 *  - расписания дивидендов / купонов / амортизаций / погашений
 *
 * Источник: downloadStockData/output/meta/*.txt (txt, скачанные отдельным пакетом).
 * Артефакт: src/data/generated/marketInstrumentDetailsCatalog.json
 * Запуск: npm run gen:instrument-details
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toDate } from 'date-fns-tz';

interface InstrumentMeta {
  isBond: boolean;
  initialFaceValueRub: number | null;
  faceUnit: string | null;
  maturityEpochMs: number | null;
  firstTradeEpochMs?: number | null;
  isin: string | null;
  /** Сырые человекочитаемые значения для отладки. */
  groupRaw: string | null;
}

type CatalogShape = {
  items: Array<{
    symbol: string;
    assetKind: string;
    sourceFilePath: string;
  }>;
};

interface DividendEntry {
  /** Дата закрытия реестра (registryclosedate) — пока используется как «декларация дивиденда». */
  recordCloseDateEpochMs: number;
  perShareRub: number;
  currency: string;
}

interface CouponEntry {
  startDateEpochMs: number;
  payDateEpochMs: number;
  recordDateEpochMs: number | null;
  perBondRub: number;
  faceValueAtTime: number;
}

interface AmortizationEntry {
  amortDateEpochMs: number;
  faceValueRub: number;
  initialFaceValueRub: number;
  amortRubPerBond: number;
  /** Из ISS: 'maturity' — последнее погашение; иные значения — промежуточные амортизации. */
  dataSource: string;
}

interface RedemptionEntry {
  maturityEpochMs: number;
  faceValueRub: number;
}

interface DetailsCatalog {
  generatedAt: string;
  lotSizeBySymbol: Record<string, number>;
  /** MOEX ISSUESIZE — акции в обращении (шт.). */
  sharesOutstandingBySymbol: Record<string, number>;
  instrumentMetaBySymbol: Record<string, InstrumentMeta>;
  dividendsBySymbol: Record<string, DividendEntry[]>;
  couponsBySymbol: Record<string, CouponEntry[]>;
  amortizationsBySymbol: Record<string, AmortizationEntry[]>;
  redemptionBySymbol: Record<string, RedemptionEntry>;
}

function parseInstrumentFile(text: string): Map<string, string> {
  const lines = text.split(/\r?\n/);
  const map = new Map<string, string>();
  for (const raw of lines) {
    const noComment = raw.includes('#') ? raw.split('#')[0] : raw;
    const line = noComment.trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const k = line.slice(0, idx).trim().toUpperCase();
    const v = line.slice(idx + 1).trim();
    if (k) map.set(k, v);
  }
  return map;
}

function moscowDateToEpochMs(yyyyMmDd: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(yyyyMmDd)) return null;
  try {
    const ms = toDate(`${yyyyMmDd}T00:00:00`, { timeZone: 'Europe/Moscow' }).getTime();
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}

function barEpochMskMinute(mskYyyymmdd: string, hhmmss: string): number | null {
  if (!/^\d{8}$/.test(mskYyyymmdd) || !/^\d{6}$/.test(hhmmss)) {
    return null;
  }
  const y = mskYyyymmdd.slice(0, 4);
  const m = mskYyyymmdd.slice(4, 6);
  const d = mskYyyymmdd.slice(6, 8);
  const hh = hhmmss.slice(0, 2);
  const mi = hhmmss.slice(2, 4);
  const ss = hhmmss.slice(4, 6);
  try {
    const ms = toDate(`${y}-${m}-${d}T${hh}:${mi}:${ss}`, {
      timeZone: 'Europe/Moscow',
    }).getTime();
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}

function readFirstTradeEpochFromCandleFile(
  projectRoot: string,
  relativePath: string
): number | null {
  const filePath = join(projectRoot, relativePath);
  if (!existsSync(filePath)) {
    return null;
  }
  const text = readFileSync(filePath, 'utf-8');
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('<') || line.startsWith('#')) {
      continue;
    }
    const parts = line.split(',');
    if (parts.length < 5) {
      continue;
    }
    const date = parts[2]?.trim() ?? '';
    const time = parts[3]?.trim() ?? '';
    const ms = barEpochMskMinute(date, time);
    if (ms != null) {
      return ms;
    }
  }
  return null;
}

function applyFirstTradeEpochsFromCatalog(
  projectRoot: string,
  instrumentMetaBySymbol: Record<string, InstrumentMeta>
): number {
  const catalogPath = join(
    projectRoot,
    'src',
    'data',
    'generated',
    'marketInstrumentCatalog.json'
  );
  if (!existsSync(catalogPath)) {
    return 0;
  }
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf-8')) as CatalogShape;
  let count = 0;
  for (const item of catalog.items ?? []) {
    const sym = item.symbol.toUpperCase();
    const first = readFirstTradeEpochFromCandleFile(projectRoot, item.sourceFilePath);
    if (first == null) {
      continue;
    }
    count += 1;
    const prev = instrumentMetaBySymbol[sym];
    if (prev) {
      instrumentMetaBySymbol[sym] = { ...prev, firstTradeEpochMs: first };
    } else {
      instrumentMetaBySymbol[sym] = {
        isBond: item.assetKind === 'bond',
        initialFaceValueRub: null,
        faceUnit: null,
        maturityEpochMs: null,
        firstTradeEpochMs: first,
        isin: null,
        groupRaw: null,
      };
    }
  }
  return count;
}

/**
 * Парсит файл с TSV-таблицей, в начале которого могут быть `#`-комментарии
 * и/или одиночные строки вроде `MATDATE (из description): 2024-07-17`.
 * Заголовок — первая строка с табуляцией.
 */
function parseTsvWithHeader(text: string): { columns: string[]; rows: string[][] } | null {
  const lines = text.split(/\r?\n/);
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i];
    if (!l || !l.trim()) continue;
    if (l.startsWith('#')) continue;
    if (!l.includes('\t')) continue;
    headerIdx = i;
    break;
  }
  if (headerIdx < 0) return null;
  const columns = lines[headerIdx].split('\t').map((c) => c.trim().toLowerCase());
  const rows: string[][] = [];
  for (let i = headerIdx + 1; i < lines.length; i += 1) {
    const l = lines[i];
    if (!l || !l.trim()) continue;
    if (l.startsWith('#')) continue;
    if (!l.includes('\t')) continue;
    rows.push(l.split('\t').map((c) => c.trim()));
  }
  return { columns, rows };
}

function valueByColumn(
  columns: string[],
  row: string[],
  name: string
): string | undefined {
  const idx = columns.indexOf(name.toLowerCase());
  if (idx < 0) return undefined;
  return row[idx];
}

function detectIsBond(map: Map<string, string>): boolean {
  const group = (map.get('GROUP') ?? '').toLowerCase();
  const type = (map.get('TYPE') ?? '').toLowerCase();
  return group.includes('bond') || type.includes('bond');
}

function parseDividends(metaDir: string, secid: string): DividendEntry[] | null {
  // Приоритет: ручной файл с опечаткой `_dividens.txt` (split-adjusted), затем штатный `.dividends.txt`.
  const candidates = [`${secid}_dividens.txt`, `${secid}.dividends.txt`];
  for (const name of candidates) {
    const path = join(metaDir, name);
    if (!existsSync(path)) continue;
    const parsed = parseTsvWithHeader(readFileSync(path, 'utf-8'));
    if (!parsed) continue;
    const result: DividendEntry[] = [];
    for (const row of parsed.rows) {
      const dateStr = valueByColumn(parsed.columns, row, 'registryclosedate');
      const valStr = valueByColumn(parsed.columns, row, 'value');
      const curStr =
        valueByColumn(parsed.columns, row, 'currencyid') ??
        valueByColumn(parsed.columns, row, 'currency') ??
        'RUB';
      if (!dateStr || !valStr) continue;
      const epochMs = moscowDateToEpochMs(dateStr);
      const perShareRub = Number(valStr);
      if (epochMs === null || !Number.isFinite(perShareRub) || perShareRub <= 0) continue;
      result.push({
        recordCloseDateEpochMs: epochMs,
        perShareRub,
        currency: curStr.toUpperCase(),
      });
    }
    if (result.length > 0) {
      return result.sort((a, b) => a.recordCloseDateEpochMs - b.recordCloseDateEpochMs);
    }
  }
  return null;
}

function parseCoupons(metaDir: string, secid: string): CouponEntry[] | null {
  const path = join(metaDir, `${secid}.coupon-schedule.txt`);
  if (!existsSync(path)) return null;
  const parsed = parseTsvWithHeader(readFileSync(path, 'utf-8'));
  if (!parsed) return null;
  const result: CouponEntry[] = [];
  for (const row of parsed.rows) {
    const startStr = valueByColumn(parsed.columns, row, 'startdate');
    const couponStr = valueByColumn(parsed.columns, row, 'coupondate');
    const recordStr = valueByColumn(parsed.columns, row, 'recorddate');
    const perBondStr =
      valueByColumn(parsed.columns, row, 'value_rub') ??
      valueByColumn(parsed.columns, row, 'value');
    const faceStr =
      valueByColumn(parsed.columns, row, 'facevalue') ??
      valueByColumn(parsed.columns, row, 'initialfacevalue');
    if (!startStr || !couponStr || !perBondStr || !faceStr) continue;
    const startMs = moscowDateToEpochMs(startStr);
    const payMs = moscowDateToEpochMs(couponStr);
    const recordMs = recordStr ? moscowDateToEpochMs(recordStr) : null;
    const perBondRub = Number(perBondStr);
    const face = Number(faceStr);
    if (
      startMs === null ||
      payMs === null ||
      !Number.isFinite(perBondRub) ||
      !Number.isFinite(face)
    ) {
      continue;
    }
    result.push({
      startDateEpochMs: startMs,
      payDateEpochMs: payMs,
      recordDateEpochMs: recordMs,
      perBondRub,
      faceValueAtTime: face,
    });
  }
  if (result.length === 0) return null;
  return result.sort((a, b) => a.payDateEpochMs - b.payDateEpochMs);
}

function parseCashflowsOther(
  metaDir: string,
  secid: string
): { amorts: AmortizationEntry[] | null; redemption: RedemptionEntry | null } {
  const path = join(metaDir, `${secid}.cashflows-other.txt`);
  if (!existsSync(path)) return { amorts: null, redemption: null };
  const parsed = parseTsvWithHeader(readFileSync(path, 'utf-8'));
  if (!parsed) return { amorts: null, redemption: null };
  const amorts: AmortizationEntry[] = [];
  let redemption: RedemptionEntry | null = null;
  for (const row of parsed.rows) {
    const amortDateStr = valueByColumn(parsed.columns, row, 'amortdate');
    const faceStr = valueByColumn(parsed.columns, row, 'facevalue');
    const initialStr = valueByColumn(parsed.columns, row, 'initialfacevalue');
    const perBondStr =
      valueByColumn(parsed.columns, row, 'value_rub') ??
      valueByColumn(parsed.columns, row, 'value');
    const dataSource = (valueByColumn(parsed.columns, row, 'data_source') ?? '').toLowerCase();
    if (!amortDateStr || !faceStr || !perBondStr) continue;
    const ms = moscowDateToEpochMs(amortDateStr);
    const face = Number(faceStr);
    const initial = initialStr ? Number(initialStr) : face;
    const perBondRub = Number(perBondStr);
    if (ms === null || !Number.isFinite(face) || !Number.isFinite(perBondRub)) continue;
    amorts.push({
      amortDateEpochMs: ms,
      faceValueRub: face,
      initialFaceValueRub: Number.isFinite(initial) ? initial : face,
      amortRubPerBond: perBondRub,
      dataSource,
    });
    if (dataSource === 'maturity') {
      redemption = { maturityEpochMs: ms, faceValueRub: face };
    }
  }
  if (amorts.length === 0) return { amorts: null, redemption };
  amorts.sort((a, b) => a.amortDateEpochMs - b.amortDateEpochMs);
  return { amorts, redemption };
}

async function main(): Promise<void> {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const projectRoot = join(scriptDir, '..');
  const metaDir = join(projectRoot, 'downloadStockData', 'output', 'meta');
  if (!existsSync(metaDir)) {
    throw new Error(`[gen:instrument-details] не найдена папка meta: ${metaDir}`);
  }

  const instrumentFiles = readdirSync(metaDir).filter((f) => f.endsWith('.instrument.txt'));

  const lotSizeBySymbol: Record<string, number> = {};
  const sharesOutstandingBySymbol: Record<string, number> = {};
  const instrumentMetaBySymbol: Record<string, InstrumentMeta> = {};
  const dividendsBySymbol: Record<string, DividendEntry[]> = {};
  const couponsBySymbol: Record<string, CouponEntry[]> = {};
  const amortizationsBySymbol: Record<string, AmortizationEntry[]> = {};
  const redemptionBySymbol: Record<string, RedemptionEntry> = {};

  for (const fname of instrumentFiles.sort()) {
    const fileSecid = fname
      .slice(0, fname.length - '.instrument.txt'.length)
      .toUpperCase();
    const map = parseInstrumentFile(readFileSync(join(metaDir, fname), 'utf-8'));
    const innerSecid = (map.get('SECID') ?? '').toUpperCase();
    const symbol = innerSecid || fileSecid;

    let lot = Number(map.get('LOTSIZE') ?? '');
    if (!Number.isFinite(lot) || lot <= 0) lot = 1;
    lotSizeBySymbol[symbol] = Math.floor(lot);

    const issueSizeRaw = map.get('ISSUESIZE');
    const issueSize = issueSizeRaw ? Number(issueSizeRaw) : NaN;
    if (Number.isFinite(issueSize) && issueSize > 0) {
      sharesOutstandingBySymbol[symbol] = Math.floor(issueSize);
    }

    const isBond = detectIsBond(map);
    const initialFaceRaw = map.get('INITIALFACEVALUE') ?? map.get('FACEVALUE');
    const initialFaceValueRub =
      initialFaceRaw && Number.isFinite(Number(initialFaceRaw))
        ? Number(initialFaceRaw)
        : null;
    const maturityRaw = map.get('MATDATE');
    const maturityEpochMs = maturityRaw ? moscowDateToEpochMs(maturityRaw) : null;
    instrumentMetaBySymbol[symbol] = {
      isBond,
      initialFaceValueRub,
      faceUnit: map.get('FACEUNIT') ?? null,
      maturityEpochMs,
      isin: map.get('ISIN') ?? null,
      groupRaw: map.get('GROUP') ?? null,
    };

    if (!isBond) {
      const divs = parseDividends(metaDir, symbol);
      if (divs) dividendsBySymbol[symbol] = divs;
    } else {
      const coupons = parseCoupons(metaDir, symbol);
      if (coupons) couponsBySymbol[symbol] = coupons;
      const { amorts, redemption } = parseCashflowsOther(metaDir, symbol);
      if (amorts) amortizationsBySymbol[symbol] = amorts;
      if (redemption) {
        redemptionBySymbol[symbol] = redemption;
      } else if (maturityEpochMs && initialFaceValueRub) {
        // Фолбэк: maturity отсутствует в cashflows-other.txt, но MATDATE есть в description.
        redemptionBySymbol[symbol] = {
          maturityEpochMs,
          faceValueRub: initialFaceValueRub,
        };
      }
    }
  }

  const firstTradeCount = applyFirstTradeEpochsFromCatalog(
    projectRoot,
    instrumentMetaBySymbol
  );

  const catalog: DetailsCatalog = {
    generatedAt: new Date().toISOString(),
    lotSizeBySymbol,
    sharesOutstandingBySymbol,
    instrumentMetaBySymbol,
    dividendsBySymbol,
    couponsBySymbol,
    amortizationsBySymbol,
    redemptionBySymbol,
  };

  const outDir = join(projectRoot, 'src', 'data', 'generated');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'marketInstrumentDetailsCatalog.json');
  writeFileSync(outPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf-8');

  console.log('[gen:instrument-details] готово:');
  console.log(`  инструментов c lotSize:      ${Object.keys(lotSizeBySymbol).length}`);
  console.log(
    `  c sharesOutstanding:         ${Object.keys(sharesOutstandingBySymbol).length}`
  );
  console.log(`  c дивидендами:               ${Object.keys(dividendsBySymbol).length}`);
  console.log(`  c купонами:                  ${Object.keys(couponsBySymbol).length}`);
  console.log(`  c амортизациями:             ${Object.keys(amortizationsBySymbol).length}`);
  console.log(`  c погашением:                ${Object.keys(redemptionBySymbol).length}`);
  console.log(`  c firstTradeEpochMs:         ${firstTradeCount}`);
  console.log(`  → ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
