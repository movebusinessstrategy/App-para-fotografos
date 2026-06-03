const SOUND_SRC = "/sounds/venda-realizada.webm";
const STYLE_ID = "sale-celebration-style";
const COLORS = ["#F1C665", "#10B981", "#38BDF8", "#EC4899", "#F97316", "#8B5CF6", "#FFFFFF"];

function ensureCelebrationStyle() {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .sale-confetti-layer {
      position: fixed;
      inset: 0;
      z-index: 99999;
      pointer-events: none;
      overflow: hidden;
    }
    .sale-confetti-piece {
      position: absolute;
      left: 50%;
      top: 50%;
      width: var(--w);
      height: var(--h);
      border-radius: 2px;
      background: var(--c);
      opacity: 0;
      transform: translate(-50%, -50%) rotate(0deg);
      animation: sale-confetti-burst var(--dur) cubic-bezier(.18,.75,.32,1) forwards;
      animation-delay: var(--delay);
      box-shadow: 0 0 10px rgba(255,255,255,.24);
    }
    @keyframes sale-confetti-burst {
      0% {
        opacity: 1;
        transform: translate(-50%, -50%) scale(.45) rotate(0deg);
      }
      72% {
        opacity: 1;
      }
      100% {
        opacity: 0;
        transform: translate(calc(-50% + var(--tx)), calc(-50% + var(--ty))) scale(1) rotate(var(--rot));
      }
    }
  `;
  document.head.appendChild(style);
}

function playSaleSound() {
  try {
    const audio = new Audio(SOUND_SRC);
    audio.volume = 0.78;
    void audio.play().catch(() => {
      // Browsers can block audio if the conversion finished outside a user gesture.
    });
  } catch {
    // Audio is celebratory, not required for the workflow.
  }
}

function burstConfetti() {
  if (typeof document === "undefined") return;
  ensureCelebrationStyle();

  const layer = document.createElement("div");
  layer.className = "sale-confetti-layer";
  document.body.appendChild(layer);

  const count = 92;
  for (let i = 0; i < count; i += 1) {
    const piece = document.createElement("span");
    piece.className = "sale-confetti-piece";

    const angle = Math.random() * Math.PI * 2;
    const distance = 140 + Math.random() * Math.max(window.innerWidth, window.innerHeight) * 0.58;
    const tx = Math.cos(angle) * distance;
    const ty = Math.sin(angle) * distance + 110 + Math.random() * 160;
    const width = 6 + Math.random() * 7;
    const height = 8 + Math.random() * 14;

    piece.style.setProperty("--tx", `${tx.toFixed(1)}px`);
    piece.style.setProperty("--ty", `${ty.toFixed(1)}px`);
    piece.style.setProperty("--rot", `${Math.round((Math.random() * 920) - 460)}deg`);
    piece.style.setProperty("--dur", `${(1150 + Math.random() * 850).toFixed(0)}ms`);
    piece.style.setProperty("--delay", `${(Math.random() * 120).toFixed(0)}ms`);
    piece.style.setProperty("--w", `${width.toFixed(1)}px`);
    piece.style.setProperty("--h", `${height.toFixed(1)}px`);
    piece.style.setProperty("--c", COLORS[i % COLORS.length]);
    layer.appendChild(piece);
  }

  window.setTimeout(() => layer.remove(), 2400);
}

export function celebrateSale() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  playSaleSound();
  burstConfetti();
}
