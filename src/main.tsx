import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import OverlayApp from "./OverlayApp";

const isOverlay = new URLSearchParams(window.location.search).get("window") === "overlay";

if (isOverlay) {
  document.body.classList.add("is-overlay");
  document.documentElement.classList.add("is-overlay");
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  isOverlay ? <OverlayApp /> : <React.StrictMode><App /></React.StrictMode>
);
