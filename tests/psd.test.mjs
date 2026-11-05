import test from 'node:test';
import { verifyPsd } from '../scripts/verify-psd.mjs';

test('PSD browser round trip preserves real layers, PNG coordinates, visibility, alpha and guarded memory', { timeout: 120000 }, async () => {
  const result = await verifyPsd();
  for (const item of result.cases) {
    console.log(`${item.id}: ${item.width}x${item.height}; layers=${item.layers.length}; composite alpha delta=${item.mergedDifference.maxAlpha}; recomposed alpha delta=${item.layerDifference.maxAlpha}; premultiplied RGB delta=${item.layerDifference.maxPremultiplied.toFixed(3)}`);
  }
  console.log(`8BPS v1 decoded; ${result.cases.length} real browser cases; ${result.invalid.length} rejected invalid size/memory inputs`);
});
