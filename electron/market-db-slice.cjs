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

function loadSessionEndByDate(calendarPath) {
  const raw = JSON.parse(fs.readFileSync(calendarPath, 'utf-8'));
  const days = raw.days ?? [];
  const map = new Map();
  for (const d of days) {
    if (d.mskDateYyyymmdd) {
      map.set(d.mskDateYyyymmdd, d.sessionEndEpochMs);
    }
  }
  return map;
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
      byWeek.set(key, { t: b.t, c: b.c });
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
    if (!prevD || time >= prevD.maxTime) {
      dayTo.set(date, { close, maxTime: time });
    }

    const k5 = Math.floor(tBar / FIVE_MS) * FIVE_MS;
    b5.set(k5, { t: k5, c: close });

    const k30 = Math.floor(tBar / THIRTY_MS) * THIRTY_MS;
    b30.set(k30, { t: k30, c: close });

    const k1h = Math.floor(tBar / HOUR_MS) * HOUR_MS;
    b1h.set(k1h, { t: k1h, c: close });
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
      c: row.close,
    });
  }

  const mapToSorted = (m) => [...m.values()].sort((a, b) => a.t - b.t);

  return {
    minute: sortedMinutes.map((row) => ({ t: row.t, c: row.c })),
    dailyClose,
    fiveMinute: mapToSorted(b5),
    thirtyMinute: mapToSorted(b30),
    oneHour: mapToSorted(b1h),
    weekly: buildWeeklyFromDaily(dailyClose),
  };
}

function queryMinuteRows(db, upper, minTs, maxTs) {
  const sql = `SELECT ts_ms AS t, close AS c FROM minute_bars WHERE symbol = ? AND ts_ms >= ? AND ts_ms <= ? ORDER BY ts_ms ASC`;
  const stmt = db.prepare(sql);
  stmt.bind([upper, minTs, maxTs]);
  const rows = [];
  while (stmt.step()) {
    const o = stmt.getAsObject();
    rows.push({ t: Number(o.t), c: Number(o.c) });
  }
  stmt.free();
  return rows;
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

  const sessionEndByDate = loadSessionEndByDate(calPath);
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

  for (const sym of symbols) {
    const upper = String(sym).toUpperCase();
    const rows = queryMinuteRows(db, upper, minTs, maxTs);
    const agg = aggregateMinuteRows(rows, sessionEndByDate);
    minuteBySymbol[upper] = agg.minute;
    dailyCloseBySymbol[upper] = agg.dailyClose;
    fiveMinuteBySymbol[upper] = agg.fiveMinute;
    thirtyMinuteBySymbol[upper] = agg.thirtyMinute;
    oneHourBySymbol[upper] = agg.oneHour;
    weeklyBySymbol[upper] = agg.weekly;
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

module.exports = {
  buildSlicesPayload,
  resolveDbPath,
  resolveCalendarPath,
};
