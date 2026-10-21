import { describe, it, expect } from 'vitest';
import { actionHash } from '../src/signing';

describe('native signing', () => {
  it('builds a deterministic L1 digest for a wire order action', () => {
    const action = {
      type: 'order',
      orders: [{
        a: 0,
        b: true,
        p: '100000',
        s: '0.001',
        r: false,
        t: { limit: { tif: 'Ioc' } },
      }],
      grouping: 'na',
    };

    const nonce = 1700000000000;
    const connectionId = actionHash(action, null, nonce, null);

    expect(connectionId).toMatch(/^0x[0-9a-f]{64}$/i);
  });
});
