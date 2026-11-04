import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./app/App";
import Indicator from "./app/Indicator";
import ComputerVisual from "./app/ComputerVisual";
import AssistantPointer from "./app/AssistantPointer";
import "./app/app.css";

// Both windows load this bundle; only "main" runs the dictation controller.
const windowLabel = getCurrentWindow().label;
const isIndicator = windowLabel === "indicator";
const isComputerVisual = windowLabel === "computer-visual";
const isAssistantPointer = windowLabel === "assistant-pointer";
if (isComputerVisual) document.documentElement.classList.add("computer-visual-view");
if (isAssistantPointer) document.documentElement.classList.add("assistant-pointer-view");
if (isIndicator) document.documentElement.classList.add("indicator-view");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isAssistantPointer ? <AssistantPointer /> : isComputerVisual ? <ComputerVisual /> : isIndicator ? <Indicator /> : <App />}
  </React.StrictMode>,
);
