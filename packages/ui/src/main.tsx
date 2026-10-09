// Per primo: nell'app desktop sostituisce il selettore di cartelle prima che il resto lo cerchi.
import "./platform/desktop.js";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";

const root = document.getElementById("root");
if (!root) throw new Error("#root non trovato");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
