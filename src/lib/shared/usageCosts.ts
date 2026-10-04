export interface ImageCostTotals {
  imageEstimatedCostUsd?: number;
  imageCostKnownRequests?: number;
  imageCostUnknownRequests?: number;
}

/** Unknown provider prices remain separate from the known estimate. */
export function addImageCost(target: ImageCostTotals, record: { capability?: string; estimatedCostUsd?: number }): void {
  if (record.capability !== "image") return;
  if (record.estimatedCostUsd === undefined) {
    target.imageCostUnknownRequests = (target.imageCostUnknownRequests ?? 0) + 1;
  } else {
    target.imageEstimatedCostUsd = (target.imageEstimatedCostUsd ?? 0) + record.estimatedCostUsd;
    target.imageCostKnownRequests = (target.imageCostKnownRequests ?? 0) + 1;
  }
}
