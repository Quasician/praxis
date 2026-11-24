import { Component, type ReactNode } from "react";
import { useUi } from "../state/ui";
import { Dialog } from "./common";
import { RELEASE_URL, VERSION } from "../lib/version";

const KEYS: [string, string][] = [
  ["Q  or  /", "Quick add"],
  ["B", "Brain dump (Claude)"],
  ["P", "Plan my day"],
  ["Enter", "Accept the proposed plan"],
  ["M", "Morning commit: pick today's tasks"],
  ["N", "New project (Claude breaks it into steps)"],
  ["S", "Shut down the day"],
  ["G", "Progress"],
  ["F", "Focus mode: only what's next"],
  ["D · W · A", "Day, Week, Sky (your areas)"],
  ["1 · 2", "Today, Inbox"],
  ["R", "Refresh from Todoist"],
  ["Esc", "Cancel a drag, close a dialog"],
  ["?", "This list"],
];
const DESKTOP: [string, string][] = [
  ["Ctrl+Shift+Space", "Quick add from anywhere"],
  ["Ctrl+Alt+D", "Mark the Now task done, from anywhere"],
  ["Ctrl+Alt+Q", "Send the clipboard to your Todoist Inbox, from anywhere"],
  ["F11", "Full screen"],
  ["Ctrl +  ·  Ctrl −  ·  Ctrl 0", "Zoom in, out, reset"],
];

export function HelpDialog() {
  const close = useUi((s) => s.closeDialog);
  return (
    <Dialog name="help" id="help-dialog" className="help-dialog">
      <div className="help-form">
        <h2>Keyboard shortcuts</h2>
        <dl className="keys">{KEYS.map(([k, v]) => <div key={k}><dt>{k.split("  ").map((x, i) => <kbd key={i}>{x}</kbd>)}</dt><dd>{v}</dd></div>)}</dl>
        <h3>Desktop app</h3>
        <dl className="keys">{DESKTOP.map(([k, v]) => <div key={k}><dt>{k.split("  ").map((x, i) => <kbd key={i}>{x}</kbd>)}</dt><dd>{v}</dd></div>)}</dl>
        <p className="dialog-sub">Right-click Praxis on the taskbar for Quick add, Brain dump, Shut down and Check for updates.</p>
        <div className="dialog-actions">
          <a className="help-version" id="app-version" href={RELEASE_URL} target="_blank" rel="noopener" title="What's new in this version">Praxis {VERSION}</a>
          <span className="spacer" />
          <a className="ghost-btn" href="https://github.com/Quasician/praxis#readme" target="_blank" rel="noopener">How it works</a>
          <button type="button" className="primary" onClick={() => close("help")}>Got it</button>
        </div>
      </div>
    </Dialog>
  );
}

/** If part of the screen crashes, show a way out instead of a blank window. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error("Praxis crashed:", error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash" id="crash">
        <h2>Something broke on this screen.</h2>
        <p>Your tasks are safe in Todoist. Reloading usually fixes it.</p>
        <pre>{String(this.state.error.message || this.state.error)}</pre>
        <button className="primary" onClick={() => location.reload()}>Reload Praxis</button>
      </div>
    );
  }
}
