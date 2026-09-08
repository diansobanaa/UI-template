/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PYTHON_API_BASE?: string;
  readonly VITE_ESP32_API_BASE?: string;
  readonly VITE_API_TIMEOUT_MS?: string;
  readonly VITE_API_TOKEN?: string;
  readonly VITE_ENABLE_DIRECT_ESP32?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
