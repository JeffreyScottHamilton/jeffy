export type VoiceState =
  | { status: "none" }
  | { status: "pending" }
  | { status: "ready"; url: string; autoplay: boolean }
  | { status: "error"; message: string };

export type TurnStatus = "streaming" | "done" | "error";

export type Turn = {
  id: string;
  question: string;
  status: TurnStatus;
  /** Topics of profile items looked up; undefined until the memories event arrives. */
  memories?: string[];
  reasoning: string;
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
  reasoning: "",
  text: "",
  voice: { status: "none" },
});
