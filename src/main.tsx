import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./app/App";
import Indicator from "./app/Indicator";
import ComputerVisual from "./app/ComputerVisual";
import AssistantToolPopup from "./app/AssistantToolPopup";
import OverlayFeedback from "./app/OverlayFeedback";
import "./app/app.css";

// Both windows load this bundle; only "main" runs the dictation controller.
const windowLabel = getCurrentWindow().label;
const isIndicator = windowLabel === "indicator";
const isComputerVisual = windowLabel === "computer-visual";
const isAssistantToolPopup = windowLabel === "assistant-tool-popup";
const isOverlayFeedback = windowLabel === "overlay-feedback";
if (isComputerVisual) document.documentElement.classList.add("computer-visual-view");
if (isAssistantToolPopup || isOverlayFeedback) { document.documentElement.style.background = "transparent"; document.body.style.background = "transparent"; }
if (isOverlayFeedback) document.documentElement.classList.add("overlay-feedback-view");
if (isAssistantToolPopup) document.documentElement.classList.add("assistant-popup-view");
if (isIndicator) document.documentElement.classList.add("indicator-view");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isOverlayFeedback ? <OverlayFeedback /> : isAssistantToolPopup ? <AssistantToolPopup /> : isComputerVisual ? <ComputerVisual /> : isIndicator ? <Indicator /> : <App />}
  </React.StrictMode>,
);
