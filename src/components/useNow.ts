import { useEffect, useState } from "react";

/** The current time, updated every minute (keeps the "now" line and "past" blocks fresh). */
export function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}
