// Keeps the solve off the main thread so the page stays responsive on a big run.
import loadHighs from '../vendor/highs.mjs';
import { solve } from './solve.js';

let highs;

onmessage = async ({ data }) => {
  try {
    highs ??= await loadHighs();
    const { assignments, unplaced, metrics, report } = solve({ highs, ...data });
    postMessage({ assignments, unplaced, metrics, errors: report.errors, warnings: report.warnings });
  } catch (e) {
    postMessage({ fatal: e.message || String(e) });
  }
};
