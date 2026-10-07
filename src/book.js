export class ValidationError extends Error {}

export function makeBook(input, config) {
  const code = typeof input.code === 'string' ? input.code.trim() : '';
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!code.startsWith(config.prefix) || !/^[A-Za-z0-9_-]{3,50}$/.test(code)) {
    throw new ValidationError(`Ma sach phai bat dau bang ${config.prefix}, toi da 50 ky tu.`);
  }
  if (!title || title.length > 200) throw new ValidationError('Ten sach phai dai 1-200 ky tu.');
  // VND integer amounts; reject arrays, decimals, negative values and unsafe numbers.
  const raw = input.basePrice;
  if (!['string', 'number'].includes(typeof raw) || !/^\d+$/.test(String(raw))) {
    throw new ValidationError('Gia phai la so nguyen VND khong am.');
  }
  const basePrice = Number(raw);
  if (!Number.isSafeInteger(basePrice) || basePrice > 1_000_000_000) {
    throw new ValidationError('Gia vuot gioi han 1 ty VND.');
  }
  const vatAmount = Math.round(basePrice * config.vatPercent / 100);
  return { code, title, basePrice, vatPercent: config.vatPercent, vatAmount,
    finalPrice: basePrice + vatAmount, createdAt: new Date() };
}
