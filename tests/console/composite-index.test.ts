import { LogicManager } from '../../src/logic/managers/LogicManager';
import {
  buildConstituentsFromPrices,
  COMPOSITE_INDEX_INITIAL_LEVEL,
  computeCapTotalRub,
  computeIndexLevelFromCaps,
  FIREIDX_SYMBOL,
  updateCompositeIndex,
} from '../../src/logic/modules/market/compositeIndex';
import {
  advanceFireidxMinuteBar,
  applyFireidxBundlesToChartSeries,
  rebuildFireidxSeriesFromConstituents,
} from '../../src/logic/modules/market/fireidxSeries';
import { emptyChartSeriesBundle } from '../../src/logic/modules/market/chartWindows';
import {
  applyChartSeriesBundleToMarket,
  createMarketModuleState,
} from '../../src/logic/modules/market/state';
import type { MarketPriceBar } from '../../src/logic/modules/market/priceSeries';
import { CHART_WEEK_5M_BAR_COUNT, CHART_MONTH_30M_BAR_COUNT } from '../../src/logic/modules/market/chartTimeframes';
import { applyMarketQuotesForSimulationEpoch } from '../../src/logic/modules/market/quoteApply';
import { exitCode, printResult } from './runner';

const M = 'IDX';
let failures = 0;
let testNum = 0;

function run(description: string, fn: () => void): void {
  testNum++;
  try {
    fn();
    printResult(M, testNum, description, true);
  } catch (e) {
    failures++;
    printResult(M, testNum, description, false, e instanceof Error ? e.message : String(e));
  }
}

function minuteBar(t: number, c: number): MarketPriceBar {
  return { t, o: c, h: c, l: c, c, v: 100 };
}

run('FIREIDX присутствует в каталоге и имеет уровень', () => {
  const lm = new LogicManager();
  const state = lm.getState();
  const item = state.market.instrumentCatalog.find(
    (i) => i.symbol === FIREIDX_SYMBOL
  );
  if (!item) throw new Error('FIREIDX нет в каталоге');
  if (item.assetKind !== 'fund') {
    throw new Error(`FIREIDX должен быть fund, получили ${item.assetKind}`);
  }
  const asset = state.market.assetsBySymbol[FIREIDX_SYMBOL];
  if (!asset || (asset.currentPriceRub ?? 0) <= 0) {
    throw new Error('нет уровня FIREIDX');
  }
  if (asset.assetKind !== 'fund') {
    throw new Error('FIREIDX assetKind не fund');
  }
  const minute = state.market.chartSeries.minute[FIREIDX_SYMBOL] ?? [];
  if (minute.length > 0) {
    const chart1d = asset.chartLineByTimeframe['1d'] ?? [];
    if (chart1d.length < 1) {
      throw new Error('есть минутки FIREIDX, но нет линии 1d');
    }
    for (const tf of ['1w', '1m', '6m', '1y'] as const) {
      const line = asset.chartLineByTimeframe[tf] ?? [];
      if (line.length < 1) {
        throw new Error(`нет линии графика FIREIDX ${tf}`);
      }
    }
  }
  if (state.market.compositeIndex.constituents.length < 1) {
    throw new Error('нет компонентов индекса');
  }
});

run('веса компонентов суммируются ~100%', () => {
  const lm = new LogicManager();
  const sum = lm
    .getState()
    .market.compositeIndex.constituents.reduce((s, c) => s + c.weightPct, 0);
  if (Math.abs(sum - 100) > 0.5) {
    throw new Error(`сумма весов ${sum}%`);
  }
});

run('SBER ~100% веса при одной акции в каталоге (изолированный стейт)', () => {
  const t0 = 1_717_198_800_000;
  const items = [
    {
      assetKind: 'stock' as const,
      ticker: 'SBER',
      symbol: 'SBER',
      displayName: 'SBER',
      isin: 'RU0009029540',
      sourceFilePath: '',
    },
    {
      assetKind: 'fund' as const,
      ticker: FIREIDX_SYMBOL,
      symbol: FIREIDX_SYMBOL,
      displayName: 'FIREIDX',
      isin: 'FIREIDX-SYNTH',
      sourceFilePath: '',
    },
  ];
  const market = createMarketModuleState(items, {
    minute: { SBER: [minuteBar(t0, 300)] },
    dailyClose: { SBER: [minuteBar(t0, 300)] },
  });
  applyMarketQuotesForSimulationEpoch(market, t0, null, { excludeSymbols: [FIREIDX_SYMBOL] });
  const idx = updateCompositeIndex(
    market.compositeIndex,
    market.instrumentCatalog,
    market.assetsBySymbol,
    market.details,
    t0,
    null
  );
  const sber = idx.constituents.find((c) => c.symbol === 'SBER');
  if (!sber || Math.abs(sber.weightPct - 100) > 0.5) {
    throw new Error(`ожидали SBER ~100%, получили ${sber?.weightPct ?? 'нет'}`);
  }
});

run('уровень FIREIDX следует за ценой единственной акции (не залипает на 1000)', () => {
  const t0 = 1_717_198_800_000;
  const items = [
    {
      assetKind: 'stock' as const,
      ticker: 'SBER',
      symbol: 'SBER',
      displayName: 'SBER',
      isin: 'RU0009029540',
      sourceFilePath: '',
    },
    {
      assetKind: 'fund' as const,
      ticker: FIREIDX_SYMBOL,
      symbol: FIREIDX_SYMBOL,
      displayName: 'FIREIDX',
      isin: 'FIREIDX-SYNTH',
      sourceFilePath: '',
    },
  ];
  const market = createMarketModuleState(items, {
    minute: { SBER: [minuteBar(t0, 300)] },
    dailyClose: { SBER: [minuteBar(t0, 300)] },
  });
  applyMarketQuotesForSimulationEpoch(market, t0, null, { excludeSymbols: [FIREIDX_SYMBOL] });
  const idx0 = updateCompositeIndex(
    market.compositeIndex,
    market.instrumentCatalog,
    market.assetsBySymbol,
    market.details,
    t0,
    null
  );
  const level0 = idx0.level;
  const sber = market.assetsBySymbol.SBER!;
  const bumped = sber.currentPriceRub! * 1.1;
  const assetsUpdated = {
    ...market.assetsBySymbol,
    SBER: { ...sber, currentPriceRub: bumped },
  };
  const idx1 = updateCompositeIndex(
    idx0,
    market.instrumentCatalog,
    assetsUpdated,
    market.details,
    t0 + 60_000,
    null
  );
  const expected = level0 * (bumped / sber.currentPriceRub!);
  if (Math.abs(idx1.level - expected) > 0.5) {
    throw new Error(
      `ожидали ~${expected.toFixed(2)}, получили ${idx1.level} (было ${level0})`
    );
  }
  if (Math.abs(idx1.level - level0) < 0.01) {
    throw new Error('уровень не изменился при +10% SBER');
  }
});

run('90/10: +10% у миноритария → индекс +~1%', () => {
  const details = {
    sharesOutstandingBySymbol: { AAA: 90, BBB: 10 },
    lotSizeBySymbol: {},
    instrumentMetaBySymbol: {},
    dividendsBySymbol: {},
    couponsBySymbol: {},
    amortizationsBySymbol: {},
  };
  const prices = { AAA: 100, BBB: 100 };
  const constituents = buildConstituentsFromPrices(['AAA', 'BBB'], prices, details);
  const capBase = computeCapTotalRub(constituents, prices);
  const level0 = COMPOSITE_INDEX_INITIAL_LEVEL;
  const bumped = { AAA: 100, BBB: 110 };
  const capNow = computeCapTotalRub(constituents, bumped);
  const level1 = computeIndexLevelFromCaps(level0, capNow, capBase);
  const expected = level0 * 1.01;
  if (Math.abs(level1 - expected) > 0.15) {
    throw new Error(`ожидали ~${expected}, получили ${level1}`);
  }
});

run('cap ×1.5: рост капитализации на 50% → уровень ×1.5', () => {
  const details = {
    sharesOutstandingBySymbol: { AAA: 1, BBB: 1 },
    lotSizeBySymbol: {},
    instrumentMetaBySymbol: {},
    dividendsBySymbol: {},
    couponsBySymbol: {},
    amortizationsBySymbol: {},
  };
  const prices = { AAA: 200, BBB: 100 };
  const constituents = buildConstituentsFromPrices(['AAA', 'BBB'], prices, details);
  const capBase = computeCapTotalRub(constituents, prices);
  const level0 = COMPOSITE_INDEX_INITIAL_LEVEL;
  const grown = { AAA: 300, BBB: 150 };
  const capNow = computeCapTotalRub(constituents, grown);
  const level1 = computeIndexLevelFromCaps(level0, capNow, capBase);
  if (Math.abs(level1 - level0 * 1.5) > 0.2) {
    throw new Error(`ожидали ${level0 * 1.5}, получили ${level1}`);
  }
});

run('replay: минутная история и агрегаты FIREIDX из SBER', () => {
  const items = [
    {
      assetKind: 'stock' as const,
      ticker: 'SBER',
      symbol: 'SBER',
      displayName: 'SBER',
      isin: 'T',
      sourceFilePath: '',
    },
    {
      assetKind: 'fund' as const,
      ticker: FIREIDX_SYMBOL,
      symbol: FIREIDX_SYMBOL,
      displayName: 'FIREIDX',
      isin: 'F',
      sourceFilePath: '',
    },
  ];
  const t0 = 1_717_198_800_000;
  const t1 = t0 + 86_400_000;
  const t2 = t1 + 86_400_000;
  const market = createMarketModuleState(items, {
    minute: {
      SBER: [
        minuteBar(t0, 100),
        minuteBar(t0 + 3_600_000, 110),
        minuteBar(t2, 121),
      ],
    },
    dailyClose: {
      SBER: [minuteBar(t0, 100), minuteBar(t1, 110), minuteBar(t2, 121)],
    },
    oneHour: {
      SBER: [
        minuteBar(t0, 100),
        minuteBar(t0 + 3_600_000, 110),
        minuteBar(t2, 121),
      ],
    },
  });
  const rebuilt = rebuildFireidxSeriesFromConstituents({
    catalog: market.instrumentCatalog,
    chartSeries: market.chartSeries,
    details: market.details,
    simulationEpochMs: t2,
    calendar: null,
  });
  if (rebuilt.minuteBars.length < 2) {
    throw new Error('ожидали минутную историю FIREIDX');
  }
  if (rebuilt.dailyBars.length < 2) {
    throw new Error('ожидали дневной ряд FIREIDX из dailyClose акций');
  }
  if (Math.abs(rebuilt.compositeIndex.level - 1210) > 5) {
    throw new Error(`ожидали ~1210, получили ${rebuilt.compositeIndex.level}`);
  }
  applyFireidxBundlesToChartSeries(market.chartSeries, rebuilt, null);
  if ((market.chartSeries.fiveMinute[FIREIDX_SYMBOL] ?? []).length < 1) {
    throw new Error('нет 5m агрегата FIREIDX');
  }
  if ((market.chartSeries.dailyClose[FIREIDX_SYMBOL] ?? []).length < 2) {
    throw new Error('ожидали >=2 дневных свечей FIREIDX');
  }
  if ((market.chartSeries.oneHour[FIREIDX_SYMBOL] ?? []).length < 1) {
    throw new Error('нет hourly агрегата FIREIDX');
  }
  applyMarketQuotesForSimulationEpoch(market, t2, null);
  const fireAsset = market.assetsBySymbol[FIREIDX_SYMBOL];
  for (const tf of ['1d', '1w', '1m', '6m'] as const) {
    if ((fireAsset.chartLineByTimeframe[tf] ?? []).length < 1) {
      throw new Error(`пустой chartLine ${tf} после quoteApply`);
    }
  }
});

run('hydrate merge: compositeIndex не сбрасывается в пустой', () => {
  const items = [
    {
      assetKind: 'stock' as const,
      ticker: 'SBER',
      symbol: 'SBER',
      displayName: 'SBER',
      isin: 'T',
      sourceFilePath: '',
    },
  ];
  const market = createMarketModuleState(items, {
    minute: { SBER: [minuteBar(1_000_000, 100), minuteBar(1_060_000, 110)] },
  });
  const rebuilt = rebuildFireidxSeriesFromConstituents({
    catalog: market.instrumentCatalog,
    chartSeries: market.chartSeries,
    details: market.details,
    simulationEpochMs: 1_060_000,
    calendar: null,
  });
  market.compositeIndex = rebuilt.compositeIndex;
  const levelBefore = market.compositeIndex.level;
  if (Math.abs(levelBefore - 1100) > 1) {
    throw new Error(`неожиданный уровень до merge: ${levelBefore}`);
  }
  const bundle = emptyChartSeriesBundle();
  bundle.minute = {
    ...market.chartSeries.minute,
    SBER: [...(market.chartSeries.minute.SBER ?? []), minuteBar(1_120_000, 121)],
  };
  applyChartSeriesBundleToMarket(market, bundle);
  if (Object.keys(market.compositeIndex.weightsBySymbol).length === 0) {
    throw new Error('compositeIndex обнулился после merge chartSeries');
  }
  if (Math.abs(market.compositeIndex.level - levelBefore) > 0.01) {
    throw new Error('уровень не должен сбрасываться при merge без пересчёта');
  }
});

run('applyFireidx: пустой rebuild не затирает дневной ряд FIREIDX', () => {
  const items = [
    {
      assetKind: 'stock' as const,
      ticker: 'SBER',
      symbol: 'SBER',
      displayName: 'SBER',
      isin: 'T',
      sourceFilePath: '',
    },
    {
      assetKind: 'fund' as const,
      ticker: FIREIDX_SYMBOL,
      symbol: FIREIDX_SYMBOL,
      displayName: 'FIREIDX',
      isin: 'F',
      sourceFilePath: '',
    },
  ];
  const t0 = 1_717_198_800_000;
  const t1 = t0 + 86_400_000;
  const market = createMarketModuleState(items, {
    minute: { SBER: [minuteBar(t0, 100), minuteBar(t1, 110)] },
    dailyClose: {
      SBER: [minuteBar(t0, 100), minuteBar(t1, 110)],
    },
  });
  const rebuilt = rebuildFireidxSeriesFromConstituents({
    catalog: market.instrumentCatalog,
    chartSeries: market.chartSeries,
    details: market.details,
    simulationEpochMs: t1,
    calendar: null,
  });
  applyFireidxBundlesToChartSeries(market.chartSeries, rebuilt, null);
  const dailyLen = (market.chartSeries.dailyClose[FIREIDX_SYMBOL] ?? []).length;
  if (dailyLen < 2) {
    throw new Error(`ожидали >=2 дневных баров FIREIDX, получили ${dailyLen}`);
  }
  applyFireidxBundlesToChartSeries(
    market.chartSeries,
    {
      minuteBars: [],
      dailyBars: [],
      hourlyBars: [],
      fiveMinuteBars: [],
      thirtyMinuteBars: [],
    },
    null
  );
  const afterLen = (market.chartSeries.dailyClose[FIREIDX_SYMBOL] ?? []).length;
  if (afterLen < 2) {
    throw new Error(`дневной ряд FIREIDX затёрся: ${afterLen}`);
  }
});

run('FIREIDX 5m/30m: replay из длинных рядов акций (не только из minute window)', () => {
  const items = [
    {
      assetKind: 'stock' as const,
      ticker: 'SBER',
      symbol: 'SBER',
      displayName: 'SBER',
      isin: 'T',
      sourceFilePath: '',
    },
    {
      assetKind: 'fund' as const,
      ticker: FIREIDX_SYMBOL,
      symbol: FIREIDX_SYMBOL,
      displayName: 'FIREIDX',
      isin: 'F',
      sourceFilePath: '',
    },
  ];
  const t0 = 1_717_198_800_000;
  const fiveSber: MarketPriceBar[] = [];
  const thirtySber: MarketPriceBar[] = [];
  const sessions = 8;
  const barsPerSession = 110;
  for (let s = 0; s < sessions; s += 1) {
    const sessionStart = t0 + s * 86_400_000;
    for (let i = 0; i < barsPerSession; i += 1) {
      const t5 = sessionStart + i * 5 * 60_000;
      fiveSber.push(minuteBar(t5, 100 + s * 2 + i * 0.01));
      if (i % 6 === 0) {
        const t30 = sessionStart + i * 5 * 60_000;
        thirtySber.push(minuteBar(t30, 100 + s * 2 + i * 0.02));
      }
    }
  }
  const epoch = t0 + (sessions - 1) * 86_400_000 + (barsPerSession - 1) * 5 * 60_000;
  const market = createMarketModuleState(items, {
    fiveMinute: { SBER: fiveSber },
    thirtyMinute: { SBER: thirtySber },
    dailyClose: {
      SBER: [minuteBar(t0, 100), minuteBar(t0 + 86_400_000, 110)],
    },
    minute: { SBER: fiveSber.slice(-120) },
  });
  const rebuilt = rebuildFireidxSeriesFromConstituents({
    catalog: market.instrumentCatalog,
    chartSeries: market.chartSeries,
    details: market.details,
    simulationEpochMs: epoch,
    calendar: null,
  });
  applyFireidxBundlesToChartSeries(market.chartSeries, rebuilt, null);
  const fiveLen = (market.chartSeries.fiveMinute[FIREIDX_SYMBOL] ?? []).length;
  const thirtyLen = (market.chartSeries.thirtyMinute[FIREIDX_SYMBOL] ?? []).length;
  if (fiveLen < CHART_WEEK_5M_BAR_COUNT * 0.8) {
    throw new Error(
      `5m FIREIDX слишком короткий для 1w: ${fiveLen}, нужно >= ${CHART_WEEK_5M_BAR_COUNT * 0.8}`
    );
  }
  if (thirtyLen < CHART_MONTH_30M_BAR_COUNT * 0.35) {
    throw new Error(
      `30m FIREIDX слишком короткий для 1m: ${thirtyLen}, нужно >= ${CHART_MONTH_30M_BAR_COUNT * 0.35}`
    );
  }
});

run('incremental FIREIDX: 5m/30m ряды не схлопываются до одной сессии', () => {
  const items = [
    {
      assetKind: 'stock' as const,
      ticker: 'SBER',
      symbol: 'SBER',
      displayName: 'SBER',
      isin: 'T',
      sourceFilePath: '',
    },
    {
      assetKind: 'fund' as const,
      ticker: FIREIDX_SYMBOL,
      symbol: FIREIDX_SYMBOL,
      displayName: 'FIREIDX',
      isin: 'F',
      sourceFilePath: '',
    },
  ];
  const t0 = 1_717_198_800_000;
  const minuteSber: MarketPriceBar[] = [];
  for (let i = 0; i < 600; i += 1) {
    minuteSber.push(minuteBar(t0 + i * 60_000, 100 + i * 0.01));
  }
  const market = createMarketModuleState(items, {
    minute: { SBER: minuteSber },
    dailyClose: {
      SBER: [minuteBar(t0, 100), minuteBar(t0 + 86_400_000, 110)],
    },
  });
  const boot = rebuildFireidxSeriesFromConstituents({
    catalog: market.instrumentCatalog,
    chartSeries: market.chartSeries,
    details: market.details,
    simulationEpochMs: t0 + 599 * 60_000,
    calendar: null,
  });
  applyFireidxBundlesToChartSeries(market.chartSeries, boot, null);
  market.compositeIndex = boot.compositeIndex;
  const fiveAfterBoot = (market.chartSeries.fiveMinute[FIREIDX_SYMBOL] ?? []).length;
  const thirtyAfterBoot = (market.chartSeries.thirtyMinute[FIREIDX_SYMBOL] ?? []).length;

  for (let i = 1; i <= 120; i += 1) {
    const epoch = t0 + (599 + i) * 60_000;
    applyMarketQuotesForSimulationEpoch(market, epoch, null, {
      excludeSymbols: [FIREIDX_SYMBOL],
    });
    market.compositeIndex = updateCompositeIndex(
      market.compositeIndex,
      market.instrumentCatalog,
      market.assetsBySymbol,
      market.details,
      epoch,
      null
    );
    advanceFireidxMinuteBar(
      market.chartSeries,
      market.instrumentCatalog,
      market.compositeIndex,
      epoch,
      null
    );
  }

  const fiveLen = (market.chartSeries.fiveMinute[FIREIDX_SYMBOL] ?? []).length;
  const thirtyLen = (market.chartSeries.thirtyMinute[FIREIDX_SYMBOL] ?? []).length;
  if (fiveLen < Math.min(fiveAfterBoot, CHART_WEEK_5M_BAR_COUNT * 0.5)) {
    throw new Error(
      `5m FIREIDX схлопнулся: boot=${fiveAfterBoot} now=${fiveLen}, нужно >= ${CHART_WEEK_5M_BAR_COUNT * 0.5}`
    );
  }
  if (thirtyLen < Math.min(thirtyAfterBoot, CHART_MONTH_30M_BAR_COUNT * 0.3)) {
    throw new Error(
      `30m FIREIDX схлопнулся: boot=${thirtyAfterBoot} now=${thirtyLen}, нужно >= ${CHART_MONTH_30M_BAR_COUNT * 0.3}`
    );
  }
});

run('60 incremental тиков = level и хвост minute как full rebuild', () => {
  const items = [
    {
      assetKind: 'stock' as const,
      ticker: 'SBER',
      symbol: 'SBER',
      displayName: 'SBER',
      isin: 'T',
      sourceFilePath: '',
    },
    {
      assetKind: 'stock' as const,
      ticker: 'GAZP',
      symbol: 'GAZP',
      displayName: 'GAZP',
      isin: 'T2',
      sourceFilePath: '',
    },
    {
      assetKind: 'fund' as const,
      ticker: FIREIDX_SYMBOL,
      symbol: FIREIDX_SYMBOL,
      displayName: 'FIREIDX',
      isin: 'F',
      sourceFilePath: '',
    },
  ];
  const t0 = 1_717_198_800_000;
  const minuteSber: MarketPriceBar[] = [];
  const minuteGazp: MarketPriceBar[] = [];
  for (let i = 0; i < 120; i += 1) {
    const t = t0 + i * 60_000;
    minuteSber.push(minuteBar(t, 100 + i * 0.1));
    minuteGazp.push(minuteBar(t, 50 + i * 0.05));
  }
  const dailySber = [minuteBar(t0, 100), minuteBar(t0 + 86_400_000, 110)];
  const dailyGazp = [minuteBar(t0, 50), minuteBar(t0 + 86_400_000, 55)];

  const incremental = createMarketModuleState(items, {
    minute: { SBER: [...minuteSber], GAZP: [...minuteGazp] },
    dailyClose: { SBER: dailySber, GAZP: dailyGazp },
  });
  const fullRef = createMarketModuleState(items, {
    minute: { SBER: [...minuteSber], GAZP: [...minuteGazp] },
    dailyClose: { SBER: dailySber, GAZP: dailyGazp },
  });

  const epoch0 = t0 + 60 * 60_000;
  const boot = rebuildFireidxSeriesFromConstituents({
    catalog: incremental.instrumentCatalog,
    chartSeries: incremental.chartSeries,
    details: incremental.details,
    simulationEpochMs: epoch0,
    calendar: null,
  });
  applyFireidxBundlesToChartSeries(incremental.chartSeries, boot, null);
  incremental.compositeIndex = boot.compositeIndex;
  applyMarketQuotesForSimulationEpoch(incremental, epoch0, null, {
    excludeSymbols: [FIREIDX_SYMBOL],
  });

  const ticks = 60;
  for (let i = 1; i <= ticks; i += 1) {
    const epoch = epoch0 + i * 60_000;
    applyMarketQuotesForSimulationEpoch(incremental, epoch, null, {
      excludeSymbols: [FIREIDX_SYMBOL],
    });
    incremental.compositeIndex = updateCompositeIndex(
      incremental.compositeIndex,
      incremental.instrumentCatalog,
      incremental.assetsBySymbol,
      incremental.details,
      epoch,
      null
    );
    advanceFireidxMinuteBar(
      incremental.chartSeries,
      incremental.instrumentCatalog,
      incremental.compositeIndex,
      epoch,
      null
    );
  }

  const finalEpoch = epoch0 + ticks * 60_000;
  applyMarketQuotesForSimulationEpoch(fullRef, finalEpoch, null, {
    excludeSymbols: [FIREIDX_SYMBOL],
  });
  const full = rebuildFireidxSeriesFromConstituents({
    catalog: fullRef.instrumentCatalog,
    chartSeries: fullRef.chartSeries,
    details: fullRef.details,
    simulationEpochMs: finalEpoch,
    calendar: null,
  });
  applyFireidxBundlesToChartSeries(fullRef.chartSeries, full, null);
  const baseIndex =
    full.compositeIndex.constituents.length > 0
      ? full.compositeIndex
      : fullRef.compositeIndex;
  fullRef.compositeIndex = updateCompositeIndex(
    baseIndex,
    fullRef.instrumentCatalog,
    fullRef.assetsBySymbol,
    fullRef.details,
    finalEpoch,
    null
  );

  const levelDelta = Math.abs(incremental.compositeIndex.level - fullRef.compositeIndex.level);
  if (levelDelta > 0.05) {
    throw new Error(
      `level incremental=${incremental.compositeIndex.level} full=${fullRef.compositeIndex.level}`
    );
  }

  const incMinute = incremental.chartSeries.minute[FIREIDX_SYMBOL] ?? [];
  const fullMinute = fullRef.chartSeries.minute[FIREIDX_SYMBOL] ?? [];
  if (incMinute.length === 0 || fullMinute.length === 0) {
    throw new Error('пустой minute FIREIDX');
  }
  const incTail = incMinute[incMinute.length - 1]!;
  const fullTail = fullMinute[fullMinute.length - 1]!;
  if (Math.abs(incTail.c - fullTail.c) > 0.05) {
    throw new Error(`хвост minute c: inc=${incTail.c} full=${fullTail.c}`);
  }
});

run('FIREIDX состав меняется при листинге/делистинге, не хаотично', () => {
  const t0 = 1_717_198_800_000;
  const emptyMeta = {
    isBond: false,
    initialFaceValueRub: null,
    faceUnit: null,
    maturityEpochMs: null,
    isin: null,
    groupRaw: null,
  };
  const items = [
    { assetKind: 'stock' as const, ticker: 'AAA', symbol: 'AAA', displayName: 'AAA', isin: 'AAA', sourceFilePath: '' },
    { assetKind: 'stock' as const, ticker: 'BBB', symbol: 'BBB', displayName: 'BBB', isin: 'BBB', sourceFilePath: '' },
    { assetKind: 'fund' as const, ticker: FIREIDX_SYMBOL, symbol: FIREIDX_SYMBOL, displayName: 'FIREIDX', isin: 'F', sourceFilePath: '' },
  ];
  const market = createMarketModuleState(items, {
    minute: {
      AAA: [minuteBar(t0, 100), minuteBar(t0 + 60_000, 101), minuteBar(t0 + 120_000, 102)],
      BBB: [minuteBar(t0 + 60_000, 50), minuteBar(t0 + 120_000, 51)],
    },
    dailyClose: {
      AAA: [minuteBar(t0, 100)],
      BBB: [minuteBar(t0 + 60_000, 50)],
    },
  });
  // Используем изолированный details, не мутируем кешированный синглтон.
  const details = {
    ...market.details,
    instrumentMetaBySymbol: {
      ...market.details.instrumentMetaBySymbol,
      AAA: { ...emptyMeta, firstTradeEpochMs: t0, maturityEpochMs: t0 + 120_000 },
      BBB: { ...emptyMeta, firstTradeEpochMs: t0 + 60_000, maturityEpochMs: null },
    },
  };

  applyMarketQuotesForSimulationEpoch(market, t0, null, { excludeSymbols: [FIREIDX_SYMBOL] });
  let idx = updateCompositeIndex(market.compositeIndex, market.instrumentCatalog, market.assetsBySymbol, details, t0, null);
  if (idx.constituents.map((c) => c.symbol).join(',') !== 'AAA') {
    throw new Error('на t0 в составе должен быть только AAA');
  }

  applyMarketQuotesForSimulationEpoch(market, t0 + 60_000, null, { excludeSymbols: [FIREIDX_SYMBOL] });
  idx = updateCompositeIndex(idx, market.instrumentCatalog, market.assetsBySymbol, details, t0 + 60_000, null);
  const midSet = new Set(idx.constituents.map((c) => c.symbol));
  if (!midSet.has('AAA') || !midSet.has('BBB') || midSet.size !== 2) {
    throw new Error('на t0+1m в составе должны быть AAA и BBB');
  }

  applyMarketQuotesForSimulationEpoch(market, t0 + 120_000, null, { excludeSymbols: [FIREIDX_SYMBOL] });
  idx = updateCompositeIndex(idx, market.instrumentCatalog, market.assetsBySymbol, details, t0 + 120_000, null);
  if (idx.constituents.map((c) => c.symbol).join(',') !== 'BBB') {
    throw new Error('после maturity AAA в составе должен остаться только BBB');
  }
});

run('incremental FIREIDX обновляется даже при дыре в минутке одной акции', () => {
  const t0 = 1_717_198_800_000;
  const items = [
    { assetKind: 'stock' as const, ticker: 'AAA', symbol: 'AAA', displayName: 'AAA', isin: 'AAA', sourceFilePath: '' },
    { assetKind: 'stock' as const, ticker: 'BBB', symbol: 'BBB', displayName: 'BBB', isin: 'BBB', sourceFilePath: '' },
    { assetKind: 'fund' as const, ticker: FIREIDX_SYMBOL, symbol: FIREIDX_SYMBOL, displayName: 'FIREIDX', isin: 'F', sourceFilePath: '' },
  ];
  const market = createMarketModuleState(items, {
    minute: {
      AAA: [minuteBar(t0, 100), minuteBar(t0 + 60_000, 101)],
      // На t0+60_000 нет новой свечи у BBB (должен работать forward-fill 50).
      BBB: [minuteBar(t0, 50)],
    },
    dailyClose: {
      AAA: [minuteBar(t0, 100)],
      BBB: [minuteBar(t0, 50)],
    },
  });
  // Сбрасываем возможное загрязнение кеша details от других тестов (AAA/BBB — кастомные символы).
  delete (market.details.instrumentMetaBySymbol as Record<string, unknown>)['AAA'];
  delete (market.details.instrumentMetaBySymbol as Record<string, unknown>)['BBB'];
  applyMarketQuotesForSimulationEpoch(market, t0, null, { excludeSymbols: [FIREIDX_SYMBOL] });
  market.compositeIndex = updateCompositeIndex(
    market.compositeIndex,
    market.instrumentCatalog,
    market.assetsBySymbol,
    market.details,
    t0,
    null
  );
  advanceFireidxMinuteBar(market.chartSeries, market.instrumentCatalog, market.compositeIndex, t0, null);
  const fireBarsAfterFirst = market.chartSeries.minute[FIREIDX_SYMBOL] ?? [];
  const first =
    fireBarsAfterFirst.length > 0
      ? fireBarsAfterFirst[fireBarsAfterFirst.length - 1]!.c
      : null;
  if (first == null) {
    throw new Error('не собран первый бар FIREIDX');
  }

  applyMarketQuotesForSimulationEpoch(market, t0 + 60_000, null, {
    excludeSymbols: [FIREIDX_SYMBOL],
  });
  market.compositeIndex = updateCompositeIndex(
    market.compositeIndex,
    market.instrumentCatalog,
    market.assetsBySymbol,
    market.details,
    t0 + 60_000,
    null
  );
  advanceFireidxMinuteBar(
    market.chartSeries,
    market.instrumentCatalog,
    market.compositeIndex,
    t0 + 60_000,
    null
  );
  const fireBarsAfterSecond = market.chartSeries.minute[FIREIDX_SYMBOL] ?? [];
  const second =
    fireBarsAfterSecond.length > 0
      ? fireBarsAfterSecond[fireBarsAfterSecond.length - 1]!.c
      : null;
  if (second == null || second <= first) {
    throw new Error(`FIREIDX должен вырасти при росте AAA: ${first} -> ${second}`);
  }
});

exitCode(failures);
