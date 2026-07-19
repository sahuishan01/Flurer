declare module "@tauri-apps/api/core" {
  export function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
}

declare module "@tauri-apps/api/event" {
  export function listen<T>(event: string, handler: (payload: { payload: T }) => void): Promise<() => void>;
}

declare module "@tauri-apps/plugin-shell" {
  interface CommandResult {
    code: number | null;
    signal: number | null;
    stdout: string;
    stderr: string;
  }
  interface Command {
    execute(): Promise<CommandResult>;
  }
  export const Command: {
    create(program: string, args?: string[]): Command;
  };
}

interface Window {
  registerPlugin(config: {
    id: string;
    name: string;
    description: string;
    version: string;
    author: string;
    viewRailButton: (props: any) => any;
    fullPanel: (props: any) => any;
  }): void;
  Solid: any;
  SolidWeb: any;
  SolidStore: any;
  TauriCore: { invoke: typeof import("@tauri-apps/api/core").invoke };
  TauriEvent: any;
  TauriShell: typeof import("@tauri-apps/plugin-shell") | undefined;
  __TAURI__?: { shell?: typeof import("@tauri-apps/plugin-shell") };
}
