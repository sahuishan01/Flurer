import { setSurfaceOpacity, getSurfaceOpacity } from "../utils";

const S = {
  section: {
    padding: "16px",
  },
  label: {
    display: "block",
    "font-size": "12px",
    "font-weight": 600,
    "margin-bottom": "8px",
    color: "var(--text-muted, #888)",
  },
  row: {
    display: "flex",
    "align-items": "center",
    gap: "12px",
  },
  slider: {
    flex: 1,
    height: "6px",
    appearance: "none" as const,
    background: "var(--border-strong)",
    outline: "none",
    "border-radius": "3px",
    cursor: "pointer",
  },
  value: {
    "font-family": "Space Mono, monospace",
    "font-size": "12px",
    color: "var(--text-color)",
    "min-width": "36px",
    "text-align": "right" as const,
  },
};

export function SettingsPanel(props: any) {
  const initial = props.pluginSettings?.surfaceOpacity ?? getSurfaceOpacity();
  if (initial !== getSurfaceOpacity()) setSurfaceOpacity(initial);

  function onChange(e: Event) {
    const val = parseFloat((e.target as HTMLInputElement).value);
    setSurfaceOpacity(val);
    props.onPluginSettingsChange?.({ surfaceOpacity: val });
  }

  return (
    <div style={S.section}>
      <label style={S.label}>Surface tint opacity</label>
      <div style={S.row}>
        <input
          type="range"
          min="0"
          max="0.2"
          step="0.005"
          value={getSurfaceOpacity()}
          onInput={onChange}
          style={S.slider}
        />
        <span style={S.value}>{Math.round(getSurfaceOpacity() * 100)}%</span>
      </div>
      <div style={{ "font-size": "11px", color: "var(--text-muted, #888)", "margin-top": "6px" }}>
        Controls the tint strength of card and panel backgrounds.
      </div>
    </div>
  );
}
