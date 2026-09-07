/**
 * Declaración mínima de `page-flip` (StPageFlip) — el paquete no trae `.d.ts`.
 * Solo lo que usa `BookLayout` (Fase 15b). Ver https://nodlik.github.io/StPageFlip/.
 */
declare module 'page-flip/dist/js/page-flip.module.js' {
  export interface PageFlipSettings {
    width: number;
    height: number;
    size?: 'fixed' | 'stretch';
    minWidth?: number;
    maxWidth?: number;
    minHeight?: number;
    maxHeight?: number;
    drawShadow?: boolean;
    flippingTime?: number;
    usePortrait?: boolean;
    startZIndex?: number;
    autoSize?: boolean;
    maxShadowOpacity?: number;
    showCover?: boolean;
    mobileScrollSupport?: boolean;
    clickEventForward?: boolean;
    useMouseEvents?: boolean;
    swipeDistance?: number;
    showPageCorners?: boolean;
    disableFlipByClick?: boolean;
  }

  export class PageFlip {
    constructor(element: HTMLElement, settings: PageFlipSettings);
    loadFromHTML(items: NodeListOf<Element> | HTMLElement[]): void;
    update(): void;
    destroy(): void;
    flipNext(corner?: 'top' | 'bottom'): void;
    flipPrev(corner?: 'top' | 'bottom'): void;
    flip(page: number, corner?: 'top' | 'bottom'): void;
    getCurrentPageIndex(): number;
    getPageCount(): number;
    on(
      event: 'flip' | 'changeOrientation' | 'changeState' | 'init' | 'update',
      cb: (e: { data: unknown; object: PageFlip }) => void,
    ): void;
  }
}
