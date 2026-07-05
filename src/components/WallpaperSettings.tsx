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

type WallpaperSettingsProps = {
  wallpaper: () => Wallpaper | null;
  error: () => string;
  opacity: () => number;
  onFetch: (query: string) => void;
  onOpacityChange: (opacity: number) => void;
};

export function WallpaperSettings(props: WallpaperSettingsProps) {
  return (
    <section class="settings-panel">
      <h2>Wallpaper</h2>
      <button onClick={() => props.onFetch("nature")}>Get Wallpaper</button>

      <label class="opacity-control">
        Opacity: {Math.round(props.opacity() * 100)}%
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={props.opacity()}
          onInput={(e) => props.onOpacityChange(e.currentTarget.valueAsNumber)}
        />
      </label>

      {props.error() && <p class="settings-error">{props.error()}</p>}
      {props.wallpaper() && (
        <p class="wallpaper-credit">
          Photo by{" "}
          <a
            href={`https://unsplash.com/@${props.wallpaper()!.user.username}`}
            target="_blank"
          >
            {props.wallpaper()!.user.name}
          </a>{" "}
          on Unsplash
        </p>
      )}
    </section>
  );
}
