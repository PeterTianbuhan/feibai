// 水墨世界的字：汉字数字、题款上的干支纪年、品第。

const D = '零一二三四五六七八九';

/** 0 到 999 写成汉字 */
export function cn(n: number): string {
  if (n < 10) return D[n];
  if (n < 20) return '十' + (n % 10 ? D[n % 10] : '');
  if (n < 100) return D[(n / 10) | 0] + '十' + (n % 10 ? D[n % 10] : '');
  const h = (n / 100) | 0, r = n % 100;
  return D[h] + '百' + (r === 0 ? '' : r < 10 ? '零' + D[r] : D[(r / 10) | 0] + '十' + (r % 10 ? D[r % 10] : ''));
}

/** 「丙午年冬」这样的一行 */
export function dateLine(d: Date): string {
  const y = d.getFullYear() - 4, m = d.getMonth() + 1;
  const gz = '甲乙丙丁戊己庚辛壬癸'[((y % 10) + 10) % 10] + '子丑寅卯辰巳午未申酉戌亥'[((y % 12) + 12) % 12];
  const s = m >= 2 && m <= 4 ? '春' : m >= 5 && m <= 7 ? '夏' : m >= 8 && m <= 10 ? '秋' : '冬';
  return gz + '年' + s;
}

const RANKS: [number, string][] = [[0, '试笔'], [3, '初墨'], [8, '行云'], [15, '流水'], [25, '游龙'], [40, '化境']];

/** 一趟落了几个点，对应哪一品。朱印上刻的就是它 */
export function rankOf(n: number): string {
  let r = RANKS[0][1];
  for (const [k, v] of RANKS) if (n >= k) r = v;
  return r;
}
