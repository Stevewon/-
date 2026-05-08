import { ReactNode } from 'react';

/**
 * DesktopPageLayout — unified content wrapper used across all
 * full-width data pages (Markets / Orders / Wallet).
 *
 * Hard-coded responsive spec (do NOT modify):
 *   Mobile  (<768px):  width 100%, padding-left/right 16px
 *   Tablet  (768–1279px): max-width 1280px, padding-left/right 20px
 *   Desktop (>=1280px):  max-width 1600px, padding-left/right 24px
 *   padding-top: 16px, padding-bottom: 24px on all breakpoints
 *   margin: 0 auto (always center)
 *   box-sizing: border-box
 *
 * The class `qx-page-wrapper` is consumed by a global media-query
 * <style> block injected once below — sharing the SAME wrapper rules
 * across pages so Trade-level desktop width is uniformly applied.
 */
export default function DesktopPageLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <style>{`
        .qx-page-wrapper {
          width: 100%;
          margin-left: auto;
          margin-right: auto;
          padding-left: 16px;
          padding-right: 16px;
          padding-top: 16px;
          padding-bottom: 24px;
          box-sizing: border-box;
          max-width: 100%;
        }
        @media (min-width: 768px) {
          .qx-page-wrapper {
            max-width: 1280px;
            padding-left: 20px;
            padding-right: 20px;
          }
        }
        @media (min-width: 1280px) {
          .qx-page-wrapper {
            max-width: 1600px;
            padding-left: 24px;
            padding-right: 24px;
          }
        }
        /* Common page heading block */
        .qx-page-title {
          width: 100%;
          margin-bottom: 16px;
        }
        /* Common toolbar / filter row */
        .qx-page-toolbar {
          width: 100%;
          margin-bottom: 12px;
        }
        /* Main table/card content fills the wrapper */
        .qx-page-main {
          width: 100%;
          border-radius: 12px;
          overflow: hidden;
        }
        .qx-page-main-scroll {
          width: 100%;
          overflow-x: auto;
        }
      `}</style>
      <div className="qx-page-wrapper">{children}</div>
    </>
  );
}
