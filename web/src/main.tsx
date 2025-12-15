import { createRoot } from "react-dom/client";
import App from "./App";
import "@fontsource/inter";
import "./main.css";

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
