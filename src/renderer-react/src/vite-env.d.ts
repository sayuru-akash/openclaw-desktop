/// <reference types="vite/client" />

import type { RendererApi } from "../../shared/types";

declare global {
  interface Window {
    openclaw: RendererApi;
  }

  namespace JSX {
    interface IntrinsicElements {
      webview: any;
    }
  }
}

export {};
