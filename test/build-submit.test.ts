/**
 * Tests for split build/submit exchange flow (backend → client sign → backend send).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Wallet } from 'ethers';
import { HyperliquidSDK } from '../src/client';
import { SignerError } from '../src/errors';
import { MAINNET_EXCHANGE_URL } from '../src/signing';

const WIRE_ORDER_ACTION = {
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

function mockNativeExchangeFetch(): { calls: any[]; restore: () => void } {
  const calls: any[] = [];
  const fn = vi.fn(async (url: string, init: any) => {
    expect(url).toBe(MAINNET_EXCHANGE_URL);
    const body = JSON.parse(init.body);
    calls.push(body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ status: 'ok', response: { type: 'order', data: { statuses: [] } } }),
    } as any;
  });
  const original = globalThis.fetch;
  globalThis.fetch = fn as any;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

afterEach(() => {
  delete process.env.PRIVATE_KEY;
});

describe('buildExchangeAction / submitSignedExchangeAction (native API)', () => {
  const builder = '0x8D62d3000eF0639d1fc9667D06BE7BB98d9993F5';

  it('buildExchangeAction works without a wallet and returns typedData only', async () => {
    delete process.env.PRIVATE_KEY;
    const sdk = new HyperliquidSDK('https://x.quiknode.pro/T', builder);

    const payload = await sdk.buildExchangeAction(WIRE_ORDER_ACTION, { slippage: 0.05 });

    expect(payload.action).toEqual(WIRE_ORDER_ACTION);
    expect(typeof payload.nonce).toBe('number');
    expect(payload.typedData.primaryType).toBe('Agent');
    expect(payload.typedData.message.source).toBe('a');
    expect(payload.typedData.message.connectionId).toMatch(/^0x[0-9a-f]{64}$/i);
    expect('hash' in payload).toBe(false);
  });

  it('submitSignedExchangeAction posts to api.hyperliquid.xyz/exchange', async () => {
    delete process.env.PRIVATE_KEY;
    const sdk = new HyperliquidSDK('https://x.quiknode.pro/T', builder);
    const signature = { r: '0xaa', s: '0xbb', v: 28 };

    const { calls, restore } = mockNativeExchangeFetch();
    try {
      const result = await sdk.submitSignedExchangeAction({
        action: WIRE_ORDER_ACTION,
        nonce: 123,
        signature,
      });

      expect(result.success).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({ action: WIRE_ORDER_ACTION, nonce: 123, signature });
    } finally {
      restore();
    }
  });

  it('rejects malformed signatures before sending', async () => {
    delete process.env.PRIVATE_KEY;
    const sdk = new HyperliquidSDK('https://x.quiknode.pro/T', builder);

    const { calls, restore } = mockNativeExchangeFetch();
    let err: unknown;
    try {
      err = await sdk.submitSignedExchangeAction({
        action: WIRE_ORDER_ACTION,
        nonce: 123,
        signature: { r: '', s: '0x2', v: 27 },
      }).catch((e: unknown) => e);
    } finally {
      restore();
    }

    expect(err).toBeInstanceOf(SignerError);
    expect(calls).toHaveLength(0);
  });

  it('supports the full backend → client → backend flow with EIP-712 signing', async () => {
    const wallet = new Wallet('0x' + '11'.repeat(32));
    const sdk = new HyperliquidSDK('https://x.quiknode.pro/T', builder, {
      privateKey: wallet.privateKey,
    });

    const { calls, restore } = mockNativeExchangeFetch();
    try {
      const buildPayload = await sdk.buildExchangeAction(WIRE_ORDER_ACTION);
      const signature = await sdk.signExchangeActionPayload(buildPayload);
      const result = await sdk.submitSignedExchangeAction({
        action: buildPayload.action,
        nonce: buildPayload.nonce,
        signature,
      });

      expect(result.success).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0].signature).toEqual(signature);
    } finally {
      restore();
    }
  });

  it('can attach a custom builder code to wire orders', async () => {
    delete process.env.PRIVATE_KEY;
    const sdk = new HyperliquidSDK('https://x.quiknode.pro/T', builder);
    const customBuilder = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';

    const payload = await sdk.buildExchangeAction(WIRE_ORDER_ACTION, {
      builder: { b: customBuilder, f: 10 },
    });

    expect(payload.action.builder).toEqual({
      b: customBuilder.toLowerCase(),
      f: 10,
    });
  });
});
