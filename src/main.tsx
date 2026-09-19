import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import { OperationalHydrator } from "@/components/OperationalHydrator";

document.title = "ChatGPT - AgroTech — Smart Greenhouse System";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HashRouter>
      <OperationalHydrator>
        <App />
      </OperationalHydrator>
    </HashRouter>
  </React.StrictMode>,
);
