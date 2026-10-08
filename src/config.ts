import deployment from './deployment.json'

// Public config only. Every value here ships to the browser. Never read secrets in this app.
const env = import.meta.env

export const config = {
  network: (env.VITE_SUI_NETWORK ?? deployment.network) as 'testnet' | 'mainnet' | 'devnet' | 'localnet',
  packageId: env.VITE_PACKAGE_ID || deployment.packageId,
  shopId: env.VITE_SHOP_ID || deployment.shopId,
  walrusPublisher: env.VITE_WALRUS_PUBLISHER ?? 'https://publisher.walrus-testnet.walrus.space',
  walrusAggregator: env.VITE_WALRUS_AGGREGATOR ?? 'https://aggregator.walrus-testnet.walrus.space',
  walrusEpochs: Number(env.VITE_WALRUS_EPOCHS ?? 5),
}

export const isContractConfigured = () => Boolean(config.packageId && config.shopId)
