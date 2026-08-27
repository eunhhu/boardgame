import { useId } from "react";
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from "react";

const styles = `
:root {
  color-scheme: light dark;
  --bg-canvas:#f4f2eb;--bg-surface:rgba(255,255,255,.84);--bg-elevated:#fff;
  --bg-subtle:rgba(25,28,24,.055);--text-primary:#1f241f;--text-muted:#687068;
  --accent:#2e7356;--accent-strong:#1d5940;--accent-contrast:#fff;
  --danger:#b64242;--success:#287b53;--border:rgba(31,36,31,.14);
  --focus:rgba(46,115,86,.34);--shadow-sm:0 1px 2px rgba(15,20,16,.08),0 8px 24px rgba(15,20,16,.05);
  --shadow-md:0 16px 50px rgba(15,20,16,.12);--space-1:.25rem;--space-2:.5rem;
  --space-3:.75rem;--space-4:1rem;--space-5:1.25rem;--space-6:1.5rem;
  --radius-sm:.55rem;--radius-md:.85rem;--radius-lg:1.25rem;--radius-pill:999px;
  font-family:Pretendard,Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  font-synthesis:none;text-rendering:optimizeLegibility;
}
@media(prefers-color-scheme:dark){:root{
  --bg-canvas:#151915;--bg-surface:rgba(29,35,30,.88);--bg-elevated:#252c26;
  --bg-subtle:rgba(255,255,255,.055);--text-primary:#f2f5f0;--text-muted:#aeb7ad;
  --accent:#68b48d;--accent-strong:#88c9a8;--accent-contrast:#102218;
  --danger:#e57d7d;--success:#74c69a;--border:rgba(242,245,240,.13);--focus:rgba(104,180,141,.4);
}}
*{box-sizing:border-box}html{min-height:100%;background:var(--bg-canvas)}body{min-width:320px;min-height:100vh;margin:0;color:var(--text-primary);background:radial-gradient(circle at 15% 0%,color-mix(in srgb,var(--accent) 12%,transparent),transparent 31rem),var(--bg-canvas)}button,input{font:inherit}button:focus-visible,input:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
.bgame-page{width:min(72rem,100%);min-height:100vh;margin:0 auto;padding:clamp(1rem,2.8vw,2.5rem)}
.bgame-page__header{display:flex;align-items:center;justify-content:space-between;gap:var(--space-4);margin-bottom:var(--space-6)}
.bgame-page__title{margin:0;font-size:clamp(1.45rem,4vw,2.15rem);letter-spacing:-.035em}.bgame-page__subtitle{margin:var(--space-1) 0 0;color:var(--text-muted);line-height:1.5}
.bgame-card{min-width:0;padding:var(--space-5);border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--bg-surface);box-shadow:var(--shadow-sm);backdrop-filter:blur(18px)}
.bgame-card[data-tone=elevated]{background:var(--bg-elevated);box-shadow:var(--shadow-md)}.bgame-card[data-tone=subtle]{background:var(--bg-subtle);box-shadow:none}
.bgame-button{display:inline-flex;align-items:center;justify-content:center;gap:var(--space-2);min-height:2.75rem;padding:.65rem 1rem;border:1px solid transparent;border-radius:var(--radius-md);font-weight:750;line-height:1;cursor:pointer;transition:transform .12s ease,background .12s ease,opacity .12s ease}
.bgame-button:hover:not(:disabled){transform:translateY(-1px)}.bgame-button:disabled{cursor:not-allowed;opacity:.48}.bgame-button[data-variant=primary]{color:var(--accent-contrast);background:var(--accent)}.bgame-button[data-variant=primary]:hover:not(:disabled){background:var(--accent-strong)}.bgame-button[data-variant=secondary]{color:var(--text-primary);background:var(--bg-subtle);border-color:var(--border)}.bgame-button[data-variant=ghost]{color:var(--text-primary);background:transparent}.bgame-button[data-variant=danger]{color:#fff;background:var(--danger)}.bgame-button[data-size=sm]{min-height:2.2rem;padding:.45rem .75rem;font-size:.875rem}.bgame-button[data-size=lg]{min-height:3.25rem;padding:.85rem 1.25rem;font-size:1.05rem}.bgame-button[data-block=true]{width:100%}
.bgame-field{display:grid;gap:var(--space-2)}.bgame-field__label{font-size:.9rem;font-weight:700}.bgame-field__input{width:100%;min-height:2.8rem;padding:.7rem .8rem;color:var(--text-primary);border:1px solid var(--border);border-radius:var(--radius-md);background:var(--bg-elevated)}.bgame-field__input[aria-invalid=true]{border-color:var(--danger)}.bgame-field__meta{min-height:1.1em;margin:0;color:var(--text-muted);font-size:.82rem}.bgame-field__meta[data-error=true]{color:var(--danger)}
.bgame-badge{display:inline-flex;align-items:center;width:fit-content;padding:.35rem .58rem;border:1px solid var(--border);border-radius:var(--radius-pill);color:var(--text-muted);background:var(--bg-subtle);font-size:.78rem;font-weight:750}.bgame-badge[data-tone=accent]{color:var(--accent-strong)}.bgame-badge[data-tone=success]{color:var(--success)}.bgame-badge[data-tone=danger]{color:var(--danger)}
.bgame-room-code{display:inline-flex;align-items:center;gap:var(--space-2);padding:.55rem .75rem;border:1px dashed color-mix(in srgb,var(--accent) 45%,var(--border));border-radius:var(--radius-md);background:color-mix(in srgb,var(--accent) 8%,transparent)}.bgame-room-code__label{color:var(--text-muted);font-size:.8rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em}.bgame-room-code__value{font-size:1.1rem;font-weight:850;letter-spacing:.12em}.bgame-divider{width:100%;height:1px;border:0;background:var(--border)}.bgame-muted{color:var(--text-muted)}.bgame-error{color:var(--danger)}
@media(max-width:42rem){.bgame-page{padding:1rem}.bgame-page__header{align-items:flex-start;flex-direction:column}.bgame-card{padding:var(--space-4);border-radius:var(--radius-md)}}
`;

export function injectBgameStyles(): void {
  if (typeof document === "undefined" || document.getElementById("bgame-styles")) return;
  const style = document.createElement("style");
  style.id = "bgame-styles";
  style.textContent = styles;
  document.head.append(style);
}

const classes = (...values: Array<string | false | null | undefined>): string =>
  values.filter(Boolean).join(" ");

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: "primary" | "secondary" | "ghost" | "danger";
  readonly size?: "sm" | "md" | "lg";
  readonly block?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
  block = false,
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={classes("bgame-button", className)}
      data-variant={variant}
      data-size={size}
      data-block={String(block)}
      {...props}
    />
  );
}

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  readonly tone?: "surface" | "elevated" | "subtle";
}

export function Card({ tone = "surface", className, ...props }: CardProps) {
  return <div className={classes("bgame-card", className)} data-tone={tone} {...props} />;
}

export interface StackProps extends HTMLAttributes<HTMLDivElement> {
  readonly gap?: string;
  readonly align?: "stretch" | "start" | "center" | "end";
}

export function Stack({ gap = "var(--space-4)", align = "stretch", style, ...props }: StackProps) {
  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap, alignItems: align, ...style }}
      {...props}
    />
  );
}

export interface InlineProps extends HTMLAttributes<HTMLDivElement> {
  readonly gap?: string;
  readonly justify?: "start" | "center" | "end" | "space-between";
  readonly wrap?: boolean;
}

export function Inline({ gap = "var(--space-3)", justify = "start", wrap = true, style, ...props }: InlineProps) {
  return (
    <div
      style={{
        display: "flex",
        gap,
        alignItems: "center",
        justifyContent: justify,
        flexWrap: wrap ? "wrap" : "nowrap",
        ...style,
      }}
      {...props}
    />
  );
}

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  readonly label: string;
  readonly hint?: string;
  readonly error?: string;
}

export function TextField({ label, hint, error, id, className, ...props }: TextFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const metaId = `${inputId}-meta`;
  return (
    <label className="bgame-field" htmlFor={inputId}>
      <span className="bgame-field__label">{label}</span>
      <input
        id={inputId}
        className={classes("bgame-field__input", className)}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={hint || error ? metaId : undefined}
        {...props}
      />
      <span id={metaId} className="bgame-field__meta" data-error={String(Boolean(error))}>
        {error ?? hint ?? ""}
      </span>
    </label>
  );
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  readonly tone?: "neutral" | "accent" | "success" | "danger";
}

export function Badge({ tone = "neutral", className, ...props }: BadgeProps) {
  return <span className={classes("bgame-badge", className)} data-tone={tone} {...props} />;
}

export function RoomCode({ code, label = "Room" }: { readonly code: string; readonly label?: string }) {
  return (
    <span className="bgame-room-code" aria-label={`${label} code ${code}`}>
      <span className="bgame-room-code__label">{label}</span>
      <span className="bgame-room-code__value">{code}</span>
    </span>
  );
}

export function PageShell({
  title,
  subtitle,
  action,
  children,
}: {
  readonly title: string;
  readonly subtitle?: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <main className="bgame-page">
      <header className="bgame-page__header">
        <div>
          <h1 className="bgame-page__title">{title}</h1>
          {subtitle ? <p className="bgame-page__subtitle">{subtitle}</p> : null}
        </div>
        {action}
      </header>
      {children}
    </main>
  );
}

export function Divider() {
  return <hr className="bgame-divider" />;
}
