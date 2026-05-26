"use client";
import NextImage from "next/image";
import { PlusIcon, MinusIcon } from "@heroicons/react/24/solid";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import { collection, deleteDoc, doc, onSnapshot, orderBy, query, serverTimestamp, setDoc } from "firebase/firestore";
import type { ChangeEvent, PointerEvent as ReactPointerEvent, SyntheticEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuthSession } from "@/components/auth-provider";
import { db } from "@/lib/firebase";


const CORE_VERSION = "0.12.9";
const CORE_BASE_URL = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd`;
const ZOOM_CROP_WIDTH = 0.1;
const ZOOM_CROP_HEIGHT = 0.1;
const ZOOM_INSET_RADIUS = 20;
const ZOOM_INSET_OFFSET_X = 30;
const ZOOM_INSET_OFFSET_Y = 72;
const ZOOM_PREVIEW_SIZE = 30;
const IMAGE_OVERLAY_DEFAULT_WIDTH = 22;
const IMAGE_OVERLAY_DEFAULT_X = 8;
const IMAGE_OVERLAY_DEFAULT_Y = 8;

type OverlayKind = "image" | "gif" | "video";

type MediaOverlay = {
  id: string;
  file: File | null;
  url: string;
  assetUrl: string;
  kind: OverlayKind;
  start: number;
  end: number;
  x: number;
  y: number;
  width: number;
  naturalWidth: number;
  naturalHeight: number;
};

type SavedOverlayPreset = {
  kind: OverlayKind;
  assetUrl: string;
  start: number;
  end: number;
  x: number;
  y: number;
  width: number;
  naturalWidth: number;
  naturalHeight: number;
};

type VideoPreset = {
  id: string;
  name: string;
  overlays: SavedOverlayPreset[];
  createdAt?: unknown;
  updatedAt?: unknown;
};

function getOverlayKind(file: File): OverlayKind {
  const extension = file.name.split(".").pop()?.toLowerCase();

  if (file.type.startsWith("video/") || ["mp4", "webm", "mov", "mkv", "avi"].includes(extension ?? "")) {
    return "video";
  }

  if (file.type === "image/gif" || extension === "gif") {
    return "gif";
  }

  return "image";
}

async function readMediaDimensions(file: File) {
  const objectUrl = URL.createObjectURL(file);

  try {
    if (getOverlayKind(file) === "video") {
      const dimensions = await new Promise<{ naturalWidth: number; naturalHeight: number }>((resolve, reject) => {
        const video = document.createElement("video");

        video.preload = "metadata";
        video.onloadedmetadata = () => {
          resolve({
            naturalWidth: video.videoWidth,
            naturalHeight: video.videoHeight,
          });
          URL.revokeObjectURL(objectUrl);
        };
        video.onerror = () => reject(new Error("Nao foi possivel ler o video."));
        video.src = objectUrl;
      });

      return dimensions;
    }

    const dimensions = await new Promise<{ naturalWidth: number; naturalHeight: number }>((resolve, reject) => {
      const image = new Image();

      image.onload = () =>
        resolve({
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
        });

      image.onerror = () => reject(new Error("Nao foi possivel ler a imagem."));
      image.src = objectUrl;
    });

    return dimensions;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function fileToDataUrl(file: File) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("Nao foi possivel ler a midia."));
    reader.readAsDataURL(file);
  });
}

async function blobToDataUrl(blob: Blob) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("Nao foi possivel ler o blob."));
    reader.readAsDataURL(blob);
  });
}

async function loadImageFromDataUrl(dataUrl: string) {
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Nao foi possivel carregar a imagem para compressao."));
    image.src = dataUrl;
  });
}

async function resizeImageDataUrl(dataUrl: string, maxSide = 512) {
  if (dataUrl.startsWith("data:image/gif")) {
    return dataUrl;
  }

  const image = await loadImageFromDataUrl(dataUrl);
  const biggestSide = Math.max(image.naturalWidth, image.naturalHeight);

  if (!biggestSide || biggestSide <= maxSide) {
    return dataUrl;
  }

  const scale = maxSide / biggestSide;
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");

  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");

  if (!context) {
    return dataUrl;
  }

  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  try {
    return canvas.toDataURL("image/webp", 0.88);
  } catch {
    return canvas.toDataURL("image/png");
  }
}

function formatSeconds(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return "0:00";
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, "0");

  return `${minutes}:${seconds}`;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

function getOverlayExtension(kind: OverlayKind) {
  if (kind === "gif") {
    return "gif";
  }

  if (kind === "video") {
    return "mp4";
  }

  return "png";
}

function shouldRevokeObjectUrl(url: string) {
  return url.startsWith("blob:");
}

export function VideoEditorPanel() {
  const { user } = useAuthSession();
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [outputUrl, setOutputUrl] = useState("");
  const [downloadName, setDownloadName] = useState("video-editado.mp4");
  const [duration, setDuration] = useState(0);
  const [videoWidth, setVideoWidth] = useState(0);
  const [videoHeight, setVideoHeight] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [zoomStart, setZoomStart] = useState(0);
  const [zoomEnd, setZoomEnd] = useState(0);
  const [imageOverlays, setImageOverlays] = useState<MediaOverlay[]>([]);
  const [presetName, setPresetName] = useState("");
  const [videoPresets, setVideoPresets] = useState<VideoPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [previewTime, setPreviewTime] = useState(0);
  const [status, setStatus] = useState("Envie um MP4 para iniciar a edição.");
  const [progress, setProgress] = useState<number | null>(null);
  const [processing, setProcessing] = useState(false);
  const [presetSaving, setPresetSaving] = useState(false);

  const ffmpegRef = useRef<FFmpeg | null>(null);
  const loadPromiseRef = useRef<Promise<FFmpeg> | null>(null);
  const lastFfmpegLogRef = useRef("");
  const outputPreviewRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const trimTrackRef = useRef<HTMLDivElement | null>(null);
  const previewMainVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewInsetVideoRef = useRef<HTMLVideoElement | null>(null);
  const zoomTrackRef = useRef<HTMLDivElement | null>(null);
  const activeZoomHandleRef = useRef<"start" | "end" | null>(null);
  const activeTrimHandleRef = useRef<"start" | "end" | null>(null);

  useEffect(() => {
    if (!db || !user) {
      setVideoPresets([]);
      setSelectedPresetId("");
      return;
    }

    const presetsQuery = query(
      collection(db, "users", user.uid, "videoPresets"),
      orderBy("updatedAt", "desc"),
    );

    const unsubscribe = onSnapshot(presetsQuery, (snapshot) => {
      setVideoPresets(
        snapshot.docs.map((presetDoc) => ({
          id: presetDoc.id,
          ...(presetDoc.data() as Omit<VideoPreset, "id">),
        })),
      );
    });

    return () => unsubscribe();
  }, [user]);

  const zoomOutputWidth = useMemo(() => {
    if (!videoWidth) {
      return 0;
    }

    return Math.max(2, Math.round((videoWidth * ZOOM_PREVIEW_SIZE) / 100 / 2) * 2);
  }, [videoWidth]);

  const zoomOutputHeight = useMemo(() => {
    if (!videoHeight) {
      return 0;
    }

    return Math.max(2, Math.round((videoHeight * ZOOM_PREVIEW_SIZE) / 100 / 2) * 2);
  }, [videoHeight]);

  const zoomStartLabel = useMemo(() => formatSeconds(zoomStart), [zoomStart]);
  const zoomEndLabel = useMemo(() => formatSeconds(zoomEnd), [zoomEnd]);
  const trimStartLabel = useMemo(() => formatSeconds(trimStart), [trimStart]);
  const trimEndLabel = useMemo(() => formatSeconds(trimEnd), [trimEnd]);
  const durationLabel = useMemo(() => formatSeconds(duration), [duration]);
  const safeTrimStart = useMemo(() => {
    if (!duration) {
      return 0;
    }

    return Math.max(0, Math.min(trimStart, duration));
  }, [duration, trimStart]);
  const safeTrimEnd = useMemo(() => {
    if (!duration) {
      return 0;
    }

    const endCandidate = Math.max(trimEnd || duration, safeTrimStart + 0.1);

    return Math.max(safeTrimStart + 0.1, Math.min(endCandidate, duration));
  }, [duration, safeTrimStart, trimEnd]);
  const trimRangeFillStyle = useMemo(() => {
    if (!duration) {
      return { left: "0%", right: "100%" };
    }

    return {
      left: `${(safeTrimStart / duration) * 100}%`,
      right: `${100 - (safeTrimEnd / duration) * 100}%`,
    };
  }, [duration, safeTrimEnd, safeTrimStart]);
  const safeZoomStart = useMemo(() => {
    if (!duration) {
      return 0;
    }

    return Math.max(0, Math.min(zoomStart, duration));
  }, [duration, zoomStart]);
  const safeZoomEnd = useMemo(() => {
    if (!duration) {
      return 0;
    }

    const endCandidate = Math.max(zoomEnd || duration, safeZoomStart + 0.1);

    return Math.max(safeZoomStart + 0.1, Math.min(endCandidate, duration));
  }, [duration, safeZoomStart, zoomEnd]);
  const previewZoomActive = useMemo(() => {
    if (!duration) {
      return false;
    }

    return previewTime >= safeZoomStart && previewTime <= safeZoomEnd;
  }, [duration, previewTime, safeZoomEnd, safeZoomStart]);

  const zoomRangeFillStyle = useMemo(() => {
    if (!duration) {
      return { left: "0%", right: "100%" };
    }

    return {
      left: `${(safeZoomStart / duration) * 100}%`,
      right: `${100 - (safeZoomEnd / duration) * 100}%`,
    };
  }, [duration, safeZoomEnd, safeZoomStart]);

  const updateZoomFromPointer = useCallback(
    (handle: "start" | "end", clientX: number) => {
      const track = zoomTrackRef.current;

      if (!track || !duration) {
        return;
      }

      const rect = track.getBoundingClientRect();
      const clampedX = Math.max(rect.left, Math.min(clientX, rect.right));
      const nextTime = ((clampedX - rect.left) / rect.width) * duration;

      if (handle === "start") {
        const nextStart = Math.min(nextTime, safeZoomEnd - 0.1);
        setZoomStart(Math.max(0, nextStart));
        return;
      }

      const nextEnd = Math.max(nextTime, safeZoomStart + 0.1);
      setZoomEnd(Math.min(duration, nextEnd));
    },
    [duration, safeZoomEnd, safeZoomStart],
  );

  const updateTrimFromPointer = useCallback(
    (handle: "start" | "end", clientX: number) => {
      const track = trimTrackRef.current;

      if (!track || !duration) {
        return;
      }

      const rect = track.getBoundingClientRect();
      const clampedX = Math.max(rect.left, Math.min(clientX, rect.right));
      const nextTime = ((clampedX - rect.left) / rect.width) * duration;

      if (handle === "start") {
        const nextStart = Math.min(nextTime, safeTrimEnd - 0.1);
        setTrimStart(Math.max(0, nextStart));
        return;
      }

      const nextEnd = Math.max(nextTime, safeTrimStart + 0.1);
      setTrimEnd(Math.min(duration, nextEnd));
    },
    [duration, safeTrimEnd, safeTrimStart],
  );

  const beginTrimDrag = (handle: "start" | "end", event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!duration) {
      return;
    }

    event.preventDefault();
    activeTrimHandleRef.current = handle;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateTrimFromPointer(handle, event.clientX);
  };

  const beginZoomDrag = (handle: "start" | "end", event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!duration) {
      return;
    }

    event.preventDefault();
    activeZoomHandleRef.current = handle;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateZoomFromPointer(handle, event.clientX);
  };

  const resetEditor = () => {
    if (sourceUrl) {
      URL.revokeObjectURL(sourceUrl);
    }

    if (outputUrl) {
      URL.revokeObjectURL(outputUrl);
    }

    clearImageOverlays();
    setSelectedPresetId("");

    setSourceFile(null);
    setSourceUrl("");
    setOutputUrl("");
    setDownloadName("video-editado.mp4");
    setDuration(0);
    setVideoWidth(0);
    setVideoHeight(0);
    setTrimStart(0);
    setTrimEnd(0);
    setZoomStart(0);
    setZoomEnd(0);
    setPreviewTime(0);
    setStatus("Envie um MP4 para iniciar a edição.");
    setProgress(null);
    setProcessing(false);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    if (imageInputRef.current) {
      imageInputRef.current.value = "";
    }
  };

  const clearImageOverlays = () => {
    setImageOverlays((currentOverlays) => {
      currentOverlays.forEach((overlay) => {
        if (shouldRevokeObjectUrl(overlay.url)) {
          URL.revokeObjectURL(overlay.url);
        }
      });
      return [];
    });
  };

  const addImageOverlays = async (files: File[]) => {
    if (!files.length) {
      return;
    }

    const importedOverlays = await Promise.all(
      files.map(async (file, index) => {
        const dimensions = await readMediaDimensions(file);
        const kind = getOverlayKind(file);
        const assetUrl = await fileToDataUrl(file);

        return {
          id: `${Date.now()}-${index}-${file.name}`,
          file,
          url: URL.createObjectURL(file),
          assetUrl,
          kind,
          start: safeTrimStart,
          end: safeTrimEnd,
          x: IMAGE_OVERLAY_DEFAULT_X,
          y: IMAGE_OVERLAY_DEFAULT_Y,
          width: IMAGE_OVERLAY_DEFAULT_WIDTH,
          naturalWidth: dimensions.naturalWidth,
          naturalHeight: dimensions.naturalHeight,
        } satisfies MediaOverlay;
      }),
    );

    setImageOverlays((currentOverlays) => [...currentOverlays, ...importedOverlays]);
  };

  const handleImageChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);

    if (!files.length) {
      return;
    }

    void addImageOverlays(files);
    event.target.value = "";
  };

  const updateImageOverlay = (
    id: string,
    updates: Partial<Pick<MediaOverlay, "start" | "end" | "x" | "y" | "width">>,
  ) => {
    setImageOverlays((currentOverlays) =>
      currentOverlays.map((overlay) =>
        overlay.id === id
          ? {
            ...overlay,
            ...updates,
          }
          : overlay,
      ),
    );
  };

  const updateImageOverlayPositionFromPointer = (
    id: string,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();

    const nextX = ((event.clientX - rect.left) / rect.width) * 100;
    const nextY = ((event.clientY - rect.top) / rect.height) * 100;

    updateImageOverlay(id, {
      x: clampNumber(nextX, 0, 100),
      y: clampNumber(nextY, 0, 100),
    });
  };

  const beginImageOverlayPositionDrag = (
    id: string,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    updateImageOverlayPositionFromPointer(id, event);
  };

  const getImageOverlayTimePercent = (time: number) => {
    const range = Math.max(safeTrimEnd - safeTrimStart, 0.1);

    return clampNumber(((time - safeTrimStart) / range) * 100, 0, 100);
  };

  const updateImageOverlayTimeFromPointer = (
    id: string,
    handle: "start" | "end",
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    const track = event.currentTarget.parentElement;

    if (!track || !duration) {
      return;
    }

    const rect = track.getBoundingClientRect();
    const clampedX = Math.max(rect.left, Math.min(event.clientX, rect.right));
    const nextTime = safeTrimStart + ((clampedX - rect.left) / rect.width) * (safeTrimEnd - safeTrimStart);

    const currentOverlay = imageOverlays.find((overlay) => overlay.id === id);

    if (!currentOverlay) {
      return;
    }

    if (handle === "start") {
      updateImageOverlay(id, {
        start: clampNumber(nextTime, safeTrimStart, currentOverlay.end - 0.1),
      });

      return;
    }

    updateImageOverlay(id, {
      end: clampNumber(nextTime, currentOverlay.start + 0.1, safeTrimEnd),
    });
  };

  const beginImageOverlayTimeDrag = (
    id: string,
    handle: "start" | "end",
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    updateImageOverlayTimeFromPointer(id, handle, event);
  };

  const removeImageOverlay = (id: string) => {
    setImageOverlays((currentOverlays) => {
      const overlayToRemove = currentOverlays.find((overlay) => overlay.id === id);

      if (overlayToRemove && shouldRevokeObjectUrl(overlayToRemove.url)) {
        URL.revokeObjectURL(overlayToRemove.url);
      }

      return currentOverlays.filter((overlay) => overlay.id !== id);
    });
  };

  const visibleImageOverlays = useMemo(() => {
    return imageOverlays.filter((overlay) => previewTime >= overlay.start && previewTime <= overlay.end);
  }, [imageOverlays, previewTime]);

  const syncTrimmedPreview = useCallback(
    (video: HTMLVideoElement) => {
      if (!duration) {
        return;
      }

      if (video.currentTime < safeTrimStart) {
        video.currentTime = safeTrimStart;
        return;
      }

      if (video.currentTime > safeTrimEnd) {
        video.pause();
        video.currentTime = safeTrimEnd;
      }
    },
    [duration, safeTrimEnd, safeTrimStart],
  );

  const handleMainPreviewTimeUpdate = (event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;

    setPreviewTime(video.currentTime);
    syncTrimmedPreview(video);
    syncPreviewVideo();
  };

  const handleMainPreviewLoadedMetadata = (event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    const nextDuration = video.duration;
    const nextWidth = video.videoWidth;
    const nextHeight = video.videoHeight;

    if (Number.isFinite(nextDuration) && nextDuration > 0) {
      setDuration(nextDuration);
      setTrimStart((current) => Math.min(current, nextDuration));
      setTrimEnd((current) => (current > 0 ? Math.min(current, nextDuration) : nextDuration));
      setZoomStart((current) => Math.min(current, nextDuration));
      setZoomEnd((current) => (current > 0 ? Math.min(current, nextDuration) : nextDuration));
    }

    if (nextWidth > 0 && nextHeight > 0) {
      setVideoWidth(nextWidth);
      setVideoHeight(nextHeight);
    }

    setPreviewTime(safeTrimStart);
    video.currentTime = safeTrimStart;
    syncTrimmedPreview(video);
    syncPreviewVideo();
  };

  const handleMainPreviewPlay = (event: SyntheticEvent<HTMLVideoElement>) => {
    syncTrimmedPreview(event.currentTarget);
    syncPreviewVideo();
  };

  const handleMainPreviewSeeked = (event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;

    setPreviewTime(video.currentTime);
    syncTrimmedPreview(video);
    syncPreviewVideo();
  };

  useEffect(() => {
    if (!sourceUrl) {
      return;
    }

    if (previewTime < safeTrimStart || previewTime > safeTrimEnd) {
      setPreviewTime(safeTrimStart);
      const mainVideo = previewMainVideoRef.current;
      const insetVideo = previewInsetVideoRef.current;

      if (mainVideo) {
        mainVideo.currentTime = safeTrimStart;
      }

      if (insetVideo) {
        insetVideo.currentTime = safeTrimStart;
      }
    }
  }, [previewTime, safeTrimEnd, safeTrimStart, sourceUrl]);

  const previewInsetStyle = useMemo(
    () => ({
      bottom: `${ZOOM_INSET_OFFSET_Y}px`,
      right: `${ZOOM_INSET_OFFSET_X}px`,
      height: `${ZOOM_PREVIEW_SIZE}%`,
      width: `${ZOOM_PREVIEW_SIZE}%`,
      borderRadius: `${ZOOM_INSET_RADIUS}px`,
    }),
    [],
  );

  const previewInsetVideoStyle = useMemo(() => {
    if (!videoWidth || !zoomOutputWidth) {
      return {
        transform: `scale(1)`,
        transformOrigin: "center center",
      };
    }

    const cropWidth = videoWidth * ZOOM_CROP_WIDTH;
    const scale = zoomOutputWidth / cropWidth || 1;

    return {
      transform: `scale(${scale})`,
      transformOrigin: "center center",
    };
  }, [videoWidth, zoomOutputWidth]);

  useEffect(() => {
    return () => {
      if (sourceUrl) {
        URL.revokeObjectURL(sourceUrl);
      }

      if (outputUrl) {
        URL.revokeObjectURL(outputUrl);
      }
    };
  }, [sourceUrl, outputUrl]);

  useEffect(() => {
    if (zoomStart > duration) {
      setZoomStart(duration);
    }
  }, [duration, zoomStart]);

  useEffect(() => {
    if (zoomEnd > duration) {
      setZoomEnd(duration);
    }
  }, [duration, zoomEnd]);

  useEffect(() => {
    if (zoomEnd > 0 && zoomEnd < zoomStart) {
      setZoomEnd(zoomStart);
    }
  }, [zoomEnd, zoomStart]);

  useEffect(() => {
    if (trimEnd > 0 && trimEnd < trimStart) {
      setTrimEnd(trimStart);
    }
  }, [trimEnd, trimStart]);

  useEffect(() => {
    if (outputUrl) {
      outputPreviewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [outputUrl]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const activeTrimHandle = activeTrimHandleRef.current;

      if (activeTrimHandle) {
        updateTrimFromPointer(activeTrimHandle, event.clientX);
        return;
      }

      const activeZoomHandle = activeZoomHandleRef.current;

      if (activeZoomHandle) {
        updateZoomFromPointer(activeZoomHandle, event.clientX);
      }
    };

    const handlePointerUp = () => {
      activeTrimHandleRef.current = null;
      activeZoomHandleRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [updateTrimFromPointer, updateZoomFromPointer]);

  const syncPreviewVideo = () => {
    const mainVideo = previewMainVideoRef.current;
    const insetVideo = previewInsetVideoRef.current;

    if (!mainVideo || !insetVideo || !sourceUrl) {
      return;
    }

    if (Math.abs((insetVideo.currentTime ?? 0) - mainVideo.currentTime) > 0.12) {
      insetVideo.currentTime = mainVideo.currentTime;
    }

    if (mainVideo.paused) {
      void insetVideo.pause();
      return;
    }

    void insetVideo.play().catch(() => undefined);
  };

  const createRoundedMaskBlob = async (width: number, height: number, radius: number) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Nao foi possivel criar a mascara do zoom.");
    }

    context.clearRect(0, 0, width, height);
    context.fillStyle = "#fff";
    context.beginPath();
    context.moveTo(radius, 0);
    context.lineTo(width - radius, 0);
    context.quadraticCurveTo(width, 0, width, radius);
    context.lineTo(width, height - radius);
    context.quadraticCurveTo(width, height, width - radius, height);
    context.lineTo(radius, height);
    context.quadraticCurveTo(0, height, 0, height - radius);
    context.lineTo(0, radius);
    context.quadraticCurveTo(0, 0, radius, 0);
    context.closePath();
    context.fill();

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));

    if (!blob) {
      throw new Error("Nao foi possivel gerar a mascara do zoom.");
    }

    return blob;
  };

  const createRoundedBorderBlob = async (width: number, height: number, radius: number, borderWidth: number) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Nao foi possivel criar a borda do zoom.");
    }

    context.clearRect(0, 0, width, height);
    context.strokeStyle = "rgba(0,0,0,0.8)";
    context.lineWidth = borderWidth;
    context.beginPath();
    context.moveTo(radius, borderWidth / 8);
    context.lineTo(width - radius, borderWidth / 8);
    context.quadraticCurveTo(width - borderWidth / 8, borderWidth / 8, width - borderWidth / 8, radius);
    context.lineTo(width - borderWidth / 8, height - radius);
    context.quadraticCurveTo(width - borderWidth / 8, height - borderWidth / 8, width - radius, height - borderWidth / 8);
    context.lineTo(radius, height - borderWidth / 8);
    context.quadraticCurveTo(borderWidth / 8, height - borderWidth / 8, borderWidth / 8, height - radius);
    context.lineTo(borderWidth / 8, radius);
    context.quadraticCurveTo(borderWidth / 8, borderWidth / 8, radius, borderWidth / 8);
    context.closePath();
    context.stroke();

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));

    if (!blob) {
      throw new Error("Nao foi possivel gerar a borda do zoom.");
    }

    return blob;
  };

  const ensureFFmpeg = async () => {
    if (ffmpegRef.current?.loaded) {
      return ffmpegRef.current;
    }

    if (loadPromiseRef.current) {
      return loadPromiseRef.current;
    }

    if (!ffmpegRef.current) {
      const ffmpeg = new FFmpeg();
      ffmpeg.on("log", ({ message }) => {
        lastFfmpegLogRef.current = message;
      });
      ffmpeg.on("progress", ({ progress: ffmpegProgress }) => {
        setProgress(Math.max(0, Math.min(100, Math.round(ffmpegProgress * 100))));
      });
      ffmpegRef.current = ffmpeg;
    }

    const loadPromise = (async () => {
      setStatus("Carregando motor de exportacao...");

      await ffmpegRef.current!.load({
        coreURL: await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.wasm`, "application/wasm"),
      });

      return ffmpegRef.current!;
    })();

    loadPromiseRef.current = loadPromise;

    try {
      return await loadPromise;
    } finally {
      loadPromiseRef.current = null;
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;

    if (sourceUrl) {
      URL.revokeObjectURL(sourceUrl);
    }

    if (outputUrl) {
      URL.revokeObjectURL(outputUrl);
      setOutputUrl("");
    }

    clearImageOverlays();

    setSourceFile(file);
    setDuration(0);
    setTrimStart(0);
    setTrimEnd(0);
    setZoomStart(0);
    setZoomEnd(0);
    setPreviewTime(0);
    setProgress(null);

    if (!file) {
      setSourceUrl("");
      setDownloadName("video-editado.mp4");
      setStatus("Envie um MP4 para iniciar a edição.");
      return;
    }

    const nextUrl = URL.createObjectURL(file);
    setSourceUrl(nextUrl);
    setDownloadName(`${file.name.replace(/\.mp4$/i, "") || "video"}-editado.mp4`);
    setStatus("Video carregado. Configure e gere o video editado.");
  };

  const saveEditedVideo = () => {
    if (!outputUrl) {
      return;
    }

    const anchor = document.createElement("a");
    anchor.href = outputUrl;
    anchor.download = downloadName;
    anchor.click();
  };

  const exportVideo = async () => {
    if (!sourceFile || !duration || processing) {
      return;
    }

    setProcessing(true);
    setProgress(0);
    setStatus("Preparando arquivo de entrada...");

    const safeTrimStartForExport = safeTrimStart;
    const safeTrimEndForExport = safeTrimEnd;
    const trimmedDuration = Math.max(0.1, safeTrimEndForExport - safeTrimStartForExport);
    const exportZoomStart = Math.max(0, safeZoomStart - safeTrimStartForExport);
    const exportZoomEnd = Math.max(exportZoomStart + 0.1, Math.min(safeZoomEnd - safeTrimStartForExport, trimmedDuration));
    const inputName = `entrada-${Date.now()}.mp4`;
    const maskName = `mask-${Date.now()}.png`;
    const borderName = `border-${Date.now()}.png`;
    const outputName = `saida-${Date.now()}.mp4`;
    const imageInputNames = imageOverlays.map((overlay, index) => `midia-${Date.now()}-${index}.${getOverlayExtension(overlay.kind)}`);

    try {
      const ffmpeg = await ensureFFmpeg();

      await ffmpeg.writeFile(inputName, await fetchFile(sourceFile));

      if (!zoomOutputWidth || !zoomOutputHeight) {
        throw new Error("As dimensoes do video ainda nao estao disponiveis.");
      }

      await ffmpeg.writeFile(maskName, await fetchFile(await createRoundedMaskBlob(zoomOutputWidth, zoomOutputHeight, ZOOM_INSET_RADIUS)));
      await ffmpeg.writeFile(borderName, await fetchFile(await createRoundedBorderBlob(zoomOutputWidth, zoomOutputHeight, ZOOM_INSET_RADIUS, 4)));
      for (let index = 0; index < imageOverlays.length; index += 1) {
        const overlaySource = imageOverlays[index].assetUrl || imageOverlays[index].url;
        await ffmpeg.writeFile(imageInputNames[index], await fetchFile(overlaySource));
      }

      setStatus("Cortando o video e aplicando zoom no canto inferior direito...");

      const filterSteps = [
        "[0:v]setpts=PTS-STARTPTS,split=2[base][zoomsrc]",
        `[zoomsrc]crop=iw*${ZOOM_CROP_WIDTH}:ih*${ZOOM_CROP_HEIGHT}:(iw*(1-${ZOOM_CROP_WIDTH}))/2:(ih*(1-${ZOOM_CROP_HEIGHT}))/2,scale=${zoomOutputWidth}:${zoomOutputHeight}[zoombase]`,
        "[1:v]format=gray[mask]",
        "[zoombase][mask]alphamerge[zoom]",
        `[base][zoom]overlay=W-w-${ZOOM_INSET_OFFSET_X}:H-h-${ZOOM_INSET_OFFSET_Y}:enable='between(t,${exportZoomStart.toFixed(2)},${exportZoomEnd.toFixed(2)})'[v0]`,
        `[v0][2:v]overlay=W-w-${ZOOM_INSET_OFFSET_X}:H-h-${ZOOM_INSET_OFFSET_Y}:enable='between(t,${exportZoomStart.toFixed(2)},${exportZoomEnd.toFixed(2)})'[v1]`,
      ];

      let lastVideoLabel = "v1";

      imageOverlays.forEach((overlay, index) => {
        const inputIndex = index + 3;
        const imageLabel = `img${index}`;
        const outputLabel = `v${index + 2}`;

        const imageWidthPx = Math.max(2, Math.round(((videoWidth * overlay.width) / 100) / 2) * 2);
        const imageHeightPx = overlay.naturalWidth > 0
          ? Math.max(2, Math.round(((imageWidthPx * overlay.naturalHeight) / overlay.naturalWidth) / 2) * 2)
          : Math.max(2, Math.round(((videoHeight * overlay.width) / 100) / 2) * 2);
        const imageX = Math.round((videoWidth * overlay.x) / 100 - imageWidthPx / 2);
        const imageY = Math.round((videoHeight * overlay.y) / 100 - imageHeightPx / 2);

        const imageStart = clampNumber(overlay.start - safeTrimStartForExport, 0, trimmedDuration);
        const imageEnd = clampNumber(overlay.end - safeTrimStartForExport, imageStart + 0.1, trimmedDuration);

        filterSteps.push(`[${inputIndex}:v]setpts=PTS-STARTPTS,scale=${imageWidthPx}:${imageHeightPx},format=rgba[${imageLabel}]`);
        filterSteps.push(
          `[${lastVideoLabel}][${imageLabel}]overlay=${imageX}:${imageY}:enable='between(t,${imageStart.toFixed(2)},${imageEnd.toFixed(2)})'[${outputLabel}]`,
        );

        lastVideoLabel = outputLabel;
      });

      const filterComplex = filterSteps.join(";");

      const imageInputArgs = imageOverlays.flatMap((overlay, index) => {
        const inputName = imageInputNames[index];

        if (overlay.kind === "video") {
          return ["-stream_loop", "-1", "-i", inputName];
        }

        return ["-loop", "1", "-i", inputName];
      });

      const borderInputArgs = ["-loop", "1", "-i", borderName];

      const exitCode = await ffmpeg.exec([
        "-ss",
        safeTrimStartForExport.toFixed(2),
        "-to",
        safeTrimEndForExport.toFixed(2),
        "-i",
        inputName,
        "-i",
        maskName,
        ...borderInputArgs,
        ...imageInputArgs,
        "-filter_complex",
        filterComplex,
        "-map",
        `[${lastVideoLabel}]`,
        "-map",
        "0:a?",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        "-movflags",
        "+faststart",
        "-t",
        trimmedDuration.toFixed(2),
        outputName,
      ]);

      if (exitCode !== 0) {
        throw new Error("FFmpeg terminou com erro.");
      }

      const data = await ffmpeg.readFile(outputName);
      const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(data);
      const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      const blob = new Blob([arrayBuffer], { type: "video/mp4" });
      const nextOutputUrl = URL.createObjectURL(blob);

      if (outputUrl) {
        URL.revokeObjectURL(outputUrl);
      }

      setOutputUrl(nextOutputUrl);
      setStatus("Video editado pronto para salvar.");
      setProgress(100);

      await ffmpeg.deleteFile(inputName);
      await ffmpeg.deleteFile(maskName);
      await ffmpeg.deleteFile(borderName);
      await ffmpeg.deleteFile(outputName);
      for (const imageInputName of imageInputNames) {
        await ffmpeg.deleteFile(imageInputName);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const ffmpegMessage = lastFfmpegLogRef.current.trim();

      console.error("Exportacao falhou", { error, ffmpegMessage });

      setStatus(
        ffmpegMessage
          ? `Exportacao falhou: ${ffmpegMessage}`
          : `Nao foi possivel exportar o video: ${errorMessage}. Tente um MP4 menor ou recarregue a pagina.`,
      );
    } finally {
      setProcessing(false);
    }
  };

  const prepareOverlaysToSave = async () => {
    const overlays: SavedOverlayPreset[] = [];

    for (const overlay of imageOverlays) {
      if (overlay.kind === "video") {
        continue;
      }

      let assetUrl = overlay.assetUrl || "";

      if (!assetUrl) {
        try {
          if (overlay.file) {
            assetUrl = await fileToDataUrl(overlay.file);
          } else if (overlay.url && !overlay.url.startsWith("blob:")) {
            // try fetching remote url and convert to data url (may fail due to CORS)
            const fetched = await fetch(overlay.url).then((r) => r.blob());
            assetUrl = await blobToDataUrl(fetched);
          } else if (overlay.url && overlay.url.startsWith("blob:")) {
            // blob URLs created in this session should have assetUrl already, but
            // as a fallback we try to fetch and convert via Fetch API
            try {
              const fetched = await fetch(overlay.url).then((r) => r.blob());
              assetUrl = await blobToDataUrl(fetched);
            } catch {
              // ignore — we'll fallback to using the blob URL (not ideal for persistence)
              assetUrl = overlay.url;
            }
          }
        } catch {
          // if conversion fails, fall back to existing url (may be blob: or http)
          assetUrl = overlay.assetUrl || overlay.url;
        }
      }

      if (overlay.kind === "image") {
        assetUrl = await resizeImageDataUrl(assetUrl, 512);
      }

      overlays.push({
        kind: overlay.kind,
        assetUrl,
        start: overlay.start,
        end: overlay.end,
        x: overlay.x,
        y: overlay.y,
        width: overlay.width,
        naturalWidth: overlay.naturalWidth,
        naturalHeight: overlay.naturalHeight,
      });
    }

    return overlays;
  };

  const loadPreset = (preset: VideoPreset) => {
    clearImageOverlays();

    const restoredOverlays = preset.overlays.map((overlay, index) => ({
      id: `${preset.id}-${index}`,
      file: null,
      url: overlay.assetUrl,
      assetUrl: overlay.assetUrl,
      kind: overlay.kind,
      start: overlay.start,
      end: overlay.end,
      x: overlay.x,
      y: overlay.y,
      width: overlay.width,
      naturalWidth: overlay.naturalWidth,
      naturalHeight: overlay.naturalHeight,
    } satisfies MediaOverlay));

    setImageOverlays(restoredOverlays);
    setPresetName(preset.name);
    setSelectedPresetId(preset.id);
    setStatus(`Preset "${preset.name}" carregado.`);
  };

  const savePreset = async () => {
    if (!db || !user) {
      setStatus("Faça login para salvar presets no seu Firebase.");
      return;
    }

    const overlaysToSave = await prepareOverlaysToSave();
    const payloadSize = JSON.stringify({ name: presetName.trim() || "Preset de imagens", overlays: overlaysToSave }).length;

    if (!overlaysToSave.length) {
      setStatus("Adicione imagens ou GIFs para salvar um preset.");
      return;
    }

    if (payloadSize > 900_000) {
      setStatus("O preset ficou grande demais para o Firestore. Use imagens menores ou menos overlays.");
      return;
    }

    const presetLabel = presetName.trim() || "Preset de imagens";
    const presetDocRef = selectedPresetId
      ? doc(db, "users", user.uid, "videoPresets", selectedPresetId)
      : doc(collection(db, "users", user.uid, "videoPresets"));

    setPresetSaving(true);

    try {
      const existingPreset = videoPresets.find((preset) => preset.id === selectedPresetId);

      console.debug("Salvando preset", { presetLabel, overlaysCount: overlaysToSave.length, presetId: presetDocRef.id });

      await setDoc(
        presetDocRef,
        {
          name: presetLabel,
          overlays: overlaysToSave,
          updatedAt: serverTimestamp(),
          ...(existingPreset ? {} : { createdAt: serverTimestamp() }),
        },
        { merge: true },
      );

      console.info("Preset salvo com sucesso", { presetId: presetDocRef.id });
      setSelectedPresetId(presetDocRef.id);
      setStatus(`Preset "${presetLabel}" salvo no seu Firebase (id: ${presetDocRef.id}).`);
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : typeof error === "object" && error
          ? JSON.stringify(error)
          : String(error);
      console.error("Erro ao salvar preset", {
        error,
        name: error instanceof Error ? error.name : undefined,
        code: typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : undefined,
        message: error instanceof Error ? error.message : undefined,
        payloadSize,
      });
      setStatus(`Nao foi possivel salvar o preset: ${errorMessage}`);
    } finally {
      setPresetSaving(false);
    }
  };

  const deletePreset = async (presetId: string) => {
    if (!db || !user) {
      return;
    }

    await deleteDoc(doc(db, "users", user.uid, "videoPresets", presetId));

    if (selectedPresetId === presetId) {
      setSelectedPresetId("");
      setPresetName("");
    }
  };

  return (
    <section className="rounded-3xl border border-slate-700/70 bg-slate-950/75 p-6 shadow-[0_20px_60px_rgba(0,0,0,.35)] md:p-8">
      <div className="flex flex-col gap-3 border-b border-slate-700/80 pb-5">
        <p className="inline-flex w-fit rounded-full border border-orange-300/30 px-3 py-1 text-xs uppercase tracking-[0.14em] text-orange-300">
          Editor de video
        </p>
        <h2 className="text-2xl font-bold uppercase tracking-tight text-white md:text-4xl">
          Zoom central no canto inferior direito
        </h2>
        <p className="max-w-3xl text-sm leading-6 text-slate-300 md:text-base">
          Envie um MP4, escolha o tempo em que o zoom deve entrar, o tempo total que o video deve ter e exporte.
        </p>
      </div>

      {sourceUrl && (
        <div className="mt-6 rounded-3xl border border-slate-700 bg-slate-900/80 p-4 md:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm uppercase tracking-[0.16em] text-orange-300">Prévia ao vivo</p>
            <span className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300">
              {videoWidth && videoHeight ? `${videoWidth}x${videoHeight}` : "Aguardando metadados"}
            </span>
          </div>

          <div
            className="relative overflow-hidden rounded-2xl border border-slate-700 bg-black"
            style={{
              aspectRatio: videoWidth && videoHeight ? `${videoWidth} / ${videoHeight}` : "16 / 9",
            }}
          >
            {visibleImageOverlays.map((overlay) => {
              const dispWidth = videoWidth
                ? Math.max(2, Math.round((videoWidth * overlay.width) / 100))
                : Math.max(2, Math.round((overlay.naturalWidth * overlay.width) / 100)) || overlay.naturalWidth;

              const dispHeight = overlay.naturalWidth > 0
                ? Math.max(2, Math.round((dispWidth * overlay.naturalHeight) / overlay.naturalWidth))
                : overlay.naturalHeight;

              if (overlay.kind === "video") {
                return (
                  <video
                    key={overlay.id}
                    src={overlay.url}
                    autoPlay
                    loop
                    muted
                    playsInline
                    preload="metadata"
                    className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-1/2 object-contain"
                    style={{
                      left: `${overlay.x}%`,
                      top: `${overlay.y}%`,
                      width: `${overlay.width}%`,
                      height: "auto",
                    }}
                  />
                );
              }

              return (
                <NextImage
                  key={overlay.id}
                  src={overlay.url}
                  alt="Imagem adicionada"
                  width={dispWidth}
                  height={dispHeight}
                  unoptimized
                  draggable={false}
                  className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-1/2 object-contain"
                  style={{
                    left: `${overlay.x}%`,
                    top: `${overlay.y}%`,
                    width: `${overlay.width}%`,
                    height: "auto",
                  }}
                />
              );
            })}

            <video
              src={sourceUrl}
              ref={previewMainVideoRef}
              controls
              playsInline
              onPlay={handleMainPreviewPlay}
              onPause={syncPreviewVideo}
              onSeeked={handleMainPreviewSeeked}
              onTimeUpdate={handleMainPreviewTimeUpdate}
              onLoadedMetadata={handleMainPreviewLoadedMetadata}
              className="h-full w-full object-contain"
            />

            <div
              style={{
                ...previewInsetStyle,
                opacity: previewZoomActive ? 1 : 0,
                transition: "opacity 180ms ease",
              }}
              className="pointer-events-none absolute overflow-hidden border border-black/20 bg-black/75 drop-shadow-lg"
            >
              <video
                src={sourceUrl}
                ref={previewInsetVideoRef}
                controls={false}
                playsInline
                muted
                style={previewInsetVideoStyle}
                className="h-full w-full object-cover object-center"
              />
            </div>
          </div>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-5">
          {!sourceUrl ? (
            <label className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-slate-600 bg-slate-900/80 px-5 py-10 text-center transition hover:border-orange-300/55 hover:bg-slate-900">
              <span className="text-sm uppercase tracking-[0.18em] text-orange-300">Enviar video MP4</span>
              <span className="max-w-sm text-sm text-slate-400">
                Clique para escolher um arquivo local em MP4. O processamento acontece no navegador.
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/mp4,.mp4"
                className="sr-only"
                onChange={handleFileChange}
              />
            </label>
          ) : (
            <div className="rounded-3xl border border-slate-700 bg-slate-950/65 p-4 md:p-5">
              <div className="flex  w-full flex-row items-center justify-between  text-center">
                <p className="text-sm uppercase tracking-[0.16em] text-orange-300">Video carregado</p>

                <button
                  type="button"
                  onClick={resetEditor}
                  className="rounded-xl border border-orange-300/40 bg-orange-400 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:brightness-110"
                >
                  Nova edição
                </button>
              </div>
            </div>
          )}
          <div className="rounded-3xl border border-slate-700 bg-slate-900/80 p-5">
            <div className="flex flex-wrap gap-3">
              {imageOverlays.length > 0 && (
                <div className="space-y-4 w-full">
                  {imageOverlays.map((overlay, index) => (
                    <div key={overlay.id} className="rounded-2xl border  border-slate-700 bg-slate-950/70 p-4">
                      <div className="mb-4 flex  items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <NextImage
                            src={overlay.url}
                            alt={`Imagem ${index + 1}`}
                            width={48}
                            height={48}
                            unoptimized
                            draggable={false}
                            className="h-12 w-12 rounded-lg border border-slate-700 object-contain"
                          />

                          <div>
                            <p className="text-sm font-semibold text-white">Imagem {index + 1}</p>
                            <p className="text-xs text-slate-500">
                              {overlay.naturalWidth}x{overlay.naturalHeight}
                            </p>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => removeImageOverlay(overlay.id)}
                          className="rounded-lg border border-red-400/40 px-3 py-1.5 text-xs font-semibold text-red-300 transition hover:bg-red-400/10"
                        >
                          Remover
                        </button>
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2 sm:col-span-2">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-xs uppercase tracking-[0.16em] text-slate-400">
                              Posição da imagem
                            </span>
                            <div className="mt-2 flex items-center gap-2">
                              <label className="flex items-center gap-2 text-xs text-slate-400">
                                X
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  step={0.1}
                                  value={Number(overlay.x.toFixed(1))}
                                  onChange={(e) => updateImageOverlay(overlay.id, { x: clampNumber(Number(e.target.value), 0, 100) })}
                                  className="w-20 rounded-md bg-slate-800 px-2 py-1 text-sm text-slate-100"
                                />
                              </label>

                              <label className="flex items-center gap-2 text-xs text-slate-400">
                                Y
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  step={0.1}
                                  value={Number(overlay.y.toFixed(1))}
                                  onChange={(e) => updateImageOverlay(overlay.id, { y: clampNumber(Number(e.target.value), 0, 100) })}
                                  className="w-20 rounded-md bg-slate-800 px-2 py-1 text-sm text-slate-100"
                                />
                              </label>
                            </div>
                          </div>
                          <div className="w-full flex flex-row gap-2">
                            <div className="w-full ">
                              <div
                                // eslint-disable-next-line jsx-a11y/role-has-required-aria-props
                                role="slider"
                                tabIndex={0}
                                aria-label="Mover posição da imagem"
                                onPointerDown={(event) => beginImageOverlayPositionDrag(overlay.id, event)}
                                onPointerMove={(event) => {
                                  if (event.buttons === 1) {
                                    updateImageOverlayPositionFromPointer(overlay.id, event);
                                  }
                                }}
                                className="relative aspect-video cursor-crosshair overflow-hidden rounded-2xl border border-slate-600 bg-slate-950"
                              >
                                <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(148,163,184,.16)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,.16)_1px,transparent_1px)] bg-size-[10%_10%]" />

                                <div
                                  className="absolute z-10 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-slate-950 bg-orange-400 shadow-[0_0_0_4px_rgba(251,146,60,.25)]"
                                  style={{
                                    left: `${overlay.x}%`,
                                    top: `${overlay.y}%`,
                                  }}
                                />
                              </div>

                            </div>
                            <div className="flex flex-col items-center gap-2 w-min">
                              <div className="flex flex-col items-center justify-between gap-1 w-fit">
                                <span className="text-xs uppercase tracking-[0.16em] text-slate-400 text-center">Tamanho da imagem</span>
                                <div className="text-xs text-slate-500">{overlay.width.toFixed(1)}%</div>
                              </div>

                              <div className="flex w-min h-43 items-center gap-4 rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3">
                                <div className="flex h-full w-min flex-col items-center justify-center text-[11px] uppercase tracking-[0.16em] text-slate-500">
                                  <button
                                    type="button"
                                    onClick={() => updateImageOverlay(overlay.id, { width: clampNumber(overlay.width + 0.5, 1, 100) })}
                                    disabled={processing}
                                    className="p-1"
                                    aria-label="Aumentar tamanho"
                                  >
                                    <PlusIcon className="h-4 w-4 hover:text-orange-400 text-white" />
                                  </button>

                                  <input
                                    type="range"
                                    min={1}
                                    max={100}
                                    step={0.5}
                                    value={overlay.width}
                                    onChange={(event) =>
                                      updateImageOverlay(overlay.id, {
                                        width: clampNumber(Number(event.target.value), 1, 100),
                                      })
                                    }
                                    className="h-28 w-2 cursor-pointer appearance-none rounded-full bg-slate-700 accent-orange-400 disabled:cursor-not-allowed disabled:opacity-50"
                                    style={{
                                      writingMode: "vertical-lr",
                                      direction: "rtl",
                                    }}
                                    disabled={processing}
                                  />

                                  <button
                                    type="button"
                                    onClick={() => updateImageOverlay(overlay.id, { width: clampNumber(overlay.width - 0.5, 1, 100) })}
                                    disabled={processing}
                                    className="p-1"
                                    aria-label="Diminuir tamanho"
                                  >
                                    <MinusIcon className="h-4 w-4 hover:text-orange-400 text-white" />
                                  </button>
                                </div>
                              </div>


                            </div>
                          </div>



                        </div>
                        <div className="space-y-2 sm:col-span-2">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-xs uppercase tracking-[0.16em] text-slate-400">
                              Tempo da imagem
                            </span>

                            <span className="text-xs text-slate-500">
                              {formatSeconds(overlay.start)} até {formatSeconds(overlay.end)}
                            </span>
                          </div>

                          <div className="relative h-10 rounded-full border border-slate-700 bg-slate-950/80 px-3">
                            <div className="absolute left-3 right-3 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-slate-700/80">
                              <div
                                className="absolute bottom-0 top-0 rounded-full bg-orange-400/80"
                                style={{
                                  left: `${getImageOverlayTimePercent(overlay.start)}%`,
                                  width: `${getImageOverlayTimePercent(overlay.end) - getImageOverlayTimePercent(overlay.start)}%`,
                                }}
                              />
                            </div>

                            <button
                              type="button"
                              aria-label="Mover início da imagem"
                              onPointerDown={(event) => beginImageOverlayTimeDrag(overlay.id, "start", event)}
                              onPointerMove={(event) => {
                                if (event.buttons === 1) {
                                  updateImageOverlayTimeFromPointer(overlay.id, "start", event);
                                }
                              }}
                              className="absolute top-1/2 z-10 h-5 w-5 -translate-y-1/2 rounded-full border border-slate-950/80 bg-orange-400 shadow-[0_8px_20px_rgba(242,122,33,.35)] transition hover:scale-110 focus:outline-none focus:ring-2 focus:ring-orange-300"
                              style={{
                                left: `clamp(12px, calc(12px + ${getImageOverlayTimePercent(overlay.start)}% - ${(getImageOverlayTimePercent(overlay.start) / 100) * 24}px - 10px), calc(100% - 32px))`,
                              }}
                              disabled={!duration || processing}
                            />

                            <button
                              type="button"
                              aria-label="Mover fim da imagem"
                              onPointerDown={(event) => beginImageOverlayTimeDrag(overlay.id, "end", event)}
                              onPointerMove={(event) => {
                                if (event.buttons === 1) {
                                  updateImageOverlayTimeFromPointer(overlay.id, "end", event);
                                }
                              }}
                              className="absolute top-1/2 z-10 h-5 w-5 -translate-y-1/2 rounded-full border border-slate-950/80 bg-orange-200 shadow-[0_8px_20px_rgba(242,122,33,.22)] transition hover:scale-110 focus:outline-none focus:ring-2 focus:ring-orange-300"
                              style={{
                                left: `clamp(12px, calc(12px + ${getImageOverlayTimePercent(overlay.end)}% - ${(getImageOverlayTimePercent(overlay.end) / 100) * 24}px - 10px), calc(100% - 32px))`,
                              }}
                              disabled={!duration || processing}
                            />
                          </div>

                          <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.16em] text-slate-500">
                            <span>{formatSeconds(safeTrimStart)}</span>
                            <span>{formatSeconds(safeTrimEnd)}</span>
                          </div>
                        </div>


                      </div>
                    </div>
                  ))}
                </div>
              )}
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*,video/*"
                className="hidden"
                onChange={handleImageChange}
                disabled={!sourceUrl || processing}
              />
            </div>
            <div className="mt-4 flex flex-col items-start">
              <p className="text-sm uppercase tracking-[0.16em] text-slate-400">Inserir mídia</p>
              <p className="mt-2 text-sm leading-6 text-slate-300">Selecione imagens, GIFs ou vídeos, um por vez.</p>
              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={!sourceUrl || processing}
                  className="rounded-xl border border-orange-300/40 bg-orange-400 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span>Adicionar mídia</span>
                </button>
              </div>
            </div>

            <div className="mt-5 rounded-3xl border border-slate-700 bg-slate-950/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm uppercase tracking-[0.16em] text-orange-300">Presets</p>
                  <p className="mt-1 text-sm text-slate-400">
                    Salve imagens, GIFs e posições no seu Firebase pessoal.
                  </p>
                </div>
                <span className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300">
                  {videoPresets.length} salvos
                </span>
              </div>

              {user ? (
                <div className="mt-4 space-y-4">
                  <label className="block space-y-2 text-sm text-slate-300">
                    <span>Nome do preset</span>
                    <input
                      type="text"
                      value={presetName}
                      onChange={(event) => setPresetName(event.target.value)}
                      placeholder="Ex: Mirage A smoke"
                      className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 outline-none transition focus:border-orange-300"
                    />
                  </label>

                  <label className="block space-y-2 text-sm text-slate-300">
                    <span>Carregar preset</span>
                    <select
                      value={selectedPresetId}
                      onChange={(event) => {
                        const nextPresetId = event.target.value;

                        if (!nextPresetId) {
                          setSelectedPresetId("");
                          setPresetName("");
                          clearImageOverlays();
                          return;
                        }

                        const nextPreset = videoPresets.find((preset) => preset.id === nextPresetId);

                        if (nextPreset) {
                          loadPreset(nextPreset);
                        }
                      }}
                      className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 outline-none transition focus:border-orange-300"
                    >
                      <option value="">Novo preset</option>
                      {videoPresets.map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => void savePreset()}
                      disabled={presetSaving || !imageOverlays.some((overlay) => overlay.kind !== "video")}
                      className="rounded-xl border border-orange-300/40 bg-orange-400 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {presetSaving ? "Salvando..." : selectedPresetId ? "Atualizar preset" : "Salvar preset"}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        if (!selectedPresetId) {
                          return;
                        }

                        void deletePreset(selectedPresetId);
                      }}
                      disabled={!selectedPresetId}
                      className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-sm font-semibold text-red-200 transition hover:border-red-300 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Excluir preset
                    </button>
                  </div>
                </div>
              ) : (
                <p className="mt-4 text-sm leading-6 text-slate-400">
                  Faça login para salvar e reutilizar seus presets no Firestore do seu usuário.
                </p>
              )}
            </div>
          </div>
        </div>
        <div className="space-y-6">
          <div className="rounded-3xl border border-slate-700 bg-slate-900/80 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm uppercase tracking-[0.16em] text-slate-400">Corte do video</p>
                <p className="mt-1 text-lg font-semibold text-white">
                  {trimStartLabel} até {trimEndLabel} de {durationLabel}
                </p>
              </div>
              <span className="rounded-full border border-orange-300/35 px-3 py-1 text-xs text-orange-300">
                {duration ? "Ajuste o trecho final" : "Aguardando video"}
              </span>
            </div>
            <div className="mt-4">
              <div
                ref={trimTrackRef}
                className="relative h-10 rounded-full border border-slate-700 bg-slate-950/80 px-3"
              >
                <div className="absolute left-3 right-3 top-1/2 h-1 -translate-y-1/2 rounded-full bg-slate-700/80" />
                <div
                  className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-orange-200/80"
                  style={trimRangeFillStyle}
                />
                <button
                  type="button"
                  aria-label="Mover início do corte"
                  onPointerDown={(event) => beginTrimDrag("start", event)}
                  className="absolute top-1/2 z-10 h-5 w-5 -translate-y-1/2 rounded-full border border-slate-950/80 bg-orange-200 shadow-[0_8px_20px_rgba(242,122,33,.22)] transition hover:scale-110 focus:outline-none focus:ring-2 focus:ring-orange-300"
                  style={{
                    left: `clamp(0px, calc(${(safeTrimStart / Math.max(duration, 1)) * 100}% - 10px), calc(100% - 20px))`,
                  }}
                  disabled={!duration}
                />
                <button
                  type="button"
                  aria-label="Mover fim do corte"
                  onPointerDown={(event) => beginTrimDrag("end", event)}
                  className="absolute top-1/2 z-10 h-5 w-5 -translate-y-1/2 rounded-full border border-slate-950/80 bg-orange-100 shadow-[0_8px_20px_rgba(242,122,33,.18)] transition hover:scale-110 focus:outline-none focus:ring-2 focus:ring-orange-300"
                  style={{
                    left: `clamp(0px, calc(${(safeTrimEnd / Math.max(duration, 1)) * 100}% - 10px), calc(100% - 20px))`,
                  }}
                  disabled={!duration}
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px] uppercase tracking-[0.16em] text-slate-500">
                <span>Início</span>
                <span>Fim</span>
              </div>
            </div>
          </div>
          <div className="rounded-3xl border border-slate-700 bg-slate-900/80 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm uppercase tracking-[0.16em] text-slate-400">Momento do zoom</p>
                <p className="mt-1 text-lg font-semibold text-white">
                  {zoomStartLabel} até {zoomEndLabel} de {durationLabel}
                </p>
              </div>
              <span className="rounded-full border border-orange-300/35 px-3 py-1 text-xs text-orange-300">
                {duration ? "Pronto para editar" : "Aguardando video"}
              </span>
            </div>
            <div className="mt-4">
              <div
                ref={zoomTrackRef}
                className="relative h-10 rounded-full border border-slate-700 bg-slate-950/80 px-3"
              >
                <div className="absolute left-3 right-3 top-1/2 h-1 -translate-y-1/2 rounded-full bg-slate-700/80" />
                <div
                  className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-orange-400/80"
                  style={zoomRangeFillStyle}
                />
                <button
                  type="button"
                  aria-label="Mover início do zoom"
                  onPointerDown={(event) => beginZoomDrag("start", event)}
                  className="absolute top-1/2 z-10 h-5 w-5 -translate-y-1/2 rounded-full border border-slate-950/80 bg-orange-400 shadow-[0_8px_20px_rgba(242,122,33,.35)] transition hover:scale-110 focus:outline-none focus:ring-2 focus:ring-orange-300"
                  style={{
                    left: `clamp(0px, calc(${(safeZoomStart / Math.max(duration, 1)) * 100}% - 10px), calc(100% - 20px))`,
                  }}
                  disabled={!duration}
                />
                <button
                  type="button"
                  aria-label="Mover fim do zoom"
                  onPointerDown={(event) => beginZoomDrag("end", event)}
                  className="absolute top-1/2 z-10 h-5 w-5 -translate-y-1/2 rounded-full border border-slate-950/80 bg-orange-200 shadow-[0_8px_20px_rgba(242,122,33,.22)] transition hover:scale-110 focus:outline-none focus:ring-2 focus:ring-orange-300"
                  style={{
                    left: `clamp(0px, calc(${(safeZoomEnd / Math.max(duration, 1)) * 100}% - 10px), calc(100% - 20px))`,
                  }}
                  disabled={!duration}
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px] uppercase tracking-[0.16em] text-slate-500">
                <span>Inicio</span>
                <span>Fim</span>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-700 bg-slate-900/80 p-5 pb-6">
              <p className="text-sm uppercase tracking-[0.16em] text-slate-400">Exportação</p>
              <p className="mt-2 text-sm leading-6 text-slate-300">Primeiro gere o arquivo e depois salve.</p>

            <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void exportVideo()}
                  disabled={!sourceFile || !duration || processing}
                  className="rounded-xl border border-orange-300/40 bg-orange-400 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {processing ? "Processando..." : "Gerar vídeo editado"}
                </button>

                <button
                  type="button"
                  onClick={saveEditedVideo}
                  disabled={!outputUrl}
                  className="rounded-xl border border-slate-600 bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-100 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Salvar vídeo editado
                </button>
            </div>

            <div className="mt-4 rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-slate-300">
              <p>{status}</p>
              <p className="mt-1 text-xs text-slate-500">
                {progress !== null ? `Progresso: ${progress}%` : "Progresso: aguardando"}
              </p>
            </div>
          </div>

          {outputUrl && (
            <div ref={outputPreviewRef} className="rounded-3xl border border-orange-300/25 bg-slate-900/80 p-5 shadow-[0_0_0_1px_rgba(242,122,33,.1)]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm uppercase tracking-[0.16em] text-orange-300">Prévia do vídeo editado</p>
                  <p className="mt-1 text-sm text-slate-400">
                    Reproduza aqui para conferir se o zoom e a posição ficaram corretos antes de salvar.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={saveEditedVideo}
                  className="rounded-xl border border-orange-300/40 bg-orange-400 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:brightness-110"
                >
                  Salvar video editado
                </button>
              </div>
              <video
                src={outputUrl}
                controls
                playsInline
                autoPlay={false}
                className="mt-4 aspect-video w-full rounded-2xl border border-slate-700 bg-black object-contain"
              />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}