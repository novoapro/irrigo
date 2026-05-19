import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

export interface AICallResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
}

export const callAI = async (
  provider: "anthropic" | "openai",
  modelId: string,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string
): Promise<AICallResult> => {
  if (provider === "anthropic") {
    return callAnthropic(modelId, apiKey, systemPrompt, userPrompt);
  }
  return callOpenAI(modelId, apiKey, systemPrompt, userPrompt);
};

const callAnthropic = async (
  modelId: string,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string
): Promise<AICallResult> => {
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: modelId,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }]
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const text = textBlock?.type === "text" ? textBlock.text : "";

  return {
    text,
    promptTokens: response.usage.input_tokens,
    completionTokens: response.usage.output_tokens
  };
};

const callOpenAI = async (
  modelId: string,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string
): Promise<AICallResult> => {
  const client = new OpenAI({ apiKey });

  const response = await client.chat.completions.create({
    model: modelId,
    max_tokens: 4096,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ]
  });

  const text = response.choices[0]?.message?.content ?? "";

  return {
    text,
    promptTokens: response.usage?.prompt_tokens ?? 0,
    completionTokens: response.usage?.completion_tokens ?? 0
  };
};
