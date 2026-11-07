export const formatBytes = (bytes: number) => {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1e6) return `${Math.round(bytes / 1e3)} KB`;
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB`;
  return `${(bytes / 1e9).toFixed(1)} GB`;
};

export const formatLeft = (seconds: number) => `About ${seconds < 120 ? `${seconds} s` : `${Math.ceil(seconds / 60)} min`} left`;

/** How a result compares with what went in. */
export function sizeChange(before: number, after: number) {
  const ratio = after / before;
  if (Math.abs(ratio - 1) < 0.01) return 'Same size';
  return ratio < 1 ? `${Math.round((1 - ratio) * 100)}% smaller` : `${ratio.toFixed(1)}× larger`;
}
