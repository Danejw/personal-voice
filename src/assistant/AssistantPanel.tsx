import { useEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ConversationBar } from "@/assistant/ConversationBar";
import { SelectField } from "@/components/SelectField";
import type { AssistantLibrarySnapshot } from "@/assistant/AssistantConversationStore";
import { selectionPreview } from "@/assistant/selectionContext";
import { cameraContextPreviewUrl } from "@/assistant/cameraPhoto";
import { previewUrl } from "@/assistant/snapshotEncode";
import type { AssistantController } from "@/assistant/AssistantController";
import type { AssistantSource } from "@/assistant/grounding";
import { assistantStatusLabel, type AssistantSnapshot } from "@/assistant/state";
import { cameraFacingLabel } from "@/platform/camera";

interface AssistantChromeProps {
  controller: AssistantController;
  snapshot: AssistantSnapshot;
  signedIn: boolean;
  micBusy?: boolean;
  onCaptureScreen?: () => Promise<void>;
  onCaptureCamera?: () => Promise<void>;
  onContinueTask?: () => Promise<void>;
  library?: AssistantLibrarySnapshot;
  onNewThread?: () => void;
  onOpenThread?: (id: string) => void;
  onRenameThread?: (id: string, title: string) => void;
  onDeleteThread?: (id: string) => void;
  onRetrySave?: () => void;
  onLoadOlder?: () => void;
  onRefreshThreads?: () => void;
  onProduce?: () => void;
  onDismissRecovery?: (id: string) => void;
  settingsContent?: ReactNode;
}

/** Header status and the Start / End control. Continue here is the only way a second device takes the microphone. */
export function AssistantHeader({ controller, snapshot, signedIn, micBusy = false, library, onProduce }: AssistantChromeProps) {
  const running = snapshot.status === "CONNECTING" || snapshot.status === "READY" || snapshot.status === "RESPONDING";
  const viewingElsewhere = !running && Boolean(library && !library.holding && library.activeLabel && library.activeLabel !== "this device");
  const label = assistantStatusLabel(snapshot, signedIn);
  return (
    <div className="page-header-actions">
      <p className={snapshot.status === "ERROR" ? "error" : "status"} role={snapshot.status === "ERROR" ? "alert" : "status"}>{label}</p>
      {import.meta.env.DEV && running && (
        <button type="button" className="secondary" onClick={() => controller.reconnect()}>
          Reconnect
        </button>
      )}
      {snapshot.echoFallback && (snapshot.status === "RESPONDING" || snapshot.playbackHeld) && (
        <button type="button" className="secondary" onClick={() => controller.interruptPlayback()}>
          Stop and listen
        </button>
      )}
      <button
        type="button"
        className="record"
        disabled={(!running && !signedIn) || (!running && micBusy)}
        onClick={() => {
          if (running) controller.end();
          else if (onProduce) void onProduce();
          else controller.start();
        }}
      >
        {running ? "End Assistant" : viewingElsewhere ? "Continue here" : snapshot.turns.length ? "Continue conversation" : "Start Assistant"}
      </button>
    </div>
  );
}

/** Saved transcript and the typed-turn composer. Starting again sends the saved conversation once. */
export function AssistantPanel({
  controller,
  snapshot,
  signedIn,
  onCaptureScreen,
  onCaptureCamera,
  onContinueTask,
  library,
  onNewThread,
  onOpenThread,
  onRenameThread,
  onDeleteThread,
  onRetrySave,
  onLoadOlder,
  onRefreshThreads,
  onDismissRecovery,
  onProduce,
  micBusy,
  settingsContent,
}: AssistantChromeProps) {
  const [draft, setDraft] = useState("");
  const [view, setView] = useState<"chat" | "settings" | "tools">("chat");
  const [showThreads, setShowThreads] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [accessibility, setAccessibility] = useState<{windowTitle: string | null; focusedName: string | null; focusedClass: string | null; text: string | null; status: string} | null>(null);
  const [accessibilityError, setAccessibilityError] = useState<string | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [capturingCamera, setCapturingCamera] = useState(false);
  const [photoWindows, setPhotoWindows] = useState<string[]>([]);
  const [photoWindow, setPhotoWindow] = useState("");
  const [photoSending, setPhotoSending] = useState(false);
  const [photoNotice, setPhotoNotice] = useState<string | null>(null);
  const [computerHistory, setComputerHistory] = useState<Array<{ label: string; phase: string; at: string }>>([]);
  const [accessibilityWatch, setAccessibilityWatch] = useState(false);
  const [treeReport, setTreeReport] = useState<{
    windowTitle:string;truncated:boolean;
    nodes:Array<{path:string;name:string;automationId:string;controlType:number;
      framework:string;patterns:string[];bounds?:{x:number;y:number;width:number;height:number}|null;}>;
  } | null>(null);
  const [treeFilter,setTreeFilter] = useState("");
  const [treeBusy,setTreeBusy] = useState(false);
  const [treeError,setTreeError] = useState<string|null>(null);
  const [accessibilityWatchError, setAccessibilityWatchError] = useState<string | null>(null);
  const [accessibilityEvents, setAccessibilityEvents] = useState<Array<{kind:string; windowTitle:string|null;at:string}>>([]);
  useEffect(() => {
    if (!navigator.userAgent.includes("Windows")) return;
    let mounted = true;
    void invoke<boolean>("accessibility_watch_status").then((enabled) => {
      if (mounted) setAccessibilityWatch(enabled);
    }).catch(() => undefined);
    const unsubscribe = listen<{kind:string;windowTitle:string|null}>("accessibility-event",(event) => {
      setAccessibilityEvents((previous) => [{
        kind:event.payload.kind,windowTitle:event.payload.windowTitle,
        at:new Date().toLocaleTimeString()
      },...previous].slice(0,40));
    });
    return () => {mounted=false;void unsubscribe.then((stop)=>stop());};
  }, [snapshot.status]);
  useEffect(() => {
    const subscription = listen<{ label: string; phase: string }>("computer-activity", (event) => {
      const entry = { label: event.payload.label, phase: event.payload.phase, at: new Date().toLocaleTimeString() };
      setComputerHistory((history) => [entry, ...history].slice(0, 25));
    });
    return () => { void subscription.then((unsubscribe) => unsubscribe()); };
  }, []);

  const [continuing, setContinuing] = useState(false);
  const [continueNotice, setContinueNotice] = useState<string | null>(null);
  const [continueError, setContinueError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const canSend = signedIn && snapshot.status === "READY";

  useEffect(() => {
    const scroll = scrollRef.current;
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  }, [library?.currentId, snapshot.turns, snapshot.liveText, snapshot.liveUser]);

  function send() {
    const text = draft.trim();
    if (!text || !canSend) return;
    controller.send(text);
    setDraft("");
  }

  const showEchoNote = snapshot.echoFallback && (snapshot.status === "CONNECTING" || snapshot.status === "READY" || snapshot.status === "RESPONDING");
  const sessionIdle = snapshot.status === "IDLE" || snapshot.status === "ERROR";
  const selected = library?.conversations.find((item) => item.id === library.currentId);
  return (
    <div className={`assistant-workspace${showThreads ? " show-thread-rail" : ""}${railCollapsed ? " is-rail-collapsed" : ""}`}>
      {library && onNewThread && onOpenThread && onRenameThread && onDeleteThread && onRetrySave && (
        <ConversationBar
          library={library}
          signedIn={signedIn}
          sessionIdle={sessionIdle}
          onNew={() => { onNewThread(); setView("chat"); setShowThreads(false); }}
          onOpen={(id) => { onOpenThread(id); setView("chat"); setShowThreads(false); }}
          onRename={onRenameThread}
          onDelete={onDeleteThread}
          onRetry={onRetrySave}
          onLoadOlder={onLoadOlder}
          onRefresh={onRefreshThreads}
          hasUnlinkedTranscript={!library.currentId && snapshot.turns.length > 0}
          onDismissRecovery={onDismissRecovery}
        />
      )}
      <section className="assistant-main-panel" aria-label="Assistant workspace">
        <header className="assistant-chat-header">
          <button type="button" className="assistant-rail-toggle secondary"
            onClick={() => { if (window.matchMedia("(max-width: 780px)").matches) setShowThreads((open) => !open); else setRailCollapsed((collapsed) => !collapsed); }}
            aria-expanded={showThreads || !railCollapsed} aria-controls="assistant-threads" aria-label={showThreads || !railCollapsed ? "Collapse conversations" : "Show conversations"}
            title={showThreads || !railCollapsed ? "Collapse conversations" : "Show conversations"}>☰</button>
          <div className="assistant-conversation-heading">
            <h3 title={selected?.title ?? "New conversation"}>{selected?.title ?? "New conversation"}</h3>
          </div>
          <AssistantHeader controller={controller} snapshot={snapshot} signedIn={signedIn}
            micBusy={micBusy} library={library} onProduce={onProduce} />
        </header>
        <nav className="assistant-view-tabs" aria-label="Assistant views">
          {(["chat", "settings", "tools"] as const).map((tab) => (
            <button key={tab} type="button" className={view === tab ? "is-active" : ""}
              aria-current={view === tab ? "page" : undefined}
              onClick={() => setView(tab)}>
              {tab === "chat" ? "Conversation" : tab === "settings" ? "Settings" : "Advanced tools"}
            </button>
          ))}
        </nav>
        <div ref={scrollRef} className="assistant-chat-scroll hide-scrollbar" hidden={view !== "chat"}>
      {showEchoNote && (
        <p className="assistant-echo" role="note">
          This phone can't cancel speaker echo, so the microphone pauses while a reply plays and for a short moment after the sound ends. Stop and listen cuts the reply off. Talking over it will not interrupt. Noise reduction lowers background noise. It does not pick out your voice or remove other people.
        </p>
      )}
      <ul className="assistant-log" aria-live="polite">
        {snapshot.turns.map((turn) => (
          <li key={turn.id} className={turn.role === "user" ? "assistant-turn is-user" : "assistant-turn"}>
            <div className="assistant-bubble-copy">
              <span className="assistant-role">{turn.role === "user" ? "You" : "Assistant"}{turn.status === "interrupted" ? " · interrupted" : ""}</span>{" "}
              <p>{turn.text}</p>
            </div>
            {turn.role === "assistant" && turn.sources && <SourceList sources={turn.sources} />}
          </li>
        ))}
        {snapshot.liveUser && (
          <li className="assistant-turn is-user"><div className="assistant-bubble-copy"><span className="assistant-role">You</span>{" "}<p className="partial">{snapshot.liveUser}</p></div></li>
        )}
        {snapshot.liveText && (
          <li className="assistant-turn">
            <div className="assistant-bubble-copy"><span className="assistant-role">Assistant</span>{" "}<p className="partial">{snapshot.liveText}</p></div>
            <SourceList sources={snapshot.liveSources} />
          </li>
        )}
        {!snapshot.turns.length && !snapshot.liveText && !snapshot.liveUser && (
          <li className="placeholder">Start Assistant, then speak or type a message.</li>
        )}
      </ul>
      {snapshot.continuedFrom && (
        <p className="note-meta">Continued from {snapshot.continuedFrom}. This is a new Assistant session.</p>
      )}
      {snapshot.selection && (
        <div className="selection-preview assistant-selection">
          <p className="note-meta">
            {snapshot.selection.sourceApp ? `From ${snapshot.selection.sourceApp}` : "Attached selection"}
          </p>
          <p>{selectionPreview(snapshot.selection.text)}</p>
          <button type="button" className="secondary" onClick={() => controller.detachSelection()}>Remove</button>
        </div>
      )}
      {snapshot.selectionError && <p className="error" role="alert">{snapshot.selectionError}</p>}
      {snapshot.notes.map((note) => (
        <div key={note.id} className="selection-preview assistant-selection">
          <p className="note-meta">Attached voice note · {new Date(note.createdAt).toLocaleString()}</p>
          <p>{selectionPreview(note.text)}</p>
          <button type="button" className="secondary" onClick={() => controller.detachNote(note.id)}>Remove</button>
        </div>
      ))}
      {snapshot.handoff && (
        <div className="selection-preview assistant-selection">
          <p className="note-meta">
            Attached handoff{snapshot.handoff.sourceLabel ? ` · ${snapshot.handoff.sourceLabel}` : ""}
          </p>
          <p>{selectionPreview(snapshot.handoff.text)}</p>
          <button type="button" className="secondary" onClick={() => controller.detachHandoff()}>Remove</button>
        </div>
      )}
      {snapshot.accountError && <p className="error" role="alert">{snapshot.accountError}</p>}
        </div>
        <div className="assistant-settings-pane hide-scrollbar" hidden={view !== "settings"} role="region" aria-label="Assistant settings">
          {settingsContent}
        </div>
        <div className="assistant-tools-pane hide-scrollbar" hidden={view !== "tools"} role="region" aria-label="Advanced Assistant tools">
          <div className="assistant-pane-intro"><h4>Advanced tools</h4><p>Screen, camera and computer diagnostics. These tools are available whenever you need them.</p></div>
      {navigator.userAgent.includes("Windows") && (
        <div className="assistant-selection" role="region" aria-label="Windows accessibility inspection">
          <p className="note-meta">Windows accessibility · read-only · manual</p>
          <button type="button" className="secondary" disabled={inspecting} onClick={() => {
            setInspecting(true);
            setAccessibilityError(null);
            void invoke<{windowTitle: string | null; focusedName: string | null; focusedClass: string | null; text: string | null; status: string}>("inspect_accessibility")
              .then(setAccessibility)
              .catch((error: unknown) => setAccessibilityError(String(error)))
              .finally(() => setInspecting(false));
          }}>{inspecting ? "Inspecting…" : "Inspect active app"}</button>
          {accessibilityError && <p role="alert" className="error">{accessibilityError}</p>}
          {accessibility && (
            <div className="selection-preview">
              <p className="note-meta">{accessibility.windowTitle ?? "Untitled window"} · {accessibility.status}</p>
              <p>{accessibility.focusedName ?? "Unnamed control"}{accessibility.focusedClass ? ` · ${accessibility.focusedClass}` : ""}</p>
              {accessibility.text && <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 200, overflowY: "auto" }}>{accessibility.text}</pre>}
              {accessibility.text && <button type="button" className="secondary" onClick={() => {
                const error = controller.attachSelection({
                  type: "selection",
                  text: accessibility.text ?? "",
                  sourceApp: accessibility.windowTitle ?? "Windows accessibility",
                  capturedAt: new Date().toISOString(),
                });
                if (error) setAccessibilityError(error);
                else setAccessibility(null);
              }}>Attach to Assistant</button>}
              <button type="button" className="secondary" onClick={() => setAccessibility(null)}>Clear</button>
            </div>
          )}
          <p className="note-meta">Local preview only until you choose Attach to Assistant. Attached text may be sent to Gemini and saved in Assistant conversations.</p>
        </div>
      )}
      {navigator.userAgent.includes("Windows") && (
        <button type="button" className="secondary" onClick={() => {
          void invoke("hide_computer_visual").catch(() => undefined);
        }}>Hide visual target</button>
      )}
      <div className="assistant-selection">
        <button
          type="button"
          className="secondary"
          disabled={!onCaptureScreen || capturing}
          onClick={() => {
            if (!onCaptureScreen) return;
            setCapturing(true);
            void onCaptureScreen().finally(() => setCapturing(false));
          }}
        >
          {capturing ? "Capturing…" : snapshot.screen ? "Recapture" : "Capture screen"}
        </button>
        {snapshot.screen && (
          <>
            <img src={previewUrl(snapshot.screen)} alt="Captured screen" className="assistant-shot" />
            <p className="note-meta">
              Attached screenshot
              {` · ${snapshot.screen.source === "window" ? "Active window" : "Screen"}`}
              {snapshot.screen.sourceApp ? ` · ${snapshot.screen.sourceApp}` : ""}
              {` · ${new Date(snapshot.screen.capturedAt).toLocaleTimeString()}`}
            </p>
            <button type="button" className="secondary" onClick={() => controller.detachSnapshot()}>Remove</button>
          </>
        )}
      </div>
      {snapshot.screenError && <p className="error" role="alert">{snapshot.screenError}</p>}
      <div className="assistant-selection">
        <button
          type="button"
          className="secondary"
          disabled={!onCaptureCamera || capturingCamera}
          onClick={() => {
            if (!onCaptureCamera) return;
            setCapturingCamera(true);
            void onCaptureCamera().finally(() => setCapturingCamera(false));
          }}
        >
          {capturingCamera ? "Opening camera…" : snapshot.cameraPhoto ? "Retake photo" : "Camera photo"}
        </button>
        {snapshot.cameraPhoto && (
          <>
            <img
              src={cameraContextPreviewUrl(snapshot.cameraPhoto)}
              alt="Captured camera photo"
              className="assistant-shot"
            />
            <p className="note-meta">
              Attached camera photo
              {` · ${cameraFacingLabel(snapshot.cameraPhoto.facing)}`}
              {snapshot.cameraPhoto.label ? ` · ${snapshot.cameraPhoto.label}` : ""}
              {` · ${new Date(snapshot.cameraPhoto.capturedAt).toLocaleTimeString()}`}
            </p>
            <button type="button" className="secondary" onClick={() => controller.detachCameraPhoto()}>Remove</button>
            {navigator.userAgent.includes("Windows") && (
              <div className="assistant-action" role="group" aria-label="Paste camera photo into another app">
                <p className="note-meta">Insert this photo into a focused input, including a ChatGPT conversation. Does not press Send.</p>
                <button type="button" className="secondary" onClick={() => {
                  setPhotoNotice(null);
                  void invoke<{ windows: string[] }>("describe_windows").then((report) => {
                    const windows = report.windows.filter((name) => name !== "Personal Voice");
                    setPhotoWindows(windows);
                    setPhotoWindow((current) => windows.includes(current) ? current : "");
                  }).catch((error: unknown) => setPhotoNotice(String(error)));
                }}>Find open windows</button>
                <SelectField
                  label="Photo destination window"
                  layout="stack"
                  value={photoWindow}
                  options={[
                    { value: "", label: "Select destination window" },
                    ...photoWindows.map((title) => ({ value: title, label: title })),
                  ]}
                  disabled={photoSending || photoWindows.length === 0}
                  onChange={setPhotoWindow}
                />
                <button type="button" className="secondary" disabled={!photoWindow || photoSending} onClick={() => {
                  setPhotoSending(true);
                  setPhotoNotice(null);
                  void controller.pasteCameraPhotoToApp(photoWindow)
                    .then(setPhotoNotice).catch((error: unknown) => setPhotoNotice(String(error)))
                    .finally(() => setPhotoSending(false));
                }}>{photoSending ? "Pasting photo…" : "Paste photo into focused input"}</button>
                {photoNotice && <p className="note-meta" role="status">{photoNotice}</p>}
              </div>
            )}
          </>
        )}
      </div>
      {snapshot.cameraPhotoError && <p className="error" role="alert">{snapshot.cameraPhotoError}</p>}
      <div className="assistant-action" role="region" aria-label="Camera Context">
        <p className="note-meta">
          {snapshot.cameraContextActive
            ? `Camera On · ${cameraFacingLabel(snapshot.cameraContextFacing ?? "default")}`
            : "Camera Context off"}
        </p>
        {snapshot.cameraContextError && <p className="error" role="alert">{snapshot.cameraContextError}</p>}
        <div className="assistant-action-buttons">
          {snapshot.cameraContextActive ? (
            <>
              <button
                type="button"
                className="secondary"
                onClick={() => void controller.switchCameraContext(
                  snapshot.cameraContextFacing === "front" ? "back" : "front",
                ).catch(() => undefined)}
              >
                Switch camera
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => void controller.stopCameraContext().catch(() => undefined)}
              >
                Stop camera
              </button>
            </>
          ) : (
            <button
              type="button"
              className="secondary"
              disabled={snapshot.status === "IDLE" || snapshot.status === "ERROR"}
              onClick={() => void controller.startCameraContext("default").catch(() => undefined)}
            >
              Start camera
            </button>
          )}
        </div>
      </div>
      {navigator.userAgent.includes("Windows") && (
        <div className="assistant-action" role="region" aria-label="Computer interaction history">
          <p className="note-meta">Accessibility element explorer</p>
          <div className="assistant-action-buttons">
            <button type="button" className="secondary" disabled={treeBusy} onClick={() => {
              setTreeBusy(true);
              setTreeError(null);
              void invoke<typeof treeReport>("inspect_accessibility_tree")
                .then(setTreeReport).catch((error:unknown)=>setTreeError(String(error)))
                .finally(()=>setTreeBusy(false));
            }}>{treeBusy ? "Inspecting…" : "Inspect current window controls"}</button>
            {treeReport && <span className="note-meta">{treeReport.nodes.length} controls · {treeReport.windowTitle}{treeReport.truncated ? " (partial)" : ""}</span>}
          </div>
          {treeError && <p className="error" role="alert">{treeError}</p>}
          {treeReport && (
            <div className="assistant-action">
              <input aria-label="Filter accessible controls" placeholder="Filter names or automation IDs" value={treeFilter}
                onChange={(event)=>setTreeFilter(event.target.value)} />
              <ol style={{maxHeight:230,overflowY:"auto",paddingInlineStart:22}}>
                {treeReport.nodes.filter((node)=>!treeFilter ||
                  node.name.toLowerCase().includes(treeFilter.toLowerCase()) ||
                  node.automationId.toLowerCase().includes(treeFilter.toLowerCase()))
                  .slice(0,60).map((node)=>(
                    <li key={node.path} className="note-meta">
                      <span>{node.name || node.automationId || "(unnamed)"} · {node.patterns.join(", ") || "read only"}</span>{" "}
                      <button type="button" className="secondary" onClick={()=>{
                        setTreeError(null);
                        void invoke("accessibility_pattern_action",{
                          locator:{window:treeReport.windowTitle,path:node.path,name:node.name,
                            automationId:node.automationId,controlType:node.controlType},
                          action:"highlight",text:null,number:null
                        }).catch((error:unknown)=>setTreeError(String(error)));
                      }}>Highlight</button>
                    </li>
                  ))}
              </ol>
            </div>
          )}
          <p className="note-meta">Computer interaction activity</p>
          <div className="assistant-action-buttons">
            <button type="button" className="secondary" onClick={() => {
              setAccessibilityWatchError(null);
              const enabled = !accessibilityWatch;
              void invoke<string>("accessibility_watch",{enabled})
                .then(() => setAccessibilityWatch(enabled))
                .catch((error:unknown) => setAccessibilityWatchError(String(error)));
            }}>{accessibilityWatch ? "Stop live UI awareness" : "Start live UI awareness"}</button>
            <button type="button" className="secondary" onClick={() => {
              setAccessibilityEvents([]);
              setComputerHistory([]);
            }}>Clear history</button>
          </div>
          <p className="note-meta">{accessibilityWatch
            ? "Windows accessibility monitoring active. Focus, selection, and UI changes are visible locally; no text is continuously sent to Gemini."
            : "Live accessibility monitoring is off."}</p>
          {accessibilityWatchError && <p className="error" role="alert">{accessibilityWatchError}</p>}
          {accessibilityEvents.length > 0 && (
            <ol style={{maxHeight:160,overflowY:"auto",paddingInlineStart:22}}>
              {accessibilityEvents.map((event,index) => (
                <li key={`${event.at}-${index}`} className="note-meta">
                  {event.at} · {event.kind}: {event.windowTitle ?? "Unknown window"}
                </li>
              ))}
            </ol>
          )}
          {computerHistory.length === 0 ? (
            <p className="note-meta">No accessibility or computer actions in this view yet.</p>
          ) : (
            <ol style={{ maxHeight: 190, overflowY: "auto", paddingInlineStart: 22 }}>
              {computerHistory.map((entry, index) => (
                <li key={`${entry.at}-${index}`} className="note-meta">
                  {entry.at} · {entry.phase}: {entry.label}
                </li>
              ))}
            </ol>
          )}

        </div>
      )}
        </div>
        <div className="assistant-chat-actions" hidden={view !== "chat"}>
      {(snapshot.computerRunning || snapshot.computerPrompt) && (
        <div className="assistant-action" role="region" aria-label="Supervised screen task">
          <p>{snapshot.computerPrompt ?? "A supervised screen task is running."}</p>
          <div className="assistant-action-buttons">
            {snapshot.computerPrompt && (
              <button type="button" className="secondary" onClick={() => controller.confirmComputer()}>Confirm</button>
            )}
            <button type="button" className="secondary" onClick={() => controller.stopComputer()}>Stop</button>
          </div>
        </div>
      )}
      {snapshot.pendingAction && (
        <div className="assistant-action" role="region" aria-label="Assistant wants to">
          <p className="note-meta">Assistant wants to:</p>
          <p>{snapshot.pendingAction.title}</p>
          <p>{snapshot.pendingAction.preview}</p>
          <div className="assistant-action-buttons">
            <button
              type="button"
              className="secondary"
              disabled={snapshot.pendingAction.working}
              onClick={() => controller.confirmPending()}
            >
              {snapshot.pendingAction.working ? "Working…" : "Confirm"}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={snapshot.pendingAction.working}
              onClick={() => controller.cancelPending()}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {snapshot.actionNotice && <p className="status" role="status">{snapshot.actionNotice}</p>}
        </div>
        <div className="assistant-tools-transfer" hidden={view !== "tools"}>
      {onContinueTask && (
        <button
          type="button"
          className="secondary"
          disabled={!signedIn || continuing || snapshot.turns.length === 0}
          onClick={() => {
            setContinuing(true);
            setContinueError(null);
            setContinueNotice(null);
            void onContinueTask()
              .then(() => setContinueNotice("Sent. On the other device, choose Continue."))
              .catch((reason: unknown) => setContinueError(reason instanceof Error ? reason.message : "Couldn't continue on another device."))
              .finally(() => setContinuing(false));
          }}
        >
          {continuing ? "Sending…" : "Continue on another device"}
        </button>
      )}
      {continueNotice && <p className="status" role="status">{continueNotice}</p>}
      {continueError && <p className="error" role="alert">{continueError}</p>}
        </div>
      <form
        className="assistant-composer"
        hidden={view !== "chat"}
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <label className="assistant-composer-field">
          <span className="visually-hidden">Message</span>
          <textarea
            value={draft}
            rows={1}
            placeholder={canSend ? "Message your Assistant…" : "Start or continue a conversation to send a message"}
            aria-label="Message"
            disabled={!canSend}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                send();
              }
            }}
          />
        </label>
        <button type="submit" className="assistant-send" disabled={!canSend || !draft.trim()} aria-label="Send message">➤</button>
      </form>
      </section>
    </div>
  );
}

function SourceList({ sources }: { sources: AssistantSource[] }) {
  if (!sources.length) return null;
  return (
    <ul className="assistant-sources">
      {sources.map((source) => (
        <li key={source.url}>
          <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
        </li>
      ))}
    </ul>
  );
}
