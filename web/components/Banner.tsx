"use client";

/**
 * components/Banner.tsx — persistent, site-wide rotating announcement bar
 * pinned above the StatsBar/Navbar. Rotates through a fixed set of
 * messages every few seconds; dismissible (remembered in localStorage —
 * reappears in a new browser/profile, which is intentional: the devnet
 * disclosure in particular should stay easy to re-surface).
 *
 * Message content is deliberately conservative:
 *  - explicitly says "Solana Devnet" — never implies mainnet.
 *  - faucet instructions point at the real Circle devnet-USDC faucet and
 *    the real devnet USDC mint (see @agentfund/shared's USDC_MINT.devnet),
 *    not a made-up URL.
 *  - the "rewards" message is worded as consideration/recognition only —
 *    "may be considered for", never a guaranteed reward or return, so it
 *    doesn't read as a securities-style promise.
 */
import { useEffect, useState } from "react";

const DISMISS_KEY = "af-banner-dismissed-v1";
const ROTATE_MS = 6500;
const USDC_DEVNET_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

const MESSAGES: { icon: string; text: string }[] = [
  {
    icon: "🟣",
    text: "AgentFund runs live on Solana Devnet — every project, vote, and contribution here uses devnet SOL and devnet USDC, never real funds.",
  },
  {
    icon: "🪙",
    text: `Need devnet USDC to try a contribution? Get some free from Circle's faucet at faucet.circle.com (select Solana Devnet) — mint ${USDC_DEVNET_MINT}. You'll also need a little devnet SOL for network fees, free at faucet.solana.com.`,
  },
  {
    icon: "✨",
    text: "Early contributors on AgentFund may be considered for recognition or rewards down the line — no promises or guarantees, just our way of remembering who showed up first.",
  },
];

export function Banner() {
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    let stored = false;
    try {
      stored = window.localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      // localStorage unavailable (private mode, etc.) — just show the banner.
    }
    setDismissed(stored);
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty("--af-banner-height", dismissed === false ? "40px" : "0px");
  }, [dismissed]);

  useEffect(() => {
    if (dismissed !== false) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % MESSAGES.length), ROTATE_MS);
    return () => clearInterval(t);
  }, [dismissed]);

  // Render nothing until we know the stored preference, to avoid a flash
  // of the banner for returning visitors who already dismissed it.
  if (dismissed !== false) return null;

  // Safe: `index` is always kept in [0, MESSAGES.length) by the `% MESSAGES.length`
  // in the rotation interval above.
  const message = MESSAGES[index % MESSAGES.length]!;

  return (
    <div className="af-banner" role="region" aria-label="Announcements">
      <div className="af-container af-banner__row">
        <div className="af-banner__track" aria-live="polite">
          <span className="af-banner__icon" aria-hidden="true">
            {message.icon}
          </span>
          <span className="af-banner__text">{message.text}</span>
        </div>
        <button
          type="button"
          className="af-banner__dismiss"
          aria-label="Dismiss announcement banner"
          onClick={() => {
            setDismissed(true);
            try {
              window.localStorage.setItem(DISMISS_KEY, "1");
            } catch {
              // ignore — worst case it reappears next visit
            }
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
