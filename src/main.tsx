import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

console.log("Davi Canvas V2 Active (Cache Cleared)");

createRoot(document.getElementById("root")!).render(<App />);
