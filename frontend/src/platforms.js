export const PLATFORMS = {
  overview: {
    id: 'overview',
    name: 'Shopify',
    shortName: 'All',
    description: 'Master catalog synced from your store',
  },
  ebay: {
    id: 'ebay',
    name: 'eBay',
    description: 'Auction and Buy It Now listings',
    connected: false,
    rules: {
      autoSync: false,
      conditions: 'All conditions',
      priceModifier: 'Base × 1.10, round up to X.99',
      minPrice: '$5.00',
    },
  },
  abebooks: {
    id: 'abebooks',
    name: 'AbeBooks',
    description: 'Rare and used book marketplace (export channel)',
    connected: false,
    rules: {
      autoSync: false,
      conditions: 'New, Like New, Very Good, Good',
      priceModifier: 'Base × 1.15, round up to X.99',
      minPrice: '$4.50',
    },
  },
  etsy: {
    id: 'etsy',
    name: 'Etsy',
    description: 'Vintage and collectible listings',
    connected: false,
    rules: {
      autoSync: false,
      conditions: 'Vintage only (published before 2006)',
      priceModifier: 'Base × 1.20, round up to X.99',
      minPrice: '$10.00',
    },
  },
};

export function getListing(product, platformId) {
  return product.platform_listings?.find((listing) => listing.platform === platformId) || null;
}

export function getListingStatus(product, platformId) {
  const listing = getListing(product, platformId);
  if (!listing) return 'unlisted';
  return listing.status;
}
