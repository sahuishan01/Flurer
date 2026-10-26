/**
 * The API gateway itself — see pluginPermissions.ts for the model.
 *
 * A plugin is loaded with `new Function(code)`, so it runs in this
 * window's global scope and can reach every global the app exposes.
 * To attribute a call to the plugin that made it, the plugin is run
 * with a *shadowed* `window` and `globalThis`: an object that forwards
 * everything to the real one, except the API surfaces that need gating.
 *
 * Plugins resolve `window.TauriCore` at CALL time (not at load time) —
 * they are IIFE bundles that read the global when they need it — so a
 * shadowed global is enough to intercept every call, including ones
 * made long after the plugin loaded.
 */

import * as TauriCore from "@tauri-apps/api/core";
import * as TauriShell from "@tauri-apps/plugin-shell";
import {
  PermissionDeniedError,
  commandPermission,
  hasPermission,
  requestPermission,
  SHELL_PERMISSION,
  type PluginPermission,
} from "./pluginPermissions";

/** The globals a plugin may use without any gating. */
type PluginGlobals = Record<string, unknown>;

/**
 * How a gated call is actually made.
 *
 * Injectable so the gate can be tested without a Tauri host — and so
 * the core can, in principle, route plugin calls somewhere else.
 */
export type GatewayTransport = {
  invoke: (cmd: string, args?: Record<string, unknown>, options?: unknown) => Promise<unknown>;
  createCommand: (program: string, args?: string | string[], options?: unknown) => {
    execute: () => Promise<unknown>;
    spawn: () => Promise<unknown>;
  };
};

/** The real transport: Tauri's own invoke and the shell plugin. */
const realTransport: GatewayTransport = {
  invoke: (cmd, args, options) =>
    (TauriCore.invoke as (c: string, a?: unknown, o?: unknown) => Promise<unknown>)(cmd, args, options),
  createCommand: (program, args, options) => {
    const cmd = TauriShell.Command.create(program, args, options as never);
    return {
      execute: () => cmd.execute(),
      spawn: () => cmd.spawn(),
    };
  },
};

/**
 * Build the `window` a plugin sees: the real window, with the gated
 * APIs replaced.
 */
function scopedWindow(
  pluginId: string,
  pluginName: string,
  real: Window & typeof globalThis,
  transport: GatewayTransport,
): PluginGlobals {
  const scopedInvoke = async (cmd: string, args?: Record<string, unknown>, options?: unknown) => {
    const permission = commandPermission(cmd);
    if (permission) {
      const allowed = await ensurePermission(pluginId, pluginName, permission);
      if (!allowed) throw new PermissionDeniedError(pluginName, permission);
    }
    return transport.invoke(cmd, args, options);
  };

  // The shell plugin's API is not a Tauri command, so it needs its own
  // gate. `Command.create(...).execute()` is what actually runs a
  // program, so that is where the check goes.
  const scopedShell = {
    ...TauriShell,
    Command: {
      ...TauriShell.Command,
      create: (program: string, args?: string | string[], options?: unknown) => {
        const cmd = transport.createCommand(program, args, options);
        return {
          ...cmd,
          execute: async () => {
            const allowed = await ensurePermission(pluginId, pluginName, SHELL_PERMISSION);
            if (!allowed) throw new PermissionDeniedError(pluginName, SHELL_PERMISSION);
            return cmd.execute();
          },
          spawn: async () => {
            const allowed = await ensurePermission(pluginId, pluginName, SHELL_PERMISSION);
            if (!allowed) throw new PermissionDeniedError(pluginName, SHELL_PERMISSION);
            return cmd.spawn();
          },
        };
      },
    },
  };

  const overrides: Record<string, unknown> = {
    TauriCore: { ...TauriCore, invoke: scopedInvoke },
    TauriShell: scopedShell,
  };

  // Everything else — Solid, SolidWeb, registerPlugin, the UI kit — is
  // forwarded to the real window. A Proxy rather than a copy, because
  // a window's own properties are accessors on the prototype and would
  // not survive being spread.
  //
  // Native getters (like innerWidth/innerHeight/document) on Window.prototype
  // require `this` to be the real Window instance (passing `receiver` causes
  // "TypeError: Illegal invocation" in browsers). Likewise, native methods
  // must be bound to the target window so their invocations succeed.
  return new Proxy(real, {
    get(target, prop, receiver) {
      if (prop in overrides) return overrides[prop as string];
      if (prop === "window" || prop === "globalThis" || prop === "self") return receiver;
      const value = Reflect.get(target, prop);
      if (typeof value === "function") {
        try {
          const bound = value.bind(target);
          try {
            Object.defineProperties(bound, Object.getOwnPropertyDescriptors(value));
          } catch {}
          return bound;
        } catch {
          return value;
        }
      }
      return value;
    },
    set(target, prop, value) {
      if (prop in overrides) {
        overrides[prop as string] = value;
        return true;
      }
      return Reflect.set(target, prop, value);
    },
    has(target, prop) {
      return prop in overrides || Reflect.has(target, prop);
    },
  }) as unknown as PluginGlobals;
}

/**
 * Check a permission, prompting the user if it is not held yet.
 *
 * The grant is remembered, so a plugin that has been allowed to read
 * files is not asked again on every call.
 */
async function ensurePermission(
  pluginId: string,
  pluginName: string,
  permission: PluginPermission,
): Promise<boolean> {
  if (hasPermission(pluginId, permission)) return true;
  const granted = await requestPermission(pluginId, pluginName, permission);
  return granted;
}

/**
 * Run a plugin's code with scoped globals.
 *
 * The plugin keeps a reference to the scoped `window`, so every later
 * call it makes is still attributed to it — which is the point.
 */
export function runPluginScoped(
  code: string,
  pluginId: string,
  pluginName: string,
  real: Window & typeof globalThis = window,
  transport: GatewayTransport = realTransport,
): void {
  const scoped = scopedWindow(pluginId, pluginName, real, transport);
  // `globalThis` is shadowed as well: a plugin that reaches for
  // globalThis.TauriCore rather than window.TauriCore must be gated
  // just the same.
  const runPlugin = new Function("window", "globalThis", code);
  runPlugin(scoped, scoped);
}
