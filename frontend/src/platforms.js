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
      autoSync: true,
      conditions: 'All conditions',
      priceModifier: 'Base + 7% (fees)',
      minPrice: '$5.00',
    },
  },
  abebooks: {
    id: 'abebooks',
    name: 'AbeBooks',
    description: 'Rare and used book marketplace',
    connected: false,
    rules: {
      autoSync: true,
      conditions: 'New, Like New, Very Good',
      priceModifier: 'Base + 15%',
      minPrice: '$10.00',
    },
  },
  etsy: {
    id: 'etsy',
    name: 'Etsy',
    description: 'Vintage and collectible listings',
    connected: false,
    rules: {
      autoSync: false,
      conditions: 'Vintage only (pre-2006)',
      priceModifier: 'Base + 20%',
      minPrice: '—',
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
