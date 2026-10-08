const env = import.meta.env

export const config = {
  network: (env.VITE_SUI_NETWORK ?? 'testnet') as 'testnet' | 'mainnet' | 'devnet' | 'localnet',
  packageId: env.VITE_PACKAGE_ID ?? '',
  shopId: env.VITE_SHOP_ID ?? '',
  walrusPublisher: env.VITE_WALRUS_PUBLISHER ?? 'https://publisher.walrus-testnet.walrus.space',
  walrusAggregator: env.VITE_WALRUS_AGGREGATOR ?? 'https://aggregator.walrus-testnet.walrus.space',
  walrusEpochs: Number(env.VITE_WALRUS_EPOCHS ?? 5),
}

export const isContractConfigured = () => Boolean(config.packageId && config.shopId)
