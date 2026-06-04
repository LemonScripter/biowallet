/**
 * BioWallet — Feature Flags
 *
 * Toggle a feature with one command:
 *   Enable:  sed -i 's/BUY_MODULE: false/BUY_MODULE: true/' src/config/features.js
 *   Disable: sed -i 's/BUY_MODULE: true/BUY_MODULE: false/' src/config/features.js
 */
export const FEATURES = {
  BUY_MODULE: true,    // BioWallet Protected Buy/Sell (v36)
};

// Kept for backward compatibility with any cached app.js version
export const BUY_SUPPORTED_CHAINS = new Set([1, 56, 137, 42161, 8453, 10]);

