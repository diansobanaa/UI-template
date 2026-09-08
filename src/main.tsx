import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import { StoreHydrator } from "@/components/StoreHydrator";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HashRouter>
      <StoreHydrator />
      <App />
    </HashRouter>
  </React.StrictMode>,
);
