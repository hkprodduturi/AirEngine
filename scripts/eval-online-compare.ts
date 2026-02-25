/**
 * AirEngine Online Eval Comparator (A4c)
 *
 * Compares two online eval reports (A6c) and detects regressions
 * in success rates, timing, tokens, and failure breakdown.
 *
 * Usage:
 *   npx tsx scripts/eval-online-compare.ts <previous.json> <current.json> [flags]
 *
 * Exit codes:
 *   0 = no hard regressions
 *   1 = hard regressions detected
 *   2 = usage error
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';

// ---- Types ----

export interface OnlineEvalMetrics {
  total_cases: number;
  completed_cases: number;
  success_count: number;
  prompt_to_air_success_rate: number;
  prompt_to_running_app_success_rate: number;
  timing: {
    avg_total_ms: number;
    p50_total_ms: number;
    p95_total_ms: number;
    avg_generation_ms: number;
    avg_loop_ms: number;
  };
  tokens: {
    total_input: number;
    total_output: number;
    avg_input: number;
    avg_output: number;
  };
  retries: {
    avg_generation_attempts: number;
    avg_repair_attempts: number;
  };
  failure_breakdown: Record<string, number>;
}

export interface OnlineEvalReportFile {
  schema_version: string;
  timestamp: string;
  corpus: {
    corpus_id: string;
    total_entries: number;
    limit_applied: number | null;
  };
  metrics: OnlineEvalMetrics;
  config: Record<string, unknown>;
}

export interface RateComparison {
  name: string;
  previous: number;
  current: number;
  delta: number;
  regression: boolean;
  hard: boolean;
  threshold: number;
}

export interface TimingComparison {
  name: string;
  previous: number;
  current: number;
  delta: number;
  ratio: number;
  regression: boolean;
  hard: boolean;
}

export interface TokenComparison {
  name: string;
  previous: number;
  current: number;
  delta: number;
  ratio: number;
  warning: boolean;
}

export interface FailureDelta {
  category: string;
  previous: number;
  current: number;
  delta: number;
}

export interface ComparePolicy {
  success_rate_threshold: number;
  air_rate_threshold: number;
  timing_ratio_threshold: number;
  timing_min_abs_ms: number;
  token_ratio_threshold: number;
  strict_corpus: boolean;
}

export interface CompareResult {
  timestamp: string;
  previous_file: string;
  current_file: string;
  policy: ComparePolicy;
  corpus_match: boolean;
  corpus_mismatch_reason?: string;
  rates: RateComparison[];
  timing: TimingComparison[];
  tokens: TokenComparison[];
  failure_deltas: FailureDelta[];
  hard_regressions: string[];
  soft_warnings: string[];
  verdict: 'pass' | 'fail';
  human_summary: string;
}

// ---- Default Policy ----

const DEFAULT_POLICY: ComparePolicy = {
  success_rate_threshold: 0.1,    // 10pp drop = hard fail
  air_rate_threshold: 0.1,        // 10pp drop = hard fail
  timing_ratio_threshold: 2.0,    // 2x slower = hard fail
  timing_min_abs_ms: 1000,        // ignore timing delta < 1s
  token_ratio_threshold: 2.0,     // 2x token increase = soft warning
  strict_corpus: false,           // corpus mismatch = warning by default
};

// ---- Exported Functions ----

/**
 * Load and validate an online eval report file.
 */
export function loadReport(path: string): OnlineEvalReportFile {
  const raw = readFileSync(path, 'utf-8');
  const data = JSON.parse(raw);
  if (!data || typeof data !== 'object') throw new Error(`Invalid report: not an object`);
  if (data.schema_version !== '1.0') throw new Error(`Unsupported schema_version: ${data.schema_version}`);
  if (!data.metrics) throw new Error('Report missing metrics');
  if (typeof data.metrics.prompt_to_running_app_success_rate !== 'number') {
    throw new Error('Report missing metrics.prompt_to_running_app_success_rate');
  }
  return data as OnlineEvalReportFile;
}

/**
 * Check if two reports have compatible corpus configurations.
 */
export function checkCorpusMatch(
  prev: OnlineEvalReportFile,
  curr: OnlineEvalReportFile,
): { match: boolean; reason?: string } {
  if (prev.corpus.corpus_id !== curr.corpus.corpus_id) {
    return { match: false, reason: `corpus_id mismatch: "${prev.corpus.corpus_id}" vs "${curr.corpus.corpus_id}"` };
  }
  if (prev.corpus.total_entries !== curr.corpus.total_entries) {
    return { match: false, reason: `total_entries mismatch: ${prev.corpus.total_entries} vs ${curr.corpus.total_entries}` };
  }
  const prevLimit = prev.corpus.limit_applied ?? prev.corpus.total_entries;
  const currLimit = curr.corpus.limit_applied ?? curr.corpus.total_entries;
  if (prevLimit !== currLimit) {
    return { match: false, reason: `effective limit mismatch: ${prevLimit} vs ${currLimit}` };
  }
  return { match: true };
}

/**
 * Compare success rates between two reports.
 */
export function compareRates(
  prev: OnlineEvalMetrics,
  curr: OnlineEvalMetrics,
  policy: ComparePolicy,
): RateComparison[] {
  const rates: RateComparison[] = [];

  // North-star: prompt_to_running_app_success_rate
  const nsPrev = prev.prompt_to_running_app_success_rate;
  const nsCurr = curr.prompt_to_running_app_success_rate;
  const nsDelta = nsCurr - nsPrev;
  const nsRegression = nsDelta < -policy.success_rate_threshold;
  rates.push({
    name: 'prompt_to_running_app_success_rate',
    previous: nsPrev,
    current: nsCurr,
    delta: Math.round(nsDelta * 1000) / 1000,
    regression: nsDelta < 0,
    hard: nsRegression,
    threshold: policy.success_rate_threshold,
  });

  // prompt_to_air_success_rate
  const airPrev = prev.prompt_to_air_success_rate;
  const airCurr = curr.prompt_to_air_success_rate;
  const airDelta = airCurr - airPrev;
  const airRegression = airDelta < -policy.air_rate_threshold;
  rates.push({
    name: 'prompt_to_air_success_rate',
    previous: airPrev,
    current: airCurr,
    delta: Math.round(airDelta * 1000) / 1000,
    regression: airDelta < 0,
    hard: airRegression,
    threshold: policy.air_rate_threshold,
  });

  return rates;
}

/**
 * Compare timing metrics between two reports.
 */
export function compareTiming(
  prev: OnlineEvalMetrics,
  curr: OnlineEvalMetrics,
  policy: ComparePolicy,
): TimingComparison[] {
  const fields: Array<[string, number, number]> = [
    ['avg_total_ms', prev.timing.avg_total_ms, curr.timing.avg_total_ms],
    ['p50_total_ms', prev.timing.p50_total_ms, curr.timing.p50_total_ms],
    ['p95_total_ms', prev.timing.p95_total_ms, curr.timing.p95_total_ms],
    ['avg_generation_ms', prev.timing.avg_generation_ms, curr.timing.avg_generation_ms],
    ['avg_loop_ms', prev.timing.avg_loop_ms, curr.timing.avg_loop_ms],
  ];

  return fields.map(([name, p, c]) => {
    const delta = c - p;
    const ratio = p > 0 ? c / p : (c > 0 ? Infinity : 1);
    const isRegression = delta > 0
      && delta >= policy.timing_min_abs_ms
      && ratio >= policy.timing_ratio_threshold;
    return {
      name,
      previous: p,
      current: c,
      delta: Math.round(delta),
      ratio: Math.round(ratio * 100) / 100,
      regression: isRegression,
      hard: isRegression,
    };
  });
}

/**
 * Compare token metrics (soft warnings only by default).
 */
export function compareTokens(
  prev: OnlineEvalMetrics,
  curr: OnlineEvalMetrics,
  policy: ComparePolicy,
): TokenComparison[] {
  const fields: Array<[string, number, number]> = [
    ['avg_input', prev.tokens.avg_input, curr.tokens.avg_input],
    ['avg_output', prev.tokens.avg_output, curr.tokens.avg_output],
    ['total_input', prev.tokens.total_input, curr.tokens.total_input],
    ['total_output', prev.tokens.total_output, curr.tokens.total_output],
  ];

  return fields.map(([name, p, c]) => {
    const delta = c - p;
    const ratio = p > 0 ? c / p : (c > 0 ? Infinity : 1);
    return {
      name,
      previous: p,
      current: c,
      delta: Math.round(delta),
      ratio: Math.round(ratio * 100) / 100,
      warning: ratio >= policy.token_ratio_threshold && delta > 0,
    };
  });
}

/**
 * Compare failure breakdowns between two reports.
 */
export function compareFailures(
  prev: OnlineEvalMetrics,
  curr: OnlineEvalMetrics,
): FailureDelta[] {
  const allCategories = new Set([
    ...Object.keys(prev.failure_breakdown),
    ...Object.keys(curr.failure_breakdown),
  ]);
  return Array.from(allCategories).map(category => ({
    category,
    previous: prev.failure_breakdown[category] ?? 0,
    current: curr.failure_breakdown[category] ?? 0,
    delta: (curr.failure_breakdown[category] ?? 0) - (prev.failure_breakdown[category] ?? 0),
  }));
}

/**
 * Run the full comparison and produce a CompareResult.
 */
export function compareReports(
  prevPath: string,
  currPath: string,
  policyOverrides?: Partial<ComparePolicy>,
): CompareResult {
  const policy: ComparePolicy = { ...DEFAULT_POLICY, ...policyOverrides };
  const prev = loadReport(prevPath);
  const curr = loadReport(currPath);

  const corpusCheck = checkCorpusMatch(prev, curr);
  const rates = compareRates(prev.metrics, curr.metrics, policy);
  const timing = compareTiming(prev.metrics, curr.metrics, policy);
  const tokens = compareTokens(prev.metrics, curr.metrics, policy);
  const failureDeltas = compareFailures(prev.metrics, curr.metrics);

  // Collect hard regressions
  const hardRegressions: string[] = [];
  for (const r of rates) {
    if (r.hard) hardRegressions.push(`${r.name}: ${r.previous} -> ${r.current} (delta=${r.delta}, threshold=${r.threshold})`);
  }
  for (const t of timing) {
    if (t.hard) hardRegressions.push(`${t.name}: ${t.previous}ms -> ${t.current}ms (${t.ratio}x)`);
  }
  if (!corpusCheck.match && policy.strict_corpus) {
    hardRegressions.push(`corpus mismatch: ${corpusCheck.reason}`);
  }

  // Collect soft warnings
  const softWarnings: string[] = [];
  for (const r of rates) {
    if (r.regression && !r.hard) softWarnings.push(`${r.name}: ${r.previous} -> ${r.current} (delta=${r.delta})`);
  }
  for (const tk of tokens) {
    if (tk.warning) softWarnings.push(`${tk.name}: ${tk.previous} -> ${tk.current} (${tk.ratio}x)`);
  }
  if (!corpusCheck.match && !policy.strict_corpus) {
    softWarnings.push(`corpus mismatch (non-strict): ${corpusCheck.reason}`);
  }

  const verdict = hardRegressions.length > 0 ? 'fail' : 'pass';

  // Human summary
  const lines: string[] = [];
  lines.push(`Online Eval Comparison: ${verdict.toUpperCase()}`);
  lines.push(`Previous: ${prevPath} (${prev.timestamp})`);
  lines.push(`Current:  ${currPath} (${curr.timestamp})`);
  lines.push('');
  lines.push('Success Rates:');
  for (const r of rates) {
    const flag = r.hard ? ' ** REGRESSION **' : r.regression ? ' (minor drop)' : '';
    lines.push(`  ${r.name}: ${(r.previous * 100).toFixed(1)}% -> ${(r.current * 100).toFixed(1)}%${flag}`);
  }
  if (hardRegressions.length > 0) {
    lines.push('');
    lines.push('Hard Regressions:');
    for (const r of hardRegressions) lines.push(`  - ${r}`);
  }
  if (softWarnings.length > 0) {
    lines.push('');
    lines.push('Soft Warnings:');
    for (const w of softWarnings) lines.push(`  - ${w}`);
  }

  return {
    timestamp: new Date().toISOString(),
    previous_file: prevPath,
    current_file: currPath,
    policy,
    corpus_match: corpusCheck.match,
    ...(corpusCheck.reason ? { corpus_mismatch_reason: corpusCheck.reason } : {}),
    rates,
    timing,
    tokens,
    failure_deltas: failureDeltas,
    hard_regressions: hardRegressions,
    soft_warnings: softWarnings,
    verdict,
    human_summary: lines.join('\n'),
  };
}

// ---- CLI ----

interface CliArgs {
  previousPath: string;
  currentPath: string;
  successRateThreshold: number;
  airRateThreshold: number;
  timingRatioThreshold: number;
  timingMinAbsMs: number;
  tokenRatioThreshold: number;
  strictCorpus: boolean;
  output: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const positional: string[] = [];
  const result: Partial<CliArgs> = {
    successRateThreshold: DEFAULT_POLICY.success_rate_threshold,
    airRateThreshold: DEFAULT_POLICY.air_rate_threshold,
    timingRatioThreshold: DEFAULT_POLICY.timing_ratio_threshold,
    timingMinAbsMs: DEFAULT_POLICY.timing_min_abs_ms,
    tokenRatioThreshold: DEFAULT_POLICY.token_ratio_threshold,
    strictCorpus: DEFAULT_POLICY.strict_corpus,
    output: 'artifacts/eval/online-eval-compare.json',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--success-rate-threshold') result.successRateThreshold = parseFloat(args[++i]);
    else if (arg === '--air-rate-threshold') result.airRateThreshold = parseFloat(args[++i]);
    else if (arg === '--timing-ratio-threshold') result.timingRatioThreshold = parseFloat(args[++i]);
    else if (arg === '--timing-min-abs-ms') result.timingMinAbsMs = parseInt(args[++i], 10);
    else if (arg === '--token-ratio-threshold') result.tokenRatioThreshold = parseFloat(args[++i]);
    else if (arg === '--strict-corpus') result.strictCorpus = true;
    else if (arg === '--output') result.output = args[++i];
    else if (!arg.startsWith('--')) positional.push(arg);
  }

  if (positional.length < 2) {
    console.error('Usage: eval-online-compare <previous.json> <current.json> [flags]');
    console.error('');
    console.error('Flags:');
    console.error('  --success-rate-threshold <n>  North-star drop threshold (default: 0.1)');
    console.error('  --air-rate-threshold <n>      AIR rate drop threshold (default: 0.1)');
    console.error('  --timing-ratio-threshold <n>  Timing regression ratio (default: 2.0)');
    console.error('  --timing-min-abs-ms <n>       Min absolute timing delta (default: 1000)');
    console.error('  --token-ratio-threshold <n>   Token increase ratio warning (default: 2.0)');
    console.error('  --strict-corpus               Fail on corpus mismatch');
    console.error('  --output <path>               Report path (default: artifacts/eval/online-eval-compare.json)');
    process.exit(2);
  }

  return {
    previousPath: positional[0],
    currentPath: positional[1],
    ...result,
  } as CliArgs;
}

function main(): void {
  const args = parseArgs();

  const result = compareReports(
    resolve(args.previousPath),
    resolve(args.currentPath),
    {
      success_rate_threshold: args.successRateThreshold,
      air_rate_threshold: args.airRateThreshold,
      timing_ratio_threshold: args.timingRatioThreshold,
      timing_min_abs_ms: args.timingMinAbsMs,
      token_ratio_threshold: args.tokenRatioThreshold,
      strict_corpus: args.strictCorpus,
    },
  );

  // Write report
  const outputPath = resolve(args.output);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(result, null, 2));

  // Print summary
  console.log(result.human_summary);
  console.log('');
  console.log(`Report: ${args.output}`);

  process.exit(result.verdict === 'pass' ? 0 : 1);
}

// Guard: only run when executed directly
const isDirectRun = process.argv[1]?.includes('eval-online-compare');
if (isDirectRun) {
  main();
}
