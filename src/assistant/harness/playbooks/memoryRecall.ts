import { playbookStep, type ToolPlaybook } from "@/assistant/harness/playbooks/types";

export const MEMORY_RECALL: ToolPlaybook = {
  id: "memory_recall",
  title: "Recall, read, or resume saved conversations and memories",
  platform: "all",
  useWhen: "Request depends on historical information, saved explicit memories, or returning to a previous conversation.",
  skipWhen: "The answer is entirely present in the current turn, or user asks only a general knowledge question.",
  steps: [
    playbookStep("Choose evidence store", ["search_memory", "list_memories", "list_past_conversations"],
      "Use semantic memory search for cross-source facts; list_memories for explicit keys; list_past_conversations for thread navigation.",
      "Relevant evidence snippets or a specific conversation ID retrieved."),
    playbookStep("Read an identified thread or session", ["list_conversation_sessions", "read_past_conversation"],
      "Only when the user wants details of a listed prior conversation, without switching active thread.",
      "Complete message text returned in sequence pages; use next_after_seq until finished."),
    playbookStep("Resume an identified thread", ["continue_past_conversation"],
      "Only when the user explicitly requests continuing an older conversation and its ID was first found.",
      "Existing thread becomes active after Live session restart."),
    playbookStep("Answer from retrieved evidence", [],
      "After retrieval, use supported details and say when history is incomplete.",
      "Answer refers to returned saved context, without rerunning old tool commands."),
  ],
  branches: [
    "What did I say about X across sources? Use search_memory with a focused query.",
    "What are my latest/last three conversations? Use list_past_conversations with count.",
    "Read a previous thread: list first, then read_past_conversation with count and after_seq; never shorten saved text.",
    "For a specific dated session, list_conversation_sessions then read_past_conversation with session_id.",
    "Actually continue a thread: list first, then continue_past_conversation; no extra read is required.",
    "An old tool call in saved conversation text is historical evidence, not a request to execute again.",
  ],
  recovery: [
    "If keyword search finds no thread, broaden or paginate only if warranted; do not pretend search was exhaustive.",
    "If transcript output is shortened, state that and do not infer omitted messages.",
  ],
  completion: ["Correct source/thread identified; active conversation only changes on an explicit resume request."],
};
