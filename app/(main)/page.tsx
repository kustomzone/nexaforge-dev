"use client";

import { useScrollTo } from "@/hooks/use-scroll-to";
import { CheckIcon } from "@heroicons/react/16/solid";
import { ChevronDownIcon } from "@heroicons/react/20/solid";
import { Sparkles, Wand2, ChevronRight, Settings2 } from "lucide-react";
import * as Select from "@radix-ui/react-select";
import { AnimatePresence, motion } from "framer-motion";
import { FormEvent, useEffect, useState, useMemo } from "react";
import LoadingDots from "@/components/loading-dots";
import { AI_PROVIDERS, ENABLED_PROVIDERS } from "@/config/ai-providers";
import CodeViewer from "@/components/code-viewer";
import AnalyticsWindow from "@/components/AnalyticsWindow";
import ErrorFixer from "@/components/ErrorFixer";
import SpinnerLoader from "@/components/SpinnerLoader";
import AISettingsPanel from "@/components/AISettingsPanel";
import ChatInterface from "@/components/ChatInterface";
import SavedGenerations from "@/components/SavedGenerations";

type Status =
  | "initial"
  | "creating"
  | "created"
  | "updating"
  | "updated"
  | "refining"
  | "brainstorming";

interface TokenAnalytics {
  modelName: string;
  provider: string;
  promptTokens: number;
  responseTokens: number;
  totalTokens: number;
  maxTokens: number;
  utilizationPercentage: string;
}

interface CumulativeTokenAnalytics extends TokenAnalytics {
  cumulativePromptTokens: number;
  cumulativeResponseTokens: number;
  cumulativeTotalTokens: number;
}

interface Analytics {
  modelName: string;
  provider: string;
  promptTokens: number;
  responseTokens: number;
  totalTokens: number;
  maxTokens: number;
  utilizationPercentage: number;
}

interface SavedGeneration {
  id: string;
  title: string;
  description: string | null;
  createdAt: string;
  generatedApp: {
    id: string;
    code: string;
    model: string;
    prompt: string;
    analytics: Analytics | null;
  };
}

interface AISettings {
  temperature: number;
  maxTokens: number;
  topP: number;
  streamOutput: boolean;
  frequencyPenalty: number;
  presencePenalty: number;
}

function removeCodeFormatting(code: string): string {
  return code
    .replace(/```(?:typescript|javascript|tsx)?\n([\s\S]*?)```/g, "$1")
    .trim();
}

const getDefaultSettings = (provider: string): AISettings => ({
  temperature: provider === "deepseek" ? 0.0 : 0.7,
  maxTokens:
    provider === "anthropic"
      ? 200000
      : provider === "openai"
        ? 64000
        : provider === "google"
          ? 1000000
          : provider === "deepseek"
            ? 32768
            : 200000,
  topP: 1,
  streamOutput: true,
  frequencyPenalty: 0,
  presencePenalty: 0,
});

export default function Home() {
  const groupedModels = Object.entries(AI_PROVIDERS)
    .filter(
      ([provider]) =>
        ENABLED_PROVIDERS[provider as keyof typeof ENABLED_PROVIDERS],
    )
    .map(([provider, models]) => ({
      provider,
      models: models.map((model) => ({
        label: model.name,
        value: model.id,
      })),
    }));

  // Component states
  const [status, setStatus] = useState<Status>("initial");
  const [prompt, setPrompt] = useState("");
  const [generatedCode, setGeneratedCode] = useState("");
  const [tokenAnalytics, setTokenAnalytics] = useState<CumulativeTokenAnalytics | null>(null);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [model, setModel] = useState(groupedModels[0]?.models[0]?.value || "");
  const [ref, scrollTo] = useScrollTo();
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);
  const [currentGeneratedAppId, setCurrentGeneratedAppId] = useState<string | null>(null);

  // Chat interface state
  const [chatVisible, setChatVisible] = useState(false);
  const [refinementMessages, setRefinementMessages] = useState<
    { role: string; content: string }[]
  >([]);

  // AI Settings states
  const [showSettings, setShowSettings] = useState(false);
  const initialProvider = groupedModels[0]?.provider || "anthropic";
  const [aiSettings, setAISettings] = useState<AISettings>(() =>
    getDefaultSettings(initialProvider),
  );

  // Get current provider
  const currentProvider = useMemo(
    () =>
      groupedModels.find((g) => g.models.some((m) => m.value === model))
        ?.provider || initialProvider,
    [model, groupedModels, initialProvider],
  );

  const updateTokenAnalytics = (newAnalytics: TokenAnalytics) => {
    setTokenAnalytics(prevAnalytics => {
      if (!prevAnalytics) {
        return {
          ...newAnalytics,
          cumulativePromptTokens: newAnalytics.promptTokens,
          cumulativeResponseTokens: newAnalytics.responseTokens,
          cumulativeTotalTokens: newAnalytics.totalTokens,
          utilizationPercentage: ((newAnalytics.totalTokens / newAnalytics.maxTokens) * 100).toFixed(2)
        };
      }

      const cumulativePromptTokens = prevAnalytics.cumulativePromptTokens + newAnalytics.promptTokens;
      const cumulativeResponseTokens = prevAnalytics.cumulativeResponseTokens + newAnalytics.responseTokens;
      const cumulativeTotalTokens = cumulativePromptTokens + cumulativeResponseTokens;

      return {
        ...newAnalytics,
        cumulativePromptTokens,
        cumulativeResponseTokens,
        cumulativeTotalTokens,
        utilizationPercentage: ((cumulativeTotalTokens / newAnalytics.maxTokens) * 100).toFixed(2)
      };
    });
    setShowAnalytics(true);
  };

  let loading = status !== "initial" && status !== "created";

  // Effect for updating settings when model changes
  useEffect(() => {
    if (currentProvider) {
      setAISettings((prev) => ({
        ...prev,
        temperature: currentProvider === "deepseek" ? 0.0 : prev.temperature,
        maxTokens:
          currentProvider === "anthropic"
            ? 200000
            : currentProvider === "openai"
              ? 64000
              : currentProvider === "google"
                ? 1000000
                : currentProvider === "deepseek"
                  ? 32768
                  : prev.maxTokens,
      }));
    }
  }, [currentProvider]);

  // Effect for code viewer scrolling
  useEffect(() => {
    let el = document.querySelector(".cm-scroller");
    if (el && loading) {
      let end = el.scrollHeight - el.clientHeight;
      el.scrollTo({ top: end });
    }
  }, [loading, generatedCode]);

  async function handleChatMessage(message: string) {
    if (!generatedCode || status !== "created") return;

    setStatus("updating");
    try {
      const updatedMessages = [
        ...refinementMessages,
        { role: "user", content: message },
      ];

      const res = await fetch("/api/generateCode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: "Previous code: " + generatedCode },
            ...updatedMessages,
          ],
          settings: aiSettings,
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error(res.statusText || "Failed to update code");
      }

      const reader = res.body.getReader();
      let receivedData = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        receivedData += new TextDecoder().decode(value);
        const cleanedData = removeCodeFormatting(receivedData);
        setGeneratedCode(cleanedData);
      }

      setRefinementMessages(updatedMessages);
      setStatus("created");

      // Include generatedAppId in analytics if available
      if (currentGeneratedAppId) {
        const analyticsRes = await fetch("/api/tokenAnalytics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            prompt: message,
            generatedCode: receivedData,
            generatedAppId: currentGeneratedAppId
          }),
        });

        if (analyticsRes.ok) {
          const analytics = await analyticsRes.json();
          updateTokenAnalytics(analytics);
        }
      }
    } catch (error) {
      console.error("Error updating code:", error);
      setStatus("created");
    }
  }

  async function generateAppIdea() {
    if (status !== "initial") return;

    setStatus("brainstorming");
    try {
      const res = await fetch("/api/generateIdea", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          settings: aiSettings,
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error(res.statusText || "Failed to generate idea");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let newIdea = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        newIdea += decoder.decode(value);
      }

      setPrompt(newIdea.trim());
    } catch (error) {
      console.error("Error generating app idea:", error);
    } finally {
      setStatus("initial");
    }
  }

  async function refinePrompt() {
    if (!prompt || status !== "initial") return;

    setStatus("refining");
    try {
      const res = await fetch("/api/refinePrompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          prompt,
          settings: aiSettings,
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error(res.statusText || "Failed to refine prompt");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let refinedPrompt = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        refinedPrompt += decoder.decode(value);
      }

      setPrompt(refinedPrompt.trim());
    } catch (error) {
      console.error("Error refining prompt:", error);
    } finally {
      setStatus("initial");
    }
  }

  async function createApp(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!prompt || status !== "initial") return;

    setStatus("creating");
    setGeneratedCode("");
    setShowAnalytics(false);
    setTokenAnalytics(null);
    setChatVisible(false);
    setRefinementMessages([]);

    setMessages([{ role: "user", content: prompt }]);
    
    try {
      const res = await fetch("/api/generateCode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          settings: aiSettings,
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error(res.statusText || "Failed to generate code");
      }

      const reader = res.body.getReader();
      let receivedData = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        receivedData += new TextDecoder().decode(value);
        const cleanedData = removeCodeFormatting(receivedData);
        setGeneratedCode(cleanedData);
      }

      // Save generated app first
      const generatedAppResponse = await fetch("/api/generated-apps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          prompt,
          code: receivedData,
        }),
      });

      if (!generatedAppResponse.ok) {
        throw new Error("Failed to save generated app");
      }

      const generatedApp = await generatedAppResponse.json();
      setCurrentGeneratedAppId(generatedApp.id);

      // Calculate analytics with generatedAppId
      const analyticsRes = await fetch("/api/tokenAnalytics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          prompt,
          generatedCode: receivedData,
          generatedAppId: generatedApp.id
        }),
      });

      if (analyticsRes.ok) {
        const analytics = await analyticsRes.json();
        updateTokenAnalytics(analytics);
      }

      setStatus("created");
      setChatVisible(true);
      scrollTo({ delay: 0.5 });
    } catch (error) {
      console.error("Error generating code:", error);
      setStatus("initial");
    }
  }

  const handleLoadGeneration = (generation: SavedGeneration) => {
    setGeneratedCode(generation.generatedApp.code);
    setPrompt(generation.generatedApp.prompt);
    setModel(generation.generatedApp.model);
    setAISettings(aiSettings);
    setCurrentGeneratedAppId(generation.generatedApp.id);
    setStatus("created");
    setChatVisible(true);
    scrollTo({ delay: 0.5 });
};

  return (
    <main className="mt-12 flex w-full flex-1 flex-col items-center px-4 text-center sm:mt-1">
      <SavedGenerations
        currentCode={generatedCode}
        currentPrompt={prompt}
        currentModel={model}
        currentSettings={aiSettings}
        onLoad={handleLoadGeneration}
        currentGeneratedAppId={currentGeneratedAppId}
      />

      <div className="mb-4 flex items-center gap-2">
        <span className="inline-flex h-7 items-center gap-2 rounded-full border border-white/30 bg-white/10 px-3 py-1 text-sm">
          <span className="flex items-center gap-1 text-white">
            Powered by <span className="font-semibold">Multi AI Models</span>
          </span>
        </span>
      </div>

      <h1 className="mb-16 max-w-3xl text-4xl font-bold text-white sm:text-6xl">
        Turn your <span className="text-blue-500">idea</span>
        <br /> into an <span className="text-blue-500">app</span>
      </h1>

      <form className="w-full max-w-xl" onSubmit={createApp}>
        <fieldset disabled={loading} className="disabled:opacity-75">
          <div className="relative">
            <div className="absolute -inset-1 rounded-[32px] bg-gradient-to-r from-white/30 to-cyan-200/30 blur-sm" />

            <div className="relative flex rounded-3xl border border-white/50 bg-white/40 shadow-lg backdrop-blur-[2px]">
              <div className="relative flex flex-grow items-stretch focus-within:z-10">
                <textarea
                  rows={3}
                  required
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  name="prompt"
                  className="w-full resize-none rounded-l-3xl bg-transparent px-6 py-5 text-lg text-gray-800 placeholder:text-gray-600 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-cyan-300 whitespace-normal break-words min-h-[100px]"
                  placeholder={
                    status === "brainstorming"
                      ? "Generating idea..."
                      : status === "refining"
                        ? "Refining prompt..."
                        : "Build me a calculator app..."
                  }
                  disabled={loading}
                />
              </div>

              <div className="flex flex-col justify-center gap-2 border-l border-white/30 px-2 py-2">
                <button
                  type="button"
                  onClick={generateAppIdea}
                  disabled={loading}
                  className="group rounded-lg p-2 transition-all duration-200 hover:bg-white/30 disabled:opacity-50"
                  title="Generate App Idea"
                >
                  <Sparkles className="h-5 w-5 text-yellow-300 group-hover:text-yellow-200" />
                </button>
                <button
                  type="button"
                  onClick={refinePrompt}
                  disabled={loading || !prompt}
                  className="group rounded-lg p-2 transition-all duration-200 hover:bg-white/30 disabled:opacity-50"
                  title="Refine Prompt"
                >
                  <Wand2 className="h-5 w-5 text-emerald-300 group-hover:text-emerald-200" />
                </button>
                <button
                  type="submit"
                  disabled={loading || !prompt}
                  className="group rounded-lg p-2 transition-all duration-200 hover:bg-white/30 disabled:opacity-50"
                  title="Generate Code"
                >
                  {status === "creating" ? (
                    <LoadingDots color="#6EE7B7" style="large" />
                  ) : (
                    <ChevronRight className="h-5 w-5 text-blue-500 group-hover:text-cyan-200" />
                  )}
                </button>
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-col justify-center gap-4 sm:flex-row sm:items-center sm:gap-8">
            <div className="flex items-center justify-between gap-3 sm:justify-center">
              <p className="text-white sm:text-xs">Model:</p>
              <div className="flex items-center gap-2">
                <Select.Root
                  name="model"
                  disabled={loading}
                  value={model}
                  onValueChange={setModel}
                >
                  <Select.Trigger className="group flex w-60 max-w-xs items-center rounded-2xl border border-white/50 bg-white/40 px-4 py-2 text-sm shadow-lg backdrop-blur-[2px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">
                    <Select.Value className="text-gray-800" />
                    <Select.Icon className="ml-auto">
                      <ChevronDownIcon className="size-6 text-gray-700 group-hover:text-gray-900" />
                    </Select.Icon>
                  </Select.Trigger>

                  <Select.Portal>
                    <Select.Content className="overflow-hidden rounded-md border border-white/50 bg-white/90 shadow-lg backdrop-blur-[2px]">
                      <Select.Viewport className="p-2">
                        {groupedModels.map(({ provider, models }) => (
                          <div key={provider}>
                            <div className="px-3 py-2 text-sm font-medium text-gray-900">
                              {provider.charAt(0).toUpperCase() +
                                provider.slice(1)}
                            </div>
                            {models.map((model) => (
                              <Select.Item
                                key={model.value}
                                value={model.value}
                                className="flex cursor-pointer items-center rounded-md px-3 py-2 text-sm text-gray-800 data-[highlighted]:bg-white/60 data-[highlighted]:outline-none"
                              >
                                <Select.ItemText asChild>
                                  <span className="inline-flex items-center gap-2 text-gray-800">
                                    <div className="size-2 rounded-full bg-cyan-400" />
                                    {model.label}
                                  </span>
                                </Select.ItemText>
                                <Select.ItemIndicator className="ml-auto">
                                  <CheckIcon className="size-5 text-cyan-500" />
                                </Select.ItemIndicator>
                              </Select.Item>
                            ))}
                          </div>
                        ))}
                      </Select.Viewport>
                    </Select.Content>
                  </Select.Portal>
                </Select.Root>
                <button
                  onClick={() => setShowSettings(!showSettings)}
                  className="group rounded-lg p-2 transition-all duration-200 hover:bg-white/30 disabled:opacity-50"
                  title="AI Settings"
                >
                  <Settings2 className="h-5 w-5 text-white" />
                </button>
              </div>
            </div>
          </div>
        </fieldset>
      </form>

      {status === "creating" && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center"
        >
          <SpinnerLoader />
        </motion.div>
      )}

{status === "created" && (
        <>
          <hr className="border-1 mb-20 mt-8 h-px bg-gray-700 dark:bg-gray-700/30" />
          <motion.div
            initial={{ height: 0 }}
            animate={{
              height: "auto",
              overflow: "hidden",
              transitionEnd: { overflow: "visible" },
            }}
            transition={{ type: "spring", bounce: 0, duration: 0.5 }}
            className="w-full pb-[25vh] pt-1"
            ref={ref}
          >
            <div className="relative mt-8 w-full overflow-hidden">
              <div className="isolate flex flex-col gap-4">
                <div className="mx-auto w-full">
                  {runtimeError && (
                    <ErrorFixer
                      error={runtimeError}
                      model={model}
                      code={generatedCode}
                      onFixComplete={(fixedCode) => {
                        setGeneratedCode(fixedCode);
                        setRuntimeError(null);
                      }}
                    />
                  )}
                  <CodeViewer
                    code={generatedCode}
                    showEditor
                    model={model}
                    prompt={prompt}
                    settings={aiSettings}
                    onError={(error) => {
                      console.log("Runtime error detected:", error);
                      setRuntimeError(error);
                    }}
                  />
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}

      <ChatInterface
        visible={chatVisible}
        loading={status === "updating"}
        currentCode={generatedCode}
        model={model}
        settings={aiSettings}
        prompt={prompt}
        generatedAppId={currentGeneratedAppId}
        onUpdateCode={(newCode) => setGeneratedCode(newCode)}
        onAnalyticsUpdate={(analytics) => updateTokenAnalytics(analytics)}
      />

      <AnalyticsWindow 
        analytics={tokenAnalytics} 
        visible={showAnalytics} 
      />

      <AISettingsPanel
        visible={showSettings}
        onClose={() => setShowSettings(false)}
        model={model}
        provider={currentProvider}
        settings={aiSettings}
        onSettingsChange={setAISettings}
      />
    </main>
  );
}
