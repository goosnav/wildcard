import { useEffect, useRef, useState } from "react";
import {
  generate,
  getMe,
  getManifest,
  verifyMagicLink,
  logout,
  getSession,
  type GenEvent,
  type AuthUser,
  type Quota,
  type AppManifest,
} from "./api";
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
import { EditBar } from "./components/EditBar";
import { SignIn } from "./components/SignIn";
import { Paywall } from "./components/Paywall";
import { AdminDashboard } from "./components/AdminDashboard";

type View =
  | { name: "home" }
  | { name: "build" }
  | { name: "admin" }
  | { name: "run"; tool: SavedTool; tab: "run" | "source" };

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [tools, setTools] = useState<SavedTool[]>([]);
  const [view, setView] = useState<View>({ name: "home" });
  const [lines, setLines] = useState<BuildLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [manifest, setManifest] = useState<AppManifest | null>(null);
  const booted = useRef(false);

  // Public app config (version, live-data catalog, feature flags). Best-effort.
  useEffect(() => {
    getManifest().then(setManifest);
  }, []);

  // Bootstrap auth: complete a magic-link sign-in, refresh after checkout, or
  // resolve the existing session. Then scrub one-time params from the URL.
  // Guarded so React StrictMode's double-invoke can't consume the single-use
  // magic token twice (the second consume would 401 and bounce us to sign-in).
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    const url = new URL(window.location.href);
    const token = url.searchParams.get("token");
    const checkout = url.searchParams.get("checkout");
    (async () => {
      try {
        if (token) {
          setUser(await verifyMagicLink(token));
        } else {
          setUser(await getMe());
        }
      } catch {
        setUser(null);
      } finally {
        if (token || checkout) {
          url.searchParams.delete("token");
          url.searchParams.delete("checkout");
          window.history.replaceState({}, "", url.pathname + url.search + url.hash);
        }
        setAuthChecked(true);
      }
    })();
  }, []);

  useEffect(() => {
    getAllTools().then(setTools);
  }, []);

  function applyQuota(quota: Quota | undefined) {
    if (quota) setUser((u) => (u ? { ...u, quota } : u));
  }

  async function build(prompt: string) {
    if (user && !user.quota.canBuild) {
      setShowPaywall(true);
      return;
    }
    setBusy(true);
    setLines([{ text: `“${prompt}”`, kind: "status" }]);
    setView({ name: "build" });
    const onEvent = (e: GenEvent) => {
      const line = eventToLine(e);
      if (line) setLines((prev) => [...prev, line]);
    };
    try {
      const result = await generate(prompt, onEvent);
      applyQuota(result.quota);
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
      } else if (result.paywall) {
        setView({ name: "home" });
        setShowPaywall(true);
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

  // Persist a hand-edited source bundle and re-run it. Same manifest id, so the
  // tool keeps its place on the grid and its WC.storage data (REQ-EDIT-004).
  async function saveToolSource(tool: SavedTool, files: SavedTool["files"]) {
    const updated: SavedTool = { ...tool, files };
    await putTool(updated);
    setTools((prev) => prev.map((t) => (t.manifest.id === tool.manifest.id ? updated : t)));
    setView({ name: "run", tool: updated, tab: "run" });
  }

  // Edit-with-AI (REQ-EDIT-003): regenerate the current tool with its source as
  // context. Shows the same streaming build view; on success the updated tool
  // replaces the original in place. A failed edit leaves the original untouched.
  async function editTool(original: SavedTool, instruction: string) {
    if (user && !user.quota.canBuild) {
      setShowPaywall(true);
      return;
    }
    setBusy(true);
    setLines([{ text: `“${instruction}”`, kind: "status" }]);
    setView({ name: "build" });
    const onEvent = (e: GenEvent) => {
      const line = eventToLine(e);
      if (line) setLines((prev) => [...prev, line]);
    };
    try {
      const result = await generate(instruction, onEvent, original);
      applyQuota(result.quota);
      if (result.ok) {
        const tool: SavedTool = {
          manifest: result.manifest,
          files: result.files,
          createdAt: original.createdAt, // keep its original place on the grid
        };
        await putTool(tool);
        setTools((prev) =>
          prev.some((t) => t.manifest.id === tool.manifest.id)
            ? prev.map((t) => (t.manifest.id === tool.manifest.id ? tool : t))
            : [tool, ...prev]
        );
        setView({ name: "run", tool, tab: "run" });
      } else if (result.paywall) {
        setView({ name: "run", tool: original, tab: "run" });
        setShowPaywall(true);
      } else {
        setLines((prev) => [...prev, { text: result.reason, kind: "fail" }]);
      }
    } catch (err) {
      setLines((prev) => [
        ...prev,
        {
          text: err instanceof Error ? err.message : "Something went wrong editing that.",
          kind: "fail",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await logout();
    setUser(null);
    setView({ name: "home" });
  }

  // Don't flash the sign-in screen while we resolve an existing session.
  if (!authChecked && getSession()) {
    return <div className="app booting" />;
  }
  if (!user) {
    return <SignIn />;
  }

  const q = user.quota;
  const quotaLabel =
    q.plan === "pro"
      ? "Pro · unlimited"
      : `${q.remaining} build${q.remaining === 1 ? "" : "s"} left`;

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => setView({ name: "home" })}>
          🃏 Wild Card
        </button>
        <div className="account">
          {user.isAdmin && (
            <button
              className={`admin-link${view.name === "admin" ? " active" : ""}`}
              onClick={() => setView({ name: "admin" })}
            >
              Dashboard
            </button>
          )}
          <button
            className={`quota-badge${q.plan === "free" && q.remaining === 0 ? " quota-empty" : ""}`}
            onClick={() => q.plan === "free" && setShowPaywall(true)}
            title={user.email}
          >
            {quotaLabel}
          </button>
          <button className="signout" onClick={signOut} title="Sign out">
            ⎋
          </button>
        </div>
      </header>

      <main className="content">
        {(view.name === "home" || view.name === "build") && (
          <PromptBar busy={busy} onSubmit={build} />
        )}

        {view.name === "admin" && <AdminDashboard />}

        {view.name === "home" && (
          <HomeGrid
            tools={tools}
            onLaunch={(tool) => setView({ name: "run", tool, tab: "run" })}
            onDelete={deleteTool}
          />
        )}

        {view.name === "build" && (
          <BuildView lines={lines} busy={busy} onHome={() => setView({ name: "home" })} />
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
              <SourceView
                bundle={view.tool}
                onSave={(files) => saveToolSource(view.tool, files)}
              />
            )}
            <EditBar busy={busy} onSubmit={(instruction) => editTool(view.tool, instruction)} />
          </div>
        )}
      </main>

      {manifest && (
        <footer className="appfoot">
          <span>Wild Card v{manifest.version}</span>
          {manifest.providers.length > 0 && (
            <span title={manifest.providers.map((p) => p.label).join(", ")}>
              · {manifest.providers.length} live-data source
              {manifest.providers.length === 1 ? "" : "s"}
            </span>
          )}
        </footer>
      )}

      {showPaywall && <Paywall onClose={() => setShowPaywall(false)} />}
    </div>
  );
}
