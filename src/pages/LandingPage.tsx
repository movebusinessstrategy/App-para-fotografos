import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import {
  motion, useReducedMotion, useScroll, useTransform, useSpring, AnimatePresence,
} from "motion/react";
import { useAuth } from "../contexts/AuthContext";
import {
  Check, ArrowRight, ArrowUpRight, Sparkles, Cake, Baby, PartyPopper, Gift,
  Calendar, MessageCircle, FileSignature, Workflow, Users, TrendingUp,
  Shield, ChevronDown, Zap, BadgeCheck, Star, Radar, Brain, Send, Search,
  Puzzle, ChevronRight, Crown, Infinity as InfinityIcon,
} from "lucide-react";

const APP_NAME = "Trilha";
const EASE = [0.22, 1, 0.36, 1] as const;

/* Logo "CRM Trilha". A landing é sempre clara, então usamos a versão clara. */
function TrilhaLogo({ heightClass = "h-9" }: { heightClass?: string }) {
  return <img src="/logo-light.png" alt="CRM Trilha" className={`${heightClass} w-auto`} />;
}

/* ─── Contexto do container de scroll (a landing rola num div próprio) ───────── */
const ScrollCtx = createContext<React.RefObject<HTMLDivElement | null> | null>(null);
const useScrollContainer = () => useContext(ScrollCtx);

/* ─── Helpers de animação ───────────────────────────────────────────────────── */
const FadeIn: React.FC<{ children: React.ReactNode; delay?: number; y?: number; className?: string }> = ({
  children, delay = 0, y = 28, className = "",
}) => {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.7, delay, ease: EASE }}
      className={className}
    >
      {children}
    </motion.div>
  );
};

/* Parallax: move o elemento conforme o scroll do container. */
function Parallax({ children, amount = 60, className = "" }: { children: React.ReactNode; amount?: number; className?: string }) {
  const reduce = useReducedMotion();
  const container = useScrollContainer();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    container: container ?? undefined,
    target: ref,
    offset: ["start end", "end start"],
  });
  const yRaw = useTransform(scrollYProgress, [0, 1], [amount, -amount]);
  const y = useSpring(yRaw, { stiffness: 120, damping: 30, mass: 0.4 });
  return (
    <div ref={ref} className={className}>
      <motion.div style={reduce ? undefined : { y }}>{children}</motion.div>
    </div>
  );
}

/* Fundo da primeira dobra: grid técnico sutil com leve brilho dourado e um
   ponto-de-luz que percorre as linhas, dando vida sem poluir. */
function HeroBackdrop() {
  const reduce = useReducedMotion();
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Grid milimetrado que some nas bordas */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(17,17,17,0.055) 1px, transparent 1px), linear-gradient(to bottom, rgba(17,17,17,0.055) 1px, transparent 1px)",
          backgroundSize: "46px 46px",
          WebkitMaskImage: "radial-gradient(ellipse 80% 68% at 50% 0%, #000 48%, transparent 100%)",
          maskImage: "radial-gradient(ellipse 80% 68% at 50% 0%, #000 48%, transparent 100%)",
        }}
      />
      {/* Brilho dourado discreto no topo */}
      <div className="absolute -top-44 left-1/2 -translate-x-1/2 w-[720px] h-[440px] bg-gold-200/25 rounded-full blur-[130px]" />
      {/* Linha de luz horizontal que cruza o grid */}
      {!reduce && (
        <motion.div
          className="absolute left-0 right-0 h-px bg-gradient-to-r from-transparent via-gold-400/50 to-transparent"
          initial={{ top: "8%", opacity: 0 }}
          animate={{ top: ["8%", "62%"], opacity: [0, 1, 1, 0] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut", repeatDelay: 2 }}
        />
      )}
    </div>
  );
}

/* Contador animado que dispara ao entrar na viewport. */
function CountUp({ to, duration = 1.6, format }: { to: number; duration?: number; format?: (n: number) => string }) {
  const [val, setVal] = useState(0);
  const started = useRef(false);
  const reduce = useReducedMotion();
  const start = () => {
    if (started.current) return;
    started.current = true;
    if (reduce) { setVal(to); return; }
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / (duration * 1000));
      setVal(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  return (
    <motion.span onViewportEnter={start} viewport={{ once: true }}>
      {format ? format(val) : val.toLocaleString("pt-BR")}
    </motion.span>
  );
}

/* Passo cíclico para os mockups "ao vivo". */
function useStep(count: number, ms: number) {
  const [i, setI] = useState(0);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce) return;
    const t = setInterval(() => setI((p) => (p + 1) % count), ms);
    return () => clearInterval(t);
  }, [count, ms, reduce]);
  return i;
}

interface Plan { id: string; slug: string; name: string; price_cents: number; }
const PLANS: Plan[] = [
  { id: "pro",      slug: "pro",      name: "Pro",      price_cents: 9700  },
  { id: "business", slug: "business", name: "Business", price_cents: 19700 },
];

export default function LandingPage() {
  const { user, loading } = useAuth();
  if (!loading && user) return <Navigate to="/dashboard" replace />;

  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setScrolled(el.scrollTop > 24);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const base = (import.meta.env.VITE_API_BASE_URL as string) || "";
    fetch(`${base}/api/health`, { method: "GET", cache: "no-store" }).catch(() => {});
  }, []);

  return (
    <ScrollCtx.Provider value={scrollRef}>
      <div
        ref={scrollRef}
        className="h-screen overflow-y-auto overflow-x-hidden bg-luxury-paper text-luxury-black font-sans antialiased scroll-smooth"
      >
        <Header scrolled={scrolled} />
        <Hero />
        <SocialProof />
        <ProblemSection />
        <StickyShowcase />
        <FeatureGrid />
        <HowItWorks />
        <Testimonials />
        <Pricing plans={PLANS} />
        <Guarantee />
        <FaqSection />
        <FinalCta />
        <Footer />
      </div>
    </ScrollCtx.Provider>
  );
}

/* ─────────────────────── HEADER ────────────────────────────────────────────── */
function Header({ scrolled }: { scrolled: boolean }) {
  return (
    <header className={`sticky top-0 z-50 transition-all duration-300 ${
      scrolled ? "bg-luxury-paper/70 backdrop-blur-xl border-b border-black/5" : "bg-transparent border-b border-transparent"
    }`}>
      <div className="max-w-6xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center"><TrilhaLogo heightClass="h-8" /></Link>
        <nav className="hidden md:flex items-center gap-9 text-[13px] font-medium text-gray-500">
          <a href="#oportunidades" className="hover:text-luxury-black transition-colors">Inteligência</a>
          <a href="#recursos" className="hover:text-luxury-black transition-colors">Recursos</a>
          <a href="#precos" className="hover:text-luxury-black transition-colors">Preços</a>
          <a href="#faq" className="hover:text-luxury-black transition-colors">Dúvidas</a>
        </nav>
        <div className="flex items-center gap-1.5">
          <Link to="/login" className="hidden sm:inline-flex px-4 py-2 text-[13px] font-medium text-gray-600 hover:text-luxury-black transition-colors">Entrar</Link>
          <Link to="/cadastro" className="px-4 py-2 text-[13px] font-semibold bg-luxury-black text-white rounded-full hover:opacity-90 transition-opacity">Começar grátis</Link>
        </div>
      </div>
    </header>
  );
}

/* ─────────────────────── HERO ──────────────────────────────────────────────── */
function Hero() {
  return (
    <section className="relative pt-14 pb-20 sm:pt-20 sm:pb-28 overflow-hidden">
      <HeroBackdrop />
      <div className="relative max-w-6xl mx-auto px-5 sm:px-8">
        <div className="grid lg:grid-cols-[1fr_1.05fr] gap-12 lg:gap-10 items-center">
          {/* Copy */}
          <div className="text-center lg:text-left">
            <FadeIn>
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/70 backdrop-blur border border-gold-200 text-[12px] font-semibold text-gold-700 mb-7 shadow-sm">
                <Brain size={13} className="text-gold-500" /> Inteligência de vendas para fotógrafos
              </div>
            </FadeIn>
            <FadeIn delay={0.05}>
              <h1 className="text-[2.7rem] sm:text-6xl lg:text-[4.3rem] font-bold tracking-[-0.035em] leading-[0.98] mb-6">
                Suas próximas vendas já estão na sua{" "}
                <span className="bg-gradient-to-r from-gold-500 to-gold-700 bg-clip-text text-transparent">base.</span>
              </h1>
            </FadeIn>
            <FadeIn delay={0.1}>
              <p className="text-lg sm:text-xl text-gray-500 max-w-xl mx-auto lg:mx-0 mb-8 leading-relaxed font-light">
                Todo dia clientes seus têm bebês, fazem aniversário e completam marcos.
                O <strong className="text-luxury-black font-semibold">{APP_NAME}</strong> lê a sua base e te entrega,
                prontas, todas as oportunidades de venda que estão passando batido.
              </p>
            </FadeIn>
            <FadeIn delay={0.15}>
              <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-3 mb-6">
                <Link to="/cadastro" className="group inline-flex items-center gap-2 px-8 py-4 bg-gold-500 hover:bg-gold-600 text-white font-semibold rounded-full shadow-lg shadow-gold-500/25 transition-all hover:shadow-xl hover:shadow-gold-500/35 hover:-translate-y-0.5 text-[15px]">
                  Começar grátis por 7 dias
                  <ArrowRight size={18} className="group-hover:translate-x-0.5 transition-transform" />
                </Link>
                <a href="#oportunidades" className="inline-flex items-center gap-1.5 px-6 py-4 text-luxury-black font-medium hover:text-gold-600 transition-colors text-[15px]">
                  Ver a inteligência <ArrowUpRight size={17} />
                </a>
              </div>
            </FadeIn>
            <FadeIn delay={0.2}>
              <div className="flex flex-wrap items-center justify-center lg:justify-start gap-x-5 gap-y-2 text-[13px] text-gray-400">
                <span className="flex items-center gap-1.5"><Check size={14} className="text-gold-500" /> Sem cartão</span>
                <span className="flex items-center gap-1.5"><Check size={14} className="text-gold-500" /> Pronto em 5 min</span>
                <span className="flex items-center gap-1.5"><Check size={14} className="text-gold-500" /> Cancele quando quiser</span>
              </div>
            </FadeIn>
          </div>

          {/* Painel vivo com tilt + parallax */}
          <FadeIn delay={0.25} y={40}>
            <Parallax amount={36}>
              <OpportunitiesMock />
            </Parallax>
          </FadeIn>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────── MOCKUP 1 · OPORTUNIDADES ──────────────────────────── */
const HERO_OPPS = [
  { icon: Cake,        tag: "Smash the Cake", chip: "bg-pink-100 text-pink-600", who: "Helena completa 1 ano", when: "em 6 dias",  value: "R$ 890"   },
  { icon: Sparkles,    tag: "Newborn",        chip: "bg-sky-100 text-sky-600",   who: "Bebê da Marina nasceu", when: "há 9 dias",  value: "R$ 1.290" },
  { icon: PartyPopper, tag: "Aniversário",    chip: "bg-rose-100 text-rose-600", who: "Théo faz 3 anos",       when: "em 12 dias", value: "R$ 650"   },
];

function OpportunitiesMock() {
  const reduce = useReducedMotion();
  return (
    <div className="relative">
      <div className="absolute -inset-8 bg-gradient-to-tr from-gold-400/20 via-amber-300/10 to-transparent rounded-[2.5rem] blur-3xl pointer-events-none" />
      <div className="relative rounded-[1.7rem] p-px bg-gradient-to-b from-black/10 to-black/5 shadow-2xl shadow-black/10">
        <div className="rounded-[1.65rem] bg-white overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-black/5">
            <span className="text-sm font-semibold text-gray-700 flex items-center gap-2"><Radar size={15} className="text-gold-500" /> Motor de Oportunidades</span>
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-600">
              <span className="relative flex h-2 w-2"><span className="animate-ping absolute h-full w-full rounded-full bg-emerald-400 opacity-60" /><span className="relative rounded-full h-2 w-2 bg-emerald-500" /></span>
              ao vivo
            </span>
          </div>
          <div className="px-5 pt-4">
            <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
              <Radar size={13} className="text-gold-500" /> Analisando sua base · <span className="font-semibold text-gray-700">1.248 clientes</span>
            </div>
            <div className="h-1 rounded-full bg-gray-100 overflow-hidden">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-gold-400 to-gold-600"
                animate={reduce ? { width: "100%" } : { width: ["0%", "100%"] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut", repeatDelay: 0.6 }}
              />
            </div>
          </div>
          <div className="px-5 py-4 grid grid-cols-[1.3fr_1fr] gap-4 items-end border-b border-black/5">
            <div>
              <p className="text-[11px] uppercase tracking-widest text-gray-400 font-semibold mb-1">Vendas paradas na base</p>
              <p className="text-[2rem] font-bold tracking-tight">R$ <CountUp to={14300} /></p>
              <p className="text-xs text-emerald-600 font-medium mt-0.5 flex items-center gap-1"><TrendingUp size={13} /> 23 oportunidades este mês</p>
            </div>
            <div className="flex items-end gap-1.5 h-12">
              {[35, 48, 40, 62, 55, 78, 92].map((h, i) => (
                <motion.div key={i}
                  className={`flex-1 rounded-md ${i === 6 ? "bg-gradient-to-t from-gold-500 to-gold-400" : "bg-gold-200"}`}
                  initial={reduce ? false : { height: 0 }} whileInView={{ height: `${h}%` }} viewport={{ once: true }}
                  transition={{ delay: 0.5 + i * 0.07, duration: 0.6, ease: EASE }} />
              ))}
            </div>
          </div>
          <div className="p-3 space-y-1.5">
            {HERO_OPPS.map((o, i) => (
              <motion.div key={o.who}
                initial={reduce ? false : { opacity: 0, x: 16 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}
                transition={{ delay: 0.5 + i * 0.16, duration: 0.5, ease: EASE }}
                className="flex items-center gap-3 p-2.5 rounded-2xl hover:bg-gray-50 transition-colors">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${o.chip}`}><o.icon size={18} /></div>
                <div className="min-w-0 flex-1"><p className="text-sm font-semibold truncate">{o.who}</p><p className="text-[11px] text-gray-400">{o.tag} · {o.when}</p></div>
                <span className="text-sm font-bold text-gold-600 flex-shrink-0">{o.value}</span>
                <button className="flex-shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-luxury-black text-white text-[11px] font-semibold hover:bg-gold-600 transition-colors"><Zap size={11} /> Enviar</button>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────── MOCKUP 2 · KANBAN NA EXTENSÃO ─────────────────────── */
const STAGES = ["Contato", "Conversa", "Agendado", "Ganho"];
const CHATS = [
  { n: "Marina Costa", m: "Perfeito! Pode ser sábado?", t: "09:41", on: true },
  { n: "Bruno Santos", m: "Quanto fica o ensaio newborn?", t: "09:32" },
  { n: "Fernanda Lima", m: "Adorei as fotos 😍", t: "ontem" },
];

function ExtensionKanbanMock() {
  const stage = useStep(STAGES.length, 1400); // card avança de fase sozinho

  return (
    <div className="relative">
      <div className="absolute -inset-8 bg-gradient-to-tr from-emerald-400/15 to-gold-300/15 rounded-[2.5rem] blur-3xl pointer-events-none" />
      <div className="relative rounded-[1.7rem] p-px bg-gradient-to-b from-black/10 to-black/5 shadow-2xl shadow-black/10">
        <div className="rounded-[1.65rem] bg-[#eae6df] overflow-hidden">
          {/* Barra do navegador */}
          <div className="flex items-center gap-1.5 px-4 py-2.5 bg-gray-100 border-b border-black/5">
            <span className="w-2.5 h-2.5 rounded-full bg-gray-300" /><span className="w-2.5 h-2.5 rounded-full bg-gray-300" /><span className="w-2.5 h-2.5 rounded-full bg-gray-300" />
            <div className="ml-3 flex-1 bg-white rounded-md px-3 py-1 text-[11px] text-gray-400 flex items-center gap-1.5"><Search size={11} /> web.whatsapp.com</div>
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-gold-600 bg-gold-50 px-2 py-1 rounded-md"><Puzzle size={11} /> Trilha</span>
          </div>

          <div className="grid grid-cols-[1.15fr_1fr]">
            {/* WhatsApp */}
            <div className="bg-white border-r border-black/5">
              <div className="h-9 bg-[#128C7E]" />
              <div className="divide-y divide-black/5">
                {CHATS.map((c) => (
                  <div key={c.n} className={`flex items-center gap-2.5 px-3 py-2.5 ${c.on ? "bg-gray-100" : ""}`}>
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-gray-300 to-gray-400 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex justify-between"><p className="text-[12px] font-semibold truncate">{c.n}</p><span className="text-[9px] text-gray-400">{c.t}</span></div>
                      <p className="text-[11px] text-gray-400 truncate">{c.m}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Painel CRM Trilha (kanban) */}
            <div className="bg-white p-3">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 rounded-lg bg-gold-500 text-white flex items-center justify-center"><Puzzle size={14} /></div>
                <div><p className="text-[12px] font-bold leading-none">CRM Trilha</p><p className="text-[9px] text-gray-400 mt-0.5">Marina Costa</p></div>
              </div>

              {/* Pipeline vertical, card avanca de fase ao vivo */}
              <div className="space-y-1.5">
                {STAGES.map((s, i) => {
                  const active = i === stage;
                  return (
                    <div key={s} className={`relative flex items-center gap-2 px-2.5 py-2 rounded-lg border transition-colors ${active ? "border-gold-400 bg-gold-50" : "border-black/5 bg-gray-50/60"}`}>
                      <span className={`w-2 h-2 rounded-full ${active ? "bg-gold-500" : "bg-gray-300"}`} />
                      <span className={`text-[11px] font-medium ${active ? "text-gold-700" : "text-gray-400"}`}>{s}</span>
                      {active && (
                        <motion.div layoutId="ext-card" className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded-md bg-white border border-gold-300 shadow-sm">
                          <div className="w-3.5 h-3.5 rounded-full bg-gradient-to-br from-gold-400 to-gold-600" />
                          <span className="text-[9px] font-bold text-gray-700">Marina</span>
                        </motion.div>
                      )}
                    </div>
                  );
                })}
              </div>

              <button className="mt-3 w-full inline-flex items-center justify-center gap-1 py-2 rounded-lg bg-luxury-black text-white text-[11px] font-semibold">
                Mover de fase <ChevronRight size={12} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────── MOCKUP 3 · DISPARO DE FOLLOW-UPS ──────────────────── */
const FOLLOW_TARGETS = ["Bruno Santos", "Carla Dias", "Diego Reis", "Elaine Souza", "Felipe Aragão", "Gabriela Pinto"];

function FollowupMock() {
  const reduce = useReducedMotion();
  const sent = useStep(FOLLOW_TARGETS.length + 2, 650); // 0..N: quantos já "enviaram"

  return (
    <div className="relative">
      <div className="absolute -inset-8 bg-gradient-to-tr from-gold-400/20 to-emerald-300/10 rounded-[2.5rem] blur-3xl pointer-events-none" />
      <div className="relative rounded-[1.7rem] p-px bg-gradient-to-b from-black/10 to-black/5 shadow-2xl shadow-black/10">
        <div className="rounded-[1.65rem] bg-white overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-black/5">
            <span className="text-sm font-semibold text-gray-700 flex items-center gap-2"><Send size={15} className="text-gold-500" /> Disparar follow-up</span>
            <span className="text-[11px] text-gray-400">Etapa do funil</span>
          </div>

          {/* Seletor de etapa */}
          <div className="px-5 pt-4">
            <div className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-gold-50 border border-gold-200">
              <span className="text-[13px] font-semibold text-gold-700 flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-gold-500" /> Conversa iniciada</span>
              <span className="text-[11px] font-medium text-gray-500">6 parados +3 dias</span>
            </div>
          </div>

          {/* Mensagem */}
          <div className="px-5 pt-3">
            <p className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold mb-1.5">Mensagem</p>
            <div className="rounded-xl bg-gray-50 border border-black/5 p-3 text-[12px] text-gray-600 leading-relaxed">
              Oi <span className="px-1 rounded bg-gold-100 text-gold-700 font-medium">{"{nome}"}</span>! Vi seu interesse no ensaio.
              Ainda dá tempo de garantir uma data esse mês. Quer que eu te mande as opções? 📸
            </div>
          </div>

          {/* Botão + progresso */}
          <div className="px-5 pt-3">
            <div className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-full bg-gold-500 text-white text-[13px] font-semibold">
              <Send size={14} /> Disparar para 6 contatos
            </div>
          </div>

          {/* Lista de envio ao vivo */}
          <div className="p-3 pt-3 space-y-1">
            {FOLLOW_TARGETS.map((name, i) => {
              const done = reduce || i < sent;
              return (
                <div key={name} className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg">
                  <div className="w-6 h-6 rounded-full bg-gradient-to-br from-gray-200 to-gray-300 flex-shrink-0" />
                  <span className="text-[12px] font-medium text-gray-600 flex-1 truncate">{name}</span>
                  <AnimatePresence mode="wait">
                    {done ? (
                      <motion.span key="ok" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                        className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600">
                        <Check size={12} /> enviado
                      </motion.span>
                    ) : (
                      <motion.span key="wait" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-[10px] text-gray-300">na fila</motion.span>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────── STICKY SHOWCASE ───────────────────────────────────── */
const CHAPTERS = [
  {
    key: "opps", eyebrow: "Motor de Oportunidades", Mock: OpportunitiesMock,
    title: "O sistema enxerga as vendas por você.",
    desc: "Ele cruza a data de nascimento de cada cliente e cada bebê e te entrega, todo dia, quem está pronto pra comprar de novo: newborn, smash the cake, aniversário e acompanhamento.",
    chips: ["Newborn", "Smash the Cake", "Aniversário", "Acompanhamento", "Aniversariantes"],
  },
  {
    key: "ext", eyebrow: "Extensão do WhatsApp", Mock: ExtensionKanbanMock,
    title: "Seu CRM dentro do WhatsApp Web.",
    desc: "A extensão injeta o pipeline do CRM ao lado da conversa. Veja o estágio do contato, mova de fase e adicione o lead sem nunca sair do WhatsApp.",
    chips: ["Painel ao lado da conversa", "Mover de fase em 1 clique", "Adicionar lead na hora"],
  },
  {
    key: "follow", eyebrow: "Disparo de follow-ups", Mock: FollowupMock,
    title: "Cutuque quem esfriou, em massa.",
    desc: "Escolha uma etapa do funil e dispare uma mensagem pronta pra todo mundo que está parado nela. O follow-up que você sempre esquece de mandar, agora em segundos.",
    chips: ["Por etapa do funil", "Mensagem personalizada", "Envio em lote"],
  },
];

function StickyShowcase() {
  const [active, setActive] = useState(0);
  const ActiveMock = CHAPTERS[active].Mock;
  return (
    <section id="oportunidades" className="relative py-12 sm:py-20">
      <div className="max-w-6xl mx-auto px-5 sm:px-8">
        <FadeIn>
          <div className="text-center mb-10 sm:mb-16 max-w-2xl mx-auto">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-600 mb-4">Inteligência que vende</p>
            <h2 className="text-3xl sm:text-5xl font-bold tracking-tight leading-[1.05]">Três formas de transformar sua base em faturamento.</h2>
          </div>
        </FadeIn>

        <div className="grid lg:grid-cols-2 gap-10 lg:gap-16">
          {/* Capítulos de texto */}
          <div>
            {CHAPTERS.map((c, i) => (
              <motion.div
                key={c.key}
                onViewportEnter={() => setActive(i)}
                viewport={{ margin: "-50% 0px -50% 0px" }}
                className="min-h-[72vh] lg:min-h-[88vh] flex flex-col justify-center"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-600 mb-3">{c.eyebrow}</p>
                <h3 className="text-2xl sm:text-4xl font-bold tracking-tight leading-[1.1] mb-4">{c.title}</h3>
                <p className="text-lg text-gray-500 leading-relaxed mb-6 max-w-md">{c.desc}</p>
                <div className="flex flex-wrap gap-2 mb-8">
                  {c.chips.map((chip) => (
                    <span key={chip} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white border border-black/5 shadow-sm text-[12px] font-medium text-gray-600">
                      <Check size={12} className="text-gold-500" /> {chip}
                    </span>
                  ))}
                </div>
                {/* Mock inline no mobile */}
                <div className="lg:hidden"><c.Mock /></div>
              </motion.div>
            ))}
          </div>

          {/* Visual fixo (desktop) */}
          <div className="hidden lg:block">
            <div className="sticky top-0 h-screen flex items-center">
              <div className="w-full">
                <AnimatePresence mode="wait">
                  <motion.div key={active}
                    initial={{ opacity: 0, y: 24, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -24, scale: 0.97 }}
                    transition={{ duration: 0.45, ease: EASE }}>
                    <ActiveMock />
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────── SOCIAL PROOF ──────────────────────────────────────── */
function SocialProof() {
  const stats = [
    { value: "+500", label: "Fotógrafos ativos" },
    { value: "+R$2M", label: "Em vendas geradas" },
    { value: "+38%", label: "Mais ensaios fechados" },
    { value: "4.9/5", label: "234 avaliações" },
  ];
  return (
    <section className="py-12 border-y border-black/5">
      <div className="max-w-5xl mx-auto px-5 sm:px-8">
        <p className="text-center text-[11px] font-semibold text-gray-400 uppercase tracking-[0.2em] mb-8">Fotógrafos de todo o Brasil já vendem mais com o {APP_NAME}</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 text-center">
          {stats.map((s) => (
            <div key={s.label}><div className="text-3xl sm:text-4xl font-bold tracking-tight">{s.value}</div><div className="text-xs text-gray-400 mt-1">{s.label}</div></div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────── PROBLEM ───────────────────────────────────────────── */
function ProblemSection() {
  const pains = [
    "O bebê que você fotografou ano passado vai fazer 1 ano, e ninguém ofereceu o Smash the Cake.",
    "A cliente teve outro filho e contratou outro fotógrafo, porque você nem ficou sabendo.",
    "O aniversário daquela família passou em branco. Era um ensaio praticamente certo.",
    "Você só lembra de vender quando o cliente aparece. No resto do tempo, a base fica parada.",
  ];
  return (
    <section className="py-24 sm:py-32 relative overflow-hidden">
      <div className="relative max-w-5xl mx-auto px-5 sm:px-8 grid lg:grid-cols-[0.9fr_1.1fr] gap-12 items-center">
        <FadeIn>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-600 mb-4">A conta que ninguém faz</p>
            <h2 className="text-3xl sm:text-5xl font-bold tracking-tight leading-[1.08] mb-5">Não é falta de cliente. É venda <span className="text-gold-600">escorrendo pelos dedos.</span></h2>
            <p className="text-lg text-gray-500 leading-relaxed">A maior parte do faturamento de um fotógrafo vem de quem já confiou nele uma vez. Sem um sistema avisando na hora certa, essas vendas simplesmente não acontecem.</p>
          </div>
        </FadeIn>
        <div className="space-y-3">
          {pains.map((p, i) => (
            <FadeIn key={p} delay={i * 0.06}>
              <div className="flex items-start gap-4 p-5 rounded-2xl bg-white border border-black/5 shadow-sm">
                <div className="w-7 h-7 rounded-full bg-rose-50 text-rose-500 flex items-center justify-center flex-shrink-0 mt-0.5"><TrendingUp size={15} className="rotate-180" /></div>
                <p className="text-[15px] text-gray-600 leading-relaxed">{p}</p>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────── FEATURE GRID ──────────────────────────────────────── */
function FeatureGrid() {
  const features = [
    { icon: Workflow,      title: "Pipeline visual de vendas", desc: "Arraste cada lead entre as etapas e veja quem está parado tempo demais." },
    { icon: FileSignature, title: "Contratos digitais",        desc: "Contrato preenchido em 1 clique, assinado pelo celular, com validade jurídica." },
    { icon: Calendar,      title: "Agenda integrada ao Google", desc: "Marcou no app, aparece no Google e vice-versa. Sem cadastrar duas vezes." },
    { icon: MessageCircle, title: "Inbox de WhatsApp",         desc: "Todas as conversas dentro do app, com templates e respostas rápidas." },
    { icon: Users,         title: "Equipe com permissões",     desc: "Vendedores e assistentes, cada um vendo exatamente o que pode." },
    { icon: TrendingUp,    title: "Relatórios que importam",   desc: "Quanto faturou, qual etapa trava, qual fonte traz mais cliente." },
  ];
  return (
    <section id="recursos" className="py-24 sm:py-32 bg-luxury-cream/50">
      <div className="max-w-6xl mx-auto px-5 sm:px-8">
        <FadeIn>
          <div className="text-center mb-16 max-w-2xl mx-auto">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-600 mb-4">Tudo num só lugar</p>
            <h2 className="text-3xl sm:text-5xl font-bold tracking-tight leading-[1.08] mb-5">E quando a venda aparece, você fecha sem sair do app.</h2>
            <p className="text-lg text-gray-500">Substitui Trello, planilha, Calendly e Autentique. Tudo conectado ao mesmo cliente.</p>
          </div>
        </FadeIn>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map((f, i) => (
            <FadeIn key={f.title} delay={(i % 3) * 0.06}>
              <div className="group h-full p-7 rounded-3xl bg-white border border-black/5 hover:border-gold-300 hover:shadow-xl hover:shadow-gold-500/5 hover:-translate-y-1 transition-all duration-300">
                <div className="w-12 h-12 rounded-2xl bg-gold-50 text-gold-600 flex items-center justify-center mb-4 group-hover:scale-105 transition-transform"><f.icon size={22} /></div>
                <h3 className="font-bold text-lg mb-2">{f.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{f.desc}</p>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────── HOW IT WORKS ──────────────────────────────────────── */
function HowItWorks() {
  const steps = [
    { n: "1", title: "Crie sua conta", desc: "Email e senha. Aprovada na hora, sem cartão de crédito." },
    { n: "2", title: "Importe seus clientes", desc: "CSV ou comece do zero. As datas de nascimento viram oportunidades automaticamente." },
    { n: "3", title: "Comece a vender", desc: "No primeiro login o sistema já te mostra quem está pronto pra comprar." },
  ];
  return (
    <section className="py-24 sm:py-32">
      <div className="max-w-5xl mx-auto px-5 sm:px-8">
        <FadeIn><div className="text-center mb-14"><h2 className="text-3xl sm:text-5xl font-bold tracking-tight mb-4">Em 5 minutos, vendendo.</h2><p className="text-lg text-gray-500 max-w-xl mx-auto">Sem instalação, sem migração demorada, sem suporte técnico.</p></div></FadeIn>
        <div className="grid sm:grid-cols-3 gap-5">
          {steps.map((s, i) => (
            <FadeIn key={s.n} delay={i * 0.1}>
              <div className="relative bg-white rounded-3xl p-8 border border-black/5 shadow-sm">
                <div className="w-11 h-11 rounded-2xl bg-gold-500 text-white font-bold text-lg flex items-center justify-center mb-5">{s.n}</div>
                <h3 className="font-bold text-lg mb-1.5">{s.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{s.desc}</p>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────── TESTIMONIALS ──────────────────────────────────────── */
function Testimonials() {
  const ts = [
    { name: "Marina Silva", role: "Fotógrafa Newborn · Curitiba/PR", text: "Em 2 meses fechei 14 ensaios a mais, todos de clientes que já eram meus. O sistema me avisava e eu só mandava a oferta." },
    { name: "Estúdio Pitori", role: "Estúdio Familiar · Londrina/PR", text: "Os Smash the Cake que eu perdia todo mês agora aparecem com 30 dias de antecedência. Virou faturamento recorrente." },
    { name: "Júlia Rocha", role: "Fotógrafa Gestante · São Paulo/SP", text: "É o primeiro sistema que entende como fotógrafo trabalha. Ele lembra dos aniversários dos bebês por mim." },
  ];
  return (
    <section className="py-24 sm:py-32 bg-luxury-cream/50">
      <div className="max-w-6xl mx-auto px-5 sm:px-8">
        <FadeIn>
          <div className="text-center mb-14">
            <div className="flex items-center justify-center gap-1 mb-4">{[...Array(5)].map((_, i) => <Star key={i} size={18} className="fill-gold-400 text-gold-400" />)}</div>
            <h2 className="text-3xl sm:text-5xl font-bold tracking-tight mb-3">Quem usa, vende mais.</h2>
            <p className="text-base text-gray-500">4.9/5 · 234 avaliações de fotógrafos brasileiros</p>
          </div>
        </FadeIn>
        <div className="grid sm:grid-cols-3 gap-5">
          {ts.map((t, i) => (
            <FadeIn key={t.name} delay={i * 0.08}>
              <div className="h-full bg-white rounded-3xl p-7 border border-black/5 shadow-sm">
                <div className="flex gap-0.5 mb-4">{[...Array(5)].map((_, j) => <Star key={j} size={14} className="fill-gold-400 text-gold-400" />)}</div>
                <p className="text-[15px] text-gray-700 mb-5 leading-relaxed">"{t.text}"</p>
                <div className="flex items-center gap-3 pt-4 border-t border-black/5">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-gold-400 to-gold-600 text-white font-bold flex items-center justify-center">{t.name[0]}</div>
                  <div><p className="font-semibold text-sm">{t.name}</p><p className="text-xs text-gray-400">{t.role}</p></div>
                </div>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────── PRICING ───────────────────────────────────────────── */
const PRO_FEATURES = [
  "Motor de Oportunidades completo",
  "Pipeline de vendas (CRM visual)",
  "Extensão do WhatsApp com CRM",
  "Disparo de follow-ups em lote",
  "Contratos digitais ilimitados",
  "Agenda integrada ao Google",
  "Até 500 clientes e 500 jobs",
  "2 vendedores na equipe",
  "Suporte por e-mail",
];
const BUSINESS_EXTRAS = [
  "Clientes, jobs e vendedores ilimitados",
  "Múltiplos vendedores com permissões",
  "Relatórios avançados de faturamento",
  "Suporte prioritário com SLA",
  "Onboarding individual com a nossa equipe",
];

const fmtBRL = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const PriceFeature: React.FC<{ children: React.ReactNode; light?: boolean }> = ({ children, light }) => (
  <li className={`flex items-start gap-2.5 text-[13.5px] ${light ? "text-gray-600" : "text-white/80"}`}>
    <span className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center ${light ? "bg-gold-100 text-gold-600" : "bg-gold-500/20 text-gold-300"}`}>
      <Check size={11} strokeWidth={3} />
    </span>
    {children}
  </li>
);

function Pricing({ plans }: { plans: Plan[] }) {
  const priceOf = (slug: string) => (plans.find((p) => p.slug === slug)?.price_cents ?? 0) / 100;
  const proPrice = priceOf("pro");
  const bizPrice = priceOf("business");

  return (
    <section id="precos" className="relative py-24 sm:py-32 overflow-hidden">
      {/* brilho de fundo sutil */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-10 left-1/2 -translate-x-1/2 w-[700px] h-[420px] bg-gold-200/30 rounded-full blur-[130px]" />
      </div>

      <div className="relative max-w-5xl mx-auto px-5 sm:px-8">
        <FadeIn>
          <div className="text-center mb-14">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-600 mb-4">Planos e preços</p>
            <h2 className="text-3xl sm:text-5xl font-bold tracking-tight mb-4">Um plano que se paga numa única venda.</h2>
            <p className="text-lg text-gray-500 max-w-xl mx-auto">7 dias grátis, sem cartão. Um ensaio recuperado já cobre o mês inteiro.</p>
          </div>
        </FadeIn>

        <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto items-stretch">
          {/* ── PRO — destaque (claro, moldura dourada) ──────────────────────── */}
          <FadeIn>
            <div className="relative h-full rounded-[1.9rem] p-px bg-gradient-to-b from-gold-400 via-gold-300 to-gold-100 shadow-2xl shadow-gold-500/15">
              <div className="relative h-full rounded-[1.85rem] bg-gradient-to-b from-gold-50/80 to-white p-8 sm:p-9 overflow-hidden">
                <div className="pointer-events-none absolute -top-16 -right-16 w-48 h-48 bg-gold-200/40 rounded-full blur-3xl" />
                <div className="relative">
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-2.5">
                      <div className="w-11 h-11 rounded-2xl bg-gold-500 text-white flex items-center justify-center shadow-lg shadow-gold-500/30"><Zap size={20} /></div>
                      <div>
                        <p className="font-bold text-lg leading-none">Pro</p>
                        <p className="text-[12px] text-gray-400 mt-1">Pra fotógrafos e pequenos estúdios</p>
                      </div>
                    </div>
                    <span className="flex-shrink-0 whitespace-nowrap px-2.5 py-1 rounded-full bg-gold-500 text-white text-[10px] font-bold shadow-sm shadow-gold-500/30">MAIS ESCOLHIDO</span>
                  </div>

                  <div className="flex items-baseline gap-1.5 mb-1">
                    <span className="text-[3.4rem] leading-none font-bold tracking-tight">R$ {proPrice.toFixed(0)}</span>
                    <span className="text-gray-400 text-sm">/mês</span>
                  </div>
                  <p className="text-[13px] text-gold-600 mb-7">Menos de R$ {fmtBRL(proPrice / 30)} por dia, e o primeiro cliente já paga.</p>

                  <Link to="/cadastro" className="group block text-center w-full py-3.5 mb-3 rounded-full font-semibold bg-gold-500 hover:bg-gold-600 text-white shadow-lg shadow-gold-500/30 transition-all hover:-translate-y-0.5">
                    Começar grátis por 7 dias
                    <ArrowRight size={16} className="inline ml-1.5 group-hover:translate-x-0.5 transition-transform" />
                  </Link>
                  <p className="text-center text-[11px] text-gray-400 mb-7">Sem cartão de crédito · cancele quando quiser</p>

                  <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 mb-4">O que está incluído</p>
                  <ul className="space-y-2.5">
                    {PRO_FEATURES.map((f) => <PriceFeature key={f} light>{f}</PriceFeature>)}
                  </ul>
                </div>
              </div>
            </div>
          </FadeIn>

          {/* ── BUSINESS — branco simples ────────────────────────────────────── */}
          <FadeIn delay={0.1}>
            <div className="relative h-full rounded-[1.9rem] bg-white border border-black/5 shadow-sm">
              <div className="h-full rounded-[1.9rem] p-8 sm:p-9 flex flex-col">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-2.5">
                    <div className="w-11 h-11 rounded-2xl bg-gold-50 text-gold-600 flex items-center justify-center"><Crown size={20} /></div>
                    <div>
                      <p className="font-bold text-lg leading-none">Business</p>
                      <p className="text-[12px] text-gray-400 mt-1">Pra estúdios e equipes em expansão</p>
                    </div>
                  </div>
                  <span className="flex-shrink-0 whitespace-nowrap inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-gold-50 text-gold-700 text-[10px] font-bold border border-gold-200"><InfinityIcon size={11} /> SEM LIMITES</span>
                </div>

                <div className="flex items-baseline gap-1.5 mb-1">
                  <span className="text-[3.4rem] leading-none font-bold tracking-tight">R$ {bizPrice.toFixed(0)}</span>
                  <span className="text-gray-400 text-sm">/mês</span>
                </div>
                <p className="text-[13px] text-gold-600 mb-7">R$ {fmtBRL(bizPrice / 30)} por dia por um estúdio inteiro sem limites.</p>

                <Link to="/cadastro" className="group block text-center w-full py-3.5 mb-3 rounded-full font-semibold bg-luxury-black text-white hover:opacity-90 transition-all hover:-translate-y-0.5">
                  Começar grátis por 7 dias
                  <ArrowRight size={16} className="inline ml-1.5 group-hover:translate-x-0.5 transition-transform" />
                </Link>
                <p className="text-center text-[11px] text-gray-400 mb-7">Sem cartão de crédito · cancele quando quiser</p>

                <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 mb-4">Tudo do Pro, e mais</p>
                <ul className="space-y-2.5">
                  {BUSINESS_EXTRAS.map((f) => <PriceFeature key={f} light>{f}</PriceFeature>)}
                </ul>
              </div>
            </div>
          </FadeIn>
        </div>

        {/* Faixa de confiança */}
        <FadeIn delay={0.15}>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-7 gap-y-3 text-[13px] text-gray-500">
            <span className="flex items-center gap-1.5"><Shield size={15} className="text-gold-500" /> Garantia de 7 dias</span>
            <span className="flex items-center gap-1.5"><BadgeCheck size={15} className="text-gold-500" /> Sem cartão de crédito</span>
            <span className="flex items-center gap-1.5"><Check size={15} className="text-gold-500" /> Cancele em 2 cliques</span>
            <span className="flex items-center gap-1.5"><MessageCircle size={15} className="text-gold-500" /> Suporte humano</span>
          </div>
        </FadeIn>
        <FadeIn delay={0.2}>
          <p className="text-center text-xs text-gray-400 mt-6">PIX recorrente ou cartão, processado pelo Asaas. A primeira cobrança só acontece após os 7 dias grátis.</p>
        </FadeIn>
      </div>
    </section>
  );
}

/* ─────────────────────── GUARANTEE ─────────────────────────────────────────── */
function Guarantee() {
  return (
    <section className="py-20">
      <div className="max-w-3xl mx-auto px-5 sm:px-8">
        <FadeIn>
          <div className="flex flex-col sm:flex-row items-center gap-7 p-9 rounded-[1.75rem] bg-white border border-black/5 shadow-sm text-center sm:text-left">
            <div className="w-16 h-16 rounded-2xl bg-gold-50 text-gold-600 flex items-center justify-center flex-shrink-0"><Shield size={30} /></div>
            <div>
              <h3 className="text-xl font-bold mb-1.5">Garantia incondicional de 7 dias</h3>
              <p className="text-[15px] text-gray-500 leading-relaxed">Use por 7 dias completos. Se não for pra você, é só cancelar pelo próprio app, sem perguntas e sem burocracia. <BadgeCheck size={15} className="inline -mt-0.5 text-gold-500" /> O risco é todo nosso.</p>
            </div>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

/* ─────────────────────── FAQ ───────────────────────────────────────────────── */
function FaqSection() {
  const faqs = [
    { q: "Como o sistema sabe quais são as oportunidades?", a: "Ele usa as datas de nascimento dos clientes e dos filhos que você cadastra e calcula automaticamente quem está na janela de newborn, smash the cake, aniversário e acompanhamento, todo dia." },
    { q: "A extensão do WhatsApp é segura?", a: "Totalmente. A extensão só lê a página do WhatsApp Web que você já abriu. Não armazena conversas e nenhuma mensagem sua vai pros nossos servidores." },
    { q: "Como funciona o disparo de follow-ups?", a: "Você escolhe uma etapa do funil, escreve (ou usa um template) a mensagem com o nome do cliente, e o sistema envia pra todos os contatos parados naquela etapa." },
    { q: "Como funciona o trial de 7 dias?", a: "Você cria a conta e ganha 7 dias com acesso completo ao plano Pro. Não precisa cartão de crédito. Quando acabar, você decide se quer assinar." },
    { q: "Preciso cadastrar tudo na mão?", a: "Não. Importamos sua base via CSV e te ajudamos no processo. A maioria importa tudo em menos de 30 minutos, e as oportunidades aparecem na hora." },
    { q: "Posso cancelar quando quiser?", a: "Sim, pelo próprio app, com 2 cliques. Você mantém o acesso até o fim do período já pago." },
    { q: "Como é cobrado?", a: "PIX recorrente (o Asaas debita automaticamente) ou cartão de crédito. A primeira cobrança só acontece depois dos 7 dias grátis." },
  ];
  return (
    <section id="faq" className="py-24 sm:py-32">
      <div className="max-w-3xl mx-auto px-5 sm:px-8">
        <FadeIn><h2 className="text-3xl sm:text-5xl font-bold tracking-tight text-center mb-12">Dúvidas frequentes</h2></FadeIn>
        <div className="space-y-3">
          {faqs.map((f, i) => (
            <FadeIn key={f.q} delay={i * 0.04}>
              <details className="group bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
                <summary className="cursor-pointer p-5 font-semibold flex items-center justify-between list-none gap-3 hover:bg-gray-50 transition-colors"><span>{f.q}</span><ChevronDown size={18} className="text-gray-400 group-open:rotate-180 transition-transform flex-shrink-0" /></summary>
                <div className="px-5 pb-5 text-gray-500 leading-relaxed">{f.a}</div>
              </details>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────── FINAL CTA ─────────────────────────────────────────── */
function FinalCta() {
  return (
    <section className="py-24 sm:py-32 relative overflow-hidden">
      <div className="absolute inset-0 bg-luxury-black" />
      <div className="pointer-events-none absolute -top-20 left-1/2 -translate-x-1/2 w-[700px] h-[500px] bg-gold-500/20 rounded-full blur-[120px]" />
      <div className="relative max-w-3xl mx-auto px-5 sm:px-8 text-center text-white">
        <FadeIn>
          <h2 className="text-3xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.05] mb-5">As vendas já estão lá.<br /><span className="bg-gradient-to-r from-gold-300 to-gold-500 bg-clip-text text-transparent">Comece a enxergá-las hoje.</span></h2>
          <p className="text-lg sm:text-xl text-white/60 mb-9 max-w-xl mx-auto">7 dias grátis, sem cartão. No primeiro login, suas oportunidades já estão te esperando.</p>
          <Link to="/cadastro" className="group inline-flex items-center gap-2 px-8 py-4 bg-gold-500 hover:bg-gold-600 text-white font-semibold rounded-full shadow-2xl shadow-gold-500/30 transition-all hover:-translate-y-1 text-lg">Criar conta grátis agora<ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" /></Link>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 mt-8 text-[13px] text-white/40">
            <span className="flex items-center gap-1.5"><Check size={14} className="text-gold-400" /> Sem cartão</span>
            <span className="flex items-center gap-1.5"><Check size={14} className="text-gold-400" /> Cancele quando quiser</span>
            <span className="flex items-center gap-1.5"><Check size={14} className="text-gold-400" /> Pronto em 5 minutos</span>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

/* ─────────────────────── FOOTER ────────────────────────────────────────────── */
function Footer() {
  return (
    <footer className="border-t border-black/5 py-14 bg-luxury-paper">
      <div className="max-w-6xl mx-auto px-5 sm:px-8">
        <div className="grid sm:grid-cols-3 gap-8 mb-10">
          <div>
            <div className="flex items-center mb-3"><TrilhaLogo heightClass="h-7" /></div>
            <p className="text-sm text-gray-400 leading-relaxed max-w-xs">O CRM que transforma a sua base de clientes em vendas recorrentes. Feito pra fotógrafos brasileiros.</p>
          </div>
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">Produto</h4>
            <ul className="space-y-2.5 text-sm">
              <li><a href="#oportunidades" className="text-gray-500 hover:text-gold-600 transition-colors">Inteligência</a></li>
              <li><a href="#recursos" className="text-gray-500 hover:text-gold-600 transition-colors">Recursos</a></li>
              <li><a href="#precos" className="text-gray-500 hover:text-gold-600 transition-colors">Preços</a></li>
              <li><a href="#faq" className="text-gray-500 hover:text-gold-600 transition-colors">Dúvidas</a></li>
            </ul>
          </div>
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">Conta</h4>
            <ul className="space-y-2.5 text-sm">
              <li><Link to="/login" className="text-gray-500 hover:text-gold-600 transition-colors">Entrar</Link></li>
              <li><Link to="/cadastro" className="text-gray-500 hover:text-gold-600 transition-colors">Criar conta grátis</Link></li>
              <li><Link to="/termos" className="text-gray-500 hover:text-gold-600 transition-colors">Termos</Link></li>
              <li><Link to="/privacidade" className="text-gray-500 hover:text-gold-600 transition-colors">Privacidade</Link></li>
            </ul>
          </div>
        </div>
        <div className="pt-7 border-t border-black/5 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-gray-400">
          <p>© {new Date().getFullYear()} {APP_NAME}. Todos os direitos reservados.</p>
          <p>Feito com 📷 no Brasil</p>
        </div>
      </div>
    </footer>
  );
}
