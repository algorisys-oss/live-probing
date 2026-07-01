/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LIVEPROBE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Injected by vite.config.ts `define` from the root package.json version.
declare const __APP_VERSION__: string;
