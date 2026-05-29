export interface AssistantStreamState {
  assistantTextStreamed: boolean;
  streamedAssistantText: string;
}

export function applyAssistantStreamEvent(
  state: AssistantStreamState,
  event:
    | { type: "message_start"; role?: string }
    | { type: "text_delta"; delta?: string }
): AssistantStreamState {
  if (event.type === "message_start" && event.role === "assistant") {
    return {
      assistantTextStreamed: false,
      streamedAssistantText: ""
    };
  }

  if (event.type === "text_delta" && event.delta) {
    return {
      assistantTextStreamed: true,
      streamedAssistantText: state.streamedAssistantText + event.delta
    };
  }

  return state;
}
