/**
 * Hyperliquid L1 and user-signed action hashing / EIP-712 payloads.
 *
 * Mirrors hyperliquid-python-sdk/hyperliquid/utils/signing.py.
 */

import { encode } from '@msgpack/msgpack';
import { Wallet, Signature as EthersSignature, keccak256, getBytes } from 'ethers';

import { Signature, ExchangeTypedData } from './types';

export const MAINNET_EXCHANGE_URL = 'https://api.hyperliquid.xyz/exchange';
export const TESTNET_EXCHANGE_URL = 'https://api.hyperliquid-testnet.xyz/exchange';

export interface BuildSignPayloadOptions {
  isMainnet: boolean;
  vaultAddress?: string | null;
  expiresAfter?: number | null;
  signatureChainId?: string;
}

const USER_SIGNED_TYPES = new Set([
  'approveBuilderFee',
  'approveAgent',
  'usdSend',
  'spotSend',
  'withdraw3',
  'usdClassTransfer',
  'sendAsset',
  'userDexAbstraction',
  'userSetAbstraction',
  'convertToMultiSigUser',
  'tokenDelegate',
  'sendMultiSig',
]);

const USER_SIGNED_CONFIG: Record<
  string,
  { primaryType: string; payloadTypes: Array<{ name: string; type: string }> }
> = {
  approveBuilderFee: {
    primaryType: 'HyperliquidTransaction:ApproveBuilderFee',
    payloadTypes: [
      { name: 'hyperliquidChain', type: 'string' },
      { name: 'maxFeeRate', type: 'string' },
      { name: 'builder', type: 'address' },
      { name: 'nonce', type: 'uint64' },
    ],
  },
  approveAgent: {
    primaryType: 'HyperliquidTransaction:ApproveAgent',
    payloadTypes: [
      { name: 'hyperliquidChain', type: 'string' },
      { name: 'agentAddress', type: 'address' },
      { name: 'agentName', type: 'string' },
      { name: 'nonce', type: 'uint64' },
    ],
  },
  usdSend: {
    primaryType: 'HyperliquidTransaction:UsdSend',
    payloadTypes: [
      { name: 'hyperliquidChain', type: 'string' },
      { name: 'destination', type: 'string' },
      { name: 'amount', type: 'string' },
      { name: 'time', type: 'uint64' },
    ],
  },
  spotSend: {
    primaryType: 'HyperliquidTransaction:SpotSend',
    payloadTypes: [
      { name: 'hyperliquidChain', type: 'string' },
      { name: 'destination', type: 'string' },
      { name: 'token', type: 'string' },
      { name: 'amount', type: 'string' },
      { name: 'time', type: 'uint64' },
    ],
  },
  withdraw3: {
    primaryType: 'HyperliquidTransaction:Withdraw',
    payloadTypes: [
      { name: 'hyperliquidChain', type: 'string' },
      { name: 'destination', type: 'string' },
      { name: 'amount', type: 'string' },
      { name: 'time', type: 'uint64' },
    ],
  },
  usdClassTransfer: {
    primaryType: 'HyperliquidTransaction:UsdClassTransfer',
    payloadTypes: [
      { name: 'hyperliquidChain', type: 'string' },
      { name: 'amount', type: 'string' },
      { name: 'toPerp', type: 'bool' },
      { name: 'nonce', type: 'uint64' },
    ],
  },
  sendAsset: {
    primaryType: 'HyperliquidTransaction:SendAsset',
    payloadTypes: [
      { name: 'hyperliquidChain', type: 'string' },
      { name: 'destination', type: 'string' },
      { name: 'sourceDex', type: 'string' },
      { name: 'destinationDex', type: 'string' },
      { name: 'token', type: 'string' },
      { name: 'amount', type: 'string' },
      { name: 'fromSubAccount', type: 'string' },
      { name: 'nonce', type: 'uint64' },
    ],
  },
};

export function isUserSignedAction(action: Record<string, unknown>): boolean {
  return USER_SIGNED_TYPES.has(String(action.type ?? ''));
}

function addressToBytes(address: string): Uint8Array {
  const hex = address.startsWith('0x') ? address.slice(2) : address;
  return getBytes(`0x${hex}`);
}

export function actionHash(
  action: Record<string, unknown>,
  vaultAddress: string | null | undefined,
  nonce: number,
  expiresAfter: number | null | undefined
): string {
  const parts: Uint8Array[] = [encode(action)];
  const nonceBytes = new Uint8Array(8);
  new DataView(nonceBytes.buffer).setBigUint64(0, BigInt(nonce));
  parts.push(nonceBytes);

  if (vaultAddress == null) {
    parts.push(new Uint8Array([0]));
  } else {
    parts.push(new Uint8Array([1]));
    parts.push(addressToBytes(vaultAddress));
  }

  if (expiresAfter != null) {
    parts.push(new Uint8Array([0]));
    const expiresBytes = new Uint8Array(8);
    new DataView(expiresBytes.buffer).setBigUint64(0, BigInt(expiresAfter));
    parts.push(expiresBytes);
  }

  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const data = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    data.set(part, offset);
    offset += part.length;
  }

  return keccak256(data);
}

function l1TypedData(actionHashHex: string, isMainnet: boolean): ExchangeTypedData {
  return {
    domain: {
      chainId: 1337,
      name: 'Exchange',
      verifyingContract: '0x0000000000000000000000000000000000000000',
      version: '1',
    },
    types: {
      Agent: [
        { name: 'source', type: 'string' },
        { name: 'connectionId', type: 'bytes32' },
      ],
    },
    primaryType: 'Agent',
    message: {
      source: isMainnet ? 'a' : 'b',
      connectionId: actionHashHex,
    },
  };
}

function userSignedTypedData(
  primaryType: string,
  payloadTypes: Array<{ name: string; type: string }>,
  message: Record<string, unknown>,
  signatureChainId: string
): ExchangeTypedData {
  const chainId = Number.parseInt(signatureChainId, 16);
  return {
    domain: {
      name: 'HyperliquidSignTransaction',
      version: '1',
      chainId,
      verifyingContract: '0x0000000000000000000000000000000000000000',
    },
    types: {
      [primaryType]: payloadTypes,
    },
    primaryType,
    message,
  };
}

export interface BuildSignPayloadResult {
  typedData: ExchangeTypedData;
  action: Record<string, unknown>;
  nonce: number;
}

export function buildSignPayload(
  action: Record<string, unknown>,
  options: BuildSignPayloadOptions
): BuildSignPayloadResult {
  const actionType = String(action.type ?? '');

  if (isUserSignedAction(action)) {
    const config = USER_SIGNED_CONFIG[actionType];
    if (!config) {
      throw new Error(`Unsupported user-signed action type: ${actionType}`);
    }

    const nonce = Number(action.nonce ?? action.time ?? Date.now());
    const message: Record<string, unknown> = {
      ...action,
      signatureChainId: options.signatureChainId ?? '0x66eee',
      hyperliquidChain: options.isMainnet ? 'Mainnet' : 'Testnet',
    };

    const typedData = userSignedTypedData(
      config.primaryType,
      config.payloadTypes,
      message,
      String(message.signatureChainId)
    );

    return {
      typedData,
      action: message,
      nonce,
    };
  }

  const nonce = Date.now();
  const connectionId = actionHash(action, options.vaultAddress ?? null, nonce, options.expiresAfter ?? null);
  const typedData = l1TypedData(connectionId, options.isMainnet);

  return {
    typedData,
    action,
    nonce,
  };
}

export async function signExchangePayload(
  typedData: ExchangeTypedData,
  wallet: Wallet
): Promise<Signature> {
  const sigHex = await wallet.signTypedData(
    typedData.domain,
    typedData.types,
    typedData.message
  );
  const sig = EthersSignature.from(sigHex);
  return { r: sig.r, s: sig.s, v: sig.v };
}
