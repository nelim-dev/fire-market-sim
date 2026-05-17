import { readdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { MARKET_ASSET_SOURCE_DIRECTORIES } from './assetSources';
import type {
  AssetSourceDirectory,
  DiscoveredAssetFile,
  MarketFileScanner,
  MarketInstrumentCatalogItem,
} from './contracts';
import { toCatalogItem } from './contracts';
import { isExcludedFromMarketCatalog } from './catalogExclusions';

function isDataFile(fileName: string): boolean {
  return extname(fileName).toLowerCase() === '.txt';
}

function sortDiscovered(a: DiscoveredAssetFile, b: DiscoveredAssetFile): number {
  if (a.assetKind !== b.assetKind) {
    return a.assetKind.localeCompare(b.assetKind);
  }
  return a.fileStem.localeCompare(b.fileStem);
}

function getFileStem(fileName: string): string {
  const extension = extname(fileName);
  return fileName.slice(0, fileName.length - extension.length);
}

function scanDirectory(
  rootDirectory: string,
  source: AssetSourceDirectory
): DiscoveredAssetFile[] {
  const absoluteDirectoryPath = resolve(rootDirectory, source.directoryName);
  let entries: string[] = [];

  try {
    entries = readdirSync(absoluteDirectoryPath, { encoding: 'utf8' });
  } catch {
    // Допустимо, что часть папок ещё не подготовлена на текущем этапе.
    return [];
  }

  return entries
    .filter(isDataFile)
    .filter((fileName) => !isExcludedFromMarketCatalog(getFileStem(fileName)))
    .map((fileName) => ({
      assetKind: source.kind,
      directoryName: source.directoryName,
      fileName,
      fileStem: getFileStem(fileName),
      absolutePath: join(absoluteDirectoryPath, fileName),
    }));
}

export class FileSystemMarketFileScanner implements MarketFileScanner {
  private readonly sourceDirectories: readonly AssetSourceDirectory[];

  constructor(
    sourceDirectories: readonly AssetSourceDirectory[] =
      MARKET_ASSET_SOURCE_DIRECTORIES
  ) {
    this.sourceDirectories = sourceDirectories;
  }

  scan(rootDirectory: string): DiscoveredAssetFile[] {
    return this.sourceDirectories
      .flatMap((source) => scanDirectory(rootDirectory, source))
      .sort(sortDiscovered);
  }
}

export function buildMarketInstrumentCatalog(
  rootDirectory: string,
  scanner: MarketFileScanner = new FileSystemMarketFileScanner()
): MarketInstrumentCatalogItem[] {
  return scanner.scan(rootDirectory).map(toCatalogItem);
}

