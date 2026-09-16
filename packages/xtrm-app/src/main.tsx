import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { adaptersFromEnv } from "./adapters/index.tsx";
import { createAppRouter } from "./app/router.tsx";
import "./styles.css";

const router = createAppRouter({ adapters: adaptersFromEnv() });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
