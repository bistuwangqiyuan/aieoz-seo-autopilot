import { generateObject, generateText, zodSchema } from "ai";
import type { LanguageModel } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { z } from "zod";
import { getModelId } from "@/lib/config";

/**
 * Multi-provider fallback chain so the unattended loop never dies with a
 * single vendor outage / exhausted quota. Order = quality first:
 *
 *   1. Vercel AI Gateway (AI_MODEL, default openai/gpt-4o-mini)
 *   2. DeepSeek deepseek-chat        (DEEPSEEK_API_KEY)
 *   3. Tongyi/DashScope qwen-max     (TONGYI_API_KEY)
 *   4. Moonshot kimi-k3              (MOONSHOT_API_KEY)
 *   5. Zhipu GLM glm-4-flash         (GLM_API_KEY)
 *
 * The gateway supports native structured outputs; the OpenAI-compatible
 * fallbacks don't reliably (their json_object mode ignores the schema), so
 * for them we inject the JSON schema into the prompt and validate with Zod.
 */

interface Provider {
  /** Human-readable id shown on the dashboard / stored in snapshots. */
  id: string;
  kind: "gateway" | "compat";
  model: LanguageModel;
}

function env(name: string): string {
  return process.env[name]?.trim() || "";
}

function compat(opts: { name: string; baseURL: string; apiKey: string; model: string }): LanguageModel {
  return createOpenAICompatible({
    name: opts.name,
    baseURL: opts.baseURL,
    apiKey: opts.apiKey,
  }).chatModel(opts.model);
}

export function getProviderChain(): Provider[] {
  const chain: Provider[] = [];

  if (env("AI_GATEWAY_API_KEY")) {
    // Plain string model ids route through the Vercel AI Gateway.
    chain.push({ id: getModelId(), kind: "gateway", model: getModelId() as unknown as LanguageModel });
  }
  if (env("DEEPSEEK_API_KEY")) {
    chain.push({
      id: "deepseek/deepseek-chat",
      kind: "compat",
      model: compat({
        name: "deepseek",
        baseURL: "https://api.deepseek.com",
        apiKey: env("DEEPSEEK_API_KEY"),
        model: "deepseek-chat",
      }),
    });
  }
  if (env("TONGYI_API_KEY")) {
    chain.push({
      id: "tongyi/qwen-max",
      kind: "compat",
      model: compat({
        name: "tongyi",
        baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiKey: env("TONGYI_API_KEY"),
        model: "qwen-max",
      }),
    });
  }
  if (env("MOONSHOT_API_KEY")) {
    chain.push({
      id: "moonshot/kimi-k3",
      kind: "compat",
      model: compat({
        name: "moonshot",
        baseURL: "https://api.moonshot.cn/v1",
        apiKey: env("MOONSHOT_API_KEY"),
        model: "kimi-k3",
      }),
    });
  }
  if (env("GLM_API_KEY")) {
    chain.push({
      id: "glm/glm-4-flash",
      kind: "compat",
      model: compat({
        name: "glm",
        baseURL: "https://open.bigmodel.cn/api/paas/v4",
        apiKey: env("GLM_API_KEY"),
        model: "glm-4-flash",
      }),
    });
  }

  return chain;
}

/** True when at least one AI provider is configured. */
export function hasAnyAiProvider(): boolean {
  return getProviderChain().length > 0;
}

/** Dashboard label, e.g. "openai/gpt-4o-mini +3 备用". */
export function describeProviderChain(): string {
  const chain = getProviderChain();
  if (chain.length === 0) return "未配置";
  const extra = chain.length - 1;
  return extra > 0 ? `${chain[0].id} +${extra} 备用` : chain[0].id;
}

/** Pull the first JSON object out of a completion (fences/commentary tolerated). */
function extractJson(text: string): string {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return t;
}

interface GenerateOpts<SCHEMA extends z.ZodTypeAny> {
  schema: SCHEMA;
  system: string;
  prompt: string;
}

async function generateViaCompat<SCHEMA extends z.ZodTypeAny>(
  model: LanguageModel,
  opts: GenerateOpts<SCHEMA>,
): Promise<z.infer<SCHEMA>> {
  const schemaJson = JSON.stringify(zodSchema(opts.schema).jsonSchema);
  const { text } = await generateText({
    model,
    system: opts.system,
    prompt:
      `${opts.prompt}\n\n` +
      `OUTPUT FORMAT (mandatory): respond with ONLY a single JSON object — no markdown fences, ` +
      `no commentary — that strictly conforms to this JSON Schema:\n${schemaJson}`,
  });
  return opts.schema.parse(JSON.parse(extractJson(text)));
}

/**
 * generateObject with automatic provider fallback. Tries each configured
 * provider in order and returns the first successful result together with
 * the provider id that produced it. Throws only when every provider fails.
 */
export async function generateObjectWithFallback<SCHEMA extends z.ZodTypeAny>(
  opts: GenerateOpts<SCHEMA>,
): Promise<{ object: z.infer<SCHEMA>; model: string }> {
  const chain = getProviderChain();
  if (chain.length === 0) throw new Error("No AI provider configured");

  const failures: string[] = [];
  for (const provider of chain) {
    try {
      const object =
        provider.kind === "gateway"
          ? (
              await generateObject({
                model: provider.model,
                schema: opts.schema,
                system: opts.system,
                prompt: opts.prompt,
              })
            ).object
          : await generateViaCompat(provider.model, opts);
      if (failures.length > 0) {
        console.warn(`[ai/client] fell back to ${provider.id} after: ${failures.join(" | ")}`);
      }
      return { object, model: provider.id };
    } catch (err) {
      const msg = err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200);
      failures.push(`${provider.id}: ${msg}`);
      console.error(`[ai/client] provider ${provider.id} failed:`, msg);
    }
  }
  throw new Error(`All AI providers failed: ${failures.join(" | ")}`);
}
