export interface FeedCanvasResizePair {
  firstSize: number;
  secondSize: number;
  firstWeight: number;
  secondWeight: number;
}

export function computeFeedCanvasResizePair({
  startFirstSize,
  combinedSize,
  combinedWeight,
  delta,
  minSize = 1,
}: {
  startFirstSize: number;
  combinedSize: number;
  combinedWeight: number;
  delta: number;
  minSize?: number;
}): FeedCanvasResizePair {
  const safeCombinedSize = Math.max(minSize * 2, combinedSize);
  const firstSize = Math.max(
    minSize,
    Math.min(safeCombinedSize - minSize, startFirstSize + delta),
  );
  const secondSize = safeCombinedSize - firstSize;
  return {
    firstSize,
    secondSize,
    firstWeight: combinedWeight * (firstSize / safeCombinedSize),
    secondWeight: combinedWeight * (secondSize / safeCombinedSize),
  };
}
