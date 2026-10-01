export function validateTaskListScope(searchParams: URLSearchParams): string | null {
  const scope = searchParams.get("scope");
  if (scope && scope !== "profile") {
    return "scope must be profile when provided";
  }
  if (
    scope === "profile"
    && (searchParams.has("clientId") || searchParams.has("clientIds"))
  ) {
    return "profile scope cannot be combined with client filters";
  }
  return null;
}
