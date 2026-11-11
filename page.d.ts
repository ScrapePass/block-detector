import type { Result, Options, Fingerprint, Expect } from './index';

export interface PageOptions extends Omit<Options, 'window' | 'captcha'> {
  /** The Response from page.goto(): gives the status, headers and the URL before redirects. */
  response?: unknown;
  /** false: skip captcha-detector even when it is installed. */
  captcha?: boolean;
}

/** Check a Playwright or Puppeteer page. */
export declare function detectInPage(page: unknown, options?: PageOptions): Promise<Result>;
/** Fingerprint a page you know is good. */
export declare function fingerprintPage(page: unknown, options?: { expect?: Expect | Expect[] }): Promise<Fingerprint>;
/** Wait until the page is not loading / an empty shell (or the timeout passes); resolves with the last result. */
export declare function waitForContent(page: unknown, options?: PageOptions & { timeout?: number; interval?: number }): Promise<Result>;
/** Source of the browser build. */
export declare const browserScript: string;
export declare function expression(options?: object, fn?: 'detect' | 'fingerprint'): string;
