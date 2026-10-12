#!/usr/bin/env node
/**
 * Turns the JSON written by the benchmarks into a markdown report.
 *
 * Reads from bench-results/ (or the directory given as the first argument):
 *   baseline.json, current.json               speed (vitest bench --outputJson)
 *   memory-baseline.json, memory-current.json  memory (test/zip.memory.ts)
 * Baseline files are optional; without them the report lists the current
 * results with no comparison.
 */
import * as fs from 'fs';
import * as path from 'path';

/** A change only counts when it is at least this large (and beyond the margin of error). */
const NOISE_PCT = 10;

const dir = process.argv[2] ?? 'bench-results';

function readJson(name) {
  const file = path.join(dir, name);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : undefined;
}

/** Flatten vitest's output into Map<group, Map<name, benchmark>>, keeping file order. */
function speedResults(json) {
  const groups = new Map();
  for (const file of json?.files ?? []) {
    for (const group of file.groups) {
      // fullName is "test/zip.bench.ts > Zip: cold open + list"; the file part is just noise here
      const groupName = group.fullName.split(' > ').slice(1).join(' > ') || group.fullName;
      groups.set(groupName, new Map(group.benchmarks.map((b) => [b.name, b])));
    }
  }
  return groups;
}

/** Milliseconds as a short human-readable duration with 3 significant digits. */
function duration(ms) {
  const units = [
    [1e-3, 'ns', 1e6],
    [1, 'µs', 1e3],
    [1e3, 'ms', 1],
    [Infinity, 's', 1e-3]
  ];
  const [, unit, scale] = units.find(([limit]) => ms < limit);
  return `${Number((ms * scale).toPrecision(3))} ${unit}`;
}

const pct = (n) => `${n > 0 ? '+' : ''}${n.toFixed(0)}%`;

function compare(base, head) {
  const change = (head.median / base.median - 1) * 100;
  const noise = Math.max(NOISE_PCT, base.rme + head.rme);
  if (Math.abs(change) < noise) {
    return { kind: 'same', text: `≈ (${pct(change)})` };
  }
  return change > 0
    ? { kind: 'slower', text: `🔴 ${pct(change)} slower` }
    : { kind: 'faster', text: `🟢 ${(base.median / head.median).toFixed(2)}x faster` };
}

function table(header, rows) {
  const align = header.map((_, i) => (i === 0 ? ':--' : '--:'));
  return [header, align, ...rows].map((r) => `| ${r.join(' | ')} |`).join('\n');
}

function speedReport(baseJson, headJson) {
  const base = speedResults(baseJson);
  const head = speedResults(headJson);
  const out = ['### Speed', ''];

  if (!baseJson) {
    out.push('_main could not be benchmarked, so there is nothing to compare against._', '');
    for (const [group, benches] of head) {
      out.push(`#### ${group}`, '');
      const rows = [...benches.values()].map((b) => [b.name, duration(b.median), `±${b.rme.toFixed(1)}%`]);
      out.push(table(['Benchmark', 'Median', 'Margin'], rows), '');
    }
    return out;
  }

  const counts = { slower: 0, faster: 0, same: 0, new: 0 };
  const notable = [];
  const details = [];

  for (const [group, benches] of head) {
    const rows = [];
    for (const [name, h] of benches) {
      const b = base.get(group)?.get(name);
      const result = b ? compare(b, h) : { kind: 'new', text: 'new' };
      counts[result.kind]++;
      const row = [name, b ? duration(b.median) : '–', duration(h.median), result.text];
      rows.push(row);
      if (result.kind === 'slower' || result.kind === 'faster') {
        notable.push([`${group} › ${name}`, ...row.slice(1)]);
      }
    }
    details.push(`#### ${group}`, '', table(['Benchmark', 'main', 'This commit', 'Change'], rows), '');
  }

  const summary = [
    counts.slower && `🔴 ${counts.slower} slower`,
    counts.faster && `🟢 ${counts.faster} faster`,
    `${counts.same} unchanged`,
    counts.new && `${counts.new} new`
  ].filter(Boolean);
  out.push(`**${summary.join(' · ')}**`, '');
  out.push(
    `Median time per operation; lower is better. Changes under ${NOISE_PCT}% or within the combined ` +
      'margin of error are treated as noise (≈).',
    ''
  );

  if (notable.length) {
    out.push(table(['Benchmark', 'main', 'This commit', 'Change'], notable), '');
  }
  out.push('<details><summary>All speed results</summary>', '', ...details, '</details>', '');
  return out;
}

function memoryCell(base, head) {
  if (base === undefined) {
    return `${head} MB`;
  }
  const diff = Math.round((head - base) * 10) / 10;
  return diff === 0 ? `${head} MB` : `${base} → **${head} MB** (${diff > 0 ? '+' : ''}${diff})`;
}

function memoryReport(base, head) {
  if (!head) {
    return [];
  }
  const rows = [];
  for (const [archive, stages] of Object.entries(head)) {
    for (const [stage, h] of Object.entries(stages)) {
      const b = base?.[archive]?.[stage];
      rows.push([
        `${archive} ${stage}`,
        memoryCell(b?.['heap MB'], h['heap MB']),
        memoryCell(b?.['buffers MB'], h['buffers MB'])
      ]);
    }
  }
  return [
    '### Memory retained by the ZIP handler',
    '',
    base ? 'Values that differ from main are shown as main → this commit.' : '_No main results to compare against._',
    '',
    table(['Archive / stage', 'Heap', 'Buffers'], rows),
    ''
  ];
}

const lines = [
  '## Benchmarks',
  '',
  ...speedReport(readJson('baseline.json'), readJson('current.json')),
  ...memoryReport(readJson('memory-baseline.json'), readJson('memory-current.json'))
];
console.log(lines.join('\n'));
