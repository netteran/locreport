const test = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./fixtures/typescript.cjs')

const {
  imageFrameOf, withImageFrame, stripImageFrame, imageFrameStyle, imageFrameBox, IMAGE_FRAMES,
} = load('lib/imageFrame.ts')
const { safeImageUrl } = load('lib/utils.ts')

const photo = 'https://project.supabase.co/storage/v1/object/public/images/articles/2026/11/abc-signal-room.png'

test('framing is saved on the image URL and read back', () => {
  assert.equal(imageFrameOf(photo), 'center')
  assert.equal(imageFrameOf(null), 'center')
  for (const frame of IMAGE_FRAMES) {
    const saved = withImageFrame(photo, frame)
    assert.equal(imageFrameOf(saved), frame)
    assert.equal(stripImageFrame(saved), photo)
  }
  assert.equal(withImageFrame(photo, 'center'), photo, 'centre is the default and stores nothing')
  assert.equal(withImageFrame(`${photo}#frame=left`, 'right'), `${photo}#frame=right`, 'a new choice replaces the old one')
  assert.equal(withImageFrame('', 'left'), '', 'no image, no framing')
  assert.equal(imageFrameOf(`${photo}#frame=sideways`), 'center', 'unknown values fall back to centre')
})

test('every other use of the image gets the clean URL', () => {
  assert.equal(safeImageUrl(`${photo}#frame=right`), photo)
  assert.equal(safeImageUrl(`  ${photo}#frame=fit  `), photo)
  assert.equal(safeImageUrl(photo), photo)
  assert.equal(safeImageUrl('javascript:alert(1)#frame=fit'), null)
})

test('crop positions and the whole-image backdrop', () => {
  assert.equal(imageFrameStyle('center'), undefined)
  assert.deepEqual(imageFrameStyle('right'), { objectPosition: '100% 50%' })
  assert.deepEqual(imageFrameStyle('top'), { objectPosition: '50% 0%' })
  assert.deepEqual(imageFrameStyle('fit'), { objectFit: 'contain' })
  assert.deepEqual(imageFrameBox('left', photo), {})
  const box = imageFrameBox('fit', 'https://example.test/a"b.png')
  assert.equal(box.className, 'image-frame-fit')
  assert.equal(box.style['--image-frame-src'], 'url("https://example.test/a%22b.png")')
})
