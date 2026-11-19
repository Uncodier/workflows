/** Decimal JSON projection only; PostgreSQL numeric remains the debit authority. */
export function sumCreditBalances(...values: number[]): number {
  if (!values.length || values.some(value => !Number.isFinite(value))) return NaN;
  const parts = values.map(value => {
    const [mantissa, exponent = '0'] = value.toString().split('e');
    const [whole, fraction = ''] = mantissa.split('.');
    return { units: BigInt(whole + fraction), scale: fraction.length - Number(exponent) };
  });
  const scale = Math.max(...parts.map(part => part.scale));
  const units = parts.reduce((sum, part) => sum + part.units * BigInt(10) ** BigInt(scale - part.scale), BigInt(0));
  return Number(`${units}e${-scale}`);
}