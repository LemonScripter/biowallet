// Entry point for wc2.min.js bundle
// Exports: globalThis.WC2 = { WalletKit, Core }
import { WalletKit } from '@reown/walletkit';
import { Core } from '@walletconnect/core';
globalThis.WC2 = { WalletKit, Core };
