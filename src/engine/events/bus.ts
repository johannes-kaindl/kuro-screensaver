// EventBus — typed, synchronous, multi-producer/multi-consumer channel for
// discrete flight/narrative events. Settled within a frame (handlers run on emit),
// so events never land a frame late. Randomness a handler needs is drawn from the
// engine's SEEDED rng by the EMITTER (e.g. ReactiveWorld), never Math.random here.
export type FlightEventKind =
  | 'intrusion'    // the operator "notices" — migrated from narrative.onIntrusion
  | 'manoeuvre'    // a director manoeuvre fired (for narrative/world to react to, later)
  | 'incomingFire' // antagonist fired a tracer at the camera (Brick D)
  | 'unitArrive'   // a CORP support unit arrived
  | 'unitCrash'    // a support unit went down
  | 'sceneChange'; // Slice 5: a user-initiated scene change (←/→ or 1-9) — dir: -1|0|+1

export interface FlightEvent {
  kind: FlightEventKind;
  /** event-specific scalar (e.g. intrusion → hesitation duration in seconds). */
  intensity?: number;
  /** -1 | 0 | +1 lateral/directional hint where meaningful. */
  dir?: number;
}

type Handler = (e: FlightEvent) => void;

export class EventBus {
  private subs = new Map<FlightEventKind | '*', Set<Handler>>();

  subscribe(kind: FlightEventKind | '*', fn: Handler): () => void {
    let set = this.subs.get(kind);
    if (!set) { set = new Set(); this.subs.set(kind, set); }
    set.add(fn);
    return () => set!.delete(fn);
  }

  emit(e: FlightEvent): void {
    this.subs.get(e.kind)?.forEach((fn) => fn(e));
    this.subs.get('*')?.forEach((fn) => fn(e));
  }
}
