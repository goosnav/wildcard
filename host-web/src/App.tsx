import { useEffect, useState } from "react";
import { generate, type GenEvent } from "./api";
import {
  getAllTools,
  putTool,
  deleteTool as deleteToolFromDb,
  type SavedTool,
} from "./idb";
import { PromptBar } from "./components/PromptBar";
import { BuildView, eventToLine, type BuildLine } from "./components/BuildView";
import { HomeGrid } from "./components/HomeGrid";
import { ToolRunner } from "./components/ToolRunner";
import { SourceView } from "./components/SourceView";

type View =
  | { name: "home" }
  | { name: "build" }
  | { name: "run"; tool: SavedTool; tab: "run" | "source" };

export default function App() {
  const [tools, setTools] = useState<SavedTool[]>([]);
  const [view, setView] = useState<View>({ name: "home" });
  const [lines, setLines] = useState<BuildLine[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getAllTools().then(setTools);
  }, []);

  async function build(prompt: string) {
    setBusy(true);
    setLines([{ text: `“${prompt}”`, kind: "status" }]);
    setView({ name: "build" });
    const onEvent = (e: GenEvent) => {
      const line = eventToLine(e);
      if (line) setLines((prev) => [...prev, line]);
    };
    try {
      const result = await generate(prompt, onEvent);
      if (result.ok) {
        const tool: SavedTool = {
          manifest: result.manifest,
          files: result.files,
          createdAt: Date.now(),
        };
        await putTool(tool);
        setTools((prev) => [
          tool,
          ...prev.filter((t) => t.manifest.id !== tool.manifest.id),
        ]);
        setView({ name: "run", tool, tab: "run" });
      } else {
        setLines((prev) => [...prev, { text: result.reason, kind: "fail" }]);
      }
    } catch (err) {
      setLines((prev) => [
        ...prev,
        {
          text:
            err instanceof Error ? err.message : "Something went wrong building that.",
          kind: "fail",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function deleteTool(tool: SavedTool) {
    await deleteToolFromDb(tool.manifest.id);
    setTools((prev) => prev.filter((t) => t.manifest.id !== tool.manifest.id));
  }

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => setView({ name: "home" })}>
          🃏 Wild Card
        </button>
      </header>

      <main className="content">
        {view.name !== "run" && (
          <PromptBar busy={busy} onSubmit={build} />
        )}

        {view.name === "home" && (
          <HomeGrid
            tools={tools}
            onLaunch={(tool) => setView({ name: "run", tool, tab: "run" })}
            onDelete={deleteTool}
          />
        )}

        {view.name === "build" && (
          <BuildView
            lines={lines}
            busy={busy}
            onHome={() => setView({ name: "home" })}
          />
        )}

        {view.name === "run" && (
          <div className="runview">
            <div className="runview-head">
              <button className="back" onClick={() => setView({ name: "home" })}>
                ‹ Home
              </button>
              <span className="runview-title">
                {view.tool.manifest.icon} {view.tool.manifest.name}
              </span>
              <div className="runview-tabs">
                <button
                  className={view.tab === "run" ? "active" : ""}
                  onClick={() => setView({ ...view, tab: "run" })}
                >
                  Run
                </button>
                <button
                  className={view.tab === "source" ? "active" : ""}
                  onClick={() => setView({ ...view, tab: "source" })}
                >
                  Source
                </button>
              </div>
            </div>
            {view.tab === "run" ? (
              <ToolRunner bundle={view.tool} />
            ) : (
              <SourceView bundle={view.tool} />
            )}
          </div>
        )}
      </main>
    </div>
  );
}
