/**
 * BioWallet — WalletConnect v2 Session Manager
 *
 * Szükséges: window.WC2 = { Web3Wallet, Core } (vendor/wc2.min.js)
 * Project ID: cloud.walletconnect.com → ingyenes regisztráció
 */

// ▶ Töltsd ki a saját Project ID-ddel (cloud.walletconnect.com):
export const WC_PROJECT_ID = 'fdf425d1424d316dc22882ae63c23901';

const WC_METADATA = {
  name:        'BioWallet',
  description: 'Biometric Ethereum Wallet — biowallet.metaspace.bio',
  url:         'https://biowallet.metaspace.bio',
  icons:       [],
};

let _wallet = null;

export async function initWC(handlers) {
  if (!window.WC2?.Web3Wallet) throw new Error('wc2.min.js nincs betöltve');
  if (!WC_PROJECT_ID)           throw new Error('WC_PROJECT_ID nincs beállítva (src/core/wc2.js)');

  const core = new window.WC2.Core({ projectId: WC_PROJECT_ID });
  _wallet    = await window.WC2.Web3Wallet.init({ core, metadata: WC_METADATA });

  _wallet.on('session_proposal', (p) => handlers.onProposal?.(p));
  _wallet.on('session_request',  (r) => handlers.onRequest?.(r));
  _wallet.on('session_delete',   (d) => handlers.onSessionDelete?.(d));

  return _wallet;
}

export async function wcPair(uri) {
  if (!_wallet) throw new Error('WC nincs inicializálva');
  return _wallet.core.pairing.pair({ uri: uri.trim() });
}

export async function wcApprove(id, address, chainId) {
  return _wallet.approveSession({
    id,
    namespaces: {
      eip155: {
        methods:  ['eth_sendTransaction', 'personal_sign', 'eth_signTypedData_v4'],
        chains:   [`eip155:${chainId}`],
        events:   ['accountsChanged', 'chainChanged'],
        accounts: [`eip155:${chainId}:${address}`],
      },
    },
  });
}

export async function wcRejectProposal(id) {
  return _wallet.rejectSession({ id, reason: { code: 4001, message: 'User rejected' } });
}

export async function wcRespondOk(topic, id, result) {
  return _wallet.respondSessionRequest({ topic, response: { id, jsonrpc: '2.0', result } });
}

export async function wcRespondError(topic, id, message = 'User rejected') {
  return _wallet.respondSessionRequest({
    topic,
    response: { id, jsonrpc: '2.0', error: { code: 4001, message } },
  });
}

export function wcGetSessions() {
  return _wallet ? Object.values(_wallet.getActiveSessions()) : [];
}

export async function wcDisconnect(topic) {
  if (!_wallet) return;
  return _wallet.disconnectSession({ topic, reason: { code: 6000, message: 'User disconnected' } })
    .catch(() => {});
}

export function wcReady() {
  return _wallet !== null;
}
