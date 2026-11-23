import { useState } from "react";
import { api } from "../lib/api";
import { queryClient, qk } from "../data/queries";

export function Setup({ message = "" }: { message?: string }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState(message);
  const [busy, setBusy] = useState(false);
  return (
    <section id="setup" className="setup">
      <div className="setup-card">
        <h1>Praxis</h1>
        <p className="lede">Turn ideas into action. Connect your Todoist account to get started; it takes about a minute.</p>
        <ol className="steps">
          <li>Open <a href="https://app.todoist.com/app/settings/integrations/developer" target="_blank" rel="noopener">Todoist → Settings → Integrations → Developer</a>.</li>
          <li>Click <b>Copy API token</b>.</li>
          <li>Paste it below. It's saved only on this computer.</li>
        </ol>
        <form id="setup-form" autoComplete="off" onSubmit={async (e) => {
          e.preventDefault();
          if (!token.trim()) return;
          setBusy(true); setError("");
          try {
            await api("/api/token", { method: "POST", body: { token: token.trim() } });
            setToken("");
            // Drop any data from a previous account, then re-check the connection.
            queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== qk.status[0] });
            await queryClient.refetchQueries({ queryKey: qk.status });
          } catch (err) { setError((err as Error).message); }
          finally { setBusy(false); }
        }}>
          <input id="token-input" type="password" placeholder="Paste your Todoist API token" spellCheck={false} autoFocus value={token} onChange={(e) => setToken(e.target.value)} />
          <button type="submit" className="primary" disabled={busy}>{busy ? "Checking…" : "Connect"}</button>
        </form>
        <p id="setup-error" className="error" role="alert">{error}</p>
      </div>
    </section>
  );
}
