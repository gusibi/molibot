export type ManipulationPhase = "idle" | "tracking" | "dragging" | "settling";

export type ManipulationSnapshot = {
  phase: ManipulationPhase;
  position: number;
  velocity: number;
  target: number | null;
};

export type DirectManipulationMode = "snap" | "continuous";

export type DirectManipulationOptions = {
  min: number;
  max: number;
  mode?: DirectManipulationMode;
  activationDistance?: number;
  projectionHorizonMs?: number;
  sampleWindowMs?: number;
  reducedMotion?: () => boolean;
  onUpdate?: (snapshot: ManipulationSnapshot) => void;
  onSettled?: (target: number) => void;
  onCommitted?: (target: number) => void;
};

type Sample = { position: number; time: number };

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

function rubberBand(value: number, min: number, max: number): number {
  if (value < min) return min - (min - value) * 0.35;
  if (value > max) return max + (value - max) * 0.35;
  return value;
}

export class DirectManipulation {
  private readonly activationDistance: number;
  private readonly projectionHorizonMs: number;
  private readonly sampleWindowMs: number;
  private readonly mode: DirectManipulationMode;
  private pointerId: number | null = null;
  private anchorClientPosition = 0;
  private anchorPosition = 0;
  private activated = false;
  private samples: Sample[] = [];
  private commitAfterSettle = false;
  private snapshot: ManipulationSnapshot = { phase: "idle", position: 0, velocity: 0, target: null };

  constructor(private readonly options: DirectManipulationOptions) {
    this.activationDistance = options.activationDistance ?? 8;
    this.projectionHorizonMs = options.projectionHorizonMs ?? 180;
    this.sampleWindowMs = options.sampleWindowMs ?? 80;
    this.mode = options.mode ?? "snap";
  }

  current(): ManipulationSnapshot {
    return this.snapshot;
  }

  begin(pointerId: number, clientPosition: number, time: number, position = this.snapshot.position): void {
    this.pointerId = pointerId;
    this.anchorClientPosition = clientPosition;
    this.anchorPosition = position;
    this.activated = false;
    this.commitAfterSettle = false;
    this.samples = [{ position, time }];
    this.publish({ phase: "tracking", position, velocity: 0, target: null });
  }

  move(pointerId: number, clientPosition: number, time: number): void {
    if (this.pointerId !== pointerId) return;
    const delta = clientPosition - this.anchorClientPosition;
    if (!this.activated && Math.abs(delta) < this.activationDistance) return;
    this.activated = true;
    const position = rubberBand(this.anchorPosition + delta, this.options.min, this.options.max);
    this.samples = [...this.samples, { position, time }].filter((sample) => time - sample.time <= this.sampleWindowMs);
    this.publish({ phase: "dragging", position, velocity: this.velocity(), target: null });
  }

  end(pointerId: number, time: number): number | null {
    if (this.pointerId !== pointerId) return null;
    const velocity = this.velocity();
    if (this.mode === "continuous") {
      this.pointerId = null;
      const position = clamp(this.snapshot.position, this.options.min, this.options.max);
      const committed = this.activated;
      this.publish({ phase: "idle", position, velocity: 0, target: null });
      this.options.onSettled?.(position);
      if (committed) this.options.onCommitted?.(position);
      return position;
    }
    this.pointerId = null;
    const projected = this.snapshot.position + velocity * this.projectionHorizonMs;
    const midpoint = (this.options.min + this.options.max) / 2;
    const target = projected >= midpoint ? this.options.max : this.options.min;
    if (!this.activated) return this.settle(this.options.min, 0, false);
    return this.settle(target, velocity, true);
  }

  cancel(): number {
    this.pointerId = null;
    if (this.mode === "continuous") {
      const position = clamp(this.snapshot.position, this.options.min, this.options.max);
      this.publish({ phase: "idle", position, velocity: 0, target: null });
      this.options.onSettled?.(position);
      return position;
    }
    return this.settle(this.options.min, 0, false);
  }

  interrupt(pointerId: number, clientPosition: number, time: number): void {
    this.begin(pointerId, clientPosition, time, this.snapshot.position);
  }

  step(elapsedMs: number): boolean {
    if (this.snapshot.phase !== "settling" || this.snapshot.target === null) return false;
    const target = this.snapshot.target;
    const delta = target - this.snapshot.position;
    const velocity = this.snapshot.velocity + (delta * 0.0028 - this.snapshot.velocity * 0.022) * elapsedMs;
    const position = this.snapshot.position + velocity * elapsedMs;
    if (Math.abs(target - position) < 0.5 && Math.abs(velocity) < 0.02) {
      this.publish({ phase: "idle", position: target, velocity: 0, target: null });
      this.options.onSettled?.(target);
      if (this.commitAfterSettle) this.options.onCommitted?.(target);
      this.commitAfterSettle = false;
      return false;
    }
    this.publish({ phase: "settling", position, velocity, target });
    return true;
  }

  private settle(target: number, velocity: number, committed: boolean): number {
    const boundedTarget = clamp(target, this.options.min, this.options.max);
    this.commitAfterSettle = committed;
    if (this.options.reducedMotion?.()) {
      this.publish({ phase: "idle", position: boundedTarget, velocity: 0, target: null });
      this.options.onSettled?.(boundedTarget);
      if (this.commitAfterSettle) this.options.onCommitted?.(boundedTarget);
      this.commitAfterSettle = false;
      return boundedTarget;
    }
    this.publish({ phase: "settling", position: this.snapshot.position, velocity, target: boundedTarget });
    return boundedTarget;
  }

  private velocity(): number {
    if (this.samples.length < 2) return 0;
    const latest = this.samples[this.samples.length - 1];
    let totalWeight = 0;
    let weightedVelocity = 0;
    for (let index = 1; index < this.samples.length; index += 1) {
      const previous = this.samples[index - 1];
      const current = this.samples[index];
      const duration = current.time - previous.time;
      if (duration <= 0) continue;
      const weight = index;
      weightedVelocity += ((current.position - previous.position) / duration) * weight;
      totalWeight += weight;
    }
    return totalWeight ? weightedVelocity / totalWeight : (latest.position - this.samples[0].position) / Math.max(1, latest.time - this.samples[0].time);
  }

  private publish(snapshot: ManipulationSnapshot): void {
    this.snapshot = snapshot;
    this.options.onUpdate?.(snapshot);
  }
}
