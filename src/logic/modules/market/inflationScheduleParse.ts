export type InflationSchedule = {
  readonly momByYyyymm: Readonly<Record<string, number>>;
  readonly lastAvailableYyyymm: string;
};

const MONTH_NAME_TO_NUM: Readonly<Record<string, string>> = {
  январь: '01',
  февраль: '02',
  март: '03',
  апрель: '04',
  май: '05',
  июнь: '06',
  июль: '07',
  август: '08',
  сентябрь: '09',
  октябрь: '10',
  ноябрь: '11',
  декабрь: '12',
};

function parseMomIndex(raw: string): number | null {
  const cleaned = raw.trim().replace(/\)$/, '').replace(',', '.');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Парсит TSV `assets/инфляция.txt` (блок MoM, строки «январь»…«декабрь»). */
export function parseInflationScheduleText(text: string): InflationSchedule {
  const lines = text.split(/\r?\n/);
  if (lines.length < 3) {
    return { momByYyyymm: {}, lastAvailableYyyymm: '' };
  }

  const headerParts = lines[0]!.split('\t');
  const years: number[] = [];
  for (let col = 1; col < headerParts.length; col += 1) {
    const y = Number(headerParts[col]?.trim());
    if (Number.isFinite(y) && y >= 1900) {
      years.push(y);
    }
  }

  const momByYyyymm: Record<string, number> = {};
  let lastAvailableYyyymm = '';

  for (let row = 2; row < lines.length; row += 1) {
    const line = lines[row]!;
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const monthName = parts[0]?.trim().toLowerCase() ?? '';
    const monthNum = MONTH_NAME_TO_NUM[monthName];
    if (!monthNum) {
      break;
    }
    for (let col = 1; col < parts.length && col - 1 < years.length; col += 1) {
      const cell = parts[col]?.trim() ?? '';
      if (!cell) continue;
      const index = parseMomIndex(cell);
      if (index === null) continue;
      const yyyymm = `${years[col - 1]}${monthNum}`;
      momByYyyymm[yyyymm] = index;
      if (!lastAvailableYyyymm || yyyymm > lastAvailableYyyymm) {
        lastAvailableYyyymm = yyyymm;
      }
    }
  }

  return { momByYyyymm, lastAvailableYyyymm };
}
