'use strict';

/**
 * Чтение minute_bars из SQLite (через sql.js / WASM) и агрегация в ряды для MarketModule.
 * В Electron main не используется better-sqlite3 — иначе нужна пересборка под ABI Electron.
 * Дублирует алгоритм src/logic/modules/market/minuteBarAggregation.ts — при правках синхронизировать.
 */

const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const { formatInTimeZone, toDate } = require('date-fns-tz');
const { getISOWeek, getISOWeekYear } = require('date-fns');

const DAY_MS = 86_400_000;
const LOOKBACK_MS = 370 * DAY_MS;
const FIVE_MS = 5 * 60 * 1000;
const THIRTY_MS = 30 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_CACHE_MAX_ENTRIES = 480;
const PROBE_REPORT_MS = 2_000;

/** @type {Promise<any> | null} */
let sqlModulePromise = null;

function getSqlJs() {
  if (!sqlModulePromise) {
    sqlModulePromise = initSqlJs({
      locateFile: (file) =>
        path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', file),
    });
  }
  return sqlModulePromise;
}

/** Кэш открытой БД по пути (файл читается в память один раз). */
let cachedDbPath = null;
/** @type {any} */
let cachedDb = null;
/** @type {Map<string, any>} */
let dayBundleCache = new Map();
/** @type {{ days: any[], sessionEndByDate: Map<string, number> } | null} */
let cachedCalendar = null;
/** @type {{ open: boolean, high: boolean, low: boolean, volume: boolean } | null} */
let minuteBarsColumns = null;
let probe = {
  cacheHits: 0,
  cacheMisses: 0,
  evictions: 0,
  prefetchRequests: 0,
  prefetchTotalMs: 0,
  prefetchMaxMs: 0,
  lastReportAtMs: 0,
};

function reportProbeIfNeeded() {
  if (process.env.NODE_ENV !== 'development') {
    return;
  }
  const now = Date.now();
  if (now - probe.lastReportAtMs < PROBE_REPORT_MS) {
    return;
  }
  const avgPrefetchMs =
    probe.prefetchRequests > 0 ? probe.prefetchTotalMs / probe.prefetchRequests : 0;
  console.debug('[market-day-cache-probe]', {
    cacheHits: probe.cacheHits,
    cacheMisses: probe.cacheMisses,
    evictions: probe.evictions,
    prefetchRequests: probe.prefetchRequests,
    avgPrefetchMs: Number(avgPrefetchMs.toFixed(2)),
    maxPrefetchMs: Number(probe.prefetchMaxMs.toFixed(2)),
    cacheEntries: dayBundleCache.size,
  });
  probe.lastReportAtMs = now;
}

async function getDatabase(dbPath) {
  if (cachedDbPath === dbPath && cachedDb) {
    return cachedDb;
  }
  if (cachedDb) {
    cachedDb.close();
    cachedDb = null;
    cachedDbPath = null;
  }
  const SQL = await getSqlJs();
  const buf = fs.readFileSync(dbPath);
  cachedDb = new SQL.Database(buf);
  cachedDbPath = dbPath;
  dayBundleCache = new Map();
  minuteBarsColumns = null;
  probe = {
    cacheHits: 0,
    cacheMisses: 0,
    evictions: 0,
    prefetchRequests: 0,
    prefetchTotalMs: 0,
    prefetchMaxMs: 0,
    lastReportAtMs: 0,
  };
  return cachedDb;
}

function resolveProjectRoot() {
  return path.join(__dirname, '..');
}

function resolveDbPath() {
  if (process.env.MARKET_SQLITE_PATH) {
    return process.env.MARKET_SQLITE_PATH;
  }
  if (process.resourcesPath) {
    const packaged = path.join(process.resourcesPath, 'market.sqlite');
    if (fs.existsSync(packaged)) {
      return packaged;
    }
  }
  return path.join(resolveProjectRoot(), 'data', 'market.sqlite');
}

function resolveCalendarPath() {
  if (process.env.MARKET_CALENDAR_JSON) {
    return process.env.MARKET_CALENDAR_JSON;
  }
  if (process.resourcesPath) {
    const packaged = path.join(process.resourcesPath, 'tradingCalendar.json');
    if (fs.existsSync(packaged)) {
      return packaged;
    }
  }
  return path.join(resolveProjectRoot(), 'data', 'tradingCalendar.json');
}

function loadCalendar(calendarPath) {
  if (cachedCalendar) {
    return cachedCalendar;
  }
  const raw = JSON.parse(fs.readFileSync(calendarPath, 'utf-8'));
  const days = raw.days ?? [];
  const map = new Map();
  const normalizedDays = [];
  for (const d of days) {
    if (d.mskDateYyyymmdd) {
      map.set(d.mskDateYyyymmdd, d.sessionEndEpochMs);
      normalizedDays.push({
        mskDateYyyymmdd: d.mskDateYyyymmdd,
        sessionStartEpochMs: Number(d.sessionStartEpochMs ?? d.sessionEndEpochMs - DAY_MS),
        sessionEndEpochMs: Number(d.sessionEndEpochMs),
      });
    }
  }
  cachedCalendar = { days: normalizedDays, sessionEndByDate: map };
  return cachedCalendar;
}

function sessionEndEpochForDate(sessionEndByDate, mskYyyymmdd) {
  const fromCal = sessionEndByDate.get(mskYyyymmdd);
  if (fromCal !== undefined) {
    return fromCal;
  }
  const y = mskYyyymmdd.slice(0, 4);
  const m = mskYyyymmdd.slice(4, 6);
  const d = mskYyyymmdd.slice(6, 8);
  const local = `${y}-${m}-${d} 18:45:00`;
  return toDate(local, { timeZone: 'Europe/Moscow' }).getTime();
}

function mskYyyymmddFromEpochMs(epochMs) {
  return formatInTimeZone(epochMs, 'Europe/Moscow', 'yyyyMMdd');
}

function dayCacheKey(symbol, mskDateYyyymmdd) {
  return `${symbol}|${mskDateYyyymmdd}`;
}

function rememberDayBundle(key, value) {
  dayBundleCache.delete(key);
  dayBundleCache.set(key, value);
  while (dayBundleCache.size > DAY_CACHE_MAX_ENTRIES) {
    const first = dayBundleCache.keys().next().value;
    if (first === undefined) {
      break;
    }
    dayBundleCache.delete(first);
    probe.evictions += 1;
  }
}

function tradingDaysInRange(days, minTs, maxTs) {
  const out = [];
  for (const d of days) {
    if (d.sessionEndEpochMs < minTs) {
      continue;
    }
    if (d.sessionStartEpochMs > maxTs) {
      break;
    }
    out.push(d);
  }
  return out;
}

function buildWeeklyFromDaily(dailies) {
  if (dailies.length === 0) {
    return [];
  }
  const byWeek = new Map();
  for (const b of dailies) {
    const dt = new Date(b.t);
    const key = `${getISOWeekYear(dt)}-W${String(getISOWeek(dt)).padStart(2, '0')}`;
    const prev = byWeek.get(key);
    if (!prev || b.t >= prev.t) {
      byWeek.set(key, { ...b });
    }
  }
  return [...byWeek.values()].sort((a, b) => a.t - b.t);
}

function aggregateMinuteRows(sortedMinutes, sessionEndByDate) {
  const dayTo = new Map();
  const b5 = new Map();
  const b30 = new Map();
  const b1h = new Map();

  for (const row of sortedMinutes) {
    const tBar = row.t;
    const close = row.c;
    const date = mskYyyymmddFromEpochMs(tBar);
    const time = formatInTimeZone(tBar, 'Europe/Moscow', 'HHmmss');

    const prevD = dayTo.get(date);
    if (!prevD) {
      dayTo.set(date, {
        open: row.o,
        high: row.h,
        low: row.l,
        close: row.c,
        volume: row.v,
        maxTime: time,
        startTime: time,
      });
    } else {
      dayTo.set(date, {
        open: time < prevD.startTime ? row.o : prevD.open,
        high: Math.max(prevD.high, row.h),
        low: Math.min(prevD.low, row.l),
        close: time >= prevD.maxTime ? row.c : prevD.close,
        volume: prevD.volume + row.v,
        maxTime: time >= prevD.maxTime ? time : prevD.maxTime,
        startTime: time < prevD.startTime ? time : prevD.startTime,
      });
    }

    const k5 = Math.floor(tBar / FIVE_MS) * FIVE_MS;
    const prev5 = b5.get(k5);
    b5.set(
      k5,
      prev5
        ? {
            t: k5,
            o: prev5.o,
            h: Math.max(prev5.h, row.h),
            l: Math.min(prev5.l, row.l),
            c: row.c,
            v: prev5.v + row.v,
          }
        : { t: k5, o: row.o, h: row.h, l: row.l, c: close, v: row.v }
    );

    const k30 = Math.floor(tBar / THIRTY_MS) * THIRTY_MS;
    const prev30 = b30.get(k30);
    b30.set(
      k30,
      prev30
        ? {
            t: k30,
            o: prev30.o,
            h: Math.max(prev30.h, row.h),
            l: Math.min(prev30.l, row.l),
            c: row.c,
            v: prev30.v + row.v,
          }
        : { t: k30, o: row.o, h: row.h, l: row.l, c: close, v: row.v }
    );

    const k1h = Math.floor(tBar / HOUR_MS) * HOUR_MS;
    const prev1h = b1h.get(k1h);
    b1h.set(
      k1h,
      prev1h
        ? {
            t: k1h,
            o: prev1h.o,
            h: Math.max(prev1h.h, row.h),
            l: Math.min(prev1h.l, row.l),
            c: row.c,
            v: prev1h.v + row.v,
          }
        : { t: k1h, o: row.o, h: row.h, l: row.l, c: close, v: row.v }
    );
  }

  const dates = [...dayTo.keys()].sort();
  const dailyClose = [];
  for (const date of dates) {
    const row = dayTo.get(date);
    if (!row) {
      continue;
    }
    dailyClose.push({
      t: sessionEndEpochForDate(sessionEndByDate, date),
      o: row.open,
      h: row.high,
      l: row.low,
      c: row.close,
      v: row.volume,
    });
  }

  const mapToSorted = (m) => [...m.values()].sort((a, b) => a.t - b.t);

  return {
    minute: sortedMinutes.map((row) => ({ ...row })),
    dailyClose,
    fiveMinute: mapToSorted(b5),
    thirtyMinute: mapToSorted(b30),
    oneHour: mapToSorted(b1h),
    weekly: buildWeeklyFromDaily(dailyClose),
  };
}

function hasColumn(db, tableName, columnName) {
  const sql = `PRAGMA table_info(${tableName})`;
  const stmt = db.prepare(sql);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows.some((row) => String(row.name).toLowerCase() === columnName.toLowerCase());
}

function queryMinuteRows(db, upper, minTs, maxTs) {
  if (!minuteBarsColumns) {
    minuteBarsColumns = {
      open: hasColumn(db, 'minute_bars', 'open'),
      high: hasColumn(db, 'minute_bars', 'high'),
      low: hasColumn(db, 'minute_bars', 'low'),
      volume: hasColumn(db, 'minute_bars', 'volume'),
    };
  }
  const hasOpen = minuteBarsColumns.open;
  const hasHigh = minuteBarsColumns.high;
  const hasLow = minuteBarsColumns.low;
  const hasVolume = minuteBarsColumns.volume;
  const sql = `
    SELECT
      ts_ms AS t,
      ${hasOpen ? 'open' : 'close'} AS o,
      ${hasHigh ? 'high' : 'close'} AS h,
      ${hasLow ? 'low' : 'close'} AS l,
      close AS c,
      ${hasVolume ? 'volume' : '0'} AS v
    FROM minute_bars
    WHERE symbol = ? AND ts_ms >= ? AND ts_ms <= ?
    ORDER BY ts_ms ASC
  `;
  const stmt = db.prepare(sql);
  stmt.bind([upper, minTs, maxTs]);
  const rows = [];
  while (stmt.step()) {
    const o = stmt.getAsObject();
    rows.push({
      t: Number(o.t),
      o: Number(o.o),
      h: Number(o.h),
      l: Number(o.l),
      c: Number(o.c),
      v: Number(o.v),
    });
  }
  stmt.free();
  return rows;
}

function cloneBars(bars) {
  return bars.map((b) => ({ ...b }));
}

function emptyBundle() {
  return {
    minute: [],
    dailyClose: [],
    fiveMinute: [],
    thirtyMinute: [],
    oneHour: [],
    weekly: [],
  };
}

function mergeDayBundles(dayBundles) {
  if (dayBundles.length === 0) {
    return emptyBundle();
  }
  const merged = emptyBundle();
  for (const d of dayBundles) {
    merged.minute.push(...d.minute);
    merged.dailyClose.push(...d.dailyClose);
    merged.fiveMinute.push(...d.fiveMinute);
    merged.thirtyMinute.push(...d.thirtyMinute);
    merged.oneHour.push(...d.oneHour);
  }
  merged.weekly = buildWeeklyFromDaily(merged.dailyClose);
  return merged;
}

function getDayByEpoch(days, epochMs) {
  for (const d of days) {
    if (epochMs >= d.sessionStartEpochMs && epochMs <= d.sessionEndEpochMs) {
      return d;
    }
  }
  return null;
}

function getNextDay(days, epochMs) {
  for (const d of days) {
    if (d.sessionStartEpochMs > epochMs) {
      return d;
    }
  }
  return null;
}

function getDayByMskDate(days, mskDateYyyymmdd) {
  for (const d of days) {
    if (d.mskDateYyyymmdd === mskDateYyyymmdd) {
      return d;
    }
  }
  return null;
}

function loadDayBundle(db, symbol, day, sessionEndByDate) {
  const key = dayCacheKey(symbol, day.mskDateYyyymmdd);
  const cached = dayBundleCache.get(key);
  if (cached) {
    probe.cacheHits += 1;
    rememberDayBundle(key, cached);
    return cached;
  }
  probe.cacheMisses += 1;
  const rows = queryMinuteRows(db, symbol, day.sessionStartEpochMs, day.sessionEndEpochMs);
  const bundle = aggregateMinuteRows(rows, sessionEndByDate);
  rememberDayBundle(key, bundle);
  return bundle;
}

function filterBundleToRange(bundle, minTs, maxTs) {
  const inRange = (bars) => bars.filter((b) => b.t >= minTs && b.t <= maxTs);
  const out = {
    minute: inRange(bundle.minute),
    dailyClose: inRange(bundle.dailyClose),
    fiveMinute: inRange(bundle.fiveMinute),
    thirtyMinute: inRange(bundle.thirtyMinute),
    oneHour: inRange(bundle.oneHour),
    weekly: inRange(bundle.weekly),
  };
  out.weekly = buildWeeklyFromDaily(out.dailyClose);
  return out;
}

/**
 * @param {{ epochMs: number, symbols: string[], fromEpochMs?: number }} params
 */
async function buildSlicesPayload(params) {
  const { epochMs, symbols } = params;
  const fromEpochMs = Number(params.fromEpochMs);
  const dbPath = resolveDbPath();
  const calPath = resolveCalendarPath();

  if (!fs.existsSync(dbPath)) {
    return { ok: false, error: 'db_missing', path: dbPath };
  }
  if (!fs.existsSync(calPath)) {
    return { ok: false, error: 'calendar_missing', path: calPath };
  }

  const { days, sessionEndByDate } = loadCalendar(calPath);
  const db = await getDatabase(dbPath);

  const minTs = Number.isFinite(fromEpochMs)
    ? Math.max(fromEpochMs + 1, epochMs - LOOKBACK_MS)
    : epochMs - LOOKBACK_MS;
  const maxTs = epochMs;

  const dailyCloseBySymbol = {};
  const minuteBySymbol = {};
  const fiveMinuteBySymbol = {};
  const thirtyMinuteBySymbol = {};
  const oneHourBySymbol = {};
  const weeklyBySymbol = {};

  const daysInRange = tradingDaysInRange(days, minTs, maxTs);

  for (const sym of symbols) {
    const upper = String(sym).toUpperCase();
    const bundles = [];
    for (const day of daysInRange) {
      bundles.push(loadDayBundle(db, upper, day, sessionEndByDate));
    }
    const agg = filterBundleToRange(mergeDayBundles(bundles), minTs, maxTs);
    minuteBySymbol[upper] = cloneBars(agg.minute);
    dailyCloseBySymbol[upper] = cloneBars(agg.dailyClose);
    fiveMinuteBySymbol[upper] = cloneBars(agg.fiveMinute);
    thirtyMinuteBySymbol[upper] = cloneBars(agg.thirtyMinute);
    oneHourBySymbol[upper] = cloneBars(agg.oneHour);
    weeklyBySymbol[upper] = cloneBars(agg.weekly);
  }

  return {
    ok: true,
    minuteBySymbol,
    dailyCloseBySymbol,
    fiveMinuteBySymbol,
    thirtyMinuteBySymbol,
    oneHourBySymbol,
    weeklyBySymbol,
  };
}

/**
 * Прогреть day-cache для следующего торгового дня по символам.
 * Возвращает ok=true даже если следующего дня нет (конец календаря).
 * @param {{ epochMs: number, symbols: string[] }} params
 */
async function prefetchNextDayPayload(params) {
  const epochMs = Number(params?.epochMs);
  const symbols = Array.isArray(params?.symbols) ? params.symbols : [];
  if (!Number.isFinite(epochMs) || symbols.length === 0) {
    return { ok: false, error: 'invalid_payload' };
  }
  const dbPath = resolveDbPath();
  const calPath = resolveCalendarPath();
  if (!fs.existsSync(dbPath)) {
    return { ok: false, error: 'db_missing', path: dbPath };
  }
  if (!fs.existsSync(calPath)) {
    return { ok: false, error: 'calendar_missing', path: calPath };
  }
  const { days, sessionEndByDate } = loadCalendar(calPath);
  const db = await getDatabase(dbPath);
  const currentDay = getDayByEpoch(days, epochMs);
  const nextDay = currentDay
    ? getNextDay(days, currentDay.sessionEndEpochMs)
    : getNextDay(days, epochMs);
  if (!nextDay) {
    return { ok: true, prefetched: false };
  }
  const startedAt = performance.now();
  for (const sym of symbols) {
    const upper = String(sym).toUpperCase();
    loadDayBundle(db, upper, nextDay, sessionEndByDate);
  }
  const elapsed = performance.now() - startedAt;
  probe.prefetchRequests += 1;
  probe.prefetchTotalMs += elapsed;
  probe.prefetchMaxMs = Math.max(probe.prefetchMaxMs, elapsed);
  reportProbeIfNeeded();
  return { ok: true, prefetched: true, mskDateYyyymmdd: nextDay.mskDateYyyymmdd };
}

/**
 * Прогреть day-cache для конкретного торгового дня по символам.
 * @param {{ mskDateYyyymmdd: string, symbols: string[] }} params
 */
async function prefetchDayPayload(params) {
  const mskDateYyyymmdd = String(params?.mskDateYyyymmdd ?? '');
  const symbols = Array.isArray(params?.symbols) ? params.symbols : [];
  if (!/^\d{8}$/.test(mskDateYyyymmdd) || symbols.length === 0) {
    return { ok: false, error: 'invalid_payload' };
  }
  const dbPath = resolveDbPath();
  const calPath = resolveCalendarPath();
  if (!fs.existsSync(dbPath)) {
    return { ok: false, error: 'db_missing', path: dbPath };
  }
  if (!fs.existsSync(calPath)) {
    return { ok: false, error: 'calendar_missing', path: calPath };
  }
  const { days, sessionEndByDate } = loadCalendar(calPath);
  const day = getDayByMskDate(days, mskDateYyyymmdd);
  if (!day) {
    return { ok: true, prefetched: false, mskDateYyyymmdd };
  }
  const db = await getDatabase(dbPath);
  const startedAt = performance.now();
  for (const sym of symbols) {
    const upper = String(sym).toUpperCase();
    loadDayBundle(db, upper, day, sessionEndByDate);
  }
  const elapsed = performance.now() - startedAt;
  probe.prefetchRequests += 1;
  probe.prefetchTotalMs += elapsed;
  probe.prefetchMaxMs = Math.max(probe.prefetchMaxMs, elapsed);
  reportProbeIfNeeded();
  return { ok: true, prefetched: true, mskDateYyyymmdd };
}

module.exports = {
  buildSlicesPayload,
  prefetchNextDayPayload,
  prefetchDayPayload,
  resolveDbPath,
  resolveCalendarPath,
};
