export type Wallpaper = {
  id: string;
  description: string | null;
  urls: {
    raw: string;
    full: string;
    regular: string;
    small: string;
    thumb: string;
  };
  user: {
    name: string;
    username: string;
  };
};

export const UNSPLASH_FREQUENCY_OPTIONS: { label: string; ms: number }[] = [
  { label: "1 minute", ms: 60_000 },
  { label: "5 minutes", ms: 5 * 60_000 },
  { label: "15 minutes", ms: 15 * 60_000 },
  { label: "30 minutes", ms: 30 * 60_000 },
  { label: "1 hour", ms: 60 * 60_000 },
  { label: "6 hours", ms: 6 * 60 * 60_000 },
  { label: "1 day", ms: 24 * 60 * 60_000 },
  { label: "1 week", ms: 7 * 24 * 60 * 60_000 },
  { label: "1 month", ms: 30 * 24 * 60 * 60_000 },
];

export const DEFAULT_UNSPLASH_FREQUENCY_MS = 5 * 60_000;

export const UNSPLASH_ROTATE_CATEGORIES = [
  "nature",
  "city",
  "space",
  "ocean",
  "mountains",
  "minimal",
];

export const UNSPLASH_FIXED_IMAGES = [
  {
    id: "forest",
    label: "Forest",
    url: "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=1600",
  },
  {
    id: "mountain",
    label: "Mountain",
    url: "https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=1600",
  },
  {
    id: "ocean",
    label: "Ocean",
    url: "https://images.unsplash.com/photo-1505142468610-359e7d316be0?w=1600",
  },
  {
    id: "city",
    label: "City",
    url: "https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=1600",
  },
  {
    id: "space",
    label: "Space",
    url: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1600",
  },
  {
    id: "desert",
    label: "Desert",
    url: "https://images.unsplash.com/photo-1509316785289-025f5b846b35?w=1600",
  },
];
