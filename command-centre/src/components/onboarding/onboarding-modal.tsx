"use client";

import { useState, useEffect, useCallback } from "react";
import { useContextStore } from "@/store/context-store";
import { useTaskStore } from "@/store/task-store";
import { useClientStore } from "@/store/client-store";
import {
  findReusableStartHereTask,
  markOnboardingCompleted,
  readOnboardingStorage,
  shouldQueueStartHereTask,
  shouldShowOnboarding,
  START_HERE_DESCRIPTION,
  START_HERE_TITLE,
  type OnboardingStorageState,
} from "./onboarding-state";

const SLIDES = [
  {
    headline: "Not just a chatbot.",
    body: "AI-OS is a Claude-powered operating system for your business. It has memory, skills, and brand context built right in — so you never explain yourself twice.",
  },
  {
    headline: "It knows your brand.",
    body: "Your voice, positioning, and ideal customer live in the system. Every skill reads that context automatically — marketing, strategy, operations — all in your style.",
  },
  {
    headline: "It gets smarter every session.",
    body: "After each session, lessons get logged. What worked, what didn't, what you prefer. The more you use it, the better it fits.",
  },
  {
    headline: "Let's set you up.",
    body: "We'll start by capturing your brand voice, market positioning, and ideal customer — the foundation every skill builds on.",
    isLast: true,
  },
];

const EXIT_MS = 150;

interface OnboardingModalProps {
  forceVisible?: boolean;
  onForceClose?: () => void;
}

export function OnboardingModal({ forceVisible, onForceClose }: OnboardingModalProps) {
  const fetchContextStatus = useContextStore((s) => s.fetchContextStatus);
  const rootHasBrandContext = useContextStore((s) => s.getHasBrandContext(null));
  const fetchTasks = useTaskStore((s) => s.fetchTasks);
  const createTask = useTaskStore((s) => s.createTask);
  const updateTask = useTaskStore((s) => s.updateTask);
  const selectedClientId = useClientStore((s) => s.selectedClientId);

  const [storageState, setStorageState] = useState<OnboardingStorageState | null>(null);
  const [tasksReady, setTasksReady] = useState(false);
  const [creating, setCreating] = useState(false);
  const [dismissedForSession, setDismissedForSession] = useState(false);

  // Animation state
  const [displaySlide, setDisplaySlide] = useState(0);
  const [contentKey, setContentKey] = useState(0);
  const [exiting, setExiting] = useState(false);
  const [direction, setDirection] = useState<1 | -1>(1); // 1 = forward, -1 = backward
  const [modalExiting, setModalExiting] = useState(false);
  const [isFirstRender, setIsFirstRender] = useState(true);

  const MODAL_EXIT_MS = 440;

  useEffect(() => {
    const t = setTimeout(() => setIsFirstRender(false), 750);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    setStorageState(readOnboardingStorage(localStorage));
  }, []);

  useEffect(() => {
    fetchContextStatus(null);
  }, [fetchContextStatus]);

  useEffect(() => {
    if (rootHasBrandContext === true) {
      markOnboardingCompleted(localStorage);
      setStorageState(readOnboardingStorage(localStorage));
    }
  }, [rootHasBrandContext]);

  useEffect(() => {
    fetchTasks().finally(() => setTasksReady(true));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (forceVisible) {
      setModalExiting(false);
      setExiting(false);
      setDisplaySlide(0);
      setContentKey((k) => k + 1);
    }
  }, [forceVisible]);

  const triggerModalExit = useCallback((onDone: () => void) => {
    setModalExiting(true);
    setTimeout(onDone, MODAL_EXIT_MS);
  }, [MODAL_EXIT_MS]);

  const goTo = useCallback((next: number) => {
    if (exiting || next === displaySlide) return;
    setDirection(next > displaySlide ? 1 : -1);
    setExiting(true);
    setTimeout(() => {
      setDisplaySlide(next);
      setContentKey((k) => k + 1);
      setExiting(false);
    }, EXIT_MS);
  }, [exiting, displaySlide]);

  const dismissForSession = () => {
    setDismissedForSession(true);
  };

  const handleSkip = () => {
    if (forceVisible && onForceClose) {
      triggerModalExit(onForceClose);
    } else {
      triggerModalExit(dismissForSession);
    }
  };

  const handleGetStarted = async () => {
    if (forceVisible && onForceClose) {
      triggerModalExit(onForceClose);
      return;
    }
    setCreating(true);
    try {
      const current = useTaskStore.getState().tasks;
      let startHereTask = findReusableStartHereTask(current, null);
      if (!startHereTask) {
        const taskId = await createTask(
          START_HERE_TITLE,
          START_HERE_DESCRIPTION,
          "task",
          null,
          null,
          "bypassPermissions",
          undefined,
          null
        );
        startHereTask = taskId
          ? findReusableStartHereTask(useTaskStore.getState().tasks, null)
          : null;
      }
      if (startHereTask) {
        if (shouldQueueStartHereTask(startHereTask)) {
          await updateTask(startHereTask.id, { status: "queued" });
        }
      }
    } finally {
      setCreating(false);
      triggerModalExit(dismissForSession);
    }
  };

  const visible = shouldShowOnboarding({
    forceVisible,
    storage: storageState,
    tasksReady,
    hasBrandContext: rootHasBrandContext,
    dismissedForSession,
    selectedClientId,
  });

  if (!visible) return null;

  const current = SLIDES[displaySlide];
  const isLast = !!current.isLast;

  return (
    <>
      <style>{`
        @keyframes aios-modal-in {
          from { transform: translateY(100vh); }
          to   { transform: translateY(0); }
        }
        @keyframes aios-modal-out {
          0%   { opacity: 1; transform: translateX(0)     scale(1);    }
          100% { opacity: 0; transform: translateX(-90px) scale(0.96); }
        }
        @keyframes aios-content-entrance {
          from { opacity: 0; transform: translateY(80px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes aios-enter-fwd {
          from { opacity: 0; transform: translateX(48px); }
          to   { opacity: 1; transform: translateX(0);    }
        }
        @keyframes aios-enter-bwd {
          from { opacity: 0; transform: translateX(-48px); }
          to   { opacity: 1; transform: translateX(0);     }
        }
        .aios-btn:active { transform: scale(0.97); }
      `}</style>

      <div
        style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "#F9F9F9",
          zIndex: 1000,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "40px 24px",
          animation: modalExiting
            ? `aios-modal-out ${MODAL_EXIT_MS}ms cubic-bezier(0.4, 0, 0.6, 1) forwards`
            : "aios-modal-in 380ms cubic-bezier(0.22, 1, 0.36, 1) both",
        }}
      >
        {/* Wordmark */}
        <div
          style={{
            position: "absolute",
            top: 28,
            left: 0,
            right: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            animation: isFirstRender ? "aios-content-entrance 400ms cubic-bezier(0.22, 1, 0.36, 1) 100ms both" : "none",
          }}
        >
          <span aria-hidden="true" style={{ fontWeight: 700 }}>AI</span>
          <span
            style={{
              fontFamily: "var(--font-epilogue), Epilogue, sans-serif",
              fontWeight: 700,
              fontSize: 15,
              color: "#1C1C1C",
              letterSpacing: "-0.02em",
              lineHeight: 1,
              marginTop: 3,
            }}
          >
            AI-OS
          </span>
        </div>

        {/* Slide content — fades out on exit, new content animates in */}
        <div
          style={{
            opacity: exiting ? 0 : 1,
            transform: exiting ? `translateX(${direction === 1 ? -32 : 32}px)` : "translateX(0)",
            transition: `opacity ${EXIT_MS}ms ease, transform ${EXIT_MS}ms ease`,
            maxWidth: 600,
            width: "100%",
            textAlign: "center",
          }}
        >
          <div
            key={contentKey}
            style={{
              animation: isFirstRender
                ? "aios-content-entrance 500ms cubic-bezier(0.22, 1, 0.36, 1) 200ms both"
                : `${direction === 1 ? "aios-enter-fwd" : "aios-enter-bwd"} 320ms cubic-bezier(0.22, 1, 0.36, 1) both`,
            }}
          >
            {/* Slide counter */}
            <p
              style={{
                fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "#5C5C5C",
                marginBottom: 20,
                opacity: 0.6,
              }}
            >
              {displaySlide + 1} / {SLIDES.length}
            </p>

            <h1
              style={{
                fontFamily: "var(--font-epilogue), Epilogue, sans-serif",
                fontWeight: 800,
                fontSize: "clamp(32px, 5vw, 54px)",
                color: "#1C1C1C",
                marginBottom: 24,
                lineHeight: 1.1,
                letterSpacing: "-0.03em",
              }}
            >
              {current.headline}
            </h1>

            {/* Accent line */}
            <div
              style={{
                width: 40,
                height: 3,
                backgroundColor: "#5C5C5C",
                borderRadius: 2,
                margin: "0 auto 28px",
                opacity: 0.55,
              }}
            />

            <p
              style={{
                fontFamily: "var(--font-epilogue), Epilogue, sans-serif",
                fontWeight: 300,
                fontSize: 18,
                lineHeight: 1.75,
                color: "#5F5F5F",
                maxWidth: 480,
                margin: "0 auto 48px",
              }}
            >
              {current.body}
            </p>

            {isLast ? (
              <button
                className="aios-btn"
                onClick={handleGetStarted}
                disabled={creating}
                style={{
                  padding: "14px 48px",
                  backgroundColor: "#5C5C5C",
                  color: "#FFFFFF",
                  border: "none",
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 700,
                  fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  cursor: creating ? "not-allowed" : "pointer",
                  opacity: creating ? 0.7 : 1,
                  transition: "opacity 150ms ease, transform 100ms ease",
                  boxShadow: "0 2px 10px rgba(92, 92, 92, 0.28)",
                }}
                onMouseEnter={(e) => { if (!creating) e.currentTarget.style.opacity = "0.86"; }}
                onMouseLeave={(e) => { if (!creating) e.currentTarget.style.opacity = "1"; }}
              >
                {creating ? "Setting up..." : "Get Started"}
              </button>
            ) : (
              <button
                className="aios-btn"
                onClick={() => goTo(displaySlide + 1)}
                style={{
                  padding: "14px 48px",
                  backgroundColor: "#5C5C5C",
                  color: "#FFFFFF",
                  border: "none",
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 700,
                  fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  cursor: "pointer",
                  transition: "opacity 150ms ease, transform 100ms ease",
                  boxShadow: "0 2px 10px rgba(92, 92, 92, 0.28)",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.86"; }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
              >
                Next
              </button>
            )}
          </div>
        </div>

        {/* Dot indicators + skip */}
        <div
          style={{
            position: "absolute",
            bottom: 32,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 14,
            animation: isFirstRender ? "aios-content-entrance 400ms cubic-bezier(0.22, 1, 0.36, 1) 350ms both" : "none",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {SLIDES.map((_, i) => (
              <button
                key={i}
                onClick={() => goTo(i)}
                style={{
                  width: i === displaySlide ? 22 : 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: i === displaySlide ? "#5C5C5C" : "rgba(92, 92, 92, 0.2)",
                  border: "none",
                  padding: 0,
                  cursor: i === displaySlide ? "default" : "pointer",
                  transition: "width 250ms cubic-bezier(0.22, 1, 0.36, 1), background-color 250ms ease",
                }}
              />
            ))}
          </div>
          <button
            onClick={handleSkip}
            style={{
              background: "none",
              border: "none",
              color: "#B1B1B1",
              fontSize: 12,
              cursor: "pointer",
              fontFamily: "var(--font-inter), Inter, sans-serif",
              padding: "4px 8px",
              transition: "color 150ms ease",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "#5F5F5F"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "#B1B1B1"; }}
          >
            {forceVisible ? "Close preview" : "Skip for now"}
          </button>
        </div>
      </div>
    </>
  );
}
