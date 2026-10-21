/**
 * Normalize human-readable exchange actions to Hyperliquid wire format.
 */

import { ValidationError } from './errors';

export interface NormalizeExchangeActionContext {
  slippage: number;
  priorityFee?: number;
  builder?: { b: string; f: number };
  resolveAssetIndex: (asset: string) => Promise<number>;
  getMid: (asset: string) => Promise<number>;
  getSizeDecimals: (asset: string) => Promise<number>;
}

export function floatToWire(x: number | string): string {
  const num = typeof x === 'string' ? Number.parseFloat(x) : x;
  if (!Number.isFinite(num)) {
    throw new ValidationError(`Invalid numeric value: ${x}`);
  }

  const rounded = num.toFixed(8);
  if (Math.abs(Number.parseFloat(rounded) - num) >= 1e-12) {
    throw new ValidationError(`Value ${x} cannot be represented as wire float`, {
      guidance: 'Use a value with at most 8 decimal places.',
    });
  }

  let normalized = rounded.replace(/(?:\.0+|(\.\d+?)0+)$/, '$1');
  if (normalized === '-0') normalized = '0';
  return normalized;
}

function wireTif(tif: string): string {
  const lower = tif.toLowerCase();
  if (lower === 'market') return 'Ioc';
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function isWireOrder(order: Record<string, unknown>): boolean {
  return typeof order.a === 'number';
}

function sideToIsBuy(side: unknown): boolean {
  if (typeof side === 'boolean') return side;
  const value = String(side ?? '').toLowerCase();
  if (value === 'buy' || value === 'long' || value === 'true') return true;
  if (value === 'sell' || value === 'short' || value === 'false') return false;
  throw new ValidationError(`Invalid order side: ${String(side)}`, {
    guidance: 'Use "buy" or "sell".',
  });
}

async function normalizeOrderAction(
  action: Record<string, unknown>,
  ctx: NormalizeExchangeActionContext
): Promise<Record<string, unknown>> {
  const orders = action.orders;
  if (!Array.isArray(orders) || orders.length === 0) {
    throw new ValidationError('Order action requires a non-empty orders array');
  }

  const wireOrders: Record<string, unknown>[] = [];
  for (const rawOrder of orders) {
    const order = rawOrder as Record<string, unknown>;
    if (isWireOrder(order)) {
      wireOrders.push(order);
      continue;
    }

    const assetName = String(order.asset ?? order.coin ?? '');
    if (!assetName) {
      throw new ValidationError('Order is missing asset', {
        guidance: 'Set orders[].asset to a market name like "BTC".',
      });
    }

    const assetIndex = await ctx.resolveAssetIndex(assetName);
    const isBuy = sideToIsBuy(order.side ?? order.isBuy ?? order.b);
    const reduceOnly = Boolean(order.reduceOnly ?? order.reduce_only ?? order.r ?? false);
    const sizeRaw = order.size ?? order.sz ?? order.s;
    if (sizeRaw == null) {
      throw new ValidationError('Order is missing size');
    }

    const tifRaw = String(order.tif ?? 'ioc').toLowerCase();
    const isMarket = tifRaw === 'market';
    let priceRaw = order.price ?? order.limitPx ?? order.p;

    if (isMarket || priceRaw == null) {
      const mid = await ctx.getMid(assetName);
      if (mid <= 0) {
        throw new ValidationError(`Could not fetch price for ${assetName}`);
      }
      const adjusted = isBuy ? mid * (1 + ctx.slippage) : mid * (1 - ctx.slippage);
      const isSpot = assetIndex >= 10000;
      const szDecimals = await ctx.getSizeDecimals(assetName);
      const decimals = Math.max(0, (isSpot ? 8 : 6) - szDecimals);
      const rounded = Number(Number(adjusted.toPrecision(5)).toFixed(decimals));
      priceRaw = floatToWire(rounded);
    }

    const wireOrder: Record<string, unknown> = {
      a: assetIndex,
      b: isBuy,
      p: floatToWire(String(priceRaw)),
      s: floatToWire(String(sizeRaw)),
      r: reduceOnly,
      t: { limit: { tif: wireTif(tifRaw) } },
    };

    const cloid = order.cloid ?? order.c;
    if (cloid != null) {
      wireOrder.c = String(cloid);
    }

    wireOrders.push(wireOrder);
  }

  let grouping: unknown = action.grouping ?? 'na';
  if (ctx.priorityFee !== undefined) {
    grouping = { p: ctx.priorityFee };
  }

  const wireAction: Record<string, unknown> = {
    type: 'order',
    orders: wireOrders,
    grouping,
  };

  if (ctx.builder) {
    wireAction.builder = {
      b: ctx.builder.b.toLowerCase(),
      f: ctx.builder.f,
    };
  } else if (action.builder) {
    wireAction.builder = action.builder;
  }

  return wireAction;
}

export async function normalizeExchangeAction(
  action: Record<string, unknown>,
  ctx: NormalizeExchangeActionContext
): Promise<Record<string, unknown>> {
  const actionType = String(action.type ?? '');

  if (actionType === 'order') {
    return normalizeOrderAction(action, ctx);
  }

  if (isUserSignedAction(action)) {
    return { ...action };
  }

  return { ...action };
}

function isUserSignedAction(action: Record<string, unknown>): boolean {
  const type = String(action.type ?? '');
  return [
    'approveBuilderFee',
    'approveAgent',
    'usdSend',
    'spotSend',
    'withdraw3',
    'usdClassTransfer',
    'sendAsset',
  ].includes(type);
}
