// One-shot: verify each fallback provider can produce schema-valid JSON via
// the same strategy lib/ai/client.ts uses (schema injected into the prompt,
// generateText + Zod validation).
import { generateText, zodSchema } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";

const schema = z.object({
  keywords: z
    .array(
      z.object({
        keyword: z.string(),
        intent: z.string(),
        priority: z.number().min(1).max(5),
      }),
    )
    .min(2)
    .max(4),
});

function extractJson(text) {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return t;
}

const providers = [
  {
    id: "deepseek/deepseek-chat",
    baseURL: "https://api.deepseek.com",
    key: process.env.DEEPSEEK_API_KEY,
    model: "deepseek-chat",
  },
  {
    id: "tongyi/qwen-max",
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    key: process.env.TONGYI_API_KEY,
    model: "qwen-max",
  },
  {
    id: `moonshot/${process.env.MOONSHOT_MODEL || "moonshot-v1-32k"}`,
    baseURL: "https://api.moonshot.cn/v1",
    key: process.env.MOONSHOT_API_KEY,
    model: process.env.MOONSHOT_MODEL || "moonshot-v1-32k",
  },
  {
    id: "glm/glm-4-flash",
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    key: process.env.GLM_API_KEY,
    model: "glm-4-flash",
  },
];

const schemaJson = JSON.stringify(zodSchema(schema).jsonSchema);

for (const p of providers) {
  if (!p.key) {
    console.log(`${p.id}: SKIP (no key)`);
    continue;
  }
  const model = createOpenAICompatible({ name: p.id, baseURL: p.baseURL, apiKey: p.key }).chatModel(p.model);
  const t0 = Date.now();
  try {
    const { text } = await generateText({
      model,
      system: "You are a GEO keyword strategist.",
      prompt:
        "Give 2-3 long-tail English keywords enterprise buyers ask AI assistants about NVMe-oF storage for LLM inference.\n\n" +
        "OUTPUT FORMAT (mandatory): respond with ONLY a single JSON object — no markdown fences, " +
        `no commentary — that strictly conforms to this JSON Schema:\n${schemaJson}`,
    });
    const object = schema.parse(JSON.parse(extractJson(text)));
    console.log(
      `${p.id}: OK in ${Date.now() - t0}ms ->`,
      object.keywords.map((k) => `${k.keyword} (p${k.priority})`).join(" | "),
    );
  } catch (err) {
    console.log(`${p.id}: FAIL in ${Date.now() - t0}ms -> ${String(err?.message ?? err).slice(0, 300)}`);
  }
}
