/// <reference types="vite/client" />

import type { BrickApi } from '../preload/index'

declare global {
  interface Window {
    brick: BrickApi
  }
}

export {}
