declare module "page-flip" {
  export interface PageFlipSettings {
    width?: number;
    height?: number;
    size?: "fixed" | "stretch";
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
    swipeDistance?: number;
    clickEventForward?: boolean;
    useMouseEvents?: boolean;
    showPageCorners?: boolean;
    disableFlipByClick?: boolean;
    startPage?: number;
  }

  export type FlipCorner = "top" | "bottom";

  export interface FlipEvent {
    data: number;
    object: any;
  }

  export class PageFlip {
    constructor(element: HTMLElement, settings: PageFlipSettings);
    loadFromImages(images: string[]): void;
    loadFromHtml(items: HTMLElement[]): void;
    updateFromImages(images: string[]): void;
    updateFromHtml(items: HTMLElement[]): void;
    clear(): void;
    turnToPrevPage(): void;
    turnToNextPage(): void;
    turnToPage(page: number): void;
    flipNext(corner?: FlipCorner): void;
    flipPrev(corner?: FlipCorner): void;
    flip(page: number, corner?: FlipCorner): void;
    destroy(): void;
    on(event: "flip", callback: (e: FlipEvent) => void): void;
    on(event: "changeState" | "changeOrientation" | "init", callback: (e: any) => void): void;
    on(event: string, callback: (e: any) => void): void;
    off(event: string): void;
    getPageCount(): number;
    getCurrentPageIndex(): number;
    getOrientation(): "landscape" | "portrait";
    getSettings(): PageFlipSettings & { [key: string]: any };
    setting: any;
  }
}
