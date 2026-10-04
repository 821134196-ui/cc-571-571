// 面额表（单位：分）
export const DENOMINATIONS: { denomCents: number; label: string }[] = [
  { denomCents: 10000, label: '100元' },
  { denomCents: 5000, label: '50元' },
  { denomCents: 2000, label: '20元' },
  { denomCents: 1000, label: '10元' },
  { denomCents: 500, label: '5元' },
  { denomCents: 100, label: '1元' },
  { denomCents: 50, label: '5角' },
  { denomCents: 10, label: '1角' },
];

export const SHIFTS = [
  { value: 'MORNING', label: '早班' },
  { value: 'EVENING', label: '晚班' },
];

export function fenToYuan(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${(abs / 100).toFixed(2)}`;
}
