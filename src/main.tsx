import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./app/App";
import Indicator from "./app/Indicator";
import ComputerVisual from "./app/ComputerVisual";
import AssistantPopup from "./app/AssistantPopup";
import "./app/app.css";

// Both windows load this bundle; only "main" runs the dictation controller.
const windowLabel = getCurrentWindow().label;
const isIndicator = windowLabel === "indicator";
const isComputerVisual = windowLabel === "computer-visual";
const isAssistantPopup = windowLabel === "assistant-popup";
if (isComputerVisual) document.documentElement.classList.add("computer-visual-view");
if (isIndicator) document.documentElement.classList.add("indicator-view");
if (isAssistantPopup) document.documentElement.classList.add("assistant-popup-view");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isComputerVisual ? <ComputerVisual /> : isAssistantPopup ? <AssistantPopup /> : isIndicator ? <Indicator /> : <App />}
  </React.StrictMode>,
);
