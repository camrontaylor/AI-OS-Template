export interface ComposerExpansionMeasurement {
  hasText: boolean;
  scrollHeight: number;
  lineHeight: number;
  paddingTop: number;
  paddingBottom: number;
  minimumLines?: number;
}

export function shouldShowComposerExpansion({
  hasText,
  scrollHeight,
  lineHeight,
  paddingTop,
  paddingBottom,
  minimumLines = 3,
}: ComposerExpansionMeasurement): boolean {
  if (!hasText || minimumLines <= 0 || lineHeight <= 0) return false;

  const contentHeight = Math.max(0, scrollHeight - paddingTop - paddingBottom);
  return contentHeight + 0.5 >= lineHeight * minimumLines;
}
