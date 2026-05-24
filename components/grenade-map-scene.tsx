"use client";

import { useEffect, useMemo, useState, type MouseEvent } from "react";

export type MapPoint = {
  x: number;
  y: number;
};

export type GrenadeMapEntry = {
  id: string;
  title: string;
  grenadeType?: string;
  launchPoint?: MapPoint | null;
  impactPoint?: MapPoint | null;
  youtubeUrl?: string;
  coverImageText?: string;
  imageTexts?: string[];
  imageText?: string;
  imageUrl?: string;
};

type ActiveFocus = {
  kind: "launch" | "impact";
  pointKey: string;
} | null;

type GrenadeMapSceneProps = {
  mapSrc?: string;
  mapAlt: string;
  entries: GrenadeMapEntry[];
  activeFocus?: ActiveFocus;
  revealMode?: "editor" | "public";
  interactive?: boolean;
  selectedLaunchPoint?: MapPoint | null;
  selectedImpactPoint?: MapPoint | null;
  selectionMode?: "launch" | "impact";
  onMapClick?: (point: MapPoint) => void;
  onLaunchClick?: (entry: GrenadeMapEntry) => void;
  onImpactClick?: (entry: GrenadeMapEntry) => void;
  onBackgroundClick?: () => void;
  className?: string;
  externalPreviewEntry?: GrenadeMapEntry | null;
  externalPreviewPoint?: MapPoint | null;
};

function buildPointKey(point?: MapPoint | null) {
  if (!point) {
    return "";
  }

  return `${point.x.toFixed(1)}:${point.y.toFixed(1)}`;
}

function pointStyle(point?: MapPoint | null) {
  if (!point) {
    return undefined;
  }

  return {
    left: `${point.x}%`,
    top: `${point.y}%`,
  } as const;
}

function pointLabel(point?: MapPoint | null) {
  if (!point) {
    return "";
  }

  return `${point.x.toFixed(1)}, ${point.y.toFixed(1)}`;
}

function getYouTubeHoverPreviewUrl(url: string) {
  try {
    const parsedUrl = new URL(url);

    if (parsedUrl.hostname.includes("youtu.be")) {
      const videoId = parsedUrl.pathname.replace("/", "").trim();
      if (!videoId) {
        return "";
      }

      const params = new URLSearchParams({
        autoplay: "1",
        mute: "1",
        controls: "0",
        rel: "0",
        modestbranding: "1",
        loop: "1",
        playlist: videoId,
        playsinline: "1",
      });

      return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
    }

    if (parsedUrl.hostname.includes("youtube.com")) {
      const videoId = parsedUrl.searchParams.get("v")?.trim() ?? "";
      if (!videoId) {
        return "";
      }

      const params = new URLSearchParams({
        autoplay: "1",
        mute: "1",
        controls: "0",
        rel: "0",
        modestbranding: "1",
        loop: "1",
        playlist: videoId,
        playsinline: "1",
      });

      return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
    }
  } catch {
    return "";
  }

  return "";
}

export function GrenadeMapScene({
  mapSrc,
  mapAlt,
  entries,
  activeFocus = null,
  revealMode = "editor",
  interactive = false,
  selectedLaunchPoint = null,
  selectedImpactPoint = null,
  selectionMode,
  onMapClick,
  onLaunchClick,
  onImpactClick,
  onBackgroundClick,
  externalPreviewEntry,
  externalPreviewPoint,
  className,
}: GrenadeMapSceneProps) {
  const hasDraftLine = Boolean(selectedLaunchPoint && selectedImpactPoint);
  const impactLaunchCountByKey = entries.reduce<Record<string, number>>((accumulator, entry) => {
    const impactKey = buildPointKey(entry.impactPoint);
    if (!impactKey) {
      return accumulator;
    }

    accumulator[impactKey] = (accumulator[impactKey] ?? 0) + 1;
    return accumulator;
  }, {});

  const shouldShowEditorFullView = revealMode === "editor";
  const [hoveredLaunchKey, setHoveredLaunchKey] = useState("");
  const [hoveredPreviewImageIndex, setHoveredPreviewImageIndex] = useState(0);
  const hoveredLaunchEntry = useMemo(
    () => entries.find((entry) => buildPointKey(entry.launchPoint) === hoveredLaunchKey) ?? null,
    [entries, hoveredLaunchKey]
  );
  const hoveredLaunchImages = useMemo(() => {
    if (!hoveredLaunchEntry) {
      return [] as string[];
    }

    const imageList = hoveredLaunchEntry.imageTexts?.length
      ? hoveredLaunchEntry.imageTexts
      : [hoveredLaunchEntry.coverImageText ?? hoveredLaunchEntry.imageText ?? hoveredLaunchEntry.imageUrl ?? ""].filter(Boolean);

    return Array.from(
      new Set(
        imageList
          .map((src) => src.trim())
          .filter((src) => src.startsWith("data:") || src.startsWith("http"))
      )
    );
  }, [hoveredLaunchEntry]);
  const hoveredLaunchVideoUrl = useMemo(() => {
    if (!hoveredLaunchEntry?.youtubeUrl) {
      return "";
    }

    return getYouTubeHoverPreviewUrl(hoveredLaunchEntry.youtubeUrl);
  }, [hoveredLaunchEntry]);

  const externalPreviewImages = useMemo(() => {
    if (!externalPreviewEntry) {
      return [] as string[];
    }

    const imageList = externalPreviewEntry.imageTexts?.length
      ? externalPreviewEntry.imageTexts
      : [externalPreviewEntry.coverImageText ?? externalPreviewEntry.imageText ?? externalPreviewEntry.imageUrl ?? ""].filter(Boolean);

    return Array.from(
      new Set(
        imageList
          .map((src) => src.trim())
          .filter((src) => src.startsWith("data:") || src.startsWith("http"))
      )
    );
  }, [externalPreviewEntry]);

  const externalPreviewVideoUrl = useMemo(() => {
    if (!externalPreviewEntry?.youtubeUrl) {
      return "";
    }

    return getYouTubeHoverPreviewUrl(externalPreviewEntry.youtubeUrl);
  }, [externalPreviewEntry]);
  const selectedLaunchImpactKeys = new Set(
    activeFocus?.kind === "launch"
      ? entries
          .filter((entry) => buildPointKey(entry.launchPoint) === activeFocus.pointKey)
          .map((entry) => buildPointKey(entry.impactPoint))
          .filter(Boolean)
      : []
  );

  const isLaunchVisible = (entry: GrenadeMapEntry) => {
    const launchKey = buildPointKey(entry.launchPoint);
    const impactKey = buildPointKey(entry.impactPoint);

    if (shouldShowEditorFullView) {
      return Boolean(entry.launchPoint);
    }

    if (!activeFocus) {
      return false;
    }

    if (activeFocus.kind === "impact") {
      return impactKey === activeFocus.pointKey && Boolean(entry.launchPoint);
    }

    return launchKey === activeFocus.pointKey;
  };

  const isImpactVisible = (entry: GrenadeMapEntry) => {
    const impactKey = buildPointKey(entry.impactPoint);

    if (shouldShowEditorFullView) {
      return Boolean(entry.impactPoint);
    }

    if (!activeFocus) {
      return Boolean(entry.impactPoint);
    }

    if (activeFocus.kind === "impact") {
      return impactKey === activeFocus.pointKey;
    }

    return selectedLaunchImpactKeys.has(impactKey);
  };

  const isLineVisible = (entry: GrenadeMapEntry) => {
    if (!entry.launchPoint || !entry.impactPoint) {
      return false;
    }

    if (shouldShowEditorFullView) {
      return true;
    }

    if (!activeFocus) {
      return false;
    }

    if (activeFocus.kind === "impact") {
      return buildPointKey(entry.impactPoint) === activeFocus.pointKey;
    }

    return buildPointKey(entry.launchPoint) === activeFocus.pointKey;
  };

  useEffect(() => {
    if (!hoveredLaunchEntry || hoveredLaunchImages.length <= 1 || hoveredLaunchVideoUrl) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setHoveredPreviewImageIndex((current) => (current + 1) % hoveredLaunchImages.length);
    }, 2000);

    return () => window.clearInterval(intervalId);
  }, [hoveredLaunchEntry, hoveredLaunchImages.length, hoveredLaunchVideoUrl]);

  const handleMapContainerClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!onBackgroundClick || onMapClick) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (target?.closest("[data-grenade-point='true']")) {
      return;
    }

    onBackgroundClick();
  };

  return (
    <div className={`relative ${className ?? ""}`.trim()}>
      <div
        className="relative aspect-square overflow-hidden rounded-2xl border border-slate-700 bg-slate-950/80"
        onClickCapture={handleMapContainerClick}
      >
        {mapSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={mapSrc}
            alt={mapAlt}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_center,rgba(255,255,255,.08),rgba(15,23,42,.92))] text-sm text-slate-400">
            Selecione um mapa com overview disponivel.
          </div>
        )}

        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          {hasDraftLine && selectedLaunchPoint && selectedImpactPoint && (
            <line
              x1={selectedLaunchPoint.x}
              y1={selectedLaunchPoint.y}
              x2={selectedImpactPoint.x}
              y2={selectedImpactPoint.y}
              stroke="rgba(251, 146, 60, .9)"
              strokeWidth="0.55"
              strokeDasharray="1.8 1.4"
              vectorEffect="non-scaling-stroke"
            />
          )}

          {entries.map((entry) => {
            if (!isLineVisible(entry)) {
              return null;
            }

            const launchPoint = entry.launchPoint;
            const impactPoint = entry.impactPoint;
            if (!launchPoint || !impactPoint) {
              return null;
            }

            const launchKey = buildPointKey(launchPoint);
            const impactKey = buildPointKey(impactPoint);
            const isHighlighted =
              !activeFocus ||
              activeFocus.pointKey === launchKey ||
              activeFocus.pointKey === impactKey;
            const lineOpacity = isHighlighted ? 0.9 : 0.16;

            return (
              <line
                key={`${entry.id}-line`}
                x1={launchPoint.x}
                y1={launchPoint.y}
                x2={impactPoint.x}
                y2={impactPoint.y}
                stroke={isHighlighted ? "rgba(248, 180, 0, .95)" : "rgba(148, 163, 184, .55)"}
                strokeWidth={isHighlighted ? 0.55 : 0.35}
                strokeDasharray="1.4 1.2"
                opacity={lineOpacity}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>

        {entries.map((entry) => {
          const launchKey = buildPointKey(entry.launchPoint);
          const impactKey = buildPointKey(entry.impactPoint);
          const launchActive = Boolean(activeFocus && activeFocus.kind === "launch" && activeFocus.pointKey === launchKey);
          const impactActive = Boolean(activeFocus && activeFocus.kind === "impact" && activeFocus.pointKey === impactKey);
          const focused = launchActive || impactActive;
          const launchButton = onLaunchClick && isLaunchVisible(entry) && entry.launchPoint;
          const impactButton = onImpactClick && isImpactVisible(entry) && entry.impactPoint;

          return (
            <div key={entry.id}>
              {launchButton && entry.launchPoint && (
                <button
                  type="button"
                  data-grenade-point="true"
                  className={`absolute z-20 inline-flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border px-0.5 py-0.5 transition ${
                    launchActive
                      ? "border-orange-200 bg-orange-300 text-slate-950 shadow-[0_0_0_6px_rgba(251,146,60,.22)]"
                      : focused
                        ? "border-slate-100 bg-slate-100 text-slate-950"
                        : "border-emerald-200 bg-emerald-300 text-slate-950 shadow-[0_0_0_5px_rgba(16,185,129,.14)]"
                  } ${launchButton ? "cursor-pointer" : "cursor-default"}`}
                  style={pointStyle(entry.launchPoint)}
                  onClick={() => onLaunchClick?.(entry)}
                  onMouseEnter={() => setHoveredLaunchKey(launchKey)}
                  onMouseLeave={() => {
                    setHoveredLaunchKey((current) => (current === launchKey ? "" : current));
                    setHoveredPreviewImageIndex(0);
                  }}
                  disabled={!launchButton}
                  title={`Lançamento: ${entry.title} ${pointLabel(entry.launchPoint)}`}
                  aria-label={`Lançamento de ${entry.title}`}
                >
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-current">
                    <span className="h-1.5 w-1.5 rounded-full bg-slate-950" />
                  </span>
                </button>
              )}

              {impactButton && entry.impactPoint && (
                <button
                  type="button"
                  data-grenade-point="true"
                  className={`absolute z-20 inline-flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border px-0.5 py-0.5 transition ${
                    impactActive
                      ? "border-orange-200 bg-black text-white shadow-[0_0_0_6px_rgba(251,146,60,.22)]"
                      : focused
                        ? "border-slate-100 bg-black text-white"
                        : "border-orange-200 bg-black text-white shadow-[0_0_0_5px_rgba(251,146,60,.14)]"
                  } ${impactButton ? "cursor-pointer" : "cursor-default"}`}
                  style={pointStyle(entry.impactPoint)}
                  onClick={() => onImpactClick?.(entry)}
                  disabled={!impactButton}
                  title={`Impacto: ${entry.title} ${pointLabel(entry.impactPoint)}`}
                  aria-label={`Impacto de ${entry.title}`}
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[10px] font-black leading-none text-black shadow-[0_1px_2px_rgba(0,0,0,.75)]">
                    {impactLaunchCountByKey[impactKey] ?? 0}
                  </span>
                </button>
              )}
            </div>
          );
        })}

        {interactive && onMapClick && (
          <div
            className="absolute inset-0 z-10 cursor-crosshair bg-transparent"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const x = ((event.clientX - rect.left) / rect.width) * 100;
              const y = ((event.clientY - rect.top) / rect.height) * 100;

              onMapClick({
                x: Number(Math.min(100, Math.max(0, x)).toFixed(1)),
                y: Number(Math.min(100, Math.max(0, y)).toFixed(1)),
              });
            }}
            role="button"
            aria-label={selectionMode === "impact" ? "Selecionar ponto de impacto" : "Selecionar ponto de lançamento"}
          />
        )}

      </div>

      {hoveredLaunchEntry && hoveredLaunchEntry.launchPoint && (
        <div
          className="pointer-events-none absolute z-50 w-[min(72vw,18rem)] -translate-x-1/2 -translate-y-[118%] overflow-hidden rounded-2xl border border-slate-700 bg-slate-950/95 shadow-[0_24px_60px_rgba(0,0,0,.45)]"
          style={{
            left: `${hoveredLaunchEntry.launchPoint.x}%`,
            top: `${hoveredLaunchEntry.launchPoint.y}%`,
          }}
        >
          <div className="border-b border-slate-700 bg-slate-900/80 px-3 py-2">
            <p className="text-xs uppercase tracking-[0.14em] text-orange-300">Preview da granada</p>
            <p className="mt-1 text-sm font-semibold text-white">{hoveredLaunchEntry.title}</p>
          </div>

          <div className="relative aspect-video bg-slate-950">
            {hoveredLaunchVideoUrl ? (
              <iframe
                className="h-full w-full"
                src={hoveredLaunchVideoUrl}
                title={`${hoveredLaunchEntry.title} preview`}
                allow="autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
              />
            ) : hoveredLaunchImages.length > 0 ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={hoveredLaunchImages[hoveredPreviewImageIndex % hoveredLaunchImages.length]}
                  alt={hoveredLaunchEntry.title}
                  className="h-full w-full object-cover"
                />
                {hoveredLaunchImages.length > 1 && (
                  <div className="absolute bottom-2 right-2 rounded-full border border-slate-700 bg-slate-950/80 px-2 py-0.5 text-[10px] text-slate-300">
                    {hoveredPreviewImageIndex % hoveredLaunchImages.length + 1}/{hoveredLaunchImages.length}
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

      {externalPreviewEntry && externalPreviewPoint && (
        <div
          className="pointer-events-none absolute z-50 w-[min(72vw,18rem)] -translate-x-1/2 -translate-y-[118%] overflow-hidden rounded-2xl border border-slate-700 bg-slate-950/95 shadow-[0_24px_60px_rgba(0,0,0,.45)]"
          style={{
            left: `${externalPreviewPoint.x}%`,
            top: `${externalPreviewPoint.y}%`,
          }}
        >
          <div className="border-b border-slate-700 bg-slate-900/80 px-3 py-2">
            <p className="text-xs uppercase tracking-[0.14em] text-orange-300">Preview da granada</p>
            <p className="mt-1 text-sm font-semibold text-white">{externalPreviewEntry.title}</p>
          </div>

          <div className="relative aspect-video bg-slate-950">
            {externalPreviewVideoUrl ? (
              <iframe
                className="h-full w-full"
                src={externalPreviewVideoUrl}
                title={`${externalPreviewEntry.title} preview`}
                allow="autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
              />
            ) : externalPreviewImages.length > 0 ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={externalPreviewImages[0]}
                  alt={externalPreviewEntry.title}
                  className="h-full w-full object-cover"
                />
              </>
            ) : (
              <div className="flex h-full w-full items-center justify-center text-sm text-slate-400">
                Sem preview disponivel
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
        <span className="rounded-full border border-slate-700 bg-slate-950/60 px-2.5 py-1">Lançamento em verde</span>
        <span className="rounded-full border border-slate-700 bg-slate-950/60 px-2.5 py-1">Impacto em laranja</span>
      </div>
    </div>
  );
}