import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { clampTrendWindowStart } from './dashboard-trend';

const DAY_DRAG_THRESHOLD = 60;
const DRAG_ACTIVATION_DISTANCE = 6;
const WHEEL_THROTTLE_MS = 110;
const TOOLTIP_RELEASE_DELAY_MS = 120;

interface DraggableTimeWindowOptions {
  totalDays: number;
  visibleDays: number;
}

export function useDraggableTimeWindow({
  totalDays,
  visibleDays,
}: DraggableTimeWindowOptions) {
  const maxStart = Math.max(0, totalDays - visibleDays);
  const [windowStart, setWindowStart] = useState(() => maxStart);
  const [isDragging, setIsDragging] = useState(false);
  const [tooltipSuppressed, setTooltipSuppressed] = useState(false);
  const interactionRef = useRef<HTMLDivElement>(null);
  const dragStartXRef = useRef<number | null>(null);
  const dragStartWindowRef = useRef(0);
  const didDragRef = useRef(false);
  const followingLatestRef = useRef(true);
  const lastWheelAtRef = useRef(0);
  const tooltipTimerRef = useRef<number | null>(null);

  const commitWindow = useCallback((nextStart: number) => {
    const next = clampTrendWindowStart(nextStart, totalDays, visibleDays);
    followingLatestRef.current = next === maxStart;
    setWindowStart(next);
  }, [maxStart, totalDays, visibleDays]);

  const moveWindow = useCallback((dayDelta: number) => {
    setWindowStart((current) => {
      const next = clampTrendWindowStart(current + dayDelta, totalDays, visibleDays);
      followingLatestRef.current = next === maxStart;
      return next;
    });
  }, [maxStart, totalDays, visibleDays]);

  const goToToday = useCallback(() => commitWindow(maxStart), [commitWindow, maxStart]);

  useEffect(() => {
    setWindowStart((current) => followingLatestRef.current
      ? maxStart
      : clampTrendWindowStart(current, totalDays, visibleDays));
  }, [maxStart, totalDays, visibleDays]);

  useEffect(() => {
    const element = interactionRef.current;
    if (!element) return undefined;

    const handleWheel = (event: WheelEvent) => {
      const direction = Math.abs(event.deltaX) > Math.abs(event.deltaY)
        ? event.deltaX
        : event.shiftKey
          ? event.deltaY
          : 0;
      if (direction === 0) return;

      event.preventDefault();
      const now = performance.now();
      if (now - lastWheelAtRef.current < WHEEL_THROTTLE_MS) return;
      lastWheelAtRef.current = now;
      moveWindow(direction > 0 ? 1 : -1);
      setTooltipSuppressed(true);
      if (tooltipTimerRef.current !== null) window.clearTimeout(tooltipTimerRef.current);
      tooltipTimerRef.current = window.setTimeout(
        () => setTooltipSuppressed(false),
        TOOLTIP_RELEASE_DELAY_MS,
      );
    };

    element.addEventListener('wheel', handleWheel, { passive: false });
    return () => element.removeEventListener('wheel', handleWheel);
  }, [moveWindow]);

  useEffect(() => () => {
    if (tooltipTimerRef.current !== null) window.clearTimeout(tooltipTimerRef.current);
  }, []);

  const finishPointer = useCallback((element?: HTMLDivElement, pointerId?: number) => {
    if (element && pointerId !== undefined && element.hasPointerCapture(pointerId)) {
      element.releasePointerCapture(pointerId);
    }
    dragStartXRef.current = null;
    setIsDragging(false);
    if (didDragRef.current) {
      if (tooltipTimerRef.current !== null) window.clearTimeout(tooltipTimerRef.current);
      tooltipTimerRef.current = window.setTimeout(() => {
        setTooltipSuppressed(false);
        didDragRef.current = false;
      }, TOOLTIP_RELEASE_DELAY_MS);
    } else {
      setTooltipSuppressed(false);
    }
  }, []);

  const handlePointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || dragStartXRef.current !== null) return;
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartXRef.current = event.clientX;
    dragStartWindowRef.current = windowStart;
    didDragRef.current = false;
  }, [windowStart]);

  const handlePointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (dragStartXRef.current === null) return;
    const deltaX = event.clientX - dragStartXRef.current;
    if (!didDragRef.current && Math.abs(deltaX) >= DRAG_ACTIVATION_DISTANCE) {
      didDragRef.current = true;
      setIsDragging(true);
      setTooltipSuppressed(true);
    }
    if (!didDragRef.current) return;

    event.preventDefault();
    const dayOffset = Math.round(deltaX / DAY_DRAG_THRESHOLD);
    commitWindow(dragStartWindowRef.current - dayOffset);
  }, [commitWindow]);

  const handlePointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
    finishPointer(event.currentTarget, event.pointerId);
  }, [finishPointer]);

  const handlePointerCancel = useCallback((event: PointerEvent<HTMLDivElement>) => {
    finishPointer(event.currentTarget, event.pointerId);
  }, [finishPointer]);

  const handlePointerLeave = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.buttons === 0 && dragStartXRef.current !== null) {
      finishPointer(event.currentTarget, event.pointerId);
    }
  }, [finishPointer]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') moveWindow(-1);
    else if (event.key === 'ArrowRight') moveWindow(1);
    else if (event.key === 'Home') commitWindow(0);
    else if (event.key === 'End') goToToday();
    else return;
    event.preventDefault();
    setTooltipSuppressed(false);
  }, [commitWindow, goToToday, moveWindow]);

  const handleBlur = useCallback(() => {
    if (dragStartXRef.current !== null) finishPointer();
  }, [finishPointer]);

  return {
    interactionRef,
    windowStart,
    maxStart,
    isDragging,
    tooltipSuppressed,
    canMoveOlder: windowStart > 0,
    canMoveNewer: windowStart < maxStart,
    moveWindow,
    goToToday,
    interactionProps: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerCancel,
      onPointerLeave: handlePointerLeave,
      onLostPointerCapture: handlePointerCancel,
      onKeyDown: handleKeyDown,
      onBlur: handleBlur,
    },
  };
}
