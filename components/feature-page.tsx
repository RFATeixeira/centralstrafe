"use client";

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { db } from "@/lib/firebase";
import { isCommentModerator, isFeatureManager } from "@/lib/roles";
import { useAuthSession } from "@/components/auth-provider";
import { GrenadeMapScene, type MapPoint } from "@/components/grenade-map-scene";

export type FeatureCategory = "granadas" | "movimentacoes" | "taticas";

type FeatureItem = {
  id: string;
  category: FeatureCategory;
  title: string;
  grenadeType?: string;
  objective?: string;
  difficulty?: string;
  throwType?: string;
  map?: string;
  location?: string;
  position?: string;
  teleportCommand?: string;
  launchPoint?: MapPoint | null;
  impactPoint?: MapPoint | null;
  description: string;
  coverImageText?: string;
  imageTexts?: string[];
  imageZoomEnabled?: boolean[];
  imageText?: string;
  imageUrl?: string;
  youtubeUrl: string;
  createdBy: string;
  createdByName?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
};

type FeatureComment = {
  id: string;
  featureId: string;
  uid: string;
  userName: string;
  text: string;
  createdAt?: unknown;
  updatedAt?: unknown;
};

type FeaturePageProps = {
  category: FeatureCategory;
  badge: string;
  title: string;
  intro: string;
  points: string[];
  showHero?: boolean;
  initialMapFilter?: string;
};

type GrenadeMapFocus = {
  kind: "launch" | "impact";
  pointKey: string;
};

type CategoryCopy = {
  singular: string;
  singularTitle: string;
  plural: string;
};

const categoryCopy: Record<FeatureCategory, CategoryCopy> = {
  granadas: {
    singular: "granada",
    singularTitle: "Granada",
    plural: "granadas",
  },
  movimentacoes: {
    singular: "movimentacao",
    singularTitle: "Movimentacao",
    plural: "movimentacoes",
  },
  taticas: {
    singular: "tatica",
    singularTitle: "Tatica",
    plural: "taticas",
  },
};

type FeatureFormState = {
  title: string;
  grenadeType: string;
  objective: string;
  difficulty: string;
  throwType: string;
  map: string;
  location: string;
  position: string;
  teleportCommand: string;
  launchPoint: MapPoint | null;
  impactPoint: MapPoint | null;
  description: string;
  coverImageText: string;
  imageTexts: string[];
  imageZoomEnabled: boolean[];
  youtubeUrl: string;
};

const emptyFeatureForm = (): FeatureFormState => ({
  title: "",
  grenadeType: "Smoke",
  objective: "Entry",
  difficulty: "Facil",
  throwType: "Parado",
  map: "",
  location: "",
  position: "Respawn",
  teleportCommand: "",
  launchPoint: null,
  impactPoint: null,
  description: "",
  coverImageText: "",
  imageTexts: [],
  imageZoomEnabled: [],
  youtubeUrl: "",
});

function normalizePosition(value: string | undefined) {
  const trimmed = (value ?? "").trim();
  return trimmed === "Spawn" ? "Respawn" : trimmed;
}

async function readFileAsDataUrl(file: File) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("Falha ao ler imagem."));
    reader.readAsDataURL(file);
  });
}

async function compressImageToDataUrl(file: File) {
  const sourceDataUrl = await readFileAsDataUrl(file);
  const image = new Image();

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Falha ao processar imagem."));
    image.src = sourceDataUrl;
  });

  const maxDimension = 1080;
  const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    return sourceDataUrl;
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, width, height);

  let quality = 0.92;
  let output = canvas.toDataURL("image/webp", quality);

  while (output.length > 1_100_000 && quality > 0.55) {
    quality -= 0.08;
    output = canvas.toDataURL("image/webp", quality);
  }

  return output;
}

function pickFirstNonEmptyText(...values: Array<string | null | undefined>) {
  return values.find((value) => Boolean(value?.trim()))?.trim() ?? "";
}

function getYouTubeOrigin() {
  return typeof window !== "undefined" ? window.location.origin : "";
}

type YouTubePlayerInstance = {
  playVideo: () => void;
  pauseVideo: () => void;
  mute?: () => void;
  setPlaybackRate?: (rate: number) => void;
  getCurrentTime?: () => number;
  getDuration?: () => number;
  seekTo?: (seconds: number, allowSeekAhead?: boolean) => void;
};

type YouTubeApiWindow = Window & {
  YT?: {
    Player: new (
      element: HTMLDivElement,
      options: {
        videoId: string;
        host?: string;
        playerVars?: Record<string, string | number | boolean>;
        events?: {
          onReady?: (event: { target: YouTubePlayerInstance }) => void;
          onStateChange?: (event: { data: number; target: YouTubePlayerInstance }) => void;
        };
      }
    ) => YouTubePlayerInstance;
    PlayerState?: { PLAYING: number; PAUSED: number };
  };
  onYouTubeIframeAPIReady?: () => void;
};

let youtubeIframeApiPromise: Promise<void> | null = null;

function loadYouTubeIframeApi() {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }

  const youtubeWindow = window as YouTubeApiWindow;
  if (youtubeWindow.YT?.Player) {
    return Promise.resolve();
  }

  if (youtubeIframeApiPromise) {
    return youtubeIframeApiPromise;
  }

  youtubeIframeApiPromise = new Promise<void>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>('script[src="https://www.youtube.com/iframe_api"]');

    const cleanup = () => {
      if (youtubeWindow.onYouTubeIframeAPIReady === onReady) {
        delete youtubeWindow.onYouTubeIframeAPIReady;
      }
    };

    const onReady = () => {
      cleanup();
      resolve();
    };

    if (existingScript) {
      youtubeWindow.onYouTubeIframeAPIReady = onReady;
      return;
    }

    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => {
      cleanup();
      youtubeIframeApiPromise = null;
      reject(new Error("Nao foi possivel carregar a API do YouTube."));
    };

    youtubeWindow.onYouTubeIframeAPIReady = onReady;
    document.head.appendChild(script);
  });

  return youtubeIframeApiPromise;
}

function getYouTubeEmbedUrl(url: string) {
  try {
    const parsedUrl = new URL(url);
    const videoId = parsedUrl.hostname.includes("youtu.be")
      ? parsedUrl.pathname.replace("/", "")
      : parsedUrl.hostname.includes("youtube.com")
        ? parsedUrl.searchParams.get("v")
        : "";

    if (videoId) {
      const params = new URLSearchParams({
        autoplay: "1",
        controls: "0",
        disablekb: "1",
        fs: "0",
        iv_load_policy: "3",
        modestbranding: "1",
        rel: "0",
        playsinline: "1",
        enablejsapi: "1",
        origin: getYouTubeOrigin(),
      });

      return `https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`;
    }
  } catch {
    return "";
  }

  return "";
}

function getYouTubeVideoId(url: string) {
  try {
    const parsedUrl = new URL(url);

    if (parsedUrl.hostname.includes("youtu.be")) {
      return parsedUrl.pathname.replace("/", "").trim();
    }

    if (parsedUrl.hostname.includes("youtube.com") || parsedUrl.hostname.includes("youtube-nocookie.com")) {
      const fromQuery = parsedUrl.searchParams.get("v")?.trim() ?? "";
      if (fromQuery) {
        return fromQuery;
      }

      const embedMatch = parsedUrl.pathname.match(/\/embed\/([^/?]+)/);
      if (embedMatch?.[1]) {
        return embedMatch[1].trim();
      }
    }
  } catch {
    return "";
  }

  return "";
}

function getYouTubeThumbnailUrl(url: string) {
  const videoId = getYouTubeVideoId(url);
  return videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : "";
}

function getYouTubeHoverPreviewUrl(url: string) {
  const videoId = getYouTubeVideoId(url);
  if (!videoId) {
    return "";
  }

  const params = new URLSearchParams({
    autoplay: "1",
    mute: "1",
    loop: "1",
    playlist: videoId,
    playsinline: "1",
    enablejsapi: "1",
    origin: getYouTubeOrigin(),
  });

  return `https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`;
}

type YouTubeExpandedPlayerProps = {
  videoId: string;
  className?: string;
};

function YouTubeExpandedPlayer({ videoId, className }: YouTubeExpandedPlayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YouTubePlayerInstance | null>(null);
  const progressBarRef = useRef<HTMLButtonElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let intervalId: number | null = null;
    const containerElement = containerRef.current;

    void loadYouTubeIframeApi()
      .then(() => {
        const youtubeWindow = window as YouTubeApiWindow;
        const youtubeApi = youtubeWindow.YT;

        if (cancelled || !containerElement || !youtubeApi?.Player) {
          return;
        }

        containerElement.innerHTML = "";

        const player = new youtubeApi.Player(containerElement, {
          host: "https://www.youtube-nocookie.com",
          videoId,
          playerVars: {
            autoplay: 1,
            controls: 0,
            disablekb: 1,
            fs: 0,
            cc_load_policy: 0,
            iv_load_policy: 3,
            modestbranding: 1,
            rel: 0,
            playsinline: 1,
            enablejsapi: 1,
            origin: getYouTubeOrigin(),
          },
          events: {
            onReady: (event) => {
              event.target.mute?.();
              event.target.setPlaybackRate?.(1.5);
              event.target.playVideo();
              const nextDuration = event.target.getDuration?.() ?? 0;
              setDuration(Number.isFinite(nextDuration) ? nextDuration : 0);
              setCurrentTime(event.target.getCurrentTime?.() ?? 0);
              playerRef.current = event.target;
            },
            onStateChange: (event) => {
              const state = youtubeWindow.YT?.PlayerState;
              if (!state) {
                return;
              }

              if (event.data === state.PLAYING) {
                const nextDuration = event.target.getDuration?.() ?? 0;
                setDuration(Number.isFinite(nextDuration) ? nextDuration : 0);
              }
            },
          },
        });

        playerRef.current = player;

        intervalId = window.setInterval(() => {
          const nextPlayer = playerRef.current;
          if (!nextPlayer) {
            return;
          }

          const nextCurrentTime = nextPlayer.getCurrentTime?.() ?? 0;
          const nextDuration = nextPlayer.getDuration?.() ?? 0;

          setCurrentTime(Number.isFinite(nextCurrentTime) ? nextCurrentTime : 0);
          setDuration(Number.isFinite(nextDuration) ? nextDuration : 0);
        }, 250);
      })
      .catch(() => {
        if (!cancelled) {
          setCurrentTime(0);
          setDuration(0);
        }
      });

    return () => {
      cancelled = true;
      playerRef.current = null;
      if (intervalId) {
        window.clearInterval(intervalId);
      }
      if (containerElement) {
        containerElement.innerHTML = "";
      }
    };
  }, [videoId]);

  const progressPercentage = duration > 0 ? Math.max(0, Math.min((currentTime / duration) * 100, 100)) : 0;

  const seekFromPointer = (clientX: number) => {
    const player = playerRef.current;
    const track = progressBarRef.current;

    if (!player || !track || duration <= 0) {
      return;
    }

    const rect = track.getBoundingClientRect();
    const clampedX = Math.max(rect.left, Math.min(clientX, rect.right));
    const nextTime = ((clampedX - rect.left) / rect.width) * duration;

    player.seekTo?.(nextTime, true);
    setCurrentTime(nextTime);
  };

  return (
    <div className={`relative aspect-video w-full bg-black ${className ?? ""}`.trim()}>
      <div ref={containerRef} className="h-full w-full" />

      <div className=" hidden left-3 right-3 absolute w-min-full inset-x-3 bottom-3 z-20 rounded-full border border-slate-700 bg-slate-950/85 px-3 py-2 shadow-[0_18px_45px_rgba(0,0,0,.4)] backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <button
            type="button"
            ref={progressBarRef}
            onClick={(event) => seekFromPointer(event.clientX)}
            onPointerDown={(event) => seekFromPointer(event.clientX)}
            className="group relative h-3 min-w-0 flex-1 cursor-pointer overflow-hidden rounded-full bg-slate-700/80"
            aria-label="Barra de progresso do vídeo"
            title="Clique para buscar no vídeo"
          >
            <div className="absolute inset-y-0 left-0 rounded-full bg-orange-300 transition-[width] duration-150" style={{ width: `${progressPercentage}%` }} />
            <div className="absolute inset-y-0 left-0 w-0.5 bg-white/90 opacity-0 transition-opacity group-hover:opacity-100" style={{ left: `calc(${progressPercentage}% - 1px)` }} />
          </button>
        </div>

        <div className="mt-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
          <span>{formatTimeLabel(currentTime)}</span>
          <span>{formatTimeLabel(duration)}</span>
        </div>
      </div>
    </div>
  );
}

const ZOOM_MIN = 1;
const ZOOM_MAX = 8;
const ZOOM_STEP = 0.1;

type ZoomSliderProps = {
  value: number;
  onChange: (value: number) => void;
  label: string;
  hint: string;
  className?: string;
};

function ZoomSlider({ value, onChange, label, hint, className }: ZoomSliderProps) {
  return (
    <div
      className={`flex items-center gap-3 rounded-2xl border border-slate-700 bg-slate-950/90 px-3 py-2.5 shadow-[0_18px_45px_rgba(0,0,0,.38)] ${className ?? ""}`.trim()}
    >
      <div className="space-y-0.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</p>
        <p className="text-[10px] leading-tight text-slate-500">{hint}</p>
      </div>
      <input
        type="range"
        min={ZOOM_MIN}
        max={ZOOM_MAX}
        step={ZOOM_STEP}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-2 w-full min-w-40 cursor-pointer accent-orange-300"
        aria-label={label}
      />
      <div className="min-w-12 rounded-full border border-slate-700 bg-slate-900 px-2 py-1 text-center text-[11px] font-semibold text-slate-200">
        {value.toFixed(1)}x
      </div>
    </div>
  );
}

type ZoomLensProps = {
  src: string;
  alt: string;
  zoom: number;
  className?: string;
};

function ZoomLens({ src, alt, zoom, className }: ZoomLensProps) {
  return (
    <div
      className={`pointer-events-none absolute left-[10%] top-1/2 z-20 -translate-y-1/2 overflow-hidden rounded-full border border-slate-900/90 bg-black shadow-[0_18px_45px_rgba(0,0,0,.55)] ${className ?? "h-44 w-44 md:h-56 md:w-56"}`.trim()}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="h-full w-full object-cover"
        style={{ transform: `scale(${zoom})`, transformOrigin: "center center" }}
      />
    </div>
  );
}

function sendYouTubePlaybackCommands(targetWindow: Window | null, speed = 1.5) {
  if (!targetWindow) {
    return;
  }

  const commands = [
    { event: "command", func: "mute", args: [] },
    { event: "command", func: "playVideo", args: [] },
    { event: "command", func: "setPlaybackRate", args: [speed] },
  ];

  for (const command of commands) {
    targetWindow.postMessage(JSON.stringify(command), "*");
  }
}

function formatTimeLabel(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return "0:00";
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, "0");

  return `${minutes}:${seconds}`;
}

function getCommentTimeLabel(value: unknown) {
  if (!value || typeof value !== "object") {
    return "";
  }

  const seconds = (value as { seconds?: number }).seconds;
  if (!seconds) {
    return "";
  }

  return new Date(seconds * 1000).toLocaleDateString("pt-BR");
}

function getFeatureTitleSizeClass(title: string, compact = false) {
  const length = title.trim().length;

  if (length >= 70) {
    return compact ? "text-[10px] md:text-xs" : "text-sm md:text-base";
  }

  if (length >= 48) {
    return compact ? "text-xs md:text-sm" : "text-base md:text-lg";
  }

  return compact ? "text-sm md:text-base" : "text-xl md:text-2xl";
}

const grenadeIconByKey: Record<string, string> = {
  smoke: "/assets/icons/grenades/smoke.svg",
  flash: "/assets/icons/grenades/flashbang.svg",
  flashbang: "/assets/icons/grenades/flashbang.svg",
  decoy: "/assets/icons/grenades/decoy.svg",
  molotov: "/assets/icons/grenades/molotov.svg",
  molly: "/assets/icons/grenades/molotov.svg",
  incendiary: "/assets/icons/grenades/molotov.svg",
  he: "/assets/icons/grenades/he.svg",
  grenade: "/assets/icons/grenades/he.svg",
  hegrenade: "/assets/icons/grenades/he.svg",
  frag: "/assets/icons/grenades/he.svg",
};

const mapIconByKey: Record<string, string> = {
  ancient: "/assets/icons/maps/svg/map_icon_de_ancient.svg",
  anubis: "/assets/icons/maps/svg/map_icon_de_anubis.svg",
  cache: "/assets/icons/maps/svg/map_icon_de_cache.svg",
  dustii: "/assets/icons/maps/svg/map_icon_de_dust2.svg",
  dust2: "/assets/icons/maps/svg/map_icon_de_dust2.svg",
  "dust-2": "/assets/icons/maps/svg/map_icon_de_dust2.svg",
  "dust-ii": "/assets/icons/maps/svg/map_icon_de_dust2.svg",
  inferno: "/assets/icons/maps/svg/map_icon_de_inferno.svg",
  mirage: "/assets/icons/maps/svg/map_icon_de_mirage.svg",
  nuke: "/assets/icons/maps/svg/map_icon_de_nuke.svg",
  overpass: "/assets/icons/maps/svg/map_icon_de_overpass.svg",
  train: "/assets/icons/maps/svg/map_icon_de_train.svg",
  vertigo: "/assets/icons/maps/svg/map_icon_de_vertigo.svg",
};

const mapOverviewByKey: Record<string, string> = {
  ancient: "/assets/icons/overviews/de_ancient_radar_psd.png",
  ancientnight: "/assets/icons/overviews/de_ancient_night_radar_psd.png",
  anubis: "/assets/icons/overviews/de_anubis_radar_psd.png",
  cache: "/assets/icons/overviews/de_cache_radar_psd.png",
  dustii: "/assets/icons/overviews/de_dust2_radar_psd.png",
  dust2: "/assets/icons/overviews/de_dust2_radar_psd.png",
  "dust-2": "/assets/icons/overviews/de_dust2_radar_psd.png",
  "dust-ii": "/assets/icons/overviews/de_dust2_radar_psd.png",
  inferno: "/assets/icons/overviews/de_inferno_radar_psd.png",
  mirage: "/assets/icons/overviews/de_mirage_radar_psd.png",
  nuke: "/assets/icons/overviews/de_nuke_radar_psd.png",
  overpass: "/assets/icons/overviews/de_overpass_radar_psd.png",
  train: "/assets/icons/overviews/de_train_radar_psd.png",
  vertigo: "/assets/icons/overviews/de_vertigo_radar_psd.png",
};

const grenadeTypeAliases: Record<string, string[]> = {
  smoke: ["smoke"],
  flash: ["flash", "flashbang"],
  flashbang: ["flashbang", "flash"],
  decoy: ["decoy"],
  molotov: ["molotov", "molly", "incendiary"],
  he: ["he", "hegrenade", "frag"],
  grenade: ["he", "hegrenade", "frag"],
};

const mapNameAliases: Record<string, string[]> = {
  dust2: ["dustii", "dust2", "dust-2", "dust-ii"],
  "dust-2": ["dustii", "dust2", "dust-2", "dust-ii"],
  "dust-ii": ["dustii", "dust2", "dust-2", "dust-ii"],
  dustii: ["dustii", "dust2", "dust-2", "dust-ii"],
  cache: ["cache"],
  nuke: ["nuke"],
  mirage: ["mirage"],
  inferno: ["inferno"],
  vertigo: ["vertigo"],
  ancient: ["ancient"],
  anubis: ["anubis"],
  overpass: ["overpass"],
  train: ["train"],
  cbble: ["cobblestone", "cbble"],
};

const grenadeTypeOptions = ["Smoke", "Flash", "Molotov", "He", "Decoy"];

const mapOptions = [
  { value: "Ancient", label: "Ancient" },
  { value: "Anubis", label: "Anubis" },
  { value: "Cache", label: "Cache" },
  { value: "Dust II", label: "Dust II" },
  { value: "Inferno", label: "Inferno" },
  { value: "Mirage", label: "Mirage" },
  { value: "Nuke", label: "Nuke" },
  { value: "Overpass", label: "Overpass" },
  { value: "Train", label: "Train" },
  { value: "Vertigo", label: "Vertigo" },
];

const objectiveOptions = ["Entry", "Exec", "Retake", "Defesa", "Fake"];
const difficultyOptions = ["Facil", "Medio", "Dificil"];
const throwTypeOptions = [
  "Jumpthrow",
  "A + Jumpthrow",
  "Parado",
  "D + Jumpthrow",
  "W + Jumpthrow",
  "Walk + Jumpthrow",
  "Run + Jumpthrow",
];

function normalizeToken(value: string | undefined) {
  return slugifyIconName(value ?? "");
}

function normalizeMapKey(value: string | undefined) {
  const slug = normalizeToken(value);
  const compactSlug = slug.replace(/-/g, "");
  const aliases = mapNameAliases[slug] ?? mapNameAliases[compactSlug] ?? [slug, compactSlug];
  return aliases[0] ?? slug;
}

function isSameMap(first: string | undefined, second: string | undefined) {
  if (!first?.trim() || !second?.trim()) {
    return false;
  }

  return normalizeMapKey(first) === normalizeMapKey(second);
}

function canonicalGrenadeType(value: string | undefined) {
  const key = normalizeToken(value);
  const aliases = grenadeTypeAliases[key] ?? [key];

  if (aliases.includes("smoke")) {
    return "smoke";
  }
  if (aliases.includes("flash") || aliases.includes("flashbang")) {
    return "flash";
  }
  if (aliases.includes("molotov") || aliases.includes("molly") || aliases.includes("incendiary")) {
    return "molotov";
  }
  if (aliases.includes("he") || aliases.includes("hegrenade") || aliases.includes("frag")) {
    return "he";
  }
  if (aliases.includes("decoy")) {
    return "decoy";
  }

  return key;
}

function getDifficultyOptionClasses(option: string, active: boolean) {
  const key = normalizeToken(option);

  if (key === "facil") {
    return active
      ? "border-emerald-300 bg-emerald-300/18 text-emerald-100"
      : "border-emerald-900/60 bg-emerald-950/30 text-emerald-200 hover:border-emerald-600";
  }

  if (key === "medio") {
    return active
      ? "border-amber-300 bg-amber-300/18 text-amber-100"
      : "border-amber-900/60 bg-amber-950/30 text-amber-200 hover:border-amber-600";
  }

  return active
    ? "border-rose-300 bg-rose-300/18 text-rose-100"
    : "border-rose-900/60 bg-rose-950/30 text-rose-200 hover:border-rose-600";
}

function slugifyIconName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function getGrenadeTypeIconCandidates(grenadeType?: string) {
  if (!grenadeType?.trim()) {
    return [];
  }

  const key = slugifyIconName(grenadeType);
  const aliases = grenadeTypeAliases[key] ?? [key];
  const candidates = aliases
    .map((alias) => grenadeIconByKey[slugifyIconName(alias)])
    .filter((iconPath): iconPath is string => Boolean(iconPath));

  return uniqueValues(candidates);
}

function getMapIconCandidates(mapName?: string) {
  if (!mapName?.trim()) {
    return [];
  }

  const slug = slugifyIconName(mapName);
  const compactSlug = slug.replace(/-/g, "");
  const aliases = mapNameAliases[slug] ?? [slug, compactSlug];
  const candidates = aliases
    .map((alias) => mapIconByKey[slugifyIconName(alias)])
    .filter((iconPath): iconPath is string => Boolean(iconPath));

  return uniqueValues(candidates);
}

function getMapOverviewCandidates(mapName?: string) {
  if (!mapName?.trim()) {
    return [];
  }

  const slug = slugifyIconName(mapName);
  const compactSlug = slug.replace(/-/g, "");
  const aliases = mapNameAliases[slug] ?? [slug, compactSlug];
  const candidates = aliases
    .map((alias) => mapOverviewByKey[slugifyIconName(alias)] ?? mapOverviewByKey[alias])
    .filter((imagePath): imagePath is string => Boolean(imagePath));

  if (candidates.length > 0) {
    return uniqueValues(candidates);
  }

  return getMapIconCandidates(mapName);
}

function getMapOverviewSource(mapName?: string) {
  return getMapOverviewCandidates(mapName)[0] ?? "";
}

function normalizeMapPoint(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const point = value as { x?: number; y?: number };

  if (typeof point.x !== "number" || typeof point.y !== "number") {
    return null;
  }

  return {
    x: Number(point.x.toFixed(1)),
    y: Number(point.y.toFixed(1)),
  } satisfies MapPoint;
}

function formatMapPoint(point?: MapPoint | null) {
  if (!point) {
    return "";
  }

  return `${point.x.toFixed(1)}, ${point.y.toFixed(1)}`;
}

function getPointKey(point?: MapPoint | null) {
  if (!point) {
    return "";
  }

  return `${point.x.toFixed(1)}:${point.y.toFixed(1)}`;
}

type PointCatalogEntry = {
  key: string;
  point: MapPoint;
  titles: string[];
};

function buildPointCatalog(features: FeatureItem[], kind: "launch" | "impact") {
  const catalog = new Map<string, PointCatalogEntry>();

  for (const feature of features) {
    const point = kind === "launch" ? feature.launchPoint : feature.impactPoint;
    if (!point) {
      continue;
    }

    const key = getPointKey(point);
    const existing = catalog.get(key);

    if (existing) {
      existing.titles.push(feature.title);
      continue;
    }

    catalog.set(key, {
      key,
      point,
      titles: [feature.title],
    });
  }

  return Array.from(catalog.values()).sort((first, second) => first.key.localeCompare(second.key));
}

function mapFeatureToGrenadeEntry(feature: FeatureItem) {
  return {
    id: feature.id,
    title: feature.title,
    grenadeType: feature.grenadeType,
    launchPoint: feature.launchPoint,
    impactPoint: feature.impactPoint,
    youtubeUrl: feature.youtubeUrl,
    coverImageText: feature.coverImageText,
    imageTexts: feature.imageTexts,
    imageText: feature.imageText,
    imageUrl: feature.imageUrl,
  };
}

type IconWithFallbackProps = {
  candidates: string[];
  alt: string;
  className: string;
};

function IconWithFallback({ candidates, alt, className }: IconWithFallbackProps) {
  const uniqueCandidates = uniqueValues(candidates);
  const [activeCandidateIndex, setActiveCandidateIndex] = useState(0);

  if (!uniqueCandidates.length || activeCandidateIndex >= uniqueCandidates.length) {
    return null;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={uniqueCandidates[activeCandidateIndex]}
      alt={alt}
      className={className}
      onError={() => setActiveCandidateIndex((current) => current + 1)}
    />
  );
}

export function FeaturePage({
  category,
  badge,
  title,
  intro,
  points,
  showHero = true,
  initialMapFilter = "",
}: FeaturePageProps) {
  const { user, profile, role } = useAuthSession();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const copy = categoryCopy[category];
  const [features, setFeatures] = useState<FeatureItem[]>([]);
  const [comments, setComments] = useState<FeatureComment[]>([]);
  const [featureModalOpen, setFeatureModalOpen] = useState(false);
  const [editingFeature, setEditingFeature] = useState<FeatureItem | null>(null);
  const [featureForm, setFeatureForm] = useState<FeatureFormState>(emptyFeatureForm);
  const [filterGrenadeType, setFilterGrenadeType] = useState("");
  const [filterMap, setFilterMap] = useState(initialMapFilter);
  const [filterObjective, setFilterObjective] = useState("");
  const [filterDifficulty, setFilterDifficulty] = useState("");
  const [filterThrowType, setFilterThrowType] = useState("");
  const [filterLocation, setFilterLocation] = useState("");
  const [filterPosition, setFilterPosition] = useState("");
  const [expandedFeatureId, setExpandedFeatureId] = useState<string | null>(null);
  const [activeExpandedImageIndex, setActiveExpandedImageIndex] = useState(0);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [editingComment, setEditingComment] = useState<FeatureComment | null>(null);
  const [editingCommentText, setEditingCommentText] = useState("");
  const [feedback, setFeedback] = useState("");
  const [saving, setSaving] = useState(false);
  const [processingImage, setProcessingImage] = useState(false);
  const [imageViewer, setImageViewer] = useState<{ src: string; alt: string; zoomEnabled: boolean } | null>(null);
  const [imageViewerZoom, setImageViewerZoom] = useState(2);
  const [copiedCommandKey, setCopiedCommandKey] = useState("");
  const [hoveredFeatureId, setHoveredFeatureId] = useState<string | null>(null);
  const [hoveredImageIndex, setHoveredImageIndex] = useState(0);
  const [selectedMapHoveredFeatureId, setSelectedMapHoveredFeatureId] = useState<string | null>(null);
  const [selectedMapHoveredImageIndex, setSelectedMapHoveredImageIndex] = useState(0);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [selectedMapFocus, setSelectedMapFocus] = useState<GrenadeMapFocus | null>(null);
  const [mapSelectionMode, setMapSelectionMode] = useState<"launch" | "impact">("launch");
  const selectedMapSectionRef = useRef<HTMLElement | null>(null);

  const canAddFeature = isFeatureManager(role);
  const canModerateComments = isCommentModerator(role);
  const isGranadasCategory = category === "granadas";
  const mapFilterFromUrl = searchParams.get("map")?.trim() ?? initialMapFilter.trim();

  const syncMapFilterToUrl = (nextMap: string) => {
    const nextValue = nextMap.trim();
    const params = new URLSearchParams(searchParams.toString());

    if (nextValue) {
      params.set("map", nextValue);
    } else {
      params.delete("map");
    }

    const nextQuery = params.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  };

  useEffect(() => {
    if (!db) {
      setFeedback("Configure o Firebase para visualizar conteudo em tempo real.");
      return;
    }

    const featuresQuery = query(
      collection(db, "features"),
      where("category", "==", category)
    );

    const unsubscribe = onSnapshot(featuresQuery, (snapshot) => {
      const items = snapshot.docs.map((item) => ({
        id: item.id,
        ...(item.data() as Omit<FeatureItem, "id">),
      }));

      setFeatures(items.sort((first, second) => first.title.localeCompare(second.title)));
    });

    return () => unsubscribe();
  }, [category]);

  useEffect(() => {
    if (!db) {
      return;
    }

    const unsubscribe = onSnapshot(collection(db, "comments"), (snapshot) => {
      const items = snapshot.docs.map((item) => ({
        id: item.id,
        ...(item.data() as Omit<FeatureComment, "id">),
      }));

      setComments(items);
    });

    return () => unsubscribe();
  }, []);

  const featureComments = useMemo(
    () =>
      features.reduce<Record<string, FeatureComment[]>>((accumulator, feature) => {
        accumulator[feature.id] = comments
          .filter((comment) => comment.featureId === feature.id)
          .sort((first, second) => {
            const firstSeconds = (first.createdAt as { seconds?: number } | undefined)?.seconds ?? 0;
            const secondSeconds = (second.createdAt as { seconds?: number } | undefined)?.seconds ?? 0;
            return secondSeconds - firstSeconds;
          });
        return accumulator;
      }, {}),
    [comments, features]
  );

  const availableImpactLocations = useMemo(() => {
    if (!filterMap.trim()) {
      return [] as string[];
    }

    return Array.from(
      new Set(
        features
          .filter((item) => isSameMap(item.map, filterMap))
          .map((item) => (item.location ?? "").trim())
          .filter(Boolean)
      )
    ).sort((first, second) => first.localeCompare(second));
  }, [features, filterMap]);

  const filterOptions = useMemo(
    () => ({
      grenadeTypes: grenadeTypeOptions,
      maps: mapOptions,
      objectives: objectiveOptions,
      difficulties: difficultyOptions,
      throwTypes: throwTypeOptions,
      locations: availableImpactLocations,
      positions: Array.from(
        new Set(features.map((item) => normalizePosition(item.position)).filter(Boolean))
      ).sort((first, second) => first.localeCompare(second)),
    }),
    [availableImpactLocations, features]
  );

  useEffect(() => {
    if (!filterLocation) {
      return;
    }

    if (!availableImpactLocations.includes(filterLocation)) {
      setFilterLocation("");
    }
  }, [availableImpactLocations, filterLocation]);

  useEffect(() => {
    setFilterMap(mapFilterFromUrl);
  }, [mapFilterFromUrl]);

  useEffect(() => {
    if (initialMapFilter.trim()) {
      setFilterMap(initialMapFilter);
    }
  }, [initialMapFilter]);

  useEffect(() => {
    if (!initialMapFilter.trim()) {
      return;
    }

    window.requestAnimationFrame(() => {
      selectedMapSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [initialMapFilter]);

  useEffect(() => {
    setSelectedMapFocus(null);
  }, [filterMap]);

  const filteredFeatures = useMemo(
    () =>
      features.filter((feature) => {
        const featureGrenadeType = canonicalGrenadeType(feature.grenadeType);
        const selectedGrenadeType = canonicalGrenadeType(filterGrenadeType);
        const featureMap = normalizeMapKey(feature.map);
        const selectedMap = normalizeMapKey(filterMap);
        const featureObjective = normalizeToken(feature.objective);
        const selectedObjective = normalizeToken(filterObjective);
        const featureDifficulty = normalizeToken(feature.difficulty);
        const selectedDifficulty = normalizeToken(filterDifficulty);
        const featureThrowType = normalizeToken(feature.throwType);
        const selectedThrowType = normalizeToken(filterThrowType);
        const featureLocation = (feature.location ?? "").trim();
        const featurePosition = normalizePosition(feature.position);

        if (filterGrenadeType && featureGrenadeType !== selectedGrenadeType) {
          return false;
        }

        if (filterMap && featureMap !== selectedMap) {
          return false;
        }

        if (filterObjective && featureObjective !== selectedObjective) {
          return false;
        }

        if (filterDifficulty && featureDifficulty !== selectedDifficulty) {
          return false;
        }

        if (filterThrowType && featureThrowType !== selectedThrowType) {
          return false;
        }

        if (filterLocation && featureLocation !== filterLocation) {
          return false;
        }

        if (filterPosition && featurePosition !== filterPosition) {
          return false;
        }

        return true;
      }),
    [
      features,
      filterDifficulty,
      filterGrenadeType,
      filterLocation,
      filterMap,
      filterObjective,
      filterPosition,
      filterThrowType,
    ]
  );

  const hoveredFeature = useMemo(
    () => features.find((feature) => feature.id === hoveredFeatureId) ?? null,
    [features, hoveredFeatureId]
  );

  const hoveredFeatureHasVideoPreview = useMemo(() => {
    if (!hoveredFeature) {
      return false;
    }

    return Boolean(getYouTubeHoverPreviewUrl(hoveredFeature.youtubeUrl));
  }, [hoveredFeature]);

  const hoveredFeatureImages = useMemo(() => {
    if (!hoveredFeature) {
      return [];
    }

    const imageList = hoveredFeature.imageTexts?.length
      ? hoveredFeature.imageTexts
      : [hoveredFeature.imageText ?? hoveredFeature.imageUrl ?? ""].filter(Boolean);
    const coverImageText = pickFirstNonEmptyText(hoveredFeature.coverImageText, imageList[0]);

    return Array.from(
      new Set(
        [coverImageText, ...imageList]
          .map((src) => src.trim())
          .filter((src) => src.startsWith("data:") || src.startsWith("http"))
      )
    );
  }, [hoveredFeature]);

  useEffect(() => {
    if (
      !hoveredFeatureId ||
      hoveredFeatureHasVideoPreview ||
      hoveredFeatureImages.length <= 1
    ) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setHoveredImageIndex((current) => (current + 1) % hoveredFeatureImages.length);
    }, 2000);

    return () => window.clearInterval(intervalId);
  }, [hoveredFeatureHasVideoPreview, hoveredFeatureId, hoveredFeatureImages.length]);

  const selectedMapFeatures = useMemo(
    () =>
      features.filter(
        (feature) => isSameMap(feature.map, filterMap) && feature.launchPoint && feature.impactPoint
      ),
    [features, filterMap]
  );

  const currentMapFeatures = useMemo(() => {
    if (!featureForm.map.trim()) {
      return [] as FeatureItem[];
    }

    return features.filter(
      (feature) => isSameMap(feature.map, featureForm.map) && feature.launchPoint && feature.impactPoint
    );
  }, [featureForm.map, features]);

  const currentMapLaunchPoints = useMemo(
    () => buildPointCatalog(currentMapFeatures, "launch"),
    [currentMapFeatures]
  );

  const currentMapImpactPoints = useMemo(
    () => buildPointCatalog(currentMapFeatures, "impact"),
    [currentMapFeatures]
  );

  const selectedMapEntries = useMemo(
    () => selectedMapFeatures.map(mapFeatureToGrenadeEntry),
    [selectedMapFeatures]
  );

  const currentMapEntries = useMemo(
    () => currentMapFeatures.map(mapFeatureToGrenadeEntry),
    [currentMapFeatures]
  );

  const handleImageUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) {
      return;
    }

    setProcessingImage(true);
    setFeedback("Processando imagem...");

    try {
      const incomingFiles = Array.from(files);
      const currentCount = featureForm.imageTexts.length;
      const remainingSlots = Math.max(0, 5 - currentCount);

      if (remainingSlots === 0) {
        setFeedback("Limite de 5 imagens por conteudo.");
        return;
      }

      const filesToProcess = incomingFiles.slice(0, remainingSlots);
      const compressedList = await Promise.all(filesToProcess.map((file) => compressImageToDataUrl(file)));
      const validImages = compressedList.filter((imageData) => imageData.length <= 950_000);
      const nextZoomFlags = validImages.map(() => false);

      setFeatureForm((current) => ({
        ...current,
        imageTexts: [...current.imageTexts, ...validImages].slice(0, 5),
        imageZoomEnabled: [...current.imageZoomEnabled, ...nextZoomFlags].slice(0, 5),
      }));

      if (validImages.length === 0) {
        setFeedback("As imagens selecionadas estao muito grandes. Use arquivos menores.");
      } else if (compressedList.length !== validImages.length) {
        setFeedback("Algumas imagens foram ignoradas por tamanho. As restantes estao prontas para salvar.");
      } else {
        setFeedback("Imagem pronta para salvar.");
      }
    } catch {
      setFeedback("Nao foi possivel processar a imagem.");
    } finally {
      setProcessingImage(false);
    }
  };

  const selectedMapOverviewSource = useMemo(
    () => getMapOverviewSource(filterMap),
    [filterMap]
  );

  const selectedMapFocusedFeatures = useMemo(() => {
    if (!selectedMapFocus) {
      return [] as FeatureItem[];
    }

    return selectedMapFeatures.filter((feature) => {
      const pointKey =
        selectedMapFocus.kind === "launch"
          ? getPointKey(feature.launchPoint)
          : getPointKey(feature.impactPoint);

      return pointKey === selectedMapFocus.pointKey;
    });
  }, [selectedMapFeatures, selectedMapFocus]);

  const selectedMapHoveredFeature = useMemo(
    () =>
      selectedMapFocusedFeatures.find((feature) => feature.id === selectedMapHoveredFeatureId) ?? null,
    [selectedMapFocusedFeatures, selectedMapHoveredFeatureId]
  );

  

  const selectedMapHoveredFeatureHasVideoPreview = useMemo(() => {
    if (!selectedMapHoveredFeature) {
      return false;
    }

    return Boolean(getYouTubeHoverPreviewUrl(selectedMapHoveredFeature.youtubeUrl));
  }, [selectedMapHoveredFeature]);

  const selectedMapHoveredFeatureVideoUrl = useMemo(() => {
    if (!selectedMapHoveredFeature) {
      return "";
    }

    return getYouTubeHoverPreviewUrl(selectedMapHoveredFeature.youtubeUrl);
  }, [selectedMapHoveredFeature]);

  const selectedMapHoveredFeatureImages = useMemo(() => {
    if (!selectedMapHoveredFeature) {
      return [] as string[];
    }

    const imageList = selectedMapHoveredFeature.imageTexts?.length
      ? selectedMapHoveredFeature.imageTexts
      : [selectedMapHoveredFeature.coverImageText ?? selectedMapHoveredFeature.imageText ?? selectedMapHoveredFeature.imageUrl ?? ""].filter(Boolean);
    const coverImageText = pickFirstNonEmptyText(
      selectedMapHoveredFeature.coverImageText,
      imageList[0]
    );

    return Array.from(
      new Set(
        [coverImageText, ...imageList]
          .map((src) => src.trim())
          .filter((src) => src.startsWith("data:") || src.startsWith("http"))
      )
    );
  }, [selectedMapHoveredFeature]);

  useEffect(() => {
    if (
      !selectedMapHoveredFeatureId ||
      selectedMapHoveredFeatureHasVideoPreview ||
      selectedMapHoveredFeatureImages.length <= 1
    ) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setSelectedMapHoveredImageIndex((current) => (current + 1) % selectedMapHoveredFeatureImages.length);
    }, 2000);

    return () => window.clearInterval(intervalId);
  }, [
    selectedMapHoveredFeatureHasVideoPreview,
    selectedMapHoveredFeatureId,
    selectedMapHoveredFeatureImages.length,
  ]);

  const openExpandedFeature = (featureId: string) => {
    setExpandedFeatureId(featureId);
    setActiveExpandedImageIndex(0);
  };

  const goToFeature = (featureId: string) => {
    setExpandedFeatureId(featureId);
    setActiveExpandedImageIndex(0);

    window.requestAnimationFrame(() => {
      document.getElementById(`feature-${featureId}`)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  };

  const openImageViewer = (src: string, alt: string, zoomEnabled: boolean) => {
    setImageViewer({ src, alt, zoomEnabled });
    setImageViewerZoom(2);
  };

  const closeImageViewer = () => {
    setImageViewer(null);
    setImageViewerZoom(2);
  };

  const openNewFeatureModal = () => {
    setEditingFeature(null);
    setFeatureForm(emptyFeatureForm());
    setMapSelectionMode("launch");
    setFeedback("");
    setFeatureModalOpen(true);
  };

  const openEditFeatureModal = (feature: FeatureItem) => {
    setEditingFeature(feature);
    setFeatureForm({
      title: feature.title ?? "",
      grenadeType: feature.grenadeType ?? "Smoke",
      objective: feature.objective ?? "Entry",
      difficulty: feature.difficulty ?? "Facil",
      throwType: feature.throwType ?? "Parado",
      map: feature.map ?? "",
      location: feature.location ?? "",
      position: normalizePosition(feature.position) || "Respawn",
      teleportCommand: feature.teleportCommand ?? "",
      launchPoint: normalizeMapPoint(feature.launchPoint),
      impactPoint: normalizeMapPoint(feature.impactPoint),
      description: feature.description ?? "",
      coverImageText: pickFirstNonEmptyText(
        feature.coverImageText,
        feature.imageTexts?.[0],
        feature.imageText,
        feature.imageUrl
      ),
      imageTexts: feature.imageTexts?.filter(Boolean) ?? [feature.imageText ?? feature.imageUrl ?? ""].filter(Boolean),
      imageZoomEnabled: (feature.imageTexts?.filter(Boolean) ?? [feature.imageText ?? feature.imageUrl ?? ""].filter(Boolean)).map(
        (_, index) => feature.imageZoomEnabled?.[index] ?? false
      ),
      youtubeUrl: feature.youtubeUrl ?? "",
    });
    setMapSelectionMode("launch");
    setFeedback("");
    setFeatureModalOpen(true);
  };

  const closeFeatureModal = () => {
    setFeatureModalOpen(false);
    setEditingFeature(null);
    setFeatureForm(emptyFeatureForm());
    setMapSelectionMode("launch");
  };

  const submitFeature = async (event: FormEvent) => {
    event.preventDefault();

    if (!db || !user || !canAddFeature) {
      setFeedback(`Voce nao tem permissao para adicionar ${copy.plural}.`);
      return;
    }

    const isGranadas = category === "granadas";

    if (
      !featureForm.title.trim() ||
      !featureForm.map.trim() ||
      (isGranadas && !featureForm.grenadeType.trim())
    ) {
      setFeedback(
        isGranadas ? "Preencha nome, tipo e mapa." : "Preencha nome e mapa."
      );
      return;
    }

    if (isGranadas && !editingFeature && (!featureForm.launchPoint || !featureForm.impactPoint)) {
      setFeedback("Marque os pontos de lancamento e impacto no mapa antes de salvar.");
      return;
    }

    setSaving(true);

    try {
      const payload = {
        category,
        title: featureForm.title.trim(),
        grenadeType: featureForm.grenadeType.trim(),
        objective: featureForm.objective.trim(),
        difficulty: featureForm.difficulty.trim(),
        throwType: featureForm.throwType.trim(),
        map: featureForm.map.trim(),
        location: featureForm.location.trim(),
        position: featureForm.position.trim(),
        teleportCommand: featureForm.teleportCommand.trim(),
        launchPoint: featureForm.launchPoint ?? null,
        impactPoint: featureForm.impactPoint ?? null,
        description: featureForm.description.trim(),
        coverImageText: featureForm.coverImageText.trim(),
        imageTexts: featureForm.imageTexts,
        imageZoomEnabled: featureForm.imageTexts.map((_, index) => featureForm.imageZoomEnabled[index] ?? false),
        imageText: pickFirstNonEmptyText(featureForm.imageTexts[0], featureForm.coverImageText),
        youtubeUrl: featureForm.youtubeUrl.trim(),
        updatedAt: serverTimestamp(),
      };

      if (editingFeature) {
        await updateDoc(doc(db, "features", editingFeature.id), payload);
        closeFeatureModal();
        setFeedback(`${copy.singularTitle} atualizada com sucesso.`);
      } else {
        await addDoc(collection(db, "features"), {
          ...payload,
          createdBy: user.uid,
          createdByName: profile?.displayName ?? user.displayName ?? user.email ?? "jogador",
          createdAt: serverTimestamp(),
        });
        closeFeatureModal();
        setFeedback(`${copy.singularTitle} adicionada com sucesso.`);
      }
    } catch (error) {
      const code = (error as { code?: string } | null)?.code ?? "";
      const message = (error as { message?: string } | null)?.message ?? "";
      if (code.includes("permission-denied")) {
        setFeedback(`Sem permissao no Firestore para salvar ${copy.singular}. Verifique seu papel (admin/owner) e as regras publicadas.`);
      } else if (message) {
        setFeedback(`Erro ao salvar ${copy.singular}: ${message}`);
      } else {
        setFeedback(`Nao foi possivel salvar ${copy.singular}.`);
      }
    } finally {
      setSaving(false);
    }
  };

  const deleteFeature = async (featureId: string) => {
    if (!db || !canAddFeature) {
      return;
    }

    setSaving(true);

    try {
      await deleteDoc(doc(db, "features", featureId));
      setFeedback(`${copy.singularTitle} excluida com sucesso.`);
    } catch (error) {
      const code = (error as { code?: string } | null)?.code ?? "";
      if (code.includes("permission-denied")) {
        setFeedback(`Sem permissao para excluir ${copy.singular}.`);
      } else {
        setFeedback(`Nao foi possivel excluir ${copy.singular}.`);
      }
    } finally {
      setSaving(false);
    }
  };

  const copyToClipboard = async (value: string, key: string) => {
    if (!value.trim()) {
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      setCopiedCommandKey(key);
      window.setTimeout(() => {
        setCopiedCommandKey((current) => (current === key ? "" : current));
      }, 1500);
    } catch {
      setFeedback("Nao foi possivel copiar o comando.");
    }
  };

  const submitComment = async (event: FormEvent, featureId: string) => {
    event.preventDefault();

    if (!db || !user) {
      setFeedback("Faca login para comentar.");
      return;
    }

    const text = (commentDrafts[featureId] ?? "").trim();
    if (!text) {
      return;
    }

    setSaving(true);

    try {
      await addDoc(collection(db, "comments"), {
        featureId,
        uid: user.uid,
        userName: profile?.displayName ?? user.displayName ?? user.email ?? "jogador",
        text,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setCommentDrafts((current) => ({ ...current, [featureId]: "" }));
      setFeedback("Comentario publicado.");
    } catch {
      setFeedback("Nao foi possivel publicar comentario.");
    } finally {
      setSaving(false);
    }
  };

  const saveCommentEdit = async () => {
    if (!db || !editingComment) {
      return;
    }

    if (!editingCommentText.trim()) {
      setFeedback("O comentario nao pode ficar vazio.");
      return;
    }

    setSaving(true);

    try {
      await updateDoc(doc(db, "comments", editingComment.id), {
        text: editingCommentText.trim(),
        updatedAt: serverTimestamp(),
      });
      setEditingComment(null);
      setEditingCommentText("");
      setFeedback("Comentario atualizado.");
    } catch {
      setFeedback("Nao foi possivel atualizar o comentario.");
    } finally {
      setSaving(false);
    }
  };

  const deleteComment = async (commentId: string) => {
    if (!db) {
      return;
    }

    setSaving(true);

    try {
      await deleteDoc(doc(db, "comments", commentId));
      setFeedback("Comentario removido.");
    } catch {
      setFeedback("Nao foi possivel remover o comentario.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-400 px-3 pb-12 text-slate-100 sm:px-4 lg:px-6">
      {showHero && (
        <section className="rounded-3xl border border-slate-700/70 bg-slate-950/70 p-6 shadow-[0_28px_65px_rgba(0,0,0,.45)] md:p-10">
          <p className="mb-3 inline-flex rounded-full border border-orange-300/35 px-3 py-1 text-xs uppercase tracking-[0.14em] text-orange-300">
            {badge}
          </p>
          <h1 className="text-3xl font-bold uppercase tracking-tight text-white md:text-5xl">
            {title}
          </h1>
          <p className="mt-4 max-w-4xl text-slate-300 md:text-lg">{intro}</p>

          <div className="mt-6 rounded-2xl border border-slate-700 bg-slate-800/65 p-5">
            <ul className="space-y-2 text-sm text-slate-200 md:text-base">
              {points.map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-orange-300" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {feedback && (
        <p className="mt-4 rounded-xl border border-slate-700 bg-slate-900/75 px-4 py-3 text-sm text-slate-300">
          {feedback}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
        {canAddFeature && (
          <button
            type="button"
            onClick={openNewFeatureModal}
            className="rounded-lg border border-orange-300/45 bg-linear-to-r from-orange-400 to-orange-300 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:scale-[1.01]"
          >
            {`Adicionar ${copy.singular}`}
          </button>
        )}
      </div>

      <section className="mt-4">
        <div className="grid items-start gap-4 lg:grid-cols-[280px_1fr]">
          <aside className="rounded-2xl border border-slate-700 bg-slate-900/75 p-4 shadow-[0_10px_20px_rgba(0,0,0,.2)] md:p-5 lg:sticky lg:top-6">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold uppercase tracking-[0.08em] text-slate-200">
                Filtros
              </p>
              <button
                type="button"
                onClick={() => setMobileFiltersOpen((current) => !current)}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-500 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-100 transition hover:border-slate-300 lg:hidden"
                aria-expanded={mobileFiltersOpen}
                aria-controls="feature-filters-mobile"
              >
                {mobileFiltersOpen ? "Fechar" : "Abrir"}
              </button>
            </div>

            <div
              id="feature-filters-mobile"
              className={`${mobileFiltersOpen ? "mt-3 grid" : "hidden"} grid-cols-1 gap-3 lg:mt-3 lg:grid`}
            >
              <button
                type="button"
                onClick={() => {
                  setFilterGrenadeType("");
                  syncMapFilterToUrl("");
                  setFilterObjective("");
                  setFilterDifficulty("");
                  setFilterThrowType("");
                  setFilterLocation("");
                  setFilterPosition("");
                }}
                className="w-full rounded-lg border border-orange-300/40 bg-orange-400/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-orange-200 transition hover:bg-orange-400/20"
              >
                Limpar filtros
              </button>

              {isGranadasCategory && (
                <details className="group rounded-xl border border-slate-700 bg-slate-950/55 p-3">
                  <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-slate-200">
                    <span>Mapa</span>
                    <svg
                      viewBox="0 0 20 20"
                      className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </summary>
                  <div className="mt-3 grid grid-cols-1 gap-2">
                    {filterOptions.maps.map((option) => {
                      const active = isSameMap(filterMap, option.value);
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => syncMapFilterToUrl(active ? "" : option.value)}
                          className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-left text-xs font-semibold transition ${
                            active
                              ? "border-orange-300 bg-orange-300/15 text-orange-100"
                              : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500"
                          }`}
                        >
                          <IconWithFallback
                            candidates={getMapIconCandidates(option.value)}
                            alt={`Mapa ${option.label}`}
                            className="h-5 w-5 shrink-0 object-contain"
                          />
                          <span>{option.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </details>
              )}

              {isGranadasCategory && (
                <details className="group rounded-xl border border-slate-700 bg-slate-950/55 p-3">
                  <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-slate-200">
                    <span>Tipo de granada</span>
                    <svg
                      viewBox="0 0 20 20"
                      className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </summary>
                  <div className="mt-3 grid grid-cols-1 gap-2">
                    {filterOptions.grenadeTypes.map((option) => {
                      const active = canonicalGrenadeType(filterGrenadeType) === canonicalGrenadeType(option);
                      return (
                        <button
                          key={option}
                          type="button"
                          onClick={() => setFilterGrenadeType(active ? "" : option)}
                          className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-left text-xs font-semibold transition ${
                            active
                              ? "border-cyan-300 bg-cyan-300/12 text-cyan-100"
                              : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500"
                          }`}
                        >
                          <IconWithFallback
                            candidates={getGrenadeTypeIconCandidates(option)}
                            alt={`Tipo ${option}`}
                            className="h-5 w-5 shrink-0 object-contain"
                          />
                          <span>{option}</span>
                        </button>
                      );
                    })}
                  </div>
                </details>
              )}

              {isGranadasCategory && (
                <details className="group rounded-xl border border-slate-700 bg-slate-950/55 p-3">
                  <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-slate-200">
                    <span>Objetivo</span>
                    <svg
                      viewBox="0 0 20 20"
                      className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </summary>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {filterOptions.objectives.map((option) => {
                      const active = normalizeToken(filterObjective) === normalizeToken(option);
                      return (
                        <button
                          key={option}
                          type="button"
                          onClick={() => setFilterObjective(active ? "" : option)}
                          className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                            active
                              ? "border-emerald-300 bg-emerald-300/15 text-emerald-100"
                              : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500"
                          }`}
                        >
                          {option}
                        </button>
                      );
                    })}
                  </div>
                </details>
              )}

              {isGranadasCategory && (
                <details className="group rounded-xl border border-slate-700 bg-slate-950/55 p-3">
                  <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-slate-200">
                    <span>Dificuldade</span>
                    <svg
                      viewBox="0 0 20 20"
                      className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </summary>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {filterOptions.difficulties.map((option) => {
                      const active = normalizeToken(filterDifficulty) === normalizeToken(option);
                      return (
                        <button
                          key={option}
                          type="button"
                          onClick={() => setFilterDifficulty(active ? "" : option)}
                          className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${getDifficultyOptionClasses(option, active)}`}
                        >
                          {option}
                        </button>
                      );
                    })}
                  </div>
                </details>
              )}

              {isGranadasCategory && (
                <details className="group rounded-xl border border-slate-700 bg-slate-950/55 p-3">
                  <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-slate-200">
                    <span>Tipo de lancamento</span>
                    <svg
                      viewBox="0 0 20 20"
                      className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </summary>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {filterOptions.throwTypes.map((option) => {
                      const active = normalizeToken(filterThrowType) === normalizeToken(option);
                      return (
                        <button
                          key={option}
                          type="button"
                          onClick={() => setFilterThrowType(active ? "" : option)}
                          className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                            active
                              ? "border-violet-300 bg-violet-300/15 text-violet-100"
                              : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500"
                          }`}
                        >
                          {option}
                        </button>
                      );
                    })}
                  </div>
                </details>
              )}

              <details className="group rounded-xl border border-slate-700 bg-slate-950/55 p-3">
                <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-slate-200">
                  <span>Local do impacto</span>
                  <svg
                    viewBox="0 0 20 20"
                    className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </summary>
                <div className="mt-3 space-y-2 text-xs text-slate-400">
                  <p>
                    {filterMap
                      ? "Lista carregada com base no mapa selecionado."
                      : "Selecione um mapa primeiro para habilitar os locais."}
                  </p>
                  <select
                    className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none disabled:cursor-not-allowed disabled:opacity-60"
                    value={filterLocation}
                    onChange={(event) => setFilterLocation(event.target.value)}
                    disabled={!filterMap}
                  >
                    <option value="">Todos</option>
                    {filterOptions.locations.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
              </details>
            </div>
          </aside>

          <div>
            {isGranadasCategory && (
              <section
                ref={selectedMapSectionRef}
                className="mb-6 rounded-3xl border border-slate-700/70 bg-slate-950/75 p-4 shadow-[0_18px_40px_rgba(0,0,0,.28)] md:p-5"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-orange-300">Mapa tatico</p>
                    <h2 className="mt-1 text-xl font-semibold text-white md:text-2xl">
                      {filterMap ? `Granadas de ${filterMap}` : "Selecione um mapa para visualizar os pontos"}
                    </h2>
                    <p className="mt-2 max-w-3xl text-sm text-slate-400 md:text-base">
                      {filterMap
                        ? `${selectedMapFeatures.length} granadas com pontos registrados neste mapa. Clique nos pontos para alternar entre lancamentos e impactos relacionados.`
                        : "Use o filtro de mapa na lateral ou no cadastro para abrir o overview e destacar os pontos cadastrados."}
                    </p>
                  </div>

                  {selectedMapFocus && (
                    <button
                      type="button"
                      onClick={() => setSelectedMapFocus(null)}
                      className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm font-semibold text-slate-100 transition hover:border-slate-300"
                    >
                      Limpar selecao
                    </button>
                  )}
                </div>

                {filterMap ? (
                  <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
                    <GrenadeMapScene
                      mapSrc={selectedMapOverviewSource}
                      mapAlt={`Mapa ${filterMap}`}
                      entries={selectedMapEntries}
                      activeFocus={selectedMapFocus}
                      revealMode="public"
                      onLaunchClick={(entry) => {
                        if (!entry.launchPoint) {
                          return;
                        }

                        setSelectedMapFocus({
                          kind: "launch",
                          pointKey: getPointKey(entry.launchPoint),
                        });
                      }}
                      onImpactClick={(entry) => {
                        if (!entry.impactPoint) {
                          return;
                        }

                        setSelectedMapFocus({
                          kind: "impact",
                          pointKey: getPointKey(entry.impactPoint),
                        });
                      }}
                      onBackgroundClick={() => setSelectedMapFocus(null)}
                      className="min-w-0"
                    />

                    <div className="rounded-2xl border border-slate-700 bg-slate-900/65 p-4">
                      {!selectedMapFocus ? (
                        <div className="flex min-h-48 items-center justify-center rounded-xl border border-dashed border-slate-700 bg-slate-950/40 px-4 text-sm text-slate-400">
                          Selecione um ponto no mapa para ver as granadas relacionadas.
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {selectedMapFocusedFeatures.length === 0 ? (
                            <p className="text-sm text-slate-400">Nenhuma granada encontrada para este ponto.</p>
                          ) : (
                            selectedMapFocusedFeatures.map((feature) => {
                              const isHovered = selectedMapHoveredFeatureId === feature.id;

                              return (
                                <button
                                  key={feature.id}
                                  type="button"
                                  className="relative group w-full rounded-xl border border-slate-700 bg-slate-950/75 p-3 text-left transition hover:border-orange-300 hover:bg-slate-900"
                                  onMouseEnter={() => {
                                    setSelectedMapHoveredFeatureId(feature.id);
                                    setSelectedMapHoveredImageIndex(0);
                                  }}
                                  onMouseLeave={() => {
                                    setSelectedMapHoveredFeatureId((current) => (current === feature.id ? null : current));
                                    setSelectedMapHoveredImageIndex(0);
                                  }}
                                  onClick={() => goToFeature(feature.id)}
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0 space-y-1">
                                      <p className="text-sm font-semibold uppercase tracking-[0.04em] text-white">
                                        {feature.title}
                                      </p>
                                    </div>

                                    <span className="shrink-0 rounded-full border border-slate-700 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-300 transition group-hover:border-orange-300 group-hover:text-orange-200">
                                      Abrir
                                    </span>
                                  </div>

                                  {isHovered && (
                                    <div className="pointer-events-none absolute left-1/2 top-0 z-40 w-[min(72vw,18rem)] -translate-x-1/2 -translate-y-[calc(100%+0.6rem)] overflow-hidden rounded-2xl border border-slate-700 bg-slate-950/95 shadow-[0_24px_60px_rgba(0,0,0,.45)]">
                                      <div className="border-b border-slate-700 bg-slate-900/80 px-3 py-2">
                                        <p className="text-xs uppercase tracking-[0.14em] text-orange-300">Preview da granada</p>
                                        <p className="mt-1 text-sm font-semibold text-white">{feature.title}</p>
                                      </div>

                                      <div className="relative aspect-video bg-slate-950">
                                        {selectedMapHoveredFeatureVideoUrl ? (
                                          <iframe
                                            className="h-full w-full"
                                            src={selectedMapHoveredFeatureVideoUrl}
                                            title={`${feature.title} preview`}
                                            allow="autoplay; encrypted-media; picture-in-picture"
                                            allowFullScreen
                                            onLoad={(event) => {
                                              const targetWindow = event.currentTarget.contentWindow;
                                              sendYouTubePlaybackCommands(targetWindow, 1.5);
                                              for (let attempt = 1; attempt <= 6; attempt += 1) {
                                                window.setTimeout(() => {
                                                  sendYouTubePlaybackCommands(targetWindow, 1.5);
                                                }, attempt * 300);
                                              }
                                            }}
                                          />
                                        ) : selectedMapHoveredFeatureImages.length > 0 ? (
                                          <>
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img
                                              src={
                                                selectedMapHoveredFeatureImages[
                                                  selectedMapHoveredImageIndex % selectedMapHoveredFeatureImages.length
                                                ]
                                              }
                                              alt={feature.title}
                                              className="h-full w-full object-cover"
                                            />
                                            {selectedMapHoveredFeatureImages.length > 1 && (
                                              <div className="absolute bottom-2 right-2 rounded-full border border-slate-700 bg-slate-950/80 px-2 py-0.5 text-[10px] text-slate-300">
                                                {selectedMapHoveredImageIndex % selectedMapHoveredFeatureImages.length + 1}/
                                                {selectedMapHoveredFeatureImages.length}
                                              </div>
                                            )}
                                          </>
                                        ) : (
                                          <div className="flex h-full w-full items-center justify-center text-sm text-slate-400">
                                            Sem preview disponivel
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </button>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="mt-5 rounded-2xl border border-dashed border-slate-700 bg-slate-900/55 p-5 text-sm text-slate-400">
                    Selecione um mapa no filtro lateral para carregar o overview e exibir os pontos cadastrados.
                  </div>
                )}
              </section>
            )}

        {filteredFeatures.length === 0 ? (
          <div className="rounded-2xl border border-slate-700 bg-slate-900/75 p-6 text-slate-300">
            {`Nenhuma ${copy.singular} encontrada com esses filtros. `}
            {canAddFeature ? "Use o botão acima para criar a primeira." : "Aguarde novas publicações."}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4 items-start">
            {filteredFeatures.map((feature) => {
            const commentsForFeature = featureComments[feature.id] ?? [];
            const imageList = feature.imageTexts?.length
              ? feature.imageTexts
              : [feature.imageText ?? feature.imageUrl ?? ""].filter(Boolean);
            const coverImageText = pickFirstNonEmptyText(feature.coverImageText, imageList[0]);
            const embedUrl = getYouTubeEmbedUrl(feature.youtubeUrl);
            const videoThumbnailUrl = getYouTubeThumbnailUrl(feature.youtubeUrl);
            const renderableImage = coverImageText.startsWith("data:") || coverImageText.startsWith("http")
              ? coverImageText
              : "";
            const isExpanded = expandedFeatureId === feature.id;
            const featureTitleSizeClass = getFeatureTitleSizeClass(feature.title, !isExpanded);
            const grenadeTypeIconCandidates = getGrenadeTypeIconCandidates(feature.grenadeType);
            const mapIconCandidates = getMapIconCandidates(feature.map);
            const videoHoverPreviewUrl = getYouTubeHoverPreviewUrl(feature.youtubeUrl);
            const showVideoHoverPreview = !isExpanded && hoveredFeatureId === feature.id && Boolean(videoHoverPreviewUrl);

              const compactCardImageSources = Array.from(
                new Set(
                  [
                    { src: coverImageText, zoomEnabled: false },
                    ...imageList.map((src, index) => ({
                      src: src.trim(),
                      zoomEnabled: feature.imageZoomEnabled?.[index] !== false,
                    })),
                  ]
                    .filter(({ src }) => src.startsWith("data:") || src.startsWith("http"))
                    .sort((left, right) => Number(left.zoomEnabled) - Number(right.zoomEnabled))
                    .map(({ src }) => src.trim())
                )
              );

              const mediaImageSources = Array.from(
                new Set(
                  [coverImageText, ...imageList]
                    .map((src) => src.trim())
                    .filter((src) => src.startsWith("data:") || src.startsWith("http"))
                )
              );
              const modalImageSources = Array.from(
                new Set(
                  imageList
                    .map((src) => src.trim())
                    .filter((src) => src.startsWith("data:") || src.startsWith("http"))
                )
              );

              const mediaItems = [
                ...modalImageSources.map((src, index) => ({
                  type: "image" as const,
                  src,
                  label: "Imagem",
                  zoomEnabled: feature.imageZoomEnabled?.[index] !== false,
                })),
                ...(embedUrl
                  ? [
                      {
                        type: "video" as const,
                        src: embedUrl,
                        thumbnail: videoThumbnailUrl,
                        label: "Video",
                      },
                    ]
                  : []),
              ];

              const safeMediaIndex = mediaItems.length
                ? Math.min(activeExpandedImageIndex, mediaItems.length - 1)
                : 0;
              const activeMediaItem = mediaItems[safeMediaIndex] ?? null;
              const activeExpandedVideoId = activeMediaItem?.type === "video" ? getYouTubeVideoId(activeMediaItem.src) : "";
              const hasMultipleMedia = mediaItems.length > 1;
              const showImageHoverSlideshow =
                !isExpanded &&
                hoveredFeatureId === feature.id &&
                !videoHoverPreviewUrl &&
                mediaImageSources.length > 1;
              const compactCardCoverSources = compactCardImageSources.slice(0, 2);
              const compactCardImage = showImageHoverSlideshow
                ? compactCardImageSources[hoveredImageIndex % compactCardImageSources.length]
                : compactCardImageSources[0] ?? renderableImage;

            const goToPreviousImage = () => {
                if (!mediaItems.length) {
                return;
              }

              setActiveExpandedImageIndex((current) =>
                  current === 0 ? mediaItems.length - 1 : current - 1
              );
            };

            const goToNextImage = () => {
                if (!mediaItems.length) {
                return;
              }

              setActiveExpandedImageIndex((current) =>
                  current >= mediaItems.length - 1 ? 0 : current + 1
              );
            };

            return (
              <article
                key={feature.id}
                id={`feature-${feature.id}`}
                className={`relative rounded-2xl border border-slate-700/70 bg-slate-900/75 p-4 shadow-[0_10px_20px_rgba(0,0,0,.2)] md:p-5 ${
                  isExpanded ? "order-first col-span-full z-30" : "z-0"
                }`}
              >
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => openExpandedFeature(feature.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openExpandedFeature(feature.id);
                    }
                  }}
                  className="flex w-full flex-col gap-3 text-left outline-none"
                >
                  <div className="flex w-full items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-700 bg-slate-800/80">
                            <IconWithFallback
                              candidates={grenadeTypeIconCandidates}
                              alt={feature.grenadeType ? `Tipo ${feature.grenadeType}` : "Tipo"}
                              className="h-6 w-6 shrink-0 object-contain"
                            />
                          </div>
                          <h2
                            className={`max-w-full truncate whitespace-nowrap font-semibold uppercase leading-tight text-white ${featureTitleSizeClass}`}
                            title={feature.title}
                          >
                            {feature.title}
                          </h2>
                        </div>
                        {isExpanded && (
                          <span className="rounded-full border border-slate-700 px-2.5 py-1 text-xs text-slate-400">
                            Card expandido
                          </span>
                        )}
                      </div>

                      {!isExpanded && canAddFeature && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              openEditFeatureModal(feature);
                            }}
                            className="rounded-md border border-slate-500 px-2.5 py-1 text-xs font-semibold text-slate-200 transition hover:border-slate-300"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              if (window.confirm(`Deseja excluir esta ${copy.singular}?`)) {
                                void deleteFeature(feature.id);
                              }
                            }}
                            className="rounded-md border border-red-500/50 px-2.5 py-1 text-xs font-semibold text-red-200 transition hover:border-red-300"
                          >
                            Excluir
                          </button>
                        </div>
                      )}
                    </div>

                    {isExpanded && (
                      <div className="flex flex-wrap gap-2">
                        {canAddFeature && (
                        <>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              openEditFeatureModal(feature);
                            }}
                            className="rounded-md border border-slate-500 px-2.5 py-1 text-xs font-semibold text-slate-200 transition hover:border-slate-300"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              if (window.confirm(`Deseja excluir esta ${copy.singular}?`)) {
                                void deleteFeature(feature.id);
                              }
                            }}
                            className="rounded-md border border-red-500/50 px-2.5 py-1 text-xs font-semibold text-red-200 transition hover:border-red-300"
                          >
                            Excluir
                          </button>
                        </>
                        )}
                      </div>
                    )}
                  </div>

                  {!isExpanded && (
                    <div className="flex w-full flex-col gap-3">
                      <div
                        className="-mx-4 aspect-video w-[calc(100%+2rem)] overflow-hidden border border-slate-700 bg-slate-950/60 md:-mx-5 md:w-[calc(100%+2.5rem)]"
                        onMouseEnter={() => {
                          setHoveredFeatureId(feature.id);
                          setHoveredImageIndex(0);
                        }}
                        onMouseLeave={() => {
                          setHoveredFeatureId((current) => (current === feature.id ? null : current));
                          setHoveredImageIndex(0);
                        }}
                      >
                        {showVideoHoverPreview ? (
                          <iframe
                            className="h-full w-full"
                            src={videoHoverPreviewUrl}
                            title={`${feature.title} preview`}
                            allow="autoplay; encrypted-media; picture-in-picture"
                            allowFullScreen
                            onLoad={(event) => {
                              const targetWindow = event.currentTarget.contentWindow;
                              sendYouTubePlaybackCommands(targetWindow, 1.5);
                              for (let attempt = 1; attempt <= 6; attempt += 1) {
                                window.setTimeout(() => {
                                  sendYouTubePlaybackCommands(targetWindow, 1.5);
                                }, attempt * 300);
                              }
                            }}
                          />
                        ) : compactCardImage ? (
                          showImageHoverSlideshow ? (
                            <>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={compactCardImage}
                                alt={feature.title}
                                className="h-full w-full object-cover"
                              />
                            </>
                          ) : compactCardCoverSources.length >= 2 ? (
                            <div className="flex h-full w-full">
                              {compactCardCoverSources.map((src, index) => (
                                <div key={`${feature.id}-cover-${index}`} className="h-full w-1/2 overflow-hidden">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={src}
                                    alt={`${feature.title} capa ${index + 1}`}
                                    className="h-full w-full object-cover object-center"
                                  />
                                </div>
                              ))}
                            </div>
                          ) : (
                            <>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={compactCardImage}
                                alt={feature.title}
                                className="h-full w-full object-cover"
                              />
                            </>
                          )
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[10px] text-slate-500">
                            Sem capa
                          </div>
                        )}
                      </div>

                      {feature.map && (
                        <div className="flex min-h-6 items-center gap-2 text-sm text-slate-300">
                          <IconWithFallback
                            candidates={mapIconCandidates}
                            alt={`Mapa ${feature.map}`}
                            className="h-5 w-5 shrink-0 object-contain"
                          />
                          <span className="truncate">{feature.map}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {isExpanded && (
                    <div className="flex flex-wrap gap-2 text-xs text-slate-400">
                      <span className="rounded-full border border-slate-700 px-2.5 py-1">
                        Criado por {feature.createdByName ?? feature.createdBy}
                      </span>
                      {feature.grenadeType && (
                        <span className="rounded-full border border-slate-700 px-2.5 py-1">
                          Tipo: {feature.grenadeType}
                        </span>
                      )}
                      {feature.objective && (
                        <span className="rounded-full border border-slate-700 px-2.5 py-1">
                          Objetivo: {feature.objective}
                        </span>
                      )}
                      {feature.difficulty && (
                        <span className="rounded-full border border-slate-700 px-2.5 py-1">
                          Dificuldade: {feature.difficulty}
                        </span>
                      )}
                      {feature.throwType && (
                        <span className="rounded-full border border-slate-700 px-2.5 py-1">
                          Lancamento: {feature.throwType}
                        </span>
                      )}
                      {feature.map && (
                        <span className="rounded-full border border-slate-700 px-2.5 py-1">
                          Mapa: {feature.map}
                        </span>
                      )}
                      {feature.position && (
                        <span className="rounded-full border border-slate-700 px-2.5 py-1">
                          Posicao: {normalizePosition(feature.position)}
                        </span>
                      )}
                      {feature.location && (
                        <span className="rounded-full border border-slate-700 px-2.5 py-1">
                          Local: {feature.location}
                        </span>
                      )}
                      {feature.launchPoint && (
                        <span className="rounded-full border border-emerald-400/35 px-2.5 py-1 text-emerald-100">
                          Lançamento: {formatMapPoint(feature.launchPoint)}
                        </span>
                      )}
                      {feature.impactPoint && (
                        <span className="rounded-full border border-orange-400/35 px-2.5 py-1 text-orange-100">
                          Impacto: {formatMapPoint(feature.impactPoint)}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {isExpanded && (
                  <div className="mt-5 space-y-5">
                    <div>
                      {activeMediaItem ? (
                        <div className="grid gap-3 lg:grid-cols-[1fr_160px] lg:items-start">
                          <div className="relative overflow-hidden rounded-xl border border-slate-700 bg-slate-950/60">
                            {activeMediaItem.type === "image" ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() =>
                                    openImageViewer(
                                      activeMediaItem.src,
                                      feature.title,
                                      activeMediaItem.type === "image"
                                        ? activeMediaItem.zoomEnabled !== false
                                        : false
                                    )
                                  }
                                  className="block w-full"
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={activeMediaItem.src}
                                    alt={feature.title}
                                    className="aspect-video h-auto w-full cursor-zoom-in object-cover"
                                  />
                                </button>

                                {activeMediaItem.type === "image" && activeMediaItem.zoomEnabled !== false && (
                                  <div className="absolute bottom-3 left-3 z-20">
                                    <ZoomSlider
                                      value={imageViewerZoom}
                                      onChange={setImageViewerZoom}
                                      label="Zoom"
                                      hint="Na página"
                                      className="w-[min(72vw,26rem)]"
                                    />
                                  </div>
                                )}

                                {activeMediaItem.type === "image" && activeMediaItem.zoomEnabled !== false && (
                                  <ZoomLens
                                    src={activeMediaItem.src}
                                    alt={feature.title}
                                    zoom={imageViewerZoom}
                                    className="h-44 w-44 md:h-76 md:w-76"
                                  />
                                )}
                              </>
                            ) : activeExpandedVideoId ? (
                              <YouTubeExpandedPlayer videoId={activeExpandedVideoId} />
                            ) : null}

                            {hasMultipleMedia && (
                              <>
                                <button
                                  type="button"
                                  onClick={goToPreviousImage}
                                  className="absolute left-3 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-slate-700 bg-slate-950/80 text-2xl leading-none font-semibold text-slate-100 shadow-lg transition hover:border-slate-300 hover:bg-slate-900"
                                  aria-label="Imagem anterior"
                                >
                                  <svg
                                    viewBox="0 0 24 24"
                                    className="h-6 w-6"
                                    fill="none"
                                    xmlns="http://www.w3.org/2000/svg"
                                    aria-hidden="true"
                                  >
                                    <path
                                      d="M15 6L9 12L15 18"
                                      stroke="currentColor"
                                      strokeWidth="2.5"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                </button>
                                <button
                                  type="button"
                                  onClick={goToNextImage}
                                  className="absolute right-3 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-slate-700 bg-slate-950/80 text-2xl leading-none font-semibold text-slate-100 shadow-lg transition hover:border-slate-300 hover:bg-slate-900"
                                  aria-label="Próxima imagem"
                                >
                                  <svg
                                    viewBox="0 0 24 24"
                                    className="h-6 w-6"
                                    fill="none"
                                    xmlns="http://www.w3.org/2000/svg"
                                    aria-hidden="true"
                                  >
                                    <path
                                      d="M9 6L15 12L9 18"
                                      stroke="currentColor"
                                      strokeWidth="2.5"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                </button>
                                <div className="absolute bottom-3 right-3 rounded-full border border-slate-700 bg-slate-950/80 px-2.5 py-1 text-[11px] text-slate-300">
                                  {safeMediaIndex + 1}/{mediaItems.length}
                                </div>
                              </>
                            )}
                          </div>

                          {hasMultipleMedia && (
                            <div className="flex gap-2 overflow-x-auto pb-1 lg:max-h-130 lg:flex-col lg:overflow-y-auto lg:overflow-x-hidden lg:pr-1">
                              {mediaItems.map((media, index) => (
                                <button
                                  key={`${feature.id}-thumb-${media.type}-${index}`}
                                  type="button"
                                  onClick={() => setActiveExpandedImageIndex(index)}
                                  className={`shrink-0 overflow-hidden rounded-lg border transition ${
                                    safeMediaIndex === index
                                      ? "border-orange-300"
                                      : "border-slate-700"
                                  }`}
                                >
                                  {media.type === "image" ? (
                                    <>
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img
                                        src={media.src}
                                        alt={`${feature.title} ${index + 1}`}
                                        className="aspect-video w-32 object-cover md:w-40 lg:w-full"
                                      />
                                    </>
                                  ) : media.thumbnail ? (
                                    <div className="relative">
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img
                                        src={media.thumbnail}
                                        alt={`${feature.title} video`}
                                        className="aspect-video w-32 object-cover md:w-40 lg:w-full"
                                      />
                                      <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-2xl text-white/95">
                                        ▶
                                      </span>
                                    </div>
                                  ) : (
                                    <div className="flex aspect-video w-32 items-center justify-center bg-slate-900 text-xs font-semibold text-slate-200 md:w-40 lg:w-full">
                                      Video
                                    </div>
                                  )}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="flex aspect-video w-full items-center justify-center rounded-xl border border-dashed border-slate-700 bg-slate-950/60 text-sm text-slate-500">
                          Sem imagem de capa cadastrada
                        </div>
                      )}
                    </div>

                    <div>
                      {isGranadasCategory ? (
                        <div className="rounded-xl border border-slate-700 bg-slate-950/70 p-4 text-sm text-slate-300 md:text-base">
                          <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Tipo de lançamento</p>
                          <p className="mt-2 font-semibold text-white">
                            {feature.throwType ? feature.throwType : "Não informado"}
                          </p>
                        </div>
                      ) : (
                        <p className="text-sm text-slate-300 md:text-base">{feature.description}</p>
                      )}

                      {feature.teleportCommand && (
                        <div className="mt-4 rounded-xl border border-slate-700 bg-slate-950/70 p-3">
                          <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Comando de teleporte</p>
                          <div className="mt-2 flex flex-wrap items-center gap-3">
                            <button
                              type="button"
                              onClick={() => void copyToClipboard(feature.teleportCommand ?? "", feature.id)}
                              className="max-w-full truncate text-left text-sm text-orange-300 underline decoration-orange-300/60 underline-offset-4"
                            >
                              {feature.teleportCommand}
                            </button>
                            <button
                              type="button"
                              onClick={() => void copyToClipboard(feature.teleportCommand ?? "", feature.id)}
                              className="rounded-md border border-slate-500 bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-slate-100 transition hover:border-slate-300"
                            >
                              {copiedCommandKey === feature.id ? "Copiado" : "Copiar"}
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="mt-4 rounded-xl border border-slate-700 bg-slate-950/55 p-4">
                        <form className="space-y-3" onSubmit={(event) => void submitComment(event, feature.id)}>
                          <textarea
                            className="min-h-24 w-full rounded-lg border border-slate-600 bg-slate-950 p-3 text-sm text-slate-100 outline-none transition focus:border-orange-300"
                            placeholder={user ? "Escreva um comentario..." : "Faça login para comentar"}
                            value={commentDrafts[feature.id] ?? ""}
                            onChange={(event) =>
                              setCommentDrafts((current) => ({
                                ...current,
                                [feature.id]: event.target.value,
                              }))
                            }
                            disabled={!user}
                          />
                          <button
                            type="submit"
                            disabled={!user || saving}
                            className="rounded-lg border border-slate-500 bg-slate-800 px-3 py-2 text-sm font-semibold text-slate-100 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Enviar comentario
                          </button>
                        </form>

                        <div className="mt-4 space-y-3">
                          {commentsForFeature.length === 0 ? (
                            <p className="text-sm text-slate-500">Nenhum comentario ainda.</p>
                          ) : (
                            commentsForFeature.map((comment) => (
                              <div
                                key={comment.id}
                                className="rounded-xl border border-slate-700 bg-slate-900 p-3"
                              >
                                {editingComment?.id === comment.id ? (
                                  <div className="space-y-3">
                                    <textarea
                                      className="min-h-24 w-full rounded-lg border border-slate-600 bg-slate-950 p-3 text-sm text-slate-100 outline-none transition focus:border-orange-300"
                                      value={editingCommentText}
                                      onChange={(event) => setEditingCommentText(event.target.value)}
                                    />
                                    <div className="flex flex-wrap gap-2">
                                      <button
                                        type="button"
                                        onClick={() => void saveCommentEdit()}
                                        className="rounded-lg border border-orange-300/45 bg-orange-400 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:brightness-110"
                                      >
                                        Salvar
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingComment(null);
                                          setEditingCommentText("");
                                        }}
                                        className="rounded-lg border border-slate-500 bg-slate-800 px-3 py-2 text-sm font-semibold text-slate-100 transition hover:border-slate-300"
                                      >
                                        Cancelar
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                    <div className="flex items-start justify-between gap-3">
                                      <div>
                                        <p className="text-sm font-semibold text-orange-200">
                                          {comment.userName}
                                        </p>
                                        <p className="text-xs text-slate-500">
                                          {getCommentTimeLabel(comment.createdAt)}
                                        </p>
                                      </div>

                                      {canModerateComments && (
                                        <div className="flex flex-wrap gap-2 text-xs">
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setEditingComment(comment);
                                              setEditingCommentText(comment.text);
                                            }}
                                            className="rounded-md border border-slate-500 px-2.5 py-1 text-slate-200 transition hover:border-slate-300"
                                          >
                                            Editar
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => void deleteComment(comment.id)}
                                            className="rounded-md border border-red-500/50 px-2.5 py-1 text-red-200 transition hover:border-red-300"
                                          >
                                            Apagar
                                          </button>
                                        </div>
                                      )}
                                    </div>

                                    <p className="mt-3 text-sm text-slate-200">{comment.text}</p>
                                  </>
                                )}
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
          </div>
        )}
          </div>
        </div>
      </section>

      {featureModalOpen && canAddFeature && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-[min(96vw,1120px)] max-h-[92vh] overflow-y-auto rounded-3xl border border-slate-700 bg-slate-950 p-6 shadow-[0_28px_65px_rgba(0,0,0,.45)] md:p-7">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-orange-300">
                  {editingFeature ? `Editar ${copy.singular}` : `Nova ${copy.singular}`}
                </p>
                <h3 className="mt-1 text-2xl font-semibold text-white">
                  {editingFeature ? "Atualizar conteúdo" : "Cadastrar conteúdo"}
                </h3>
              </div>
              <button
                type="button"
                onClick={closeFeatureModal}
                className="rounded-lg border border-slate-500 px-3 py-2 text-sm text-slate-200 transition hover:border-slate-300"
              >
                Fechar
              </button>
            </div>

            <form className="mt-6 space-y-4" onSubmit={(event) => void submitFeature(event)}>
              {feedback && (
                <p className="rounded-xl border border-slate-700 bg-slate-900/75 px-4 py-3 text-sm text-slate-300">
                  {feedback}
                </p>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2 text-sm text-slate-300">
                  <span>Nome</span>
                  <input
                    className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 outline-none transition focus:border-orange-300"
                    value={featureForm.title}
                    onChange={(event) =>
                      setFeatureForm((current) => ({ ...current, title: event.target.value }))
                    }
                  />
                </label>

                {isGranadasCategory ? (
                  <label className="space-y-2 text-sm text-slate-300">
                    <span>Tipo de granada</span>
                    <select
                      className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 outline-none transition focus:border-orange-300"
                      value={featureForm.grenadeType}
                      onChange={(event) =>
                        setFeatureForm((current) => ({ ...current, grenadeType: event.target.value }))
                      }
                    >
                      {grenadeTypeOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <div />
                )}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2 text-sm text-slate-300">
                  <span>Mapa</span>
                  <select
                    className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 outline-none transition focus:border-orange-300"
                    value={featureForm.map}
                    onChange={(event) =>
                      setFeatureForm((current) => ({
                        ...current,
                        map: event.target.value,
                        launchPoint: null,
                        impactPoint: null,
                      }))
                    }
                  >
                    <option value="">Selecione</option>
                    {mapOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-2 text-sm text-slate-300">
                  <span>Local</span>
                  <input
                    className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 outline-none transition focus:border-orange-300"
                    value={featureForm.location}
                    onChange={(event) =>
                      setFeatureForm((current) => ({ ...current, location: event.target.value }))
                    }
                    placeholder="Ex: janelão"
                  />
                </label>
              </div>

              {isGranadasCategory && (
                <div className="space-y-4 rounded-2xl border border-slate-700 bg-slate-950/55 p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.16em] text-orange-300">Pontos da granada</p>
                      <h4 className="mt-1 text-lg font-semibold text-white">Clique no mapa para marcar o lançamento e o impacto</h4>
                      <p className="mt-1 text-sm text-slate-400">
                        Primeiro escolha o lançamento, depois o impacto. O painel abaixo mostra a posição selecionada em porcentagem do mapa.
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setMapSelectionMode("launch")}
                        className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                          mapSelectionMode === "launch"
                            ? "border-emerald-300 bg-emerald-300/15 text-emerald-100"
                            : "border-slate-600 bg-slate-900 text-slate-300 hover:border-slate-400"
                        }`}
                      >
                        Definir lançamento
                      </button>
                      <button
                        type="button"
                        onClick={() => setMapSelectionMode("impact")}
                        className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                          mapSelectionMode === "impact"
                            ? "border-orange-300 bg-orange-300/15 text-orange-100"
                            : "border-slate-600 bg-slate-900 text-slate-300 hover:border-slate-400"
                        }`}
                      >
                        Definir impacto
                      </button>
                    </div>
                  </div>

                  <GrenadeMapScene
                    mapSrc={getMapOverviewSource(featureForm.map)}
                    mapAlt={featureForm.map || "Mapa da granada"}
                    entries={currentMapEntries}
                    revealMode="editor"
                    interactive
                    selectionMode={mapSelectionMode}
                    selectedLaunchPoint={featureForm.launchPoint}
                    selectedImpactPoint={featureForm.impactPoint}
                    onMapClick={(point) => {
                      setFeatureForm((current) =>
                        mapSelectionMode === "launch"
                          ? { ...current, launchPoint: point }
                          : { ...current, impactPoint: point }
                      );

                      if (mapSelectionMode === "launch") {
                        setMapSelectionMode("impact");
                      }
                    }}
                    onLaunchClick={(entry) => {
                      if (!entry.launchPoint) {
                        return;
                      }

                      setFeatureForm((current) => ({
                        ...current,
                        launchPoint: entry.launchPoint ?? null,
                      }));
                      setMapSelectionMode("impact");
                    }}
                    onImpactClick={(entry) => {
                      if (!entry.impactPoint) {
                        return;
                      }

                      setFeatureForm((current) => ({
                        ...current,
                        impactPoint: entry.impactPoint ?? null,
                      }));
                      setMapSelectionMode("launch");
                    }}
                  />

                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="rounded-xl border border-slate-700 bg-slate-900/75 p-3">
                      <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Lançamento</p>
                      <p className="mt-1 text-sm font-semibold text-white">
                        {featureForm.launchPoint ? formatMapPoint(featureForm.launchPoint) : "Nenhum ponto marcado"}
                      </p>
                      <button
                        type="button"
                        onClick={() => setFeatureForm((current) => ({ ...current, launchPoint: null }))}
                        className="mt-3 rounded-md border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-slate-300"
                      >
                        Limpar lançamento
                      </button>
                    </div>

                    <div className="rounded-xl border border-slate-700 bg-slate-900/75 p-3">
                      <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Impacto</p>
                      <p className="mt-1 text-sm font-semibold text-white">
                        {featureForm.impactPoint ? formatMapPoint(featureForm.impactPoint) : "Nenhum ponto marcado"}
                      </p>
                      <button
                        type="button"
                        onClick={() => setFeatureForm((current) => ({ ...current, impactPoint: null }))}
                        className="mt-3 rounded-md border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-slate-300"
                      >
                        Limpar impacto
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-2">
                    <div className="rounded-xl border border-slate-700 bg-slate-900/55 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs uppercase tracking-[0.12em] text-emerald-300">Lançamentos existentes</p>
                          <h5 className="mt-1 text-sm font-semibold text-white">Clique para reutilizar um ponto já salvo</h5>
                        </div>
                        <span className="rounded-full border border-slate-700 px-2.5 py-1 text-xs text-slate-400">
                          {currentMapLaunchPoints.length}
                        </span>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {currentMapLaunchPoints.length === 0 ? (
                          <p className="text-sm text-slate-400">Nenhum lançamento cadastrado para este mapa.</p>
                        ) : (
                          currentMapLaunchPoints.map((entry) => (
                            <button
                              key={entry.key}
                              type="button"
                              onClick={() => {
                                setFeatureForm((current) => ({
                                  ...current,
                                  launchPoint: entry.point,
                                }));
                                setMapSelectionMode("impact");
                              }}
                              className="rounded-full border border-emerald-300/35 bg-emerald-300/10 px-3 py-1.5 text-xs font-semibold text-emerald-100 transition hover:border-emerald-200"
                              title={entry.titles.join(" • ")}
                            >
                              {formatMapPoint(entry.point)}
                            </button>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-700 bg-slate-900/55 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs uppercase tracking-[0.12em] text-orange-300">Impactos existentes</p>
                          <h5 className="mt-1 text-sm font-semibold text-white">Clique para reutilizar um ponto já salvo</h5>
                        </div>
                        <span className="rounded-full border border-slate-700 px-2.5 py-1 text-xs text-slate-400">
                          {currentMapImpactPoints.length}
                        </span>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {currentMapImpactPoints.length === 0 ? (
                          <p className="text-sm text-slate-400">Nenhum impacto cadastrado para este mapa.</p>
                        ) : (
                          currentMapImpactPoints.map((entry) => (
                            <button
                              key={entry.key}
                              type="button"
                              onClick={() => {
                                setFeatureForm((current) => ({
                                  ...current,
                                  impactPoint: entry.point,
                                }));
                                setMapSelectionMode("launch");
                              }}
                              className="rounded-full border border-orange-300/35 bg-orange-300/10 px-3 py-1.5 text-xs font-semibold text-orange-100 transition hover:border-orange-200"
                              title={entry.titles.join(" • ")}
                            >
                              {formatMapPoint(entry.point)}
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {isGranadasCategory && (
                <div className="grid gap-4 md:grid-cols-3">
                  <label className="space-y-2 text-sm text-slate-300">
                    <span>Objetivo</span>
                    <select
                      className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 outline-none transition focus:border-orange-300"
                      value={featureForm.objective}
                      onChange={(event) =>
                        setFeatureForm((current) => ({ ...current, objective: event.target.value }))
                      }
                    >
                      {objectiveOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-2 text-sm text-slate-300">
                    <span>Dificuldade</span>
                    <select
                      className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 outline-none transition focus:border-orange-300"
                      value={featureForm.difficulty}
                      onChange={(event) =>
                        setFeatureForm((current) => ({ ...current, difficulty: event.target.value }))
                      }
                    >
                      {difficultyOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-2 text-sm text-slate-300">
                    <span>Tipo de lancamento</span>
                    <select
                      className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 outline-none transition focus:border-orange-300"
                      value={featureForm.throwType}
                      onChange={(event) =>
                        setFeatureForm((current) => ({ ...current, throwType: event.target.value }))
                      }
                    >
                      {throwTypeOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2 text-sm text-slate-300">
                  <span>Posição</span>
                  <select
                    className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 outline-none transition focus:border-orange-300"
                    value={featureForm.position}
                    onChange={(event) =>
                      setFeatureForm((current) => ({ ...current, position: event.target.value }))
                    }
                  >
                    <option value="Respawn">Respawn</option>
                    <option value="Diverso">Diverso</option>
                  </select>
                </label>
              </div>

              <div className="space-y-2 text-sm text-slate-300">
                <span>Imagem</span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 outline-none transition file:mr-4 file:rounded-md file:border-0 file:bg-orange-400 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-slate-950 focus:border-orange-300"
                  onChange={(event) => {
                    void handleImageUpload(event.target.files);
                    event.currentTarget.value = "";
                  }}
                />
                <span className="block text-xs text-slate-500">
                  Adicione ate 5 imagens. Depois use o botao de zoom em qualquer preview para editar essa imagem.
                </span>
                {processingImage && (
                  <span className="block text-xs text-orange-300">Processando imagem...</span>
                )}
              </div>

              {featureForm.imageTexts.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Imagens adicionadas</p>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {featureForm.imageTexts.map((src, index) => (
                      <div key={`preview-${index}`} className="space-y-2 rounded-xl border border-slate-700 bg-slate-950/60 p-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={src} alt={`Preview ${index + 1}`} className="h-28 w-full rounded-md object-cover" />
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setFeatureForm((current) => ({
                                ...current,
                                imageZoomEnabled: current.imageZoomEnabled.map((value, currentIndex) =>
                                  currentIndex === index ? !value : value
                                ),
                              }))
                            }
                            className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition ${
                              featureForm.imageZoomEnabled[index] !== false
                                ? "border-orange-300/45 bg-orange-400/10 text-orange-200 hover:bg-orange-400/20"
                                : "border-slate-600 bg-slate-900 text-slate-300 hover:border-slate-400"
                            }`}
                          >
                            {featureForm.imageZoomEnabled[index] !== false ? "Desativar zoom" : "Ativar zoom"}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setFeatureForm((current) => {
                                const nextImages = current.imageTexts.filter((_, currentIndex) => currentIndex !== index);
                                const nextZoomEnabled = current.imageZoomEnabled.filter((_, currentIndex) => currentIndex !== index);

                                return {
                                  ...current,
                                  imageTexts: nextImages,
                                  imageZoomEnabled: nextZoomEnabled,
                                };
                              })
                            }
                            className="rounded-md border border-red-500/50 bg-red-950/30 px-3 py-1.5 text-xs font-semibold text-red-200 transition hover:border-red-300"
                          >
                            Remover
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!isGranadasCategory && (
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-2 text-sm text-slate-300 md:col-span-2">
                    <span>Descrição</span>
                    <textarea
                      className="min-h-32 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 outline-none transition focus:border-orange-300"
                      value={featureForm.description}
                      onChange={(event) =>
                        setFeatureForm((current) => ({ ...current, description: event.target.value }))
                      }
                    />
                  </label>
                </div>
              )}

              <label className="space-y-2 text-sm text-slate-300">
                <span>Link do video do YouTube</span>
                <input
                  className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 outline-none transition focus:border-orange-300"
                  value={featureForm.youtubeUrl}
                  onChange={(event) =>
                    setFeatureForm((current) => ({ ...current, youtubeUrl: event.target.value }))
                  }
                  placeholder="https://www.youtube.com/watch?v=..."
                />
              </label>

              <label className="space-y-2 text-sm text-slate-300">
                <span>Comando de teleporte</span>
                <input
                  className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 outline-none transition focus:border-orange-300"
                  value={featureForm.teleportCommand}
                  onChange={(event) =>
                    setFeatureForm((current) => ({ ...current, teleportCommand: event.target.value }))
                  }
                  placeholder="Ex: https://link-do-comando ou comando direto"
                />
              </label>

              <div className="flex flex-wrap justify-end gap-5 pt-2">
                <button
                  type="button"
                  onClick={closeFeatureModal}
                  className="rounded-lg border border-slate-500 bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-100 transition hover:border-slate-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg border border-orange-300/45 bg-linear-to-r from-orange-400 to-orange-300 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {imageViewer && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center bg-black/90 p-4"
          onClick={closeImageViewer}
        >
          <div
            className="w-full max-w-6xl rounded-2xl border border-slate-700 bg-slate-950/95 p-4 md:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm text-slate-300 md:text-base">{imageViewer.alt}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {imageViewer.zoomEnabled
                    ? "Use o controle circular para ajustar o zoom."
                    : "Zoom desativado para esta imagem."}
                </p>
              </div>

              <button
                type="button"
                onClick={closeImageViewer}
                className="rounded-md border border-red-500/50 bg-red-950/30 px-3 py-1.5 text-sm text-red-200 transition hover:border-red-300"
              >
                Fechar
              </button>
            </div>

            <div className="space-y-4">
              <div className="relative overflow-hidden rounded-xl border border-slate-700 bg-black">
                <button type="button" className="flex min-h-[50vh] w-full items-center justify-center p-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imageViewer.src}
                    alt={imageViewer.alt}
                    className="max-h-[70vh] max-w-full select-none object-contain transition duration-150"
                    style={{ transform: `scale(${imageViewerZoom})` }}
                  />
                </button>

                {imageViewer.zoomEnabled && (
                  <>
                    <div className="absolute bottom-4 left-4 z-20">
                      <ZoomSlider
                        value={imageViewerZoom}
                        onChange={setImageViewerZoom}
                        label="Zoom"
                        hint="No modal"
                        className="w-[min(72vw,28rem)]"
                      />
                    </div>

                    <ZoomLens
                      src={imageViewer.src}
                      alt={imageViewer.alt}
                      zoom={imageViewerZoom}
                      className="h-48 w-48 md:h-64 md:w-64"
                    />
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
