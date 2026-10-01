export const FEED_CHAT_BOTTOM_THRESHOLD = 48;
export const FEED_CHAT_COMPOSER_RATIO = 0.4;
export const FEED_CHAT_COMPOSER_CHROME_HEIGHT = 62;

export interface FeedChatScrollMetrics {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}

export function isFeedChatNearBottom(
  metrics: FeedChatScrollMetrics,
  threshold = FEED_CHAT_BOTTOM_THRESHOLD,
): boolean {
  return metrics.scrollTop + metrics.clientHeight >= metrics.scrollHeight - threshold;
}

export function getFeedComposerTextareaMaxHeight(
  shellHeight: number | null,
  minHeight = 36,
  maxHeight = 220,
): number {
  if (shellHeight == null || !Number.isFinite(shellHeight)) return maxHeight;
  const available = Math.floor(shellHeight * FEED_CHAT_COMPOSER_RATIO)
    - FEED_CHAT_COMPOSER_CHROME_HEIGHT;
  return Math.max(minHeight, Math.min(maxHeight, available));
}
