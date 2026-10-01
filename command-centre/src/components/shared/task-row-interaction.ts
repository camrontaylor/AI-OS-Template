export function shouldActivateSubtaskRowKey(key: string, originatedOnRow: boolean): boolean {
  return originatedOnRow && (key === "Enter" || key === " ");
}
