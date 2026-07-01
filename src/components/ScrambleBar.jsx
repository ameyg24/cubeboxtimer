import { useState } from "react";

const selectAll = (e) => {
  const range = document.createRange();
  range.selectNodeContents(e.currentTarget);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
};

const ScrambleBar = ({ scrambles = [], selectedScrambleIdx = 0, setSelectedScrambleIdx = () => {} }) => {
  const [copied, setCopied] = useState(false);
  const scramble = scrambles[selectedScrambleIdx] || "";

  if (!scramble) return null;

  const moveCount = scramble.split(" ").filter(Boolean).length;
  const prev = () => setSelectedScrambleIdx((i) => (i > 0 ? i - 1 : scrambles.length - 1));
  const next = () => setSelectedScrambleIdx((i) => (i < scrambles.length - 1 ? i + 1 : 0));
  const copy = () => {
    navigator.clipboard.writeText(scramble).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="scramble-bar">
      <button className="icon-btn" onClick={prev} title="Previous scramble" aria-label="Previous scramble">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M9 11L5 7l4-4" />
        </svg>
      </button>

      <p className="scramble-text" onClick={selectAll}>{scramble}</p>

      <span className="scramble-count" title={`${moveCount} moves`}>{moveCount}</span>
      <button
        className="icon-btn"
        onClick={copy}
        title="Copy scramble"
        aria-label={copied ? "Scramble copied" : "Copy scramble"}
        aria-live="polite"
        style={{ color: copied ? "var(--success)" : undefined }}
      >
        {copied ? "✓" : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
          </svg>
        )}
      </button>

      <button className="icon-btn" onClick={next} title="Next scramble" aria-label="Next scramble">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M5 3l4 4-4 4" />
        </svg>
      </button>
    </div>
  );
};

export default ScrambleBar;
