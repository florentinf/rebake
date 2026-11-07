/** `83`, `1:23` or `1:02:03.5` to seconds. Null means it can't be read as a time. */
export function parseTime(text: string): number | null {
  const parts = text.trim().split(':');
  if (parts.length > 3 || parts.some((part) => !/^\d+(\.\d*)?$/.test(part))) return null;
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}

export const formatTime = (seconds: number) => {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = String(Math.floor((whole % 3600) / 60));
  const rest = String(whole % 60).padStart(2, '0');
  return hours ? `${hours}:${minutes.padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
};
