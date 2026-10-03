import type { Circuit, CursorSelection, ExampleSummary, LockedBaseline, SavedCircuit, SavedSummary, SimulationResult, Stimulus, StimulusPlan } from "./types";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload as T;
}

export const api = {
  examples: () => request<{ examples: ExampleSummary[] }>("/api/examples"),
  example: (id: string) => request<{ circuit: Circuit; stimulus: Stimulus; name: string }>(`/api/examples/${id}`),
  simulate: (circuit: Circuit, stimulus: Stimulus, maxTime: number) =>
    request<SimulationResult>("/api/simulate", {
      method: "POST",
      body: JSON.stringify({ circuit, stimulus, maxTime }),
    }),
  saved: () => request<{ circuits: SavedSummary[] }>("/api/circuits"),
  load: (id: string) => request<SavedCircuit>(`/api/circuits/${id}`),
  save: (payload: { name: string; circuit: Circuit; stimulus: Stimulus; plans?: StimulusPlan[]; activePlanId?: string; comparePlanId?: string; baseline?: LockedBaseline | null; maxTime?: number; cursor?: CursorSelection | null }, id?: string) =>
    request<SavedCircuit>(id ? `/api/circuits/${id}` : "/api/circuits", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(payload),
    }),
};
