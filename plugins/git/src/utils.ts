import type { RecentRepo } from "./types";

const RECENT_REPOS_KEY = "flurer-git-recent-repos";
const MAX_RECENT_REPOS = 20;

export function getRecentRepos(): RecentRepo[] {
  try {
    const raw = localStorage.getItem(RECENT_REPOS_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveRecentRepo(path: string, branch?: string): void {
  const repos = getRecentRepos().filter((r) => r.path !== path);
  const name = basename(path);
  repos.unshift({ path, name, lastOpened: Date.now(), branch });
  if (repos.length > MAX_RECENT_REPOS) repos.length = MAX_RECENT_REPOS;
  localStorage.setItem(RECENT_REPOS_KEY, JSON.stringify(repos));
}

export function removeRecentRepo(path: string): void {
  const repos = getRecentRepos().filter((r) => r.path !== path);
  localStorage.setItem(RECENT_REPOS_KEY, JSON.stringify(repos));
}

export function basename(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}

export function formatTimestamp(ts: number): string {
  const now = Date.now();
  const diff = now - ts * 1000;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

export function statusToLabel(status: string): string {
  switch (status) {
    case "M": return "Modified";
    case "A": return "Added";
    case "D": return "Deleted";
    case "R": return "Renamed";
    case "C": return "Copied";
    case "??": return "Untracked";
    case "!": return "Ignored";
    default: return status;
  }
}

export function statusColor(status: string): string {
  switch (status) {
    case "M": return "#f59e0b";
    case "A": return "#4ade80";
    case "D": return "#f87171";
    case "R": return "#c084fc";
    case "C": return "#60a5fa";
    case "??": return "#f87171";
    default: return "var(--text-muted, #888)";
  }
}
