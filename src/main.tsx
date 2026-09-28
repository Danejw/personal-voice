import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./app/App";
import Indicator from "./app/Indicator";
import "./app/app.css";

// Both windows load this bundle; only "main" runs the dictation controller.
const isIndicator = getCurrentWindow().label === "indicator";
if (isIndicator) document.documentElement.classList.add("indicator-view");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isIndicator ? <Indicator /> : <App />}
  </React.StrictMode>,
);
