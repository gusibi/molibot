export interface TranscriptState<T> {
  transcript: T | null;
  loading: boolean;
  error: string;
}

/** Keeps cached history visible while refreshing; only the current selection may publish. */
export class ExternalTranscriptLoader<T> {
  private cache = new Map<string, T>();
  private request: AbortController | null = null;

  constructor(private load: (endpoint: string, id: string, signal: AbortSignal) => Promise<T>) {}

  async select(endpoint: string, id: string, publish: (state: TranscriptState<T>) => void): Promise<void> {
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    const key = JSON.stringify([endpoint, id]);
    const cached = this.cache.get(key) ?? null;
    publish({ transcript: cached, loading: cached === null, error: "" });
    try {
      const transcript = await this.load(endpoint, id, request.signal);
      if (this.request !== request) return;
      this.cache.set(key, transcript);
      publish({ transcript, loading: false, error: "" });
    } catch (cause) {
      if (this.request !== request) return;
      publish({ transcript: cached, loading: false, error: cause instanceof Error ? cause.message : String(cause) });
    }
  }

  close(): void {
    this.request?.abort();
    this.request = null;
  }

  clear(): void {
    this.close();
    this.cache.clear();
  }
}
