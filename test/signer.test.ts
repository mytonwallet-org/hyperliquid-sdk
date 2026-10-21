/**
 * Tests for the external-signer feature (WithSigner-equivalent).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { HyperliquidSDK, Signer } from '../src/client';
import { SignerError, SignatureError } from '../src/errors';
import { ExchangeTypedData } from '../src/types';
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
    if (url === MAINNET_EXCHANGE_URL) {
      const body = JSON.parse(init.body);
      calls.push(body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: 'ok', response: { type: 'order', data: { statuses: [] } } }),
      } as any;
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  });
  const original = globalThis.fetch;
  globalThis.fetch = fn as any;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

afterEach(() => {
  delete process.env.PRIVATE_KEY;
});

describe('external signer', () => {
  const builder = '0x8D62d3000eF0639d1fc9667D06BE7BB98d9993F5';

  it('constructs with a signer only and exposes signerAddress', () => {
    delete process.env.PRIVATE_KEY;
    const addr = '0x1234567890123456789012345678901234567890';
    const sdk = new HyperliquidSDK('https://x.quiknode.pro/T', builder, {
      signer: () => ({ r: '0x1', s: '0x2', v: 27 }),
      signerAddress: addr,
    });
    expect(sdk.address).toBe(addr);
    expect((sdk as any)._wallet).toBeNull();
    expect((sdk as any)._signer).not.toBeNull();
  });

  it('never reads PRIVATE_KEY env when a signer is set', () => {
    process.env.PRIVATE_KEY = '0x' + '11'.repeat(32);
    const sdk = new HyperliquidSDK('https://x.quiknode.pro/T', builder, {
      signer: () => ({ r: '0x1', s: '0x2', v: 27 }),
    });
    expect((sdk as any)._wallet).toBeNull();
  });

  it('routes typedData through the signer and forwards r/s/v', async () => {
    delete process.env.PRIVATE_KEY;
    let seenTypedData: ExchangeTypedData | undefined;
    const signer: Signer = (typedData) => {
      seenTypedData = typedData;
      return { r: '0xaa', s: '0xbb', v: 28 };
    };
    const sdk = new HyperliquidSDK('https://x.quiknode.pro/T', builder, { signer, autoApprove: false });

    const { calls, restore } = mockNativeExchangeFetch();
    try {
      await (sdk as any)._buildSignSend(WIRE_ORDER_ACTION);
    } finally {
      restore();
    }

    expect(seenTypedData?.primaryType).toBe('Agent');
    expect(calls).toHaveLength(1);
    expect(calls[0].signature).toEqual({ r: '0xaa', s: '0xbb', v: 28 });
  });

  it('passes an AbortSignal to the signer', async () => {
    delete process.env.PRIVATE_KEY;
    let gotSignal: AbortSignal | undefined;
    const signer: Signer = (_typedData, opts) => {
      gotSignal = opts?.signal;
      return { r: '0x1', s: '0x2', v: 27 };
    };
    const sdk = new HyperliquidSDK('https://x.quiknode.pro/T', builder, { signer, autoApprove: false });

    const { restore } = mockNativeExchangeFetch();
    try {
      await (sdk as any)._buildSignSend(WIRE_ORDER_ACTION);
    } finally {
      restore();
    }
    expect(gotSignal).toBeInstanceOf(AbortSignal);
  });

  it('wraps a signer failure in SignerError (not SignatureError) with cause', async () => {
    delete process.env.PRIVATE_KEY;
    const boom = new Error('kms unavailable');
    const signer: Signer = () => { throw boom; };
    const sdk = new HyperliquidSDK('https://x.quiknode.pro/T', builder, { signer, autoApprove: false });

    const { restore } = mockNativeExchangeFetch();
    let err: unknown;
    try {
      err = await (sdk as any)._buildSignSend(WIRE_ORDER_ACTION).catch((e: unknown) => e);
    } finally {
      restore();
    }

    expect(err).toBeInstanceOf(SignerError);
    expect(err).not.toBeInstanceOf(SignatureError);
    expect((err as SignerError).code).toBe('SIGNER_FAILED');
    expect((err as Error).cause).toBe(boom);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['missing v', { r: '0x1', s: '0x2' }],
    ['empty r', { r: '', s: '0x2', v: 27 }],
    ['bad v (raw recovery id)', { r: '0x1', s: '0x2', v: 0 }],
  ])('wraps a malformed signer return (%s) in SignerError, never sending it', async (_label, bad) => {
    delete process.env.PRIVATE_KEY;
    const signer = (() => bad) as unknown as Signer;
    const sdk = new HyperliquidSDK('https://x.quiknode.pro/T', builder, { signer, autoApprove: false });

    const { calls, restore } = mockNativeExchangeFetch();
    let err: unknown;
    try {
      err = await (sdk as any)._buildSignSend(WIRE_ORDER_ACTION).catch((e: unknown) => e);
    } finally {
      restore();
    }

    expect(err).toBeInstanceOf(SignerError);
    expect((err as SignerError).code).toBe('SIGNER_FAILED');
    expect(calls).toHaveLength(0);
  });

  it('skips builder-fee auto-approve under an external signer', async () => {
    delete process.env.PRIVATE_KEY;
    const sdk = new HyperliquidSDK('https://x.quiknode.pro/T', builder, {
      signer: () => ({ r: '0x1', s: '0x2', v: 27 }),
      autoApprove: true,
    });

    const { calls, restore } = mockNativeExchangeFetch();
    try {
      await (sdk as any)._buildSignSend(WIRE_ORDER_ACTION);
    } finally {
      restore();
    }
    expect(calls).toHaveLength(1);
  });
});
