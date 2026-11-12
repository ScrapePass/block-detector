export type Reason =
  | 'challenge'
  | 'access-denied'
  | 'rate-limit'
  | 'login'
  | 'redirected'
  | 'js-shell'
  | 'empty'
  | 'loading'
  | 'stripped'
  | 'different'
  | 'not-found'
  | 'error';

/** 'h1', '.item >= 10', '.x = 2', or an object. text: a RegExp (or its source) the element text must match. */
export type Expect = string | { selector?: string; min?: number; max?: number; text?: RegExp | string; label?: string };

export interface Fingerprint {
  v: 1;
  url: string;
  title: string;
  textLength: number;
  counts: { links: number; contentLinks: number; contentElements: number; images: number; headings: number; listItems: number; tables: number; forms: number; inputs: number; elements: number };
  tags: Record<string, number>;
  classes: Record<string, number>;
  expect: { selector: string; count: number }[];
}

export interface Options {
  /** The URL you asked for, before redirects. */
  requestedUrl?: string;
  /** The final URL (detectHtml only; the browser knows its own). */
  url?: string;
  status?: number;
  headers?: Record<string, string | string[]> | Headers | [string, string][];
  /** Selectors the real page must have. */
  expect?: Expect | Expect[];
  /** Fingerprint(s) of good pages of the same kind. */
  reference?: Fingerprint | Fingerprint[];
  /** 0..1, default 0.5: confidence a reason needs to count. */
  threshold?: number;
  /** A captcha-detector result for this page; null to skip. Filled in automatically when captcha-detector is registered. */
  captcha?: unknown;
  /** false: do not run captcha-detector even when it is registered. */
  useCaptchaDetector?: boolean;
  /** The captcha-detector module to use for this call. */
  captchaDetector?: unknown;
  /** detect() only: the window to check. */
  window?: Window;
}

export interface Evidence {
  type: string;
  value: string;
  confidence: number;
}

export interface Detection {
  reason: Reason;
  confidence: number;
  /** false for not-found and error: the page is missing, not blocked. */
  blocking: boolean;
  description: string;
  evidence: Evidence[];
}

export interface ExpectResult {
  selector: string | null;
  min: number;
  max: number | null;
  text: string | null;
  count: number;
  ok: boolean;
  sample: string | null;
  error?: string;
  fromReference?: boolean;
  label?: string;
}

export interface Comparison {
  similarity: number;
  parts: { classes: number; structure: number; text: number; links: number };
  textRatio: number | null;
  referenceUrl: string;
}

export interface Result {
  /** The page looks like the real content. */
  ok: boolean;
  /** The site most likely served something else on purpose (any reason but not-found / error leads). */
  blocked: boolean;
  reason: Reason | null;
  confidence: number;
  summary: string;
  detections: Detection[];
  /** Signals below the threshold. */
  hints: Detection[];
  expect: ExpectResult[];
  reference: Comparison | null;
  captcha: { captcha: boolean; challengePage: boolean; blocked: boolean; summary: string } | null;
  page: { url: string; requestedUrl: string; status: number | null; title: string; textLength: number; links: number; images: number; elements: number };
  mode: 'dom' | 'html';
  version: string;
  /** This page's fingerprint (not enumerable: JSON.stringify leaves it out). */
  readonly fingerprint: Fingerprint;
}

export declare const VERSION: string;
export declare const REASONS: Record<Reason, string>;
export declare function detect(options?: Options): Result;
export declare function detectHtml(html: string, options?: Options): Result;
export declare function detectResponse(response: Response | { data?: unknown; body?: unknown; status?: number; statusCode?: number; headers?: unknown } | string, options?: Options): Promise<Result>;
export declare function fingerprint(options?: { expect?: Expect | Expect[]; window?: Window }): Fingerprint;
export declare function fingerprintHtml(html: string, options?: { url?: string; expect?: Expect | Expect[] }): Fingerprint;
export declare function compare(reference: Fingerprint | Fingerprint[], page: Fingerprint | object): Comparison;
/** The words an address names in its path (ids and generic words left out), used by the relevance check. */
export declare function addressWords(url: string): string[];
export declare function analyze(snapshot: object, options?: Options): Result;
export declare function snapshotFromDom(win?: Window, options?: Options): object;
export declare function snapshotFromHtml(html: string, options?: Options): object;
export declare function fingerprintOf(snapshot: object): Fingerprint;
export declare function normalizeExpect(expect: Expect | Expect[]): object[];
/** Register captcha-detector so its checks run too (the Node entry does this when it is installed). */
export declare function use(captchaDetector: unknown): unknown;
export declare const rules: { reason: Reason; patterns: (RegExp | [RegExp, number])[]; headlineOnly?: (RegExp | [RegExp, number])[] }[];

declare const BlockDetector: {
  VERSION: typeof VERSION;
  REASONS: typeof REASONS;
  detect: typeof detect;
  detectHtml: typeof detectHtml;
  detectResponse: typeof detectResponse;
  fingerprint: typeof fingerprint;
  fingerprintHtml: typeof fingerprintHtml;
  compare: typeof compare;
  addressWords: typeof addressWords;
  analyze: typeof analyze;
  snapshotFromDom: typeof snapshotFromDom;
  snapshotFromHtml: typeof snapshotFromHtml;
  fingerprintOf: typeof fingerprintOf;
  normalizeExpect: typeof normalizeExpect;
  use: typeof use;
  rules: typeof rules;
};
export default BlockDetector;
