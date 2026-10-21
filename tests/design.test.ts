import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";

// DESIGN.md is the design spec; the CSS is what actually ships. This
// test is the link between them: every token DESIGN.md declares as the
// source of truth must appear in the stylesheet with the same value.
// Without it the spec silently drifts — it already had drifted once
// (DESIGN.md's spacing scale never existed in CSS at all), and nothing
// caught it because nothing read the file.
//
// The check is deliberately narrow: it asserts the tokens the spec
// declares are PRESENT and EQUAL, not that the CSS contains nothing
// else. The stylesheet legitimately holds many tokens the spec doesn't
// enumerate (per-theme accents, material layers, runtime surface
// controls), and a stricter test would break on every one of them.

const root = new URL("..", import.meta.url).pathname;
const design = readFileSync(`${root}DESIGN.md`, "utf8");
const appCss = readFileSync(`${root}src/App.css`, "utf8");
const themeCss = readFileSync(`${root}src/theme.css`, "utf8");

/** The YAML frontmatter block at the top of DESIGN.md. */
function frontmatter(md: string): string {
  const start = md.indexOf("---\n");
  if (start !== 0) throw new Error("DESIGN.md does not start with a YAML frontmatter block");
  const end = md.indexOf("\n---", start + 4);
  if (end === -1) throw new Error("DESIGN.md frontmatter is not terminated");
  return md.slice(start + 4, end);
}

const spec = Bun.YAML.parse(frontmatter(design)) as Record<string, any>;

/**
 * The custom properties declared inside one rule block. Blocks are
 * scoped deliberately: `--shadow-sm` means the LIGHT value in `:root`
 * and a different one in `[data-mode="dark"]`, so a flat "last
 * declaration wins" map over the whole file would compare the wrong
 * pair.
 */
function blockVars(css: string, selector: string): Map<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = css.match(new RegExp(`^${escaped} \\{([\\s\\S]*?)^\\}`, "m"));
  if (!block) throw new Error(`block ${selector} not found`);
  const out = new Map<string, string>();
  for (const m of block[1].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out.set(m[1], m[2].trim());
  }
  return out;
}

const themeRoot = blockVars(themeCss, ":root");
const themeDark = blockVars(themeCss, '[data-mode="dark"]');
const appRoot = blockVars(appCss, ":root");
const appDark = blockVars(appCss, '[data-mode="dark"]');

/**
 * Compare two CSS values. Whitespace is not significant, and neither is
 * hex case — the stylesheet writes `#1c1c1c` where the spec writes
 * `#1C1C1C`.
 */
const sameValue = (a: string, b: string) =>
  a.replace(/\s+/g, "").toLowerCase() === b.replace(/\s+/g, "").toLowerCase();

/**
 * Resolve a `var(--x)` indirection against a given scope, so a token
 * that points at another token (--shadow-md -> --glass-shadow) can be
 * compared against the spec's literal value.
 */
function resolve(value: string, scope: Map<string, string>): string {
  const ref = value.match(/^var\((--[a-z0-9-]+)\)$/);
  return ref ? scope.get(ref[1]) ?? value : value;
}

describe("DESIGN.md stays in sync with the stylesheet", () => {
  test("the spec declares the sections the check relies on", () => {
    expect(spec.colors).toBeDefined();
    expect(spec.typography).toBeDefined();
    expect(spec.rounded).toBeDefined();
    expect(spec.spacing).toBeDefined();
    expect(spec.shadows).toBeDefined();
  });

  test("semantic colours match the light-mode tokens", () => {
    // The palette is split across the two stylesheets: the Fluent
    // semantic colours live in theme.css, the app's own danger/success
    // tints in App.css.
    const cases: Array<[string, Map<string, string>]> = [
      ["--text-primary", themeRoot],
      ["--text-secondary", themeRoot],
      ["--accent-default", themeRoot],
      ["--danger", appRoot],
      ["--success", appRoot],
    ];
    const expected: Record<string, string> = {
      "--text-primary": spec.colors["primary-light"],
      "--text-secondary": spec.colors["secondary-light"],
      "--accent-default": spec.colors["accent-light"],
      "--danger": spec.colors.danger,
      "--success": spec.colors.success,
    };
    for (const [prop, scope] of cases) {
      const got = scope.get(prop);
      expect(got, `${prop} missing from its :root block`).toBeDefined();
      expect(sameValue(got!, expected[prop]), `${prop} does not match DESIGN.md`).toBe(true);
    }
  });

  test("semantic colours match the dark-mode tokens", () => {
    const cases: Array<[string, Map<string, string>]> = [
      ["--text-primary", themeDark],
      ["--accent-default", themeDark],
    ];
    const expected: Record<string, string> = {
      "--text-primary": spec.colors["primary-dark"],
      "--accent-default": spec.colors["accent-dark"],
    };
    for (const [prop, scope] of cases) {
      const got = scope.get(prop);
      expect(got, `${prop} missing from the dark block`).toBeDefined();
      expect(sameValue(got!, expected[prop]), `${prop} does not match DESIGN.md`).toBe(true);
    }
  });

  test("the type scale matches the --text-* tokens", () => {
    const typeToken: Record<string, string> = {
      display: "--text-display",
      title: "--text-title",
      body: "--text-body",
      label: "--text-label",
      secondary: "--text-secondary",
      caption: "--text-caption",
      section: "--text-section",
      badge: "--text-badge",
    };
    for (const [role, token] of Object.entries(typeToken)) {
      const want = spec.typography[role]?.fontSize;
      expect(want, `DESIGN.md typography.${role}.fontSize missing`).toBeDefined();
      expect(appRoot.get(token), `${token} missing from App.css`).toBe(want);
    }
  });

  test("the radius scale matches the --radius-* tokens", () => {
    const radiusToken: Record<string, string> = { sm: "--radius-sm", md: "--radius-md", lg: "--radius-lg" };
    for (const [name, token] of Object.entries(radiusToken)) {
      const want = spec.rounded[name];
      expect(want, `DESIGN.md rounded.${name} missing`).toBeDefined();
      expect(appRoot.get(token), `${token} missing from App.css`).toBe(String(want));
    }
  });

  test("the spacing scale matches the --space-* tokens", () => {
    // DESIGN.md's spacing scale is the source of truth for the token
    // steps. It is keyed by the token's pixel size at the 16px base, so
    // each spec entry names both the step and its rendered size.
    const spacing = spec.spacing as Record<string, string>;
    expect(Object.keys(spacing).length).toBeGreaterThan(0);

    for (const [step, want] of Object.entries(spacing)) {
      const token = `--space-${step}`;
      const got = appRoot.get(token);
      expect(got, `${token} missing from App.css — DESIGN.md declares spacing.${step}`).toBeDefined();
      // The spec records the pixel size; the token records the rem value
      // that renders as exactly that size at the 16px base.
      const px = Number(want.replace("px", ""));
      expect(Number(got!.replace("rem", "")) * 16).toBe(px);
    }
  });

  test("every --space-* token in App.css is declared in the spec", () => {
    // The reverse direction: a token added to the stylesheet but not to
    // the spec is drift too, and it is the drift that is easy to miss.
    const declared = new Set(Object.keys(spec.spacing as Record<string, string>));
    for (const name of appRoot.keys()) {
      const m = name.match(/^--space-(\d+)$/);
      if (!m) continue;
      expect(declared.has(m[1]), `${name} exists in App.css but not in DESIGN.md spacing`).toBe(true);
    }
  });

  test("elevation shadows match the --shadow-* tokens", () => {
    const cases: Array<[string, Map<string, string>, Map<string, string>]> = [
      ["sm", appRoot, themeRoot],
      ["md", appRoot, themeRoot],
      ["lg", appRoot, themeRoot],
      ["dark-sm", appDark, themeDark],
      ["dark-md", appDark, themeDark],
      ["dark-lg", appDark, themeDark],
    ];
    for (const [name, scope, varScope] of cases) {
      const want = spec.shadows[name];
      expect(want, `DESIGN.md shadows.${name} missing`).toBeDefined();
      const token = `--shadow-${name.replace(/^dark-/, "")}`;
      const got = scope.get(token);
      expect(got, `${token} missing from App.css`).toBeDefined();
      // --shadow-md points at --glass-shadow, so compare the resolved
      // value rather than the literal declaration.
      expect(sameValue(resolve(got!, varScope), String(want)), `shadow ${name} does not match DESIGN.md`).toBe(true);
    }
  });
});
