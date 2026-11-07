import type { BenchtopApi } from '../shared/types';

declare global {
  interface Window {
    benchtop: BenchtopApi;
  }
}

export {};
