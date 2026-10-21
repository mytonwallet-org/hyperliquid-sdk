/**
 * Hyperliquid SDK for TypeScript
 *
 * A complete, type-safe client for the Hyperliquid exchange.
 *
 * @packageDocumentation
 */

export * from './types';

// Main SDK client
export { HyperliquidSDK, HyperliquidSDKOptions, PredictionMarkets, Signer } from './client';

export {
  MAINNET_EXCHANGE_URL,
  TESTNET_EXCHANGE_URL,
  buildSignPayload,
  signExchangePayload,
  actionHash,
  isUserSignedAction,
} from './signing';
export type { BuildSignPayloadOptions, BuildSignPayloadResult } from './signing';

// Order builders
export { Order, TriggerOrder, PlacedOrder } from './order';

// Info API client
export { Info } from './info';

// HyperCore JSON-RPC client
export { HyperCore } from './hypercore';

// EVM JSON-RPC client
export { EVM } from './evm';

// WebSocket streaming
export { Stream, StreamType, ConnectionState as StreamConnectionState, StreamOptions } from './websocket';

// gRPC streaming
export { GRPCStream, GRPCStreamType, GRPCStreamOptions, ConnectionState as GRPCConnectionState } from './grpc-stream';

// EVM WebSocket streaming
export { EVMStream, EVMSubscriptionType, EVMStreamOptions, ConnectionState as EVMConnectionState } from './evm-stream';

// Errors
export {
  HyperliquidError,
  BuildError,
  SendError,
  ApprovalError,
  ValidationError,
  SignatureError,
  SignerError,
  NoPositionError,
  OrderNotFoundError,
  GeoBlockedError,
  InsufficientMarginError,
  LeverageError,
  RateLimitError,
  MaxOrdersError,
  ReduceOnlyError,
  DuplicateOrderError,
  UserNotFoundError,
  MustDepositError,
  InvalidNonceError,
  ErrorOptions,
  parseApiError,
} from './errors';

// Re-export commonly used types
export type { default as WebSocket } from 'ws';
