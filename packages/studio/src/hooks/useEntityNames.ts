import { useQuery } from "@tanstack/react-query";

const ENTITY_NAMES_URL = "/api/traces/entity-names";
const STALE_TIME_MS = 5 * 60 * 1000; // 5 minutes

async function fetchEntityNames(): Promise<string[]> {
  const res = await fetch(ENTITY_NAMES_URL);
  if (!res.ok) throw new Error(`Failed to fetch entity names: ${res.status}`);
  return res.json();
}

/**
 * Fetches distinct entity names from the traces API.
 * Used for filter dropdown options.
 */
export function useEntityNames(): string[] {
  const { data } = useQuery({
    queryKey: ["entity-names"],
    queryFn: fetchEntityNames,
    staleTime: STALE_TIME_MS,
  });

  return data ?? [];
}
