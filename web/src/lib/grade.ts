/** 质量四级（品牌规范，唯一实现）：优 ≤50 / 良 ≤150 / 中 ≤300 / 差 >300 */

export interface Grade {
  label: string;
  cls: string;
}

export function gradeOf(ms: number): Grade {
  if (ms <= 50) return { label: '优', cls: 'grade-ok' };
  if (ms <= 150) return { label: '良', cls: 'grade-fine' };
  if (ms <= 300) return { label: '中', cls: 'grade-mid' };
  return { label: '差', cls: 'grade-bad' };
}

/** 仅取等级配色（表格数字着色等场景） */
export function latencyClass(ms: number): string {
  return gradeOf(ms).cls;
}
