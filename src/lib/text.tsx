import { Fragment, type ReactNode } from "react";

/** Todoist text without markdown: "[text](url)" → "text", no asterisks. */
export const plain = (s: string | null | undefined) => String(s ?? "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\*+/g, "");

/** Renders the little bit of markdown Todoist allows: [text](url), **bold**, *italic*. */
export function Inline({ text }: { text: string }) {
  const out: ReactNode[] = [];
  const re = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<a key={i++} href={m[2]} target="_blank" rel="noopener">{m[1]}</a>);
    else if (m[3]) out.push(<b key={i++}>{m[3]}</b>);
    else if (m[4]) out.push(<i key={i++}>{m[4]}</i>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return <Fragment>{out}</Fragment>;
}

export const COLORS: Record<string, string> = {
  berry_red: "#b8256f", red: "#db4035", orange: "#ff9933", yellow: "#fad000",
  olive_green: "#afb83b", lime_green: "#7ecc49", green: "#299438", mint_green: "#6accbc",
  teal: "#158fad", sky_blue: "#14aaf5", light_blue: "#96c3eb", blue: "#4073ff",
  grape: "#884dff", violet: "#af38eb", lavender: "#eb96eb", magenta: "#e05194",
  salmon: "#ff8d85", charcoal: "#808080", grey: "#b8b8b8", taupe: "#ccac93",
};
export const colorOf = (name: string | undefined) => (name && COLORS[name]) || "#b8b8b8";
