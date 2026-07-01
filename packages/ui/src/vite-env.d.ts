/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LIVEPROBE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
