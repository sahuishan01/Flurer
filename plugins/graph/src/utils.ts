export function parentDir(path: string): string {
  const normalized = path.replace(/[/\\]+$/, "");
  const idx = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  if (idx < 0) return normalized;
  if (idx === 2 && normalized[1] === ":") return normalized.slice(0, idx + 1);
  return normalized.slice(0, idx);
}

export type PathSegment = { label: string; path: string };

export function pathSegments(path: string): PathSegment[] {
  const driveMatch = /^([a-zA-Z]:)[\\/]?/.exec(path);
  if (!driveMatch) return path ? [{ label: path, path }] : [];

  const drive = driveMatch[1];
  const rest = path.slice(driveMatch[0].length);
  const parts = rest.split(/[\\/]+/).filter(Boolean);

  const driveRoot = `${drive}\\`;
  const segments: PathSegment[] = [{ label: driveRoot, path: driveRoot }];
  let current = driveRoot;
  for (const part of parts) {
    current = `${current}${part}\\`;
    segments.push({ label: part, path: current });
  }
  return segments;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}
