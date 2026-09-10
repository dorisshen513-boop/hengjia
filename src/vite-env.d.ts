/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_STATIC?: string;
  readonly VITE_BASE?: string;
  readonly VITE_AUTH_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
