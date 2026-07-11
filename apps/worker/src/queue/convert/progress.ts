export class ComposeProgressTracker {
  private completedWeight = 0;
  private currentStepWeight = 0;
  private lastReported = -1;

  constructor(
    private readonly totalWeight: number,
    private readonly onProgress: (percent: number) => void
  ) {}

  startStep(weight: number): { onFfmpegProgress: (ratio: number) => void } {
    this.currentStepWeight = weight;
    return {
      onFfmpegProgress: (ratio: number) => {
        const overall = (this.completedWeight + weight * Math.min(1, Math.max(0, ratio))) / this.totalWeight;
        this.report(overall);
      }
    };
  }

  completeStep(weight?: number): void {
    const stepWeight = weight ?? this.currentStepWeight;
    this.completedWeight += stepWeight;
    this.report(this.completedWeight / this.totalWeight);
  }

  finish(): void {
    this.onProgress(100);
  }

  private report(ratio: number): void {
    const percent = Math.min(99, Math.max(0, Math.round(ratio * 100)));
    if (percent !== this.lastReported) {
      this.lastReported = percent;
      this.onProgress(percent);
    }
  }
}
