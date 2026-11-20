export type VoiceState =
  | { status: "none" }
  | { status: "pending" }
  /** Chunks are playing through the VoiceEngine while the reply is still arriving. */
  | { status: "live" }
  | { status: "ready"; url: string; autoplay: boolean }
  | { status: "error"; message: string };

export type TurnStatus = "streaming" | "done" | "error";

export type Turn = {
  id: string;
  question: string;
  status: TurnStatus;
  /** Answer text as streamed. */
  text: string;
  /** Final cleaned reply (text_done); used for history and copy. */
  final?: string;
  voice: VoiceState;
  error?: string;
};

export const newTurn = (id: string, question: string): Turn => ({
  id,
  question,
  status: "streaming",
  text: "",
  voice: { status: "none" },
});
