import test, { before } from 'node:test';
import { verifyLayerActions, assertZipResults, assertMergeResults, assertInvalidResults } from '../scripts/verify-layer-actions.mjs';

let report;
before(async () => { report = await verifyLayerActions(); });
test('visible layers export unique safe PNG filenames in a shared full/cropped ZIP frame', () => { assertZipResults(report); });
test('merging bakes effects once, preserves alpha and order, and leaves the input untouched', () => { assertMergeResults(report); });
test('invalid selections, dimensions and budgets fail before expensive allocation', () => { assertInvalidResults(report); });
