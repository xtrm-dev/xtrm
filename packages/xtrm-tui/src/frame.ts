/**
 * InteractionFrame store — pure frame navigation/close logic.
 *
 * One normal idle user submit opens one frame. All Pi activity caused by that
 * interaction stays in the frame until the session is truly settled.
 * `agent_end` never closes a frame (callers simply do not call settle for it);
 * `agent_settled` closes the open frame exactly once (settle is idempotent).
 */

export type FrameStatus = "open" | "settled";

export interface InteractionFrame {
  id: number;
  /** 1-based position on the current conversation path. */
  index: number;
  ingress: string;
  status: FrameStatus;
  /** Assistant text accumulated while the frame was open. */
  bodyText: string;
  /** Compressed one-line tool rows, in completion order. */
  toolRows: string[];
  /** How many times settle was attempted after close (must stay 0 in prod). */
  redundantSettleAttempts: number;
}

export class FrameStore {
  private frames: InteractionFrame[] = [];
  private selectedId = -1;
  private nextId = 1;

  /** Open a frame for a new accepted ingress; selects it. */
  create(ingress: string): InteractionFrame {
    const frame: InteractionFrame = {
      id: this.nextId++,
      index: this.frames.length + 1,
      ingress,
      status: "open",
      bodyText: "",
      toolRows: [],
      redundantSettleAttempts: 0,
    };
    this.frames.push(frame);
    this.selectedId = frame.id;
    return frame;
  }

  current(): InteractionFrame | undefined {
    return this.frames.find((f) => f.id === this.selectedId);
  }

  count(): number {
    return this.frames.length;
  }

  /**
   * Close the currently selected frame. Returns true only on the
   * open → settled transition; repeat calls return false and are counted.
   */
  settleCurrent(): boolean {
    const frame = this.current();
    if (!frame) return false;
    if (frame.status === "settled") {
      frame.redundantSettleAttempts += 1;
      return false;
    }
    frame.status = "settled";
    return true;
  }

  select(id: number): InteractionFrame | undefined {
    if (this.frames.some((f) => f.id === id)) this.selectedId = id;
    return this.current();
  }

  previous(): InteractionFrame | undefined {
    const i = this.frames.findIndex((f) => f.id === this.selectedId);
    if (i > 0) this.selectedId = this.frames[i - 1]!.id;
    return this.current();
  }

  next(): InteractionFrame | undefined {
    const i = this.frames.findIndex((f) => f.id === this.selectedId);
    if (i >= 0 && i < this.frames.length - 1) this.selectedId = this.frames[i + 1]!.id;
    return this.current();
  }

  settledCount(): number {
    return this.frames.filter((f) => f.status === "settled").length;
  }
}
