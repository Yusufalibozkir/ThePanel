// metadata_status drives UI badges and rule eligibility:
//   ok         — enough canonical metadata from tags (author + condition + year)
//   partial    — some metadata from tags, key fields missing
//   unverified — any field auto-filled from OpenLibrary (needs review)
//   missing    — neither author nor condition known

const computeMetadataStatus = ({ author, year, condition, enriched = {} }) => {
  const usedEnrichment = Boolean(enriched.author || enriched.year || enriched.condition);
  if (usedEnrichment) return 'unverified';
  if (!author && !condition) return 'missing';
  if (author && condition && year) return 'ok';
  return 'partial';
};

module.exports = {
  computeMetadataStatus,
};
