const nf = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function formatRub(value: number, withCurrency = true): string {
  const s = nf.format(value).replace(/\u00a0/g, ' ');
  return withCurrency ? `${s}\u00a0₽` : s;
}

export function formatRubSigned(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  const abs = Math.abs(value);
  return `${sign}${formatRub(abs)}`;
}

/** П/У в строке позиции (2 знака после запятой, как на макете). */
export function formatRubSignedDetailed(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  const abs = new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(value));
  return `${sign}${abs}\u00a0₽`;
}

export function formatPctSigned(value: number, digits = 1): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  const abs = Math.abs(value).toFixed(digits).replace('.', ',');
  return `${sign}${abs}%`;
}
