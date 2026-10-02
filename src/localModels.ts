import { parseNaturalEntry, recognitionLibraryMatches } from "./parser";
import { extractModelJson, generatedModelText } from "./modelOutput";
import type { LedgerState, ParsedEntry } from "./types";

export type ModelPackId = "language" | "speech";
export type ModelDownloadSource = "auto" | "official" | "mirror";
export type ModelProgress = { progress: number; loaded: number; total: number };

export const modelDownloadSources: Array<{ id: ModelDownloadSource; label: string; description: string }> = [
  { id: "auto", label: "自动测速", description: "下载前测试官方源与国内镜像，选择响应更快的一端。" },
  { id: "official", label: "官方源", description: "直接使用 Hugging Face Hub 与其 Xet/CDN。" },
  { id: "mirror", label: "国内镜像", description: "使用 hf-mirror.com，适合官方 CDN 较慢的网络。" },
];

export const modelPackInfo = {
  language: {
    name: "高级文字理解包",
    model: "Qwen 2.5 0.5B · Q4F16",
    size: "约 483 MB",
    description: "复杂项目名称、模糊语义与分类建议。",
    repository: "onnx-community/Qwen2.5-0.5B-Instruct",
  },
  speech: {
    name: "中文语音包",
    model: "Whisper Tiny · Q4",
    size: "约 120 MB",
    description: "普通话与中英混合商品名的离线转写。",
    repository: "onnx-community/whisper-tiny",
  },
} as const;

export function getModelRuntimeInfo() {
  const webGpu = "gpu" in navigator;
  const float16 = "Float16Array" in globalThis;
  return {
    webGpu,
    float16,
    languageCompatible: webGpu && float16,
    label: !webGpu ? "当前网页运行时没有启用 WebGPU" : !float16 ? "当前网页运行时缺少 Float16Array，无法运行 Q4F16 推理" : "WebGPU 与 Q4F16 运行条件已满足",
  };
}

export function localModelErrorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  if (/Float16Array|float16 tensor|shader-f16/i.test(raw)) return "当前网页运行时不支持 Q4F16 推理；模型文件已下载，但需在兼容浏览器或封装版中运行";
  if (/webgpu|gpu adapter|device lost/i.test(raw)) return "WebGPU 推理失败；这是网页运行环境问题，已改用本地规则";
  if (/模型没有返回可用的记账结构/.test(raw)) return "高级模型已运行，但未返回有效结构，已改用本地规则";
  return `高级模型运行失败：${raw.slice(0, 76)}`;
}

const installedKey = (id: ModelPackId) => `iledger-model-ready-${id}-v2`;
const sourceKey = "iledger-model-download-source-v1";
const packEvent = "iledger:model-pack-change";
let languagePipeline: any;
let speechPipeline: any;

const sourceHosts = {
  official: "https://huggingface.co/",
  mirror: "https://hf-mirror.com/",
} as const;

const inferenceDevice = () => ("gpu" in navigator ? "webgpu" : "wasm");

export function isModelPackInstalled(id: ModelPackId) {
  return localStorage.getItem(installedKey(id)) === "1";
}

export function getModelDownloadSource(): ModelDownloadSource {
  const saved = localStorage.getItem(sourceKey);
  return saved === "official" || saved === "mirror" ? saved : "auto";
}

export function setModelDownloadSource(source: ModelDownloadSource) {
  localStorage.setItem(sourceKey, source);
}

export function subscribeToModelPacks(listener: () => void) {
  window.addEventListener(packEvent, listener);
  return () => window.removeEventListener(packEvent, listener);
}

function markInstalled(id: ModelPackId, installed: boolean) {
  if (installed) localStorage.setItem(installedKey(id), "1");
  else localStorage.removeItem(installedKey(id));
  window.dispatchEvent(new Event(packEvent));
}

function progressHandler(onProgress?: (progress: ModelProgress) => void) {
  return (event: { status?: string; progress?: number; loaded?: number; total?: number }) => {
    if (event.status !== "progress_total" || !onProgress) return;
    onProgress({
      progress: Math.max(0, Math.min(100, event.progress ?? 0)),
      loaded: event.loaded ?? 0,
      total: event.total ?? 0,
    });
  };
}

async function transformers(host: string = sourceHosts.official) {
  const library = await import("@huggingface/transformers");
  library.env.allowLocalModels = false;
  library.env.useBrowserCache = true;
  library.env.remoteHost = host;
  library.env.remotePathTemplate = "{model}/resolve/{revision}/";
  return library;
}

async function measureSource(source: Exclude<ModelDownloadSource, "auto">) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 5000);
  const started = performance.now();
  try {
    const url = `${sourceHosts[source]}${modelPackInfo.language.repository}/resolve/main/config.json?iledger-speed-test=${Date.now()}`;
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(String(response.status));
    await response.arrayBuffer();
    return performance.now() - started;
  } catch {
    return Number.POSITIVE_INFINITY;
  } finally {
    window.clearTimeout(timer);
  }
}

async function resolveSource(preference: ModelDownloadSource) {
  if (preference !== "auto") return preference;
  const [official, mirror] = await Promise.all([measureSource("official"), measureSource("mirror")]);
  if (!Number.isFinite(official) && !Number.isFinite(mirror)) return "official";
  return mirror < official ? "mirror" : "official";
}

export async function prepareModelPack(id: ModelPackId, onProgress?: (progress: ModelProgress) => void) {
  await navigator.storage?.persist?.().catch(() => false);
  const preference = getModelDownloadSource();
  let resolvedSource = await resolveSource(preference);
  let { pipeline } = await transformers(sourceHosts[resolvedSource]);
  const progress_callback = progressHandler(onProgress);
  const initialize = async () => {
    if (id === "language") {
      languagePipeline ??= await pipeline("text-generation", modelPackInfo.language.repository, {
        device: inferenceDevice(),
        dtype: inferenceDevice() === "webgpu" ? "q4f16" : "q4",
        progress_callback,
      });
    } else {
      speechPipeline ??= await pipeline("automatic-speech-recognition", modelPackInfo.speech.repository, {
        device: inferenceDevice(),
        dtype: "q4",
        progress_callback,
      });
    }
  };
  try {
    await initialize();
  } catch (error) {
    if (preference !== "auto" || resolvedSource === "official") throw error;
    resolvedSource = "official";
    ({ pipeline } = await transformers(sourceHosts.official));
    await initialize();
  }
  onProgress?.({ progress: 100, loaded: 1, total: 1 });
  markInstalled(id, true);
  return resolvedSource;
}

export async function removeModelPack(id: ModelPackId) {
  const current = id === "language" ? languagePipeline : speechPipeline;
  await current?.dispose?.();
  if (id === "language") languagePipeline = undefined;
  else speechPipeline = undefined;

  if ("caches" in window) {
    const repository = modelPackInfo[id].repository;
    const cache = await caches.open("transformers-cache");
    const keys = await cache.keys();
    await Promise.all(keys.map((request) => {
      let url = request.url;
      try { url = decodeURIComponent(url); } catch { /* keep encoded URL */ }
      return url.includes(repository) ? cache.delete(request) : Promise.resolve(false);
    }));
  }
  markInstalled(id, false);
}

export async function removeLegacyModelCache() {
  if (!("caches" in window)) return;
  await caches.delete("iledger-model-packs-v1");
}

export async function parseWithAdvancedModel(source: string, state: LedgerState): Promise<ParsedEntry> {
  const base = parseNaturalEntry(source, state);
  const recognitionLocks = recognitionLibraryMatches(source, state);
  if (!isModelPackInstalled("language")) return base;
  const runtime = getModelRuntimeInfo();
  if (!runtime.languageCompatible) throw new Error(runtime.label);
  if (!languagePipeline) await prepareModelPack("language");

  const messages = [
    {
      role: "system",
      content: "你是离线中文记账解析器。只输出一行合法 JSON，不要 Markdown，不要解释。字段必须是 item、amount、type、category、currency。示例：{\"item\":\"AirPods\",\"amount\":1899,\"type\":\"expense\",\"category\":\"数码\",\"currency\":\"CNY\"}。去除买了、购买、花费、支付等动作词和一、一个、一对、一双、一台等量词；保留商品型号中的数字。type 只能是 expense 或 income；category 和 currency 必须从候选中选择。",
    },
    {
      role: "user",
      content: `原句：${source}\n规则解析候选：${JSON.stringify({ item: base.item, amount: base.amount, type: base.type, category: base.category, currency: base.currency })}\n本地识别库锁定字段（不得改写）：${JSON.stringify(recognitionLocks)}\n可选分类：${state.categories.map((item) => item.name).join("、")}\n可选币种：${state.rates.map((item) => `${item.code}(${item.name})`).join("、")}\n只输出 JSON。`,
    },
  ];
  const prompt = languagePipeline.tokenizer.apply_chat_template(messages, {
    tokenize: false,
    add_generation_prompt: true,
  });
  const generate = async (input: string, maxNewTokens = 110) => {
    try {
      return await languagePipeline(input, {
        max_new_tokens: maxNewTokens,
        do_sample: false,
        repetition_penalty: 1.08,
        return_full_text: false,
      });
    } catch (error) {
      throw new Error(`WebGPU generation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  let output = await generate(prompt);
  let parsed;
  try {
    parsed = extractModelJson(generatedModelText(output));
  } catch {
    output = await generate(`把下面内容转换成一行 JSON。只能输出 {"item":"项目","amount":数字,"type":"expense或income","category":"分类","currency":"币种代码"}，不得输出其他文字。\n${source}`, 90);
    parsed = extractModelJson(generatedModelText(output));
  }
  const categories = new Set(state.categories.map((item) => item.name));
  const amount = Number(parsed.amount);
  const modelItem = typeof parsed.item === "string" && parsed.item.trim() ? parsed.item.trim() : base.item;
  const modelCategory = typeof parsed.category === "string" && categories.has(parsed.category) ? parsed.category : base.category;
  const modelType = parsed.type === "income" || parsed.type === "expense" ? parsed.type : base.type;
  const type = recognitionLocks.type ?? modelType;
  const parsedCurrency = typeof parsed.currency === "string" ? parsed.currency.toUpperCase() : "";
  const modelCurrency = state.rates.some((rate) => rate.code === parsedCurrency) ? parsedCurrency : base.currency;
  const item = recognitionLocks.item ?? modelItem;
  const category = recognitionLocks.category ?? modelCategory;
  const currency = recognitionLocks.currency ?? modelCurrency;

  return {
    ...base,
    item,
    category,
    type,
    currency,
    amount: Number.isFinite(amount) && amount > 0 ? amount : base.amount,
    confidence: {
      ...base.confidence,
      item: recognitionLocks.item ? base.confidence.item : 0.94,
      category: recognitionLocks.category ? base.confidence.category : 0.9,
      amount: Number.isFinite(amount) && amount > 0 ? 0.96 : base.confidence.amount,
      currency: currency !== base.currency ? 0.9 : base.confidence.currency,
      type: 0.96,
    },
  };
}

export async function transcribeChinese(audio: Float32Array) {
  if (!isModelPackInstalled("speech")) throw new Error("请先在设置中安装中文语音包");
  if (!speechPipeline) await prepareModelPack("speech");
  const result = await speechPipeline(audio, {
    language: "chinese",
    task: "transcribe",
    chunk_length_s: 30,
    stride_length_s: 5,
    num_beams: 5,
    temperature: 0,
    return_timestamps: false,
  });
  const text = String(result?.text ?? "").trim();
  if (!text) throw new Error("没有识别到清晰语音，请重试");
  return text;
}

export async function audioBlobToMono16k(blob: Blob) {
  const sourceContext = new AudioContext();
  try {
    const decoded = await sourceContext.decodeAudioData(await blob.arrayBuffer());
    const targetRate = 16000;
    const frameCount = Math.ceil(decoded.duration * targetRate);
    const offline = new OfflineAudioContext(1, frameCount, targetRate);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return new Float32Array(rendered.getChannelData(0));
  } finally {
    await sourceContext.close();
  }
}
