import type { CSSProperties } from 'react'

/**
 * How a lead image sits in the cropped boxes that show it: the homepage lead
 * story (16:10), story cards (16:9) and the article hero (16:8, 4:3 on phones).
 *
 * `center` is the default crop. `left`/`right`/`top`/`bottom` keep that edge
 * of the picture in view. `fit` shows the whole image, letterboxed over a
 * blurred copy of itself, for artwork that must not be cut (title cards,
 * portraits at one edge).
 *
 * Stored as a fragment on `image_url` (`…/photo.png#frame=right`) rather than a
 * column, so it travels through drafts → publish_editorial_draft → articles →
 * public_article_index with no migration. Browsers never send a fragment, so
 * the image request is unchanged; `safeImageUrl()` strips it for every other
 * use (Open Graph, RSS, JSON-LD).
 */
export const IMAGE_FRAMES = ['center', 'left', 'right', 'top', 'bottom', 'fit'] as const
export type ImageFrame = typeof IMAGE_FRAMES[number]

export const IMAGE_FRAME_LABELS: Record<ImageFrame, string> = {
  center: 'Centre',
  left: 'Left',
  right: 'Right',
  top: 'Top',
  bottom: 'Bottom',
  fit: 'Whole image',
}

const FRAGMENT = /#frame=([a-z]+)$/

export function isImageFrame(value: unknown): value is ImageFrame {
  return IMAGE_FRAMES.some(frame => frame === value)
}

/** The framing saved on an image URL; `center` when none is. */
export function imageFrameOf(url: string | null | undefined): ImageFrame {
  const match = url?.trim().match(FRAGMENT)?.[1]
  return isImageFrame(match) ? match : 'center'
}

/** The URL without its framing fragment. */
export function stripImageFrame(url: string): string {
  return url.trim().replace(FRAGMENT, '')
}

/** Save a framing on an image URL; `center` removes it. */
export function withImageFrame(url: string, frame: ImageFrame): string {
  const bare = stripImageFrame(url)
  return !bare || frame === 'center' ? bare : `${bare}#frame=${frame}`
}

const POSITION: Record<Exclude<ImageFrame, 'fit'>, string> = {
  center: '50% 50%',
  left: '0% 50%',
  right: '100% 50%',
  top: '50% 0%',
  bottom: '50% 100%',
}

/** Inline style for the cropped <img>. */
export function imageFrameStyle(frame: ImageFrame): CSSProperties | undefined {
  if (frame === 'fit') return { objectFit: 'contain' }
  return frame === 'center' ? undefined : { objectPosition: POSITION[frame] }
}

/**
 * Props for the element wrapping a `fit` image: a class that paints a blurred
 * copy of the picture behind it, so the letterbox bars are not flat colour.
 */
export function imageFrameBox(frame: ImageFrame, src: string): { className?: string; style?: CSSProperties } {
  if (frame !== 'fit') return {}
  return {
    className: 'image-frame-fit',
    style: { '--image-frame-src': `url("${src.replace(/"/g, '%22')}")` } as CSSProperties,
  }
}
